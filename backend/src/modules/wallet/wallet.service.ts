import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LedgerAccountType, LedgerDirection, PaymentStatus, Prisma, WalletTransactionType } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { isStaff } from '../../common/enums/role.enum';
import { decodeCursor, encodeCursor } from '../../common/utils/pagination';
import { PrismaService } from '../../database/prisma.service';
import type { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';
import { DEFAULT_WALLET_CURRENCY } from './dto/wallet.dto';
import type { ConvertCoinsDto, RequestWithdrawalDto, TransferWalletDto } from './dto/wallet.dto';

interface Actor {
  id: string;
  role: string;
}

/** Transaction wallet enrichie du ledger (idempotencyKey) pour l'idempotence. */
type WalletTxWithLedger = Prisma.WalletTransactionGetPayload<{
  include: { ledgerTransaction: true };
}>;

const TX_INCLUDE = { ledgerTransaction: true } as const;

/**
 * Portefeuilles multi-devises AFRI-WALLET (XOF par defaut).
 *
 * Invariants :
 * - un wallet par (userId, currency) — upsert + contrainte unique ;
 * - toute ecriture est defendue par une garde de gel (WALLET_FROZEN) ;
 * - la monnaie circule exclusivement en unites mineures entieres ;
 * - debit atomique : updateMany({ balanceMinor: { gte: amount } }) -> si 0 ligne
 *   touchee, un debit concurrent a gagne la course => INSUFFICIENT_BALANCE ;
 * - idempotence : cle stockee sur LedgerTransaction.idempotencyKey (contrainte
 *   unique existante) + relation WalletTransaction.ledgerTransactionId —
 *   jamais de double debit, la transaction existante est renvoyee ;
 * - retrait : somme des WITHDRAW du jour comparee a dailyLimitMinor.
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // ------------------------------------------------------------ Ouverture

  /** getOrCreate : upsert par (userId, currency), devise par defaut XOF. Idempotent. */
  async getOrCreate(userId: string, currency?: string) {
    const cur = (currency ?? DEFAULT_WALLET_CURRENCY).toUpperCase();
    try {
      return await this.prisma.wallet.upsert({
        where: { userId_currency: { userId, currency: cur } },
        create: { userId, currency: cur },
        update: {},
      });
    } catch (err) {
      // Course d'ouverture simultanee : la contrainte unique P2002 est
      // rattrapee par une relecture (le wallet existe desormais forcement).
      if ((err as { code?: string }).code === 'P2002') {
        const existing = await this.prisma.wallet.findUnique({
          where: { userId_currency: { userId, currency: cur } },
        });
        if (existing) return existing;
      }
      throw err;
    }
  }

  /** Alias metier : ouverture implicite a la premiere consultation. */
  async init(userId: string, currency?: string) {
    return this.getOrCreate(userId, currency);
  }

  /** Accès scoped : id en 'w-...' = walletId direct (staff), sinon upsert proprietaire. */
  async getWalletForActor(actor: Actor, currency?: string) {
    if (actor.id.startsWith('w-')) {
      const wallet = await this.prisma.wallet.findUnique({ where: { id: actor.id } });
      if (!wallet) throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Portefeuille introuvable.');
      return wallet;
    }
    return this.getOrCreate(actor.id, currency);
  }

  // ------------------------------------------------------------- Ecritures

  /** Credit interne (TOPUP, TRANSFER_IN, REFUND...). Gel refuse, idempotent. */
  async credit(
    walletId: string,
    amountMinor: number,
    type: WalletTransactionType = WalletTransactionType.TOPUP,
    idempotencyKey?: string,
    note?: string,
  ) {
    this.assertPositiveAmount(amountMinor);
    const key = this.requireKey(idempotencyKey);
    const replay = await this.findByIdempotencyKey(key);
    if (replay) return replay;

    return this.runInTransaction(async (tx) => {
      const wallet = await this.mustFindWallet(tx, walletId);
      this.assertNotFrozen(wallet);
      const ledger = await tx.ledgerTransaction.create({ data: { type, idempotencyKey: key } });
      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balanceMinor: { increment: amountMinor } },
      });
      await this.ensureAccountAndEntry(tx, ledger.id, wallet, LedgerDirection.CREDIT, amountMinor);
      return tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type,
          amountMinor,
          balanceAfterMinor: updated.balanceMinor,
          ledgerTransactionId: ledger.id,
          note,
        },
        include: TX_INCLUDE,
      });
    });
  }

  /**
   * Debit atomique : updateMany conditionnel (balanceMinor >= montant).
   * 0 ligne touchee => soit solde insuffisant, soit debit concurrent arrive
   * premier dans la course => INSUFFICIENT_BALANCE (AFRI-WALLET-001).
   */
  async debit(
    walletId: string,
    amountMinor: number,
    type: WalletTransactionType = WalletTransactionType.PAYMENT,
    idempotencyKey?: string,
    note?: string,
  ) {
    this.assertPositiveAmount(amountMinor);
    const key = this.requireKey(idempotencyKey);
    const replay = await this.findByIdempotencyKey(key);
    if (replay) return replay;

    return this.runInTransaction(async (tx) => {
      const wallet = await this.mustFindWallet(tx, walletId);
      this.assertNotFrozen(wallet);
      const touched = await tx.wallet.updateMany({
        where: { id: wallet.id, balanceMinor: { gte: amountMinor } },
        data: { balanceMinor: { decrement: amountMinor } },
      });
      if (touched.count === 0) {
        throw AppException.unprocessable(
          ERROR_CODES.INSUFFICIENT_BALANCE,
          'Solde insuffisant pour débiter ce portefeuille.',
          { walletId: wallet.id, requestedMinor: amountMinor, balanceMinor: wallet.balanceMinor },
        );
      }
      const after = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      const ledger = await tx.ledgerTransaction.create({ data: { type, idempotencyKey: key } });
      await this.ensureAccountAndEntry(tx, ledger.id, wallet, LedgerDirection.DEBIT, amountMinor);
      return tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type,
          amountMinor,
          balanceAfterMinor: after.balanceMinor,
          ledgerTransactionId: ledger.id,
          note,
        },
        include: TX_INCLUDE,
      });
    });
  }

  // -------------------------------------------------------------- Transfert

  /** Transfert entre wallets de meme devise uniquement (sinon CURRENCY_MISMATCH). */
  async transfer(fromUserId: string, dto: TransferWalletDto & { toUserId: string }) {
    this.assertPositiveAmount(dto.amountMinor);
    const key = this.requireKey(dto.idempotencyKey);
    const replay = await this.findByIdempotencyKey(key);
    if (replay) return replay;

    const from = await this.getOrCreate(fromUserId);
    const to = await this.getOrCreate(dto.toUserId);
    if (from.currency !== to.currency) {
      throw AppException.unprocessable(
        ERROR_CODES.CURRENCY_MISMATCH,
        `Transfert multi-devises interdit (${from.currency} vers ${to.currency}) : convertez d'abord.`,
        { fromCurrency: from.currency, toCurrency: to.currency },
      );
    }
    if (dto.amountMinor > from.balanceMinor) {
      throw AppException.unprocessable(ERROR_CODES.INSUFFICIENT_BALANCE, 'Solde insuffisant pour ce transfert.', {
        walletId: from.id,
        requestedMinor: dto.amountMinor,
        balanceMinor: from.balanceMinor,
      });
    }

    return this.runInTransaction(async (tx) => {
      for (const w of [from, to]) this.assertNotFrozen(w);
      const touched = await tx.wallet.updateMany({
        where: { id: from.id, balanceMinor: { gte: dto.amountMinor } },
        data: { balanceMinor: { decrement: dto.amountMinor } },
      });
      if (touched.count === 0) {
        throw AppException.unprocessable(ERROR_CODES.INSUFFICIENT_BALANCE, 'Solde insuffisant pour ce transfert.', {
          walletId: from.id,
          requestedMinor: dto.amountMinor,
        });
      }
      const debited = await tx.wallet.findUniqueOrThrow({ where: { id: from.id } });
      const credited = await tx.wallet.update({
        where: { id: to.id },
        data: { balanceMinor: { increment: dto.amountMinor } },
      });
      const ledger = await tx.ledgerTransaction.create({
        data: { type: 'TRANSFER', idempotencyKey: key, refType: 'USER', refId: to.userId },
      });
      await this.ensureAccountAndEntry(tx, ledger.id, from, LedgerDirection.DEBIT, dto.amountMinor);
      await this.ensureAccountAndEntry(tx, ledger.id, to, LedgerDirection.CREDIT, dto.amountMinor);
      await tx.walletTransaction.create({
        data: {
          walletId: to.id,
          type: WalletTransactionType.TRANSFER_IN,
          amountMinor: dto.amountMinor,
          balanceAfterMinor: credited.balanceMinor,
          ledgerTransactionId: ledger.id,
          note: dto.note,
        },
      });
      return tx.walletTransaction.create({
        data: {
          walletId: from.id,
          type: WalletTransactionType.TRANSFER_OUT,
          amountMinor: dto.amountMinor,
          balanceAfterMinor: debited.balanceMinor,
          ledgerTransactionId: ledger.id,
          note: dto.note,
        },
        include: TX_INCLUDE,
      });
    });
  }

  // ---------------------------------------------------------------- Retrait

  /**
   * Demande de retrait : garde de gel, plafond journalier puis debit atomique.
   * Somme(des WITHDRAW du jour) + montant > dailyLimitMinor => AFRI-WALLET-002.
   */
  async requestWithdrawal(actor: Actor, dto: RequestWithdrawalDto) {
    this.assertPositiveAmount(dto.amountMinor);
    const key = this.requireKey(dto.idempotencyKey);
    const replay = await this.findByIdempotencyKey(key);
    if (replay) return replay;

    const wallet = await this.getWalletForActor(actor);
    this.assertNotFrozen(wallet);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const aggregate = await this.prisma.walletTransaction.aggregate({
      where: { walletId: wallet.id, type: WalletTransactionType.WITHDRAW, createdAt: { gte: startOfDay } },
      _sum: { amountMinor: true },
    });
    const usedToday = aggregate._sum?.amountMinor ?? 0;
    if (usedToday + dto.amountMinor > wallet.dailyLimitMinor) {
      throw AppException.unprocessable(
        ERROR_CODES.WITHDRAWAL_LIMIT_EXCEEDED,
        `Plafond de retrait journalier dépassé (${usedToday + dto.amountMinor}/${wallet.dailyLimitMinor} mineurs).`,
        { dailyLimitMinor: wallet.dailyLimitMinor, usedTodayMinor: usedToday, requestedMinor: dto.amountMinor },
      );
    }

    const tx = await this.debit(
      wallet.id,
      dto.amountMinor,
      WalletTransactionType.WITHDRAW,
      `${key}:debit`,
      dto.destination ? `Retrait vers ${dto.destination}` : undefined,
    );
    // Le retrait devient une demande PENDING (paiement effectif via Payout plus tard).
    return this.prisma.walletTransaction.update({
      where: { id: tx.id },
      data: { status: PaymentStatus.PENDING },
      include: TX_INCLUDE,
    });
  }

  // -------------------------------------------------------------- Conversion

  /**
   * Conversion coins -> argent (unites mineures).
   * Taux (mineurs par coin) : FxRate(base='COIN', quote=devise) si present,
   * sinon inverse de la config COINS_PER_CURRENCY_MINOR, sinon 1 coin = 1 mineure.
   * Arrondi half-up : le resultat est une quantite entiere exacte de mineures.
   */
  async convertCoins(actor: Actor, dto: ConvertCoinsDto) {
    if (!Number.isInteger(dto.coins) || dto.coins <= 0) {
      throw AppException.badRequest(ERROR_CODES.VALIDATION_FAILED, 'Quantité de coins invalide.');
    }
    const key = this.requireKey(dto.idempotencyKey);
    const replay = await this.findByIdempotencyKey(key);
    if (replay) return replay;

    const wallet = await this.getWalletForActor(actor);
    this.assertNotFrozen(wallet);

    const rate = await this.resolveCoinRate(wallet.currency);
    const amountMinor = Math.round(dto.coins * rate);
    const tx = await this.credit(
      wallet.id,
      amountMinor,
      WalletTransactionType.TOPUP,
      `${key}:credit`,
      `Conversion ${dto.coins} coins vers ${amountMinor} ${wallet.currency} (mineurs)`,
    );
    return { ...tx, convertedFrom: { coins: dto.coins, ratePerCoinMinor: rate } };
  }

  /** Mineurs par coin : FxRate COIN vers devise, fallback config COINS_PER_CURRENCY_MINOR (inverse), fallback 1. */
  private async resolveCoinRate(currency: string): Promise<number> {
    const fx = await this.prisma.fxRate
      .findUnique({ where: { base_quote: { base: 'COIN', quote: currency } } })
      .catch(() => null);
    if (fx && fx.rate > 0) return fx.rate;
    const perMinor = Number(this.config.get<string>('COINS_PER_CURRENCY_MINOR') ?? 0);
    if (Number.isFinite(perMinor) && perMinor > 0) return 1 / perMinor;
    return 1;
  }

  // ------------------------------------------------------------------ Gel

  /** Staff only : gel / degel administratif (garde WALLET_FROZEN). */
  async setFrozen(staff: Actor, walletId: string, frozen: boolean, reason?: string) {
    if (!isStaff(staff.role as never)) {
      throw AppException.forbidden(ERROR_CODES.ACCOUNT_SUSPENDED, 'Réservé au staff.');
    }
    const wallet = await this.mustFindWallet(this.prisma, walletId);
    const updated = await this.prisma.wallet.update({ where: { id: wallet.id }, data: { frozen } });
    this.logger.log(`Wallet ${wallet.id} ${frozen ? 'gelé' : 'dégelé'} par ${staff.id}${reason ? ` (${reason})` : ''}`);
    return updated;
  }

  // -------------------------------------------------------------- Historique

  /** Historique paginé par curseur keyset (createdAt,id desc), scope proprietaire/staff. */
  async listTransactions(actor: Actor, query: CursorPaginationQueryDto, currency?: string) {
    const wallet = await this.getWalletForActor(actor, currency);
    const limit = Math.max(1, Math.min(query.limit ?? 20, 100));
    const cursorWhere = decodeCursor(query.cursor) as { createdAt?: unknown; id?: unknown } | undefined;
    let where: Prisma.WalletTransactionWhereInput = { walletId: wallet.id };
    if (cursorWhere?.createdAt && cursorWhere?.id) {
      const at = new Date(String(cursorWhere.createdAt));
      where = {
        AND: [
          { walletId: wallet.id },
          { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: String(cursorWhere.id) } }] },
        ],
      };
    }
    const rows = await this.prisma.walletTransaction.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: TX_INCLUDE,
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const edge = items[items.length - 1];
    const nextCursor = hasMore && edge ? encodeCursor({ createdAt: edge.createdAt.toISOString(), id: edge.id }) : null;
    return { items, nextCursor, hasMore };
  }

  // --------------------------------------------------------------- Helpers

  private assertPositiveAmount(amountMinor: number): void {
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw AppException.badRequest(ERROR_CODES.VALIDATION_FAILED, 'Montant invalide (entier positif attendu).');
    }
  }

  private requireKey(idempotencyKey?: string): string {
    if (!idempotencyKey || idempotencyKey.length === 0) {
      throw AppException.badRequest(ERROR_CODES.VALIDATION_FAILED, "Clé d'idempotence obligatoire.");
    }
    return idempotencyKey;
  }

  private assertNotFrozen(wallet: { frozen: boolean }): void {
    if (wallet.frozen) {
      throw AppException.unprocessable(
        ERROR_CODES.WALLET_FROZEN,
        'Portefeuille gelé : toutes les écritures sont suspendues.',
      );
    }
  }

  /** Rejeu idempotent : la transaction liee a cette cle est renvoyee telle quelle. */
  private async findByIdempotencyKey(key: string): Promise<WalletTxWithLedger | null> {
    const ledger = await this.prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey: key },
      include: { walletTx: { include: TX_INCLUDE } },
    });
    const found = ledger?.walletTx?.[0];
    return found ?? null;
  }

  /** Compte ledger du wallet (cree a la volee s'il manque), puis ecriture double-entry. */
  private async ensureAccountAndEntry(
    tx: Prisma.TransactionClient,
    ledgerTransactionId: string,
    wallet: { id: string; userId: string; currency: string },
    direction: LedgerDirection,
    amountMinor: number,
  ): Promise<void> {
    const account = await tx.ledgerAccount.upsert({
      where: { walletId: wallet.id },
      create: {
        type: LedgerAccountType.USER_WALLET,
        ownerId: wallet.userId,
        currency: wallet.currency,
        walletId: wallet.id,
      },
      update: {},
    });
    await tx.ledgerEntry.create({
      data: {
        transactionId: ledgerTransactionId,
        accountId: account.id,
        direction,
        amountMinor,
        currency: wallet.currency,
      },
    });
  }

  private async mustFindWallet(tx: Pick<Prisma.TransactionClient, 'wallet'>, walletId: string) {
    const wallet = await tx.wallet.findUnique({ where: { id: walletId } });
    if (!wallet) throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Portefeuille introuvable.');
    return wallet;
  }

  /** $transaction injectable (mock-friendly) : session reelle hors test. */
  private runInTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const runner = this.prisma as {
      $transaction?: (f: (t: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
    };
    if (typeof runner.$transaction === 'function') {
      return runner.$transaction(fn);
    }
    return fn(this.prisma as unknown as Prisma.TransactionClient);
  }
}

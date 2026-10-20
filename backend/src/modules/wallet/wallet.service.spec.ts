import {
  LedgerDirection,
  PaymentStatus,
  WalletTransactionType,
} from '@prisma/client';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { encodeCursor } from '../../common/utils/pagination';
import { WalletService } from './wallet.service';
import type { ConvertCoinsDto, RequestWithdrawalDto, TransferWalletDto } from './dto/wallet.dto';

/**
 * Spec unitaire Wallet : ouverture idempotente (upsert + course P2002),
 * credit/debit atomiques (updateMany garde gte), gel WALLET_FROZEN,
 * idempotence par LedgerTransaction.idempotencyKey (jamais de double débit),
 * plafond journalier des retraits, conversion coins→mineures arrondie,
 * transfert multi-devises refusé et historique keyset.
 * PrismaService / ConfigService sont mockés directement (aucun TestBed).
 */
const USER = { id: 'u-1', role: 'USER' };
const STAFF = { id: 's-1', role: 'ADMIN' };

function makeMocks() {
  const tx = {
    wallet: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    ledgerTransaction: { create: jest.fn() },
    ledgerAccount: { upsert: jest.fn() },
    ledgerEntry: { create: jest.fn() },
    walletTransaction: { create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    wallet: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    ledgerTransaction: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    ledgerAccount: { upsert: jest.fn() },
    ledgerEntry: { create: jest.fn() },
    walletTransaction: {
      create: jest.fn(),
      aggregate: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    fxRate: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const config = { get: jest.fn(() => undefined as string | undefined) };
  const service = new WalletService(prisma as never, config as never);
  return { prisma, tx, config, service };
}

const walletRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'w-1',
  userId: 'u-1',
  currency: 'XOF',
  balanceMinor: 10_000,
  dailyLimitMinor: 50_000_000,
  frozen: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const walletTxRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'wtx-1',
  walletId: 'w-1',
  type: WalletTransactionType.PAYMENT,
  amountMinor: 5_000,
  balanceAfterMinor: 5_000,
  ledgerTransactionId: 'led-1',
  status: PaymentStatus.SUCCEEDED,
  note: null,
  createdAt: new Date('2026-01-02T00:00:00.000Z'),
  ledgerTransaction: { id: 'led-1', idempotencyKey: 'key-1' },
  ...overrides,
});

describe('WalletService.getOrCreate / init', () => {
  it('upsert par (userId, currency) avec XOF par défaut — création idempotente', async () => {
    const { prisma, service } = makeMocks();
    const created = walletRow();
    prisma.wallet.upsert.mockResolvedValue(created);

    const res = await service.getOrCreate('u-1');
    expect(res).toBe(created);
    expect(prisma.wallet.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_currency: { userId: 'u-1', currency: 'XOF' } },
        create: { userId: 'u-1', currency: 'XOF' },
      }),
    );
    // Deuxième appel : même upsert, aucune doublure créée.
    await service.init('u-1');
    expect(prisma.wallet.upsert).toHaveBeenCalledTimes(2);
  });

  it('course P2002 rattrapée par relecture (le wallet concurrent est renvoyé)', async () => {
    const { prisma, service } = makeMocks();
    const existing = walletRow({ id: 'w-race' });
    prisma.wallet.upsert.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
    prisma.wallet.findUnique.mockResolvedValue(existing);

    await expect(service.getOrCreate('u-1', 'xof')).resolves.toBe(existing);
    expect(prisma.wallet.findUnique).toHaveBeenCalledWith({
      where: { userId_currency: { userId: 'u-1', currency: 'XOF' } },
    });
  });

  it('erreur Prisma autre que P2002 remontée telle quelle', async () => {
    const { prisma, service } = makeMocks();
    const boom = Object.assign(new Error('db down'), { code: 'P1001' });
    prisma.wallet.upsert.mockRejectedValue(boom);
    await expect(service.getOrCreate('u-1')).rejects.toBe(boom);
  });

  it('getWalletForActor : id "w-..." = accès staff direct, sinon upsert propriétaire', async () => {
    const { prisma, service } = makeMocks();
    // L'acteur staff porte un id de wallet cible (prefixe 'w-') : lookup direct par id.
    // NB : mock distinct du findUnique 'tx' (celui des transactions) -> on cible le client top-level.
    prisma.wallet.findUnique.mockResolvedValueOnce(walletRow({ id: 'w-target', userId: 'u-9' }));
    const res = await service.getWalletForActor({ id: 'w-target', role: 'ADMIN' }, undefined);
    expect(res.currency).toBe('XOF');
    expect(prisma.wallet.findUnique).toHaveBeenCalledWith({ where: { id: 'w-target' } });
    expect(prisma.wallet.upsert).not.toHaveBeenCalled();
  });

  it('getWalletForActor : utilisateur normal → upsert scoped propriétaire', async () => {
    const { prisma, service } = makeMocks();
    prisma.wallet.upsert.mockResolvedValue(walletRow());
    const res = await service.getWalletForActor(USER, 'NGN');
    expect(res.id).toBe('w-1');
    expect(prisma.wallet.findUnique).not.toHaveBeenCalled();
  });

  it('getWalletForActor staff sur wallet inexistant → NOT_FOUND', async () => {
    const { prisma, service } = makeMocks();
    prisma.wallet.findUnique.mockResolvedValue(null);
    // acteur 'w-missing' : lookup direct echoue
    await expect(service.getWalletForActor({ id: 'w-missing', role: 'ADMIN' })).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });
});

describe('WalletService.credit', () => {
  it('crédite le solde et écrit le ledger (double entry CREDIT)', async () => {
    const { tx, service } = makeMocks();
    tx.wallet.findUnique.mockResolvedValue(walletRow());
    tx.wallet.update.mockResolvedValue(walletRow({ balanceMinor: 15_000 }));
    tx.ledgerTransaction.create.mockResolvedValue({ id: 'led-1' });
    tx.ledgerAccount.upsert.mockResolvedValue({ id: 'acc-1' });
    tx.ledgerEntry.create.mockResolvedValue({});
    tx.walletTransaction.create.mockImplementation(({ data, include }) =>
      Promise.resolve({ ...walletTxRow(data), ...(include ? {} : {}) }),
    );

    const res = await service.credit('w-1', 5_000, WalletTransactionType.TOPUP, 'k-credit');
    expect(res.amountMinor).toBe(5_000);
    expect(tx.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { balanceMinor: { increment: 5_000 } } }),
    );
    expect(tx.ledgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ direction: LedgerDirection.CREDIT, amountMinor: 5_000 }),
      }),
    );
    expect(tx.walletTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ledgerTransactionId: 'led-1' }) }),
    );
  });

  it('montant non entier ou <= 0 → VALIDATION_FAILED', async () => {
    const { service } = makeMocks();
    await expect(service.credit('w-1', 0, WalletTransactionType.TOPUP, 'k')).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
    });
    await expect(service.credit('w-1', 12.5, WalletTransactionType.TOPUP, 'k')).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  });

  it('clé d’idempotence obligatoire', async () => {
    const { service } = makeMocks();
    await expect(service.credit('w-1', 1_000, WalletTransactionType.TOPUP)).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  });

  it('WALLET_FROZEN : crédit refusé sur wallet gelé', async () => {
    const { tx, service } = makeMocks();
    tx.wallet.findUnique.mockResolvedValue(walletRow({ frozen: true }));
    await expect(service.credit('w-1', 5_000, WalletTransactionType.TOPUP, 'k-frozen')).rejects.toMatchObject({
      code: ERROR_CODES.WALLET_FROZEN,
    });
    expect(tx.wallet.update).not.toHaveBeenCalled();
  });
});

describe('WalletService.debit', () => {
  it('débit OK quand updateMany touche 1 ligne (garde balanceMinor >= montant)', async () => {
    const { tx, service } = makeMocks();
    tx.wallet.findUnique.mockResolvedValue(walletRow());
    tx.wallet.updateMany.mockResolvedValue({ count: 1 });
    tx.wallet.findUniqueOrThrow.mockResolvedValue(walletRow({ balanceMinor: 5_000 }));
    tx.ledgerTransaction.create.mockResolvedValue({ id: 'led-1' });
    tx.ledgerAccount.upsert.mockResolvedValue({ id: 'acc-1' });
    tx.ledgerEntry.create.mockResolvedValue({});
    tx.walletTransaction.create.mockImplementation(({ data }) => Promise.resolve(walletTxRow(data)));

    const res = await service.debit('w-1', 5_000, WalletTransactionType.PAYMENT, 'k-debit');
    expect(res.amountMinor).toBe(5_000);
    expect(tx.wallet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'w-1', balanceMinor: { gte: 5_000 } },
        data: { balanceMinor: { decrement: 5_000 } },
      }),
    );
  });

  it('solde insuffisant → AFRI-WALLET-001 (INSUFFICIENT_BALANCE), aucune écriture ledger', async () => {
    const { tx, service } = makeMocks();
    tx.wallet.findUnique.mockResolvedValue(walletRow({ balanceMinor: 1_000 }));
    tx.wallet.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.debit('w-1', 5_000, WalletTransactionType.PAYMENT, 'k-low')).rejects.toMatchObject({
      code: ERROR_CODES.INSUFFICIENT_BALANCE,
    });
    expect(tx.ledgerTransaction.create).not.toHaveBeenCalled();
    expect(tx.walletTransaction.create).not.toHaveBeenCalled();
  });

  it('cours concurrentiel : updateMany → count 0 malgré solde lu suffisant → AFRI-WALLET-001', async () => {
    const { tx, service } = makeMocks();
    // Le solde lu au début semble suffisant, mais un débit concurrent gagne la course.
    tx.wallet.findUnique.mockResolvedValue(walletRow({ balanceMinor: 6_000 }));
    tx.wallet.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.debit('w-1', 5_000, WalletTransactionType.PAYMENT, 'k-race')).rejects.toMatchObject({
      code: ERROR_CODES.INSUFFICIENT_BALANCE,
    });
    expect(tx.wallet.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('WALLET_FROZEN : débit refusé avant toute garde de solde', async () => {
    const { tx, service } = makeMocks();
    tx.wallet.findUnique.mockResolvedValue(walletRow({ frozen: true }));
    await expect(service.debit('w-1', 1_000, WalletTransactionType.PAYMENT, 'k-frozen')).rejects.toMatchObject({
      code: ERROR_CODES.WALLET_FROZEN,
    });
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
  });
});

describe('WalletService — idempotence', () => {
  it('double soumission même idempotencyKey → transaction existante renvoyée, jamais de double débit', async () => {
    const { prisma, tx, service } = makeMocks();
    const first = walletTxRow({ id: 'wtx-first', ledgerTransaction: { id: 'led-1', idempotencyKey: 'key-dup' } });
    prisma.ledgerTransaction.findUnique.mockResolvedValue({ id: 'led-1', walletTx: [first] });

    const res = await service.debit('w-1', 5_000, WalletTransactionType.PAYMENT, 'key-dup');
    expect(res).toBe(first);
    expect(prisma.ledgerTransaction.findUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: 'key-dup' },
      include: { walletTx: { include: { ledgerTransaction: true } } },
    });
    // Aucune écriture SQL lors du rejeu : pas de second débit possible.
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
    expect(tx.walletTransaction.create).not.toHaveBeenCalled();
  });
});

describe('WalletService.requestWithdrawal', () => {
  const wdDto = (extra: Partial<RequestWithdrawalDto> = {}): RequestWithdrawalDto =>
    ({ amountMinor: 20_000, idempotencyKey: 'wd-1', ...extra }) as RequestWithdrawalDto;

  function wireDebitOk({ prisma, tx }: ReturnType<typeof makeMocks>) {
    prisma.wallet.upsert.mockResolvedValue(walletRow());
    tx.wallet.findUnique.mockResolvedValue(walletRow());
    tx.wallet.updateMany.mockResolvedValue({ count: 1 });
    tx.wallet.findUniqueOrThrow.mockResolvedValue(walletRow({ balanceMinor: 8_000 }));
    tx.ledgerTransaction.create.mockResolvedValue({ id: 'led-wd' });
    tx.ledgerAccount.upsert.mockResolvedValue({ id: 'acc-1' });
    tx.ledgerEntry.create.mockResolvedValue({});
    tx.walletTransaction.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'wtx-wd', ...data, createdAt: new Date() }),
    );
    prisma.walletTransaction.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'wtx-wd', ...data, ledgerTransaction: { id: 'led-wd', idempotencyKey: 'wd-1:debit' } }),
    );
  }

  it('retrait OK : compteur jour sous plafond → débit WITHDRAW puis statut PENDING', async () => {
    const { prisma, service, ...m } = makeMocks();
    const mocks = { prisma, ...m };
    wireDebitOk(mocks as never);
    prisma.walletTransaction.aggregate.mockResolvedValue({ _sum: { amountMinor: 10_000 } });

    const res = await service.requestWithdrawal(USER, wdDto());
    expect(res.status).toBe(PaymentStatus.PENDING);
    expect(prisma.walletTransaction.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: WalletTransactionType.WITHDRAW }),
      }),
    );
    expect(prisma.walletTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: PaymentStatus.PENDING } }),
    );
  });

  it('dailyLimitMinor dépassé → AFRI-WALLET-002 (WITHDRAWAL_LIMIT_EXCEEDED), aucun débit SQL', async () => {
    const { prisma, tx, service } = makeMocks();
    prisma.wallet.upsert.mockResolvedValue(walletRow({ dailyLimitMinor: 25_000 }));
    prisma.walletTransaction.aggregate.mockResolvedValue({ _sum: { amountMinor: 10_000 } });

    await expect(service.requestWithdrawal(USER, wdDto({ amountMinor: 20_000 }))).rejects.toMatchObject({
      code: ERROR_CODES.WITHDRAWAL_LIMIT_EXCEEDED,
    });
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
    expect(prisma.walletTransaction.update).not.toHaveBeenCalled();
  });

  it('WALLET_FROZEN : retrait refusé avant le contrôle de plafond', async () => {
    const { prisma, service } = makeMocks();
    prisma.wallet.upsert.mockResolvedValue(walletRow({ frozen: true }));
    await expect(service.requestWithdrawal(USER, wdDto())).rejects.toMatchObject({
      code: ERROR_CODES.WALLET_FROZEN,
    });
    expect(prisma.walletTransaction.aggregate).not.toHaveBeenCalled();
  });
});

describe('WalletService.convertCoins', () => {
  const cvDto = (coins: number): ConvertCoinsDto => ({ coins, idempotencyKey: `cv-${coins}` }) as ConvertCoinsDto;

  function wireCreditOk({ tx }: ReturnType<typeof makeMocks>) {
    tx.wallet.findUnique.mockResolvedValue(walletRow());
    tx.wallet.update.mockImplementation(({ data }) =>
      Promise.resolve(walletRow({ balanceMinor: 10_000 + (data.balanceMinor.increment as number) })),
    );
    tx.ledgerTransaction.create.mockResolvedValue({ id: 'led-cv' });
    tx.ledgerAccount.upsert.mockResolvedValue({ id: 'acc-1' });
    tx.ledgerEntry.create.mockResolvedValue({});
    tx.walletTransaction.create.mockImplementation(({ data }) => Promise.resolve(walletTxRow(data)));
  }

  it('taux FxRate COIN→devise : 1 coin = 50 mineures → montant entier exact', async () => {
    const { prisma, tx, service } = makeMocks();
    prisma.wallet.upsert.mockResolvedValue(walletRow());
    prisma.fxRate.findUnique.mockResolvedValue({ base: 'COIN', quote: 'XOF', rate: 50 });
    wireCreditOk({ tx } as never);

    const res = (await service.convertCoins(USER, cvDto(137))) as never as { convertedFrom: { coins: number; ratePerCoinMinor: number }; amountMinor: number };
    expect(res.convertedFrom).toEqual({ coins: 137, ratePerCoinMinor: 50 });
    expect(tx.walletTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amountMinor: 6_850 }) }),
    );
    // Aucun trou dans la monnaie : la quantité créditée est un entier de mineures.
    expect(Number.isInteger(res.amountMinor)).toBe(true);
  });

  it('fallback config COINS_PER_CURRENCY_MINOR=4 → 10 coins = 2,5 mineurs → arrondi half-up = 3', async () => {
    const { prisma, tx, config, service } = makeMocks();
    prisma.wallet.upsert.mockResolvedValue(walletRow());
    config.get.mockReturnValue('4');
    wireCreditOk({ tx } as never);

    const res = (await service.convertCoins(USER, cvDto(10))) as never as { convertedFrom: { ratePerCoinMinor: number; coins: number } };
    expect(res.convertedFrom).toEqual({ coins: 10, ratePerCoinMinor: 0.25 });
    expect(tx.walletTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amountMinor: 3 }) }),
    );
  });

  it('sans FxRate ni config : 1 coin = 1 mineure', async () => {
    const { prisma, tx, service } = makeMocks();
    prisma.wallet.upsert.mockResolvedValue(walletRow());
    wireCreditOk({ tx } as never);
    const res = (await service.convertCoins(USER, cvDto(7))) as never as { convertedFrom: { ratePerCoinMinor: number }; amountMinor: number };
    expect(res.convertedFrom.ratePerCoinMinor).toBe(1);
    expect(res.amountMinor).toBe(7);
    expect(tx.walletTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amountMinor: 7 }) }),
    );
  });

  it('WALLET_FROZEN : conversion refusée', async () => {
    const { prisma, tx, service } = makeMocks();
    prisma.wallet.upsert.mockResolvedValue(walletRow({ frozen: true }));
    await expect(service.convertCoins(USER, cvDto(10))).rejects.toMatchObject({
      code: ERROR_CODES.WALLET_FROZEN,
    });
    expect(tx.wallet.update).not.toHaveBeenCalled();
  });

  it('coins invalides → VALIDATION_FAILED', async () => {
    const { service } = makeMocks();
    await expect(service.convertCoins(USER, cvDto(0))).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  });
});

describe('WalletService.transfer', () => {
  const trDto = (extra: Partial<TransferWalletDto & { toUserId: string }> = {}) =>
    ({ toUserId: 'u-2', amountMinor: 4_000, idempotencyKey: 'tr-1', ...extra }) as TransferWalletDto & {
      toUserId: string;
    };

  function wireSameCurrency({ prisma }: ReturnType<typeof makeMocks>) {
    prisma.wallet.upsert
      .mockResolvedValueOnce(walletRow())
      .mockResolvedValueOnce(walletRow({ id: 'w-2', userId: 'u-2' }));
  }

  it('CURRENCY_MISMATCH : transfert multi-devises refusé (AFRI-WALLET-004)', async () => {
    const { prisma, tx, service } = makeMocks();
    prisma.wallet.upsert
      .mockResolvedValueOnce(walletRow({ currency: 'XOF' }))
      .mockResolvedValueOnce(walletRow({ id: 'w-2', userId: 'u-2', currency: 'NGN' }));

    await expect(service.transfer('u-1', trDto())).rejects.toMatchObject({
      code: ERROR_CODES.CURRENCY_MISMATCH,
    });
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
  });

  it('transfert même devise : débit atomique + crédit + double écriture ledger DEBIT/CREDIT', async () => {
    const { prisma, tx, service } = makeMocks();
    wireSameCurrency({ prisma } as never);
    tx.wallet.updateMany.mockResolvedValue({ count: 1 });
    tx.wallet.findUniqueOrThrow.mockResolvedValue(walletRow({ balanceMinor: 6_000 }));
    tx.wallet.update.mockResolvedValue(walletRow({ id: 'w-2', userId: 'u-2', balanceMinor: 4_000 }));
    tx.ledgerTransaction.create.mockResolvedValue({ id: 'led-tr' });
    tx.ledgerAccount.upsert.mockResolvedValue({ id: 'acc-1' });
    tx.ledgerEntry.create.mockResolvedValue({});
    tx.walletTransaction.create.mockImplementation(({ data }) => Promise.resolve(walletTxRow(data)));

    const res = await service.transfer('u-1', trDto());
    expect(res.type).toBe(WalletTransactionType.TRANSFER_OUT);
    expect(tx.ledgerEntry.create).toHaveBeenCalledTimes(2);
    const directions = tx.ledgerEntry.create.mock.calls.map((c) => c[0].data.direction);
    expect(directions).toEqual([LedgerDirection.DEBIT, LedgerDirection.CREDIT]);
  });

  it('solde insuffisant avant même la transaction → AFRI-WALLET-001', async () => {
    const { prisma, tx, service } = makeMocks();
    prisma.wallet.upsert
      .mockResolvedValueOnce(walletRow({ balanceMinor: 1_000 }))
      .mockResolvedValueOnce(walletRow({ id: 'w-2', userId: 'u-2' }));
    await expect(service.transfer('u-1', trDto())).rejects.toMatchObject({
      code: ERROR_CODES.INSUFFICIENT_BALANCE,
    });
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
  });
});

describe('WalletService.setFrozen', () => {
  it('staff : gèle le wallet (flag WALLET_FROZEN posé en base)', async () => {
    const { prisma, service } = makeMocks();
    prisma.wallet.findUnique.mockResolvedValue(walletRow());
    prisma.wallet.update.mockResolvedValue(walletRow({ frozen: true }));
    const res = await service.setFrozen(STAFF, 'w-1', true, 'soupçonne fraude');
    expect(res.frozen).toBe(true);
    expect(prisma.wallet.update).toHaveBeenCalledWith({ where: { id: 'w-1' }, data: { frozen: true } });
  });

  it('non-staff → refus (réservé au staff)', async () => {
    const { prisma, service } = makeMocks();
    await expect(service.setFrozen(USER, 'w-1', true)).rejects.toBeInstanceOf(Error);
    expect(prisma.wallet.update).not.toHaveBeenCalled();
  });
});

describe('WalletService.listTransactions', () => {
  it('première page : take limit+1, nextCursor composite {createdAt,id} si plus de lignes', async () => {
    const { prisma, service } = makeMocks();
    prisma.wallet.upsert.mockResolvedValue(walletRow());
    const rows = Array.from({ length: 3 }, (_, i) =>
      walletTxRow({ id: `wtx-${i}`, createdAt: new Date(Date.UTC(2026, 0, 10 - i)) }),
    );
    prisma.walletTransaction.findMany.mockResolvedValue(rows);

    const page = await service.listTransactions(USER, { limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe(
      encodeCursor({ createdAt: rows[1].createdAt.toISOString(), id: rows[1].id }),
    );
    expect(prisma.walletTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
    );
  });

  it('curseur keyset : filtre OR (createdAt < t) OU (createdAt = t ET id < dernier)', async () => {
    const { prisma, service } = makeMocks();
    prisma.wallet.upsert.mockResolvedValue(walletRow());
    const at = new Date(Date.UTC(2026, 0, 9));
    prisma.walletTransaction.findMany.mockResolvedValue([]);

    const page = await service.listTransactions(USER, { limit: 20, cursor: encodeCursor({ createdAt: at.toISOString(), id: 'wtx-1' }) });
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
    const where = prisma.walletTransaction.findMany.mock.calls[0][0].where;
    expect(where.AND[1].OR).toEqual([
      { createdAt: { lt: at } },
      { createdAt: at, id: { lt: 'wtx-1' } },
    ]);
  });

  it('clamp de limite : >100 ramené à 100, <1 ramené à 1', async () => {
    const { prisma, service } = makeMocks();
    prisma.wallet.upsert.mockResolvedValue(walletRow());
    prisma.walletTransaction.findMany.mockResolvedValue([]);
    await service.listTransactions(USER, { limit: 500 });
    expect(prisma.walletTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 101 }));
    await service.listTransactions(USER, { limit: 0 });
    expect(prisma.walletTransaction.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 2 }));
  });
});

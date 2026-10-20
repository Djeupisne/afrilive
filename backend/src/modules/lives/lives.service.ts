import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LiveStatus, Prisma, WalletTransactionType } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { isStaff } from '../../common/enums/role.enum';
import { decodeCursor, encodeCursor } from '../../common/utils/pagination';
import { DOMAIN_EVENTS } from '../../common/events/domain-events';
import { PrismaService } from '../../database/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { LivekitService } from './livekit.service';
import type { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';
import type { AddLiveProductDto, CreateLiveDto, LiveMessageDto, TipDto, UpdateLiveDto } from './dto/lives.dto';

interface Actor {
  id: string;
  role: string;
}

/** Machine à états du direct : SCHEDULED -> LIVE -> ENDED (ou CANCELLED). */
const LIVE_TRANSITIONS: Record<LiveStatus, LiveStatus[]> = {
  [LiveStatus.SCHEDULED]: [LiveStatus.LIVE, LiveStatus.CANCELLED],
  [LiveStatus.LIVE]: [LiveStatus.ENDED],
  [LiveStatus.ENDED]: [],
  [LiveStatus.CANCELLED]: [],
};

const LIVE_SELECT = {
  id: true,
  createdAt: true,
  hostId: true,
  shopId: true,
  title: true,
  status: true,
  roomName: true,
  scheduledAt: true,
  startedAt: true,
  endedAt: true,
  peakViewers: true,
  totalViewers: true,
  ordersCount: true,
  revenueMinor: true,
  allowTips: true,
  category: true,
  countryCode: true,
} as const;

/**
 * Lives shopping AFRI-WALLET/LiveKit.
 *
 * Invariants :
 * - un live par hote est LIVE a la fois (garde avant demarrage) ;
 * - roomName unique (prefixe live- + uuid, contrainte unique du schema) ;
 * - transition de statut hors machine a etats => CONFLICT ; demarrer un live
 *   deja lance => LIVE_ALREADY_STARTED (AFRI-LIVE-001) ; agir sur un live fini
 *   => LIVE_ENDED (AFRI-LIVE-002) ;
 * - tip = debit wallet atomique (TIP) + credit host (TRANSFER_IN/TIP) +
 *   Donation encaissee ; solde insuffisant remonte AFRI-WALLET-001 ;
 * - les operations d'ecriture (chat, produit, tip) sont refusees si le live
 *   n'est pas LIVE ; seul le host (ou staff) gere sa session.
 */
@Injectable()
export class LivesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly livekit: LivekitService,
    private readonly events: EventEmitter2,
  ) {}

  // -------------------------------------------------------------- Cycle vie

  /** Planifie (SCHEDULED) ou ouvre directement (startNow => LIVE) une session. */
  async create(actor: Actor, dto: CreateLiveDto) {
    if (dto.startNow) return this.startExisting(await this.createScheduled(actor, dto));
    return this.createScheduled(actor, dto);
  }

  private async createScheduled(actor: Actor, dto: CreateLiveDto) {
    const roomName = await this.uniqueRoomName();
    return this.prisma.liveSession.create({
      data: {
        hostId: actor.id,
        shopId: dto.shopId,
        title: dto.title,
        status: LiveStatus.SCHEDULED,
        roomName,
        scheduledAt: dto.scheduledAt ?? null,
        allowTips: dto.allowTips ?? true,
        category: dto.category,
        countryCode: dto.countryCode,
      },
      select: LIVE_SELECT,
    });
  }

  /** Demarre : SCHEDULED -> LIVE (updateMany atomique anti-double-demarrage). */
  async start(actor: Actor, id: string) {
    const live = await this.mustGetManageable(actor, id);
    if (live.status === LiveStatus.LIVE) {
      throw AppException.conflict(ERROR_CODES.LIVE_ALREADY_STARTED);
    }
    if (!LIVE_TRANSITIONS[live.status].includes(LiveStatus.LIVE)) {
      throw AppException.conflict(ERROR_CODES.LIVE_ENDED, 'Cette session ne peut plus demarrer.');
    }
    const touched = await this.prisma.liveSession.updateMany({
      where: { id: live.id, status: LiveStatus.SCHEDULED },
      data: { status: LiveStatus.LIVE, startedAt: new Date() },
    });
    if (touched.count === 0) {
      // Course : un autre appel a demarre la session entre-temps.
      throw AppException.conflict(ERROR_CODES.LIVE_ALREADY_STARTED);
    }
    this.events.emit(DOMAIN_EVENTS.LIVE_STARTED, { liveId: live.id, hostId: live.hostId });
    return this.prisma.liveSession.findUniqueOrThrow({ where: { id: live.id }, select: LIVE_SELECT });
  }

  private async startExisting(live: { id: string }) {
    return this.prisma.liveSession.update({
      where: { id: live.id },
      data: { status: LiveStatus.LIVE, startedAt: new Date() },
      select: LIVE_SELECT,
    });
  }

  /** Met fin au direct : LIVE -> ENDED + fermeture best-effort de la room. */
  async end(actor: Actor, id: string) {
    const live = await this.mustGetManageable(actor, id);
    if (live.status !== LiveStatus.LIVE) {
      throw AppException.conflict(ERROR_CODES.LIVE_ENDED);
    }
    const updated = await this.prisma.liveSession.update({
      where: { id },
      data: { status: LiveStatus.ENDED, endedAt: new Date() },
      select: LIVE_SELECT,
    });
    await this.livekit.closeRoom(live.roomName).catch(() => undefined);
    this.events.emit(DOMAIN_EVENTS.LIVE_ENDED, { liveId: id, hostId: live.hostId });
    return updated;
  }

  /** Annulation (hote ou staff) avant demarrage uniquement. */
  async cancel(actor: Actor, id: string) {
    const live = await this.mustGetManageable(actor, id);
    if (live.status !== LiveStatus.SCHEDULED) {
      throw AppException.conflict(ERROR_CODES.CONFLICT, 'Seule une session planifiee est annulable.');
    }
    return this.prisma.liveSession.update({
      where: { id },
      data: { status: LiveStatus.CANCELLED },
      select: LIVE_SELECT,
    });
  }

  /** PATCH metas (titre / tips) par le host ou le staff. */
  async update(actor: Actor, id: string, dto: UpdateLiveDto) {
    await this.mustGetManageable(actor, id);
    if (dto.status) {
      throw AppException.badRequest(ERROR_CODES.VALIDATION_FAILED, 'Utilisez /start, /end ou /cancel pour changer de statut.');
    }
    return this.prisma.liveSession.update({ where: { id }, data: { title: dto.title, allowTips: dto.allowTips }, select: LIVE_SELECT });
  }

  // ------------------------------------------------------------------ Tokens

  /** JWT LiveKit : publisher pour le host, subscriber pour les spectateurs. */
  async tokenFor(actor: Actor, id: string) {
    const live = await this.prisma.liveSession.findFirst({ where: { id, status: { not: LiveStatus.CANCELLED } }, select: { id: true, status: true, roomName: true, hostId: true } });
    if (!live) throw AppException.notFound();
    if (live.status === LiveStatus.ENDED) throw AppException.conflict(ERROR_CODES.LIVE_ENDED);
    const isHost = live.hostId === actor.id || isStaff(actor.role as never);
    if (!isHost && live.status !== LiveStatus.LIVE) throw AppException.conflict(ERROR_CODES.LIVE_ENDED, 'Le direct n\u2019a pas encore commence.');
    return await this.livekit.issueToken(actor.id, live.roomName, isHost);
  }

  // ---------------------------------------------------------------- Vitrine

  /** Attache un produit a la vitrine du live (host/staff, session active). */
  async addProduct(actor: Actor, id: string, dto: AddLiveProductDto) {
    await this.mustBeLive(actor, id);
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId },
      select: { id: true, shopId: true },
    });
    if (!product) throw AppException.notFound();
    return this.prisma.liveProduct.create({
      data: {
        liveId: id,
        productId: product.id,
        variantId: dto.variantId,
        position: dto.position ?? 0,
        isPinned: dto.isPinned ?? false,
        livePriceMinor: dto.livePriceMinor,
        flashEndsAt: dto.flashEndsAt,
        stockLimit: dto.stockLimit,
      },
      include: { product: { select: { id: true, title: true } } },
    });
  }

  /** Epingle un produit (un seul pinned a la fois dans la session). */
  async pinProduct(actor: Actor, id: string, liveProductId: string) {
    const live = await this.mustGetManageable(actor, id);
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.liveProduct.updateMany({ where: { liveId: live.id, isPinned: true }, data: { isPinned: false } });
      return tx.liveProduct.update({ where: { id: liveProductId, liveId: live.id } as never, data: { isPinned: true } });
    });
    this.events.emit(DOMAIN_EVENTS.LIVE_PRODUCT_PINNED, { liveId: live.id, liveProductId });
    return result;
  }

  // -------------------------------------------------------------------- Chat

  /** Message du chat (pinned reserve au host/staff) ; live LIVE requis. */
  async postMessage(actor: Actor, id: string, dto: LiveMessageDto) {
    const live = await this.mustGetManageableOrLive(actor, id);
    if (live.status !== LiveStatus.LIVE) throw AppException.conflict(ERROR_CODES.LIVE_ENDED);
    const pinned = dto.pinned === true && (live.hostId === actor.id || isStaff(actor.role as never));
    return this.prisma.liveMessage.create({
      data: { liveId: id, userId: actor.id, text: dto.text, pinned },
      select: { id: true, liveId: true, userId: true, text: true, pinned: true, createdAt: true },
    });
  }

  async listMessages(id: string, query: CursorPaginationQueryDto) {
    const limit = query.limit ?? 50;
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.liveMessage.findMany({
      where: cursor ? { liveId: id, OR: [{ createdAt: { gt: cursor.createdAt as Date } }, { createdAt: cursor.createdAt as Date, id: { gt: cursor.id as string } }] } : { liveId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      select: { id: true, liveId: true, userId: true, text: true, pinned: true, createdAt: true },
    });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1] as { createdAt: Date; id: string } | undefined;
    return { items, nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null, hasMore };
  }

  // --------------------------------------------------------------------- Tips

  /**
   * Don via portefeuille : debit atomique du donateur (TIP, cle d'idempotence
   * obligatoire -> jamais de double debit), credit du host, Donation encaissee
   * et cumul revenueMinor de la session.
   */
  async tip(actor: Actor, id: string, dto: TipDto) {
    const live = await this.prisma.liveSession.findFirst({ where: { id }, select: { id: true, status: true, hostId: true, allowTips: true } });
    if (!live) throw AppException.notFound();
    if (live.status === LiveStatus.ENDED || live.status === LiveStatus.CANCELLED) throw AppException.conflict(ERROR_CODES.LIVE_ENDED);
    if (live.status !== LiveStatus.LIVE) throw AppException.conflict(ERROR_CODES.LIVE_ENDED, 'Le direct n\u2019a pas encore commence.');
    if (!live.allowTips) throw AppException.forbidden(ERROR_CODES.WALLET_FROZEN, 'Les dons sont desactivees sur cette session.');
    if (actor.id === live.hostId) throw AppException.badRequest(ERROR_CODES.VALIDATION_FAILED, 'Impossible de se tipper soi-m\u00eame.');

    const donorWallet = await this.wallet.getOrCreate(actor.id, dto.currency);
    const hostWallet = await this.wallet.getOrCreate(live.hostId, dto.currency);

    const debit = await this.wallet.debit(
      donorWallet.id,
      dto.amountMinor,
      WalletTransactionType.TIP,
      `${dto.idempotencyKey}:debit`,
      `Tip live ${id}`,
    );
    const credit = await this.wallet.credit(
      hostWallet.id,
      dto.amountMinor,
      WalletTransactionType.TRANSFER_IN,
      `${dto.idempotencyKey}:credit`,
      `Tip live ${id}`,
    );

    const donation = await this.prisma.donation.create({
      data: {
        liveId: id,
        fromUserId: actor.id,
        toUserId: live.hostId,
        amountMinor: dto.amountMinor,
        currency: donorWallet.currency,
        message: dto.message ?? '',
      },
    });
    await this.prisma.liveSession.update({ where: { id }, data: { revenueMinor: { increment: dto.amountMinor } } });

    return { donation, debitTxId: debit.id, creditTxId: credit.id };
  }

  // ------------------------------------------------------------- Consultation

  async getOne(id: string) {
    const live = await this.prisma.liveSession.findFirst({
      where: { id, status: { not: LiveStatus.CANCELLED } },
      select: { ...LIVE_SELECT, host: { select: { id: true, username: true, displayName: true } }, products: { select: { id: true, productId: true, isPinned: true, livePriceMinor: true } } },
    });
    if (!live) throw AppException.notFound();
    return live;
  }

  /** Lives en cours (et planifies), filtres pays/categorie, keyset desc. */
  async listLive(query: CursorPaginationQueryDto & { countryCode?: string; category?: string }) {
    const limit = query.limit ?? 20;
    const cursor = decodeCursor(query.cursor);
    const base: Prisma.LiveSessionWhereInput = { status: { in: [LiveStatus.LIVE, LiveStatus.SCHEDULED] } };
    if (query.countryCode) base.countryCode = query.countryCode;
    if (query.category) base.category = query.category as never;
    const rows = await this.prisma.liveSession.findMany({
      where: cursor ? { AND: [base, { OR: [{ createdAt: { lt: cursor.createdAt as Date } }, { createdAt: cursor.createdAt as Date, id: { lt: cursor.id as string } }] }] } : base,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: LIVE_SELECT,
    });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1] as { createdAt: Date; id: string } | undefined;
    return { items, nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null, hasMore };
  }

  /** Abonnement notifications "host en direct" (upsert idempotent). */
  async subscribe(actor: Actor, hostId: string) {
    if (hostId === actor.id) throw AppException.badRequest(ERROR_CODES.VALIDATION_FAILED, 'Impossible de vous abonner a vous-m\u00eame.');
    await this.prisma.liveSubscription.upsert({
      where: { userId_hostId: { userId: actor.id, hostId } },
      create: { userId: actor.id, hostId },
      update: {},
    });
    return { subscribed: true };
  }

  async unsubscribe(actor: Actor, hostId: string) {
    await this.prisma.liveSubscription.deleteMany({ where: { userId: actor.id, hostId } });
    return { subscribed: false };
  }

  // ------------------------------------------------------------------ Aides

  private async uniqueRoomName(): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const name = `live-${crypto.randomUUID()}`;
      const clash = await this.prisma.liveSession.findUnique({ where: { roomName: name }, select: { id: true } });
      if (!clash) return name;
    }
    throw AppException.conflict(ERROR_CODES.CONFLICT, 'Nom de room indisponible.');
  }

  private async mustGetManageable(actor: Actor, id: string) {
    const live = await this.prisma.liveSession.findFirst({ where: { id }, select: { id: true, status: true, hostId: true, roomName: true } });
    if (!live) throw AppException.notFound();
    if (live.hostId !== actor.id && !isStaff(actor.role as never)) throw AppException.forbidden();
    return live;
  }

  private async mustGetManageableOrLive(actor: Actor, id: string) {
    const live = await this.prisma.liveSession.findFirst({ where: { id }, select: { id: true, status: true, hostId: true } });
    if (!live) throw AppException.notFound();
    return live;
  }

  private async mustBeLive(actor: Actor, id: string) {
    const live = await this.mustGetManageable(actor, id);
    if (live.status !== LiveStatus.LIVE) {
      throw AppException.conflict(live.status === LiveStatus.ENDED ? ERROR_CODES.LIVE_ENDED : ERROR_CODES.CONFLICT);
    }
    return live;
  }
}

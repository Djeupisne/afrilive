import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationType } from '@prisma/client';
import { decodeCursor, encodeCursor } from '../../common/utils/pagination';
import { DOMAIN_EVENTS } from '../../common/events/domain-events';
import { PrismaService } from '../../database/prisma.service';
import { PushService } from '../../integrations/push/push.service';

interface Actor {
  id: string;
}

/**
 * Notifications in-app (table Notification) + push (PushService FCM/HMS).
 * - déduplication via dedupeKey (best effort, pas de contrainte unique) ;
 * - fan-out déclenché par les événements de domaine (@OnEvent) : jamais
 *   bloquant pour la mutation d'origine (try/catch + log) ;
 * - préférences NotificationPreference respectées pour le canal push.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  /** Crée une notification in-app et notifie en push si la préférence l'autorise. */
  async notifyUser(
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
    data: Record<string, string> = {},
    dedupeKey?: string,
  ) {
    if (dedupeKey) {
      const recent = await this.prisma.notification.findFirst({
        where: { userId, dedupeKey, createdAt: { gte: new Date(Date.now() - 60_000) } },
        select: { id: true },
      });
      if (recent) return null; // même alerte < 60 s → ignorée
    }
    const row = await this.prisma.notification.create({
      data: { userId, type, title, body, data: data as never, dedupeKey: dedupeKey ?? null },
      select: { id: true, userId: true, type: true, title: true, body: true, createdAt: true },
    });
    try {
      const pref = await this.prisma.notificationPreference.findUnique({
        where: { userId_type: { userId, type } },
        select: { push: true },
      });
      if (pref?.push === false) return row;
      await this.push.sendToUser(userId, { title, body, data });
    } catch (err) {
      this.logger.warn(`push échoué (user=${userId}, type=${type}) : ${(err as Error).message}`);
    }
    return row;
  }

  // --------------------------------------------------------------- Lecture

  /** GET /notifications — keyset desc (createdAt,id), filtre ?unread=true. */
  async list(actor: Actor, query: { cursor?: string; limit?: number; unread?: boolean }) {
    const limit = Math.min(query.limit ?? 30, 100);
    const cursor = decodeCursor(query.cursor);
    const base = {
      userId: actor.id,
      ...(query.unread ? { readAt: null as Date | null } : {}),
    };
    const rows = await this.prisma.notification.findMany({
      where: cursor
        ? {
            AND: [
              base,
              {
                OR: [
                  { createdAt: { lt: cursor.createdAt as Date } },
                  { createdAt: cursor.createdAt as Date, id: { lt: cursor.id as string } },
                ],
              },
            ],
          }
        : base,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: { id: true, type: true, title: true, body: true, data: true, readAt: true, createdAt: true },
    });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1] as { createdAt: Date; id: string } | undefined;
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
      hasMore,
    };
  }

  async unreadCount(actor: Actor) {
    const count = await this.prisma.notification.count({ where: { userId: actor.id, readAt: null } });
    return { count };
  }

  async markRead(actor: Actor, id: string) {
    const updated = await this.prisma.notification.updateMany({
      where: { id, userId: actor.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { read: updated.count > 0 };
  }

  async markAllRead(actor: Actor) {
    const updated = await this.prisma.notification.updateMany({
      where: { userId: actor.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { marked: updated.count };
  }

  /** POST /notifications/devices — register/refresh d'un token device (upsert). */
  async registerDevice(actor: Actor, dto: { token: string; platform: 'IOS' | 'ANDROID' | 'WEB' | 'HMS'; locale?: string }) {
    await this.prisma.deviceToken.upsert({
      where: { token: dto.token },
      create: { userId: actor.id, token: dto.token, platform: dto.platform, locale: dto.locale ?? 'fr' },
      update: { userId: actor.id, platform: dto.platform, locale: dto.locale ?? 'fr' },
    });
    return { registered: true };
  }

  async unregisterDevice(actor: Actor, token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { token, userId: actor.id } });
    return { registered: false };
  }

  // ------------------------------------------------- Fan-out événementiel

  @OnEvent(DOMAIN_EVENTS.LIVE_STARTED)
  async onLiveStarted(payload: { liveId: string; hostId: string }): Promise<void> {
    try {
      const subs = await this.prisma.liveSubscription.findMany({ where: { hostId: payload.hostId }, select: { userId: true } });
      const host = await this.prisma.user.findUnique({ where: { id: payload.hostId }, select: { displayName: true } });
      for (const sub of subs) {
        await this.notifyUser(
          sub.userId,
          NotificationType.LIVE_STARTED,
          `${host?.displayName ?? 'Un créateur'} est en direct !`,
          'Rejoignez le live maintenant.',
          { liveId: payload.liveId },
          `live-started:${payload.liveId}`,
        ).catch(() => undefined);
      }
    } catch (err) {
      this.logger.warn(`fan-out LIVE_STARTED échoué : ${(err as Error).message}`);
    }
  }

  @OnEvent(DOMAIN_EVENTS.ORDER_PAID)
  async onOrderPaid(payload: { orderId: string; shopId: string; amountMinor: number; currency: string }): Promise<void> {
    try {
      const shop = await this.prisma.shop.findUnique({ where: { id: payload.shopId }, select: { ownerId: true } });
      if (!shop) return;
      await this.notifyUser(
        shop.ownerId,
        NotificationType.ORDER_STATUS,
        'Commande payée',
        `Une commande de ${payload.amountMinor} ${payload.currency} vient d'être payée.`,
        { orderId: payload.orderId },
        `order-paid:${payload.orderId}`,
      );
    } catch (err) {
      this.logger.warn(`fan-out ORDER_PAID échoué : ${(err as Error).message}`);
    }
  }

  @OnEvent(DOMAIN_EVENTS.PAYMENT_SUCCEEDED)
  async onPaymentSucceeded(payload: { paymentId: string; orderId: string }): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({ where: { id: payload.orderId }, select: { buyerId: true } });
      if (!order) return;
      await this.notifyUser(
        order.buyerId,
        NotificationType.PAYMENT,
        'Paiement confirmé',
        'Votre paiement a été accepté, la commande est en préparation.',
        { orderId: payload.orderId, paymentId: payload.paymentId },
        `payment-ok:${payload.paymentId}`,
      );
    } catch (err) {
      this.logger.warn(`fan-out PAYMENT_SUCCEEDED échoué : ${(err as Error).message}`);
    }
  }

  @OnEvent(DOMAIN_EVENTS.PRODUCT_STOCK_LOW)
  async onStockLow(payload: { productId: string; shopId: string; remaining: number }): Promise<void> {
    try {
      const shop = await this.prisma.shop.findUnique({ where: { id: payload.shopId }, select: { ownerId: true } });
      if (!shop) return;
      await this.notifyUser(
        shop.ownerId,
        NotificationType.SYSTEM,
        'Stock faible',
        `Il reste ${payload.remaining} unité(s) sur un produit de votre boutique.`,
        { productId: payload.productId },
        `stock-low:${payload.productId}:${payload.remaining}`,
      );
    } catch (err) {
      this.logger.warn(`fan-out PRODUCT_STOCK_LOW échoué : ${(err as Error).message}`);
    }
  }
}

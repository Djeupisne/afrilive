import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CourierStatus, DeliveryOfferStatus, DeliveryStatus, Prisma } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { isStaff } from '../../common/enums/role.enum';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../integrations/redis/redis.service';

interface Actor {
  id: string;
  role: string;
}

/** Machine à états de la livraison. */
const DELIVERY_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  [DeliveryStatus.CREATED]: [DeliveryStatus.ASSIGNED, DeliveryStatus.FAILED],
  [DeliveryStatus.ASSIGNED]: [DeliveryStatus.PICKED_UP, DeliveryStatus.FAILED],
  [DeliveryStatus.PICKED_UP]: [DeliveryStatus.IN_TRANSIT, DeliveryStatus.FAILED],
  [DeliveryStatus.IN_TRANSIT]: [DeliveryStatus.DELIVERED, DeliveryStatus.FAILED, DeliveryStatus.RETURNING],
  [DeliveryStatus.RETURNING]: [DeliveryStatus.RETURNED, DeliveryStatus.FAILED],
  [DeliveryStatus.DELIVERED]: [],
  [DeliveryStatus.FAILED]: [DeliveryStatus.RETURNING],
  [DeliveryStatus.RETURNED]: [],
};

const GEO_KEY = 'couriers:geo';
const OFFER_TTL_SEC = 120;

const DELIVERY_SELECT = {
  id: true,
  orderId: true,
  courierId: true,
  carrier: true,
  status: true,
  pickup: true,
  dropoff: true,
  distanceKm: true,
  urgency: true,
  feeMinor: true,
  currency: true,
  deliveredAt: true,
  createdAt: true,
} as const;

/**
 * Livraisons AFRI (périmètre V1 restreint, volontairement non bloquant pour
 * le mobile) : création interne, offre aux livreurs approuvés géolocalisés
 * (Redis GEO), acceptation atomique anti-course, machine à états stricte et
 * trace des événements. Les transporteurs externes (Sendy/Kwik/GIG/DHL) ne
 * sont PAS intégrés — carrier reste INTERNAL ; un appel renvoyant une erreur
 * explicite est prévu côté controller pour éviter tout faux succès.
 */
@Injectable()
export class DeliveriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ------------------------------------------------------------- Création

  /** Staff/vendeur : ouvre une livraison pour une commande payée. */
  async create(actor: Actor, dto: { orderId: string; pickup: Record<string, unknown>; dropoff: Record<string, unknown>; feeMinor?: number; currency?: string; urgency?: 'STANDARD' | 'EXPRESS' | 'SAME_DAY' }) {
    if (!isStaff(actor.role as never)) throw AppException.forbidden();
    const order = await this.prisma.order.findUnique({ where: { id: dto.orderId }, select: { id: true, status: true } });
    if (!order) throw AppException.notFound();
    const existing = await this.prisma.delivery.findUnique({ where: { orderId: dto.orderId }, select: { id: true } });
    if (existing) throw AppException.conflict(ERROR_CODES.CONFLICT, 'Une livraison existe déjà pour cette commande.');
    const delivery = await this.prisma.delivery.create({
      data: {
        orderId: dto.orderId,
        pickup: dto.pickup as never,
        dropoff: dto.dropoff as never,
        feeMinor: dto.feeMinor ?? 0,
        currency: dto.currency ?? 'XOF',
        urgency: dto.urgency ?? 'STANDARD',
      },
      select: DELIVERY_SELECT,
    });
    await this.trace(delivery.id, DeliveryStatus.CREATED, 'Livraison créée.');
    return delivery;
  }

  // -------------------------------------------------------- Géolocalisation

  /** POST /deliveries/courier/location — heartbeat GPS du livreur. */
  async updateLocation(actor: Actor, lat: number, lng: number) {
    const courier = await this.mustBeCourier(actor.id);
    await this.prisma.courier.update({ where: { id: courier.id }, data: { lat, lng, lastSeenAt: new Date() } });
    await this.redis.geoAdd(GEO_KEY, [{ member: courier.id, longitude: lng, latitude: lat }]);
    return { tracked: true };
  }

  /** POST /deliveries/courier/online — bascule en ligne/hors ligne. */
  async setOnline(actor: Actor, isOnline: boolean) {
    const courier = await this.mustBeCourier(actor.id);
    await this.prisma.courier.update({ where: { id: courier.id }, data: { isOnline } });
    if (!isOnline) await this.redis.sRem(GEO_KEY, courier.id);
    return { isOnline };
  }

  // ------------------------------------------------------------------ Offres

  /** Diffuse une offre vers les livreurs APPROVED en ligne proches (GEO Redis). */
  async broadcastOffers(deliveryId: string, origin?: { lat: number; lng: number }): Promise<number> {
    let onlineIds: string[] = [];
    if (origin) {
      const near = await this.redis
        .geoSearch(GEO_KEY, origin.lng, origin.lat, 10, 20)
        .then((rows) => rows.map((r) => r.member))
        .catch(() => [] as string[]);
      if (near.length) onlineIds = near;
    }
    // Fallback assumé : sans position d'origine ni résultat GEO, on diffuse à
    // tous les livreurs approuvés en ligne (les offres expirent au TTL de 2 min).
    const couriers = await this.prisma.courier.findMany({
      where: {
        status: CourierStatus.APPROVED,
        isOnline: true,
        ...(onlineIds.length ? { id: { in: onlineIds } } : {}),
      },
      select: { id: true },
      take: 10,
    });
    const expiresAt = new Date(Date.now() + OFFER_TTL_SEC * 1000);
    for (const c of couriers) {
      await this.prisma.deliveryOffer.upsert({
        where: { deliveryId_courierId: { deliveryId, courierId: c.id } },
        create: { deliveryId, courierId: c.id, expiresAt },
        update: { status: DeliveryOfferStatus.PENDING, expiresAt },
      });
    }
    return couriers.length;
  }

  /** Mes offres reçues (livreur). */
  async myOffers(actor: Actor) {
    const courier = await this.mustBeCourier(actor.id);
    const rows = await this.prisma.deliveryOffer.findMany({
      where: { courierId: courier.id, status: DeliveryOfferStatus.PENDING, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { deliveryId: true, courierId: true, expiresAt: true, createdAt: true, delivery: { select: DELIVERY_SELECT } },
    });
    return { items: rows };
  }

  /** Accepte une offre — updateMany atomique : un seul livreur gagne la course. */
  async acceptOffer(actor: Actor, deliveryId: string) {
    const courier = await this.mustBeCourier(actor.id);
    const touched = await this.prisma.deliveryOffer.updateMany({
      where: { deliveryId, courierId: courier.id, status: DeliveryOfferStatus.PENDING, expiresAt: { gt: new Date() } },
      data: { status: DeliveryOfferStatus.ACCEPTED },
    });
    if (touched.count === 0) throw AppException.conflict(ERROR_CODES.CONFLICT, 'Offre expirée ou déjà attribuée.');
    await this.assignCourier(deliveryId, courier.id);
    return { deliveryId, assigned: true };
  }

  // ------------------------------------------------------------- Cycle vie

  /** Transition gardée par la machine à états (livreur assigné ou staff). */
  async transition(actor: Actor, id: string, to: DeliveryStatus, note?: string, coords?: { lat: number; lng: number }) {
    const delivery = await this.prisma.delivery.findUnique({ where: { id }, select: { id: true, status: true, courierId: true } });
    if (!delivery) throw AppException.notFound();
    const courier = await this.prisma.courier.findUnique({ where: { userId: actor.id }, select: { id: true } });
    const isAssignedCourier = courier && delivery.courierId === courier.id;
    if (!isAssignedCourier && !isStaff(actor.role as never)) throw AppException.forbidden();
    if (!DELIVERY_TRANSITIONS[delivery.status].includes(to)) {
      throw AppException.conflict(ERROR_CODES.CONFLICT, `Transition interdite : ${delivery.status} → ${to}.`);
    }
    await this.prisma.delivery.update({
      where: { id },
      data: { status: to, ...(to === DeliveryStatus.DELIVERED ? { deliveredAt: new Date() } : {}) },
    });
    await this.trace(id, to, note, coords);
    if (to === DeliveryStatus.DELIVERED && courier) {
      await this.prisma.courier.update({ where: { id: courier.id }, data: { deliveriesDone: { increment: 1 } } });
    }
    return { id, status: to };
  }

  /** Historique complet d'une livraison (events asc). */
  async timeline(id: string, actor: Actor) {
    const delivery = await this.prisma.delivery.findUnique({ where: { id }, select: { id: true, courierId: true, order: { select: { buyerId: true } } } });
    if (!delivery) throw AppException.notFound();
    const courier = await this.prisma.courier.findUnique({ where: { userId: actor.id }, select: { id: true } });
    const allowed =
      isStaff(actor.role as never) ||
      delivery.order?.buyerId === actor.id ||
      (courier && delivery.courierId === courier.id);
    if (!allowed) throw AppException.forbidden();
    const events = await this.prisma.deliveryEvent.findMany({ where: { deliveryId: id }, orderBy: { at: 'asc' } });
    return { items: events };
  }

  /** Mes livraisons actives (livreur). */
  async myActive(actor: Actor) {
    const courier = await this.mustBeCourier(actor.id);
    const rows = await this.prisma.delivery.findMany({
      where: { courierId: courier.id, status: { in: [DeliveryStatus.ASSIGNED, DeliveryStatus.PICKED_UP, DeliveryStatus.IN_TRANSIT] } },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: DELIVERY_SELECT,
    });
    return { items: rows };
  }

  /** Expire les offres PENDING dépassées (cron 1 min) — évite les attributions tardives. */
  @Cron(CronExpression.EVERY_MINUTE)
  async expireStaleOffers(): Promise<void> {
    await this.prisma.deliveryOffer
      .updateMany({ where: { status: DeliveryOfferStatus.PENDING, expiresAt: { lt: new Date() } }, data: { status: DeliveryOfferStatus.EXPIRED } })
      .catch(() => undefined);
  }

  // ------------------------------------------------------------------ Aides

  private async assignCourier(deliveryId: string, courierId: string) {
    const touched = await this.prisma.delivery.updateMany({
      where: { id: deliveryId, status: DeliveryStatus.CREATED },
      data: { courierId, status: DeliveryStatus.ASSIGNED },
    });
    if (touched.count === 0) {
      // déjà ASSIGNED par une autre offre gagnée : cohérent, on garde.
      return;
    }
    await this.broadcastOffersCleanup(deliveryId);
    await this.trace(deliveryId, DeliveryStatus.ASSIGNED, 'Livreur affecté.');
  }

  private async broadcastOffersCleanup(deliveryId: string) {
    await this.prisma.deliveryOffer.updateMany({
      where: { deliveryId, status: DeliveryOfferStatus.PENDING },
      data: { status: DeliveryOfferStatus.REJECTED },
    });
  }

  private async trace(deliveryId: string, status: DeliveryStatus, note?: string, coords?: { lat: number; lng: number }) {
    const data: Prisma.DeliveryEventCreateInput = {
      delivery: { connect: { id: deliveryId } },
      status,
      note: note ?? null,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
    };
    await this.prisma.deliveryEvent.create({ data }).catch(() => undefined);
  }

  private async mustBeCourier(userId: string) {
    const courier = await this.prisma.courier.findUnique({ where: { userId }, select: { id: true, status: true } });
    if (!courier) throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Profil livreur introuvable.');
    if (courier.status !== CourierStatus.APPROVED) throw AppException.forbidden(ERROR_CODES.ACCOUNT_SUSPENDED, 'Compte livreur non approuvé.');
    return courier;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { CouponType, OrderSource, OrderStatus, Prisma, ProductStatus, StockReservationStatus } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { canTransitionOrder } from '../../common/enums/order-status.enum';
import { isStaff } from '../../common/enums/role.enum';
import { decodeCursor, encodeCursor, sliceCursorPage } from '../../common/utils/pagination';
import { PrismaService } from '../../database/prisma.service';
import type { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';
import type { CreateOrderDto } from './dto/order.dto';
import { CartView } from './cart.service';

/** Validité d'une commande PENDING avant paiement (30 min). */
const ORDER_TTL_MS = 30 * 60 * 1000;
/** Part plateforme prélevée à la commande (2,5 % du sous-total). */
const PLATFORM_FEE_BPS = 250;
/** Taux de TVA par défaut (basepoints pour entiers stricts : 17,50 %). */
const DEFAULT_VAT_BPS = 1750;
/** Pays appliquant une TVA sur les commandes. */
const VAT_COUNTRIES = new Set(['CI', 'SN', 'BF', 'ML', 'NE', 'TG', 'BJ', 'CM']);

interface Actor {
  id: string;
  role: string;
}

const ORDER_SELECT = {
  id: true,
  number: true,
  buyerId: true,
  shopId: true,
  status: true,
  currency: true,
  subtotalMinor: true,
  shippingMinor: true,
  discountMinor: true,
  feeMinor: true,
  taxMinor: true,
  totalMinor: true,
  couponId: true,
  shippingAddress: true,
  countryCode: true,
  source: true,
  liveSessionId: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
  items: {
    select: {
      id: true,
      variantId: true,
      titleSnapshot: true,
      unitPriceMinor: true,
      quantity: true,
    },
  },
  history: { orderBy: { createdAt: 'asc' }, select: { status: true, note: true, actorId: true, createdAt: true } },
} as const;

/**
 * Commandes : matérialisation atomique du panier → Order PENDING avec
 * snapshots (titre/prix), allocation de stock (reserved + StockReservation)
 * et expiration à 30 min. Les transitions de statut sont défendues par la
 * table ORDER_TRANSITIONS ; toute écriture est journalisée dans
 * OrderStatusHistory.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(private readonly prisma: PrismaService) {}

  // --------------------------------------------------------------- Création

  /**
   * Construit la commande depuis une vue de panier déjà validée
   * (appelé par le controller après CartService.getCart).
   */
  async createFromCart(actor: Actor, cartView: CartView, dto: CreateOrderDto) {
    if (dto.itemIds && dto.itemIds.length > 0) {
      const wanted = new Set(dto.itemIds);
      const known = new Set(cartView.items.map((i) => i.id));
      for (const id of wanted) {
        if (!known.has(id)) {
          throw AppException.badRequest(ERROR_CODES.VALIDATION_FAILED, `Ligne de panier inconnue : ${id}`);
        }
      }
      cartView = { ...cartView, items: cartView.items.filter((i) => wanted.has(i.id)) };
    }

    if (cartView.items.length === 0) {
      throw AppException.badRequest(ERROR_CODES.CART_EMPTY, 'Panier vide : rien à commander.');
    }
    if (!cartView.payable) {
      const blocked = cartView.items.find((i) => i.issue !== null);
      throw AppException.unprocessable(
        ERROR_CODES.OUT_OF_STOCK,
        blocked ? `Ligne non commandable : ${blocked.issue}.` : 'Panier non commandable.',
        blocked ? { variantId: blocked.variantId, issue: blocked.issue } : undefined,
      );
    }

    // Une commande = une boutique (regroupement multi-boutiques hors MVP).
    const firstLine = await this.prisma.cartItem.findFirst({
      where: { id: cartView.items[0].id },
      include: { variant: { include: { product: { select: { shopId: true, currency: true } } } } },
    });
    if (!firstLine) throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Ligne de panier introuvable.');
    const shopId = firstLine.variant.product.shopId;
    const currency = firstLine.variant.product.currency;

    if (cartView.items.some((i) => i.currency !== currency)) {
      throw AppException.badRequest(ERROR_CODES.CURRENCY_MISMATCH, 'Toutes les lignes doivent partager la même devise.');
    }

    const shop = await this.prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop || shop.status !== 'ACTIVE') {
      throw AppException.forbidden(ERROR_CODES.SHOP_NOT_VERIFIED, 'Boutique inactive ou suspendue.');
    }

    // Idempotence : renvoyer la commande existante si la clé a déjà servi.
    if (dto.idempotencyKey) {
      const existing = await this.prisma.order.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
      if (existing) return this.getById(existing.id, actor);
    }

    // Coupon éventuel (borné à la boutique de la commande).
    let couponId: string | null = null;
    let discountMinor = 0;
    if (dto.couponCode) {
      const coupon = await this.prisma.coupon.findFirst({
        where: { shopId, code: dto.couponCode.toUpperCase(), active: true },
      });
      const now = new Date();
      if (!coupon || coupon.startsAt > now || coupon.endsAt < now) {
        throw AppException.badRequest(ERROR_CODES.VALIDATION_FAILED, 'Code promo invalide ou expiré.');
      }
      if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
        throw AppException.badRequest(ERROR_CODES.VALIDATION_FAILED, 'Code promo épuisé.');
      }
      if (cartView.subtotalMinor < coupon.minOrderMinor) {
        throw AppException.badRequest(
          ERROR_CODES.VALIDATION_FAILED,
          `Commande minimum ${coupon.minOrderMinor} ${currency} pour ce code.`,
        );
      }
      discountMinor =
        coupon.type === CouponType.PERCENT
          ? Math.floor((cartView.subtotalMinor * coupon.value) / 100)
          : Math.min(coupon.value, cartView.subtotalMinor);
      couponId = coupon.id;
    }

    const subtotalMinor = cartView.subtotalMinor;
    const shippingMinor = dto.shippingMinor ?? 0;
    const feeMinor = Math.floor((subtotalMinor * PLATFORM_FEE_BPS) / 10_000);
    const orderCountry = dto.countryCode ?? shop.countryCode;
    const taxMinor = VAT_COUNTRIES.has(orderCountry)
      ? Math.floor(((subtotalMinor - discountMinor + shippingMinor) * DEFAULT_VAT_BPS) / 10_000)
      : 0;
    const totalMinor = Math.max(0, subtotalMinor - discountMinor + shippingMinor + feeMinor + taxMinor);

    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          number: await this.nextOrderNumber(tx),
          buyerId: actor.id,
          shopId,
          status: OrderStatus.PENDING,
          currency,
          subtotalMinor,
          shippingMinor,
          discountMinor,
          feeMinor,
          taxMinor,
          totalMinor,
          couponId,
          shippingAddress: dto.shippingAddress as unknown as Prisma.InputJsonValue,
          countryCode: orderCountry,
          source: dto.source ?? OrderSource.SHOP,
          liveSessionId: dto.liveSessionId,
          idempotencyKey: dto.idempotencyKey,
          expiresAt: new Date(Date.now() + ORDER_TTL_MS),
          history: { create: [{ status: OrderStatus.PENDING, note: 'Créée depuis le panier', actorId: actor.id }] },
          items: {
            create: cartView.items.map((line) => ({
              variantId: line.variantId,
              titleSnapshot: line.title,
              unitPriceMinor: line.unitPriceMinor,
              quantity: line.quantity,
            })),
          },
        },
      });

      // Allocation de stock déterministe (ordre des variantes) pour éviter les interblocages.
      for (const line of [...cartView.items].sort((a, b) => (a.variantId < b.variantId ? -1 : 1))) {
        const stocks = await tx.stockItem.findMany({
          where: { variantId: line.variantId },
          orderBy: { warehouseId: 'asc' },
        });
        let remaining = line.quantity;
        for (const stock of stocks) {
          if (remaining <= 0) break;
          const free = stock.quantity - stock.reserved;
          if (free <= 0) continue;
          const take = Math.min(free, remaining);
          await tx.stockItem.update({
            where: { id: stock.id },
            data: { reserved: { increment: take } },
          });
          await tx.stockReservation.create({
            data: {
              variantId: line.variantId,
              warehouseId: stock.warehouseId,
              quantity: take,
              orderId: created.id,
              expiresAt: new Date(Date.now() + ORDER_TTL_MS),
            },
          });
          remaining -= take;
        }
        if (remaining > 0) {
          // Course contre la montre : on annule tout (la transaction roule back).
          throw AppException.unprocessable(
            ERROR_CODES.OUT_OF_STOCK,
            `Stock devenu insuffisant pendant la commande (${line.sku}).`,
            { variantId: line.variantId, missing: remaining },
          );
        }
      }

      if (couponId) {
        await tx.coupon.update({ where: { id: couponId }, data: { usedCount: { increment: 1 } } });
      }
      // Le panier ne garde que les lignes achetées.
      await tx.cartItem.deleteMany({ where: { id: { in: cartView.items.map((i) => i.id) } } });
      return created;
    });

    return this.getById(order.id, actor);
  }

  // ------------------------------------------------------------------ Lecture

  async getById(id: string, actor: Actor) {
    const order = await this.prisma.order.findUnique({ where: { id }, select: ORDER_SELECT });
    if (!order) throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Commande introuvable.');
    const isParty = order.buyerId === actor.id || (await this.isShopOwnerOrStaff(actor, order.shopId));
    if (!isParty) {
      throw AppException.forbidden(ERROR_CODES.NOT_FOUND, 'Accès refusé à cette commande.');
    }
    return order;
  }

  /** Mes commandes (buyer) — paginées par curseur keyset sur id. */
  async listMine(query: CursorPaginationQueryDto & { status?: OrderStatus }, actor: Actor) {
    const limit = query.limit ?? 20;
    const where: Prisma.OrderWhereInput = { buyerId: actor.id };
    if (query.status) where.status = query.status;
    const cursor = decodeCursor(query.cursor);
    if (cursor?.id) where.id = query.backward ? { gt: String(cursor.id) } : { lt: String(cursor.id) };
    const rows = await this.prisma.order.findMany({
      where,
      orderBy: { id: query.backward ? 'asc' : 'desc' },
      take: limit + 1,
      select: {
        id: true,
        number: true,
        status: true,
        currency: true,
        totalMinor: true,
        createdAt: true,
        items: { select: { quantity: true } },
      },
    });
    const page = sliceCursorPage(rows, limit, 'id', query.backward);
    return {
      ...page,
      items: page.items.map((o) => ({
        ...o,
        itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
        items: undefined,
      })),
    };
  }

  /** Commandes reçues par mes boutiques (seller/staff). */
  async listForShop(shopId: string, query: CursorPaginationQueryDto & { status?: OrderStatus }, actor: Actor) {
    if (!(await this.isShopOwnerOrStaff(actor, shopId))) {
      throw AppException.forbidden(ERROR_CODES.NOT_FOUND, 'Boutique inconnue ou non accessible.');
    }
    const limit = query.limit ?? 20;
    const where: Prisma.OrderWhereInput = { shopId };
    if (query.status) where.status = query.status;
    const cursor = decodeCursor(query.cursor);
    if (cursor?.id) where.id = query.backward ? { gt: String(cursor.id) } : { lt: String(cursor.id) };
    const rows = await this.prisma.order.findMany({
      where,
      orderBy: { id: query.backward ? 'asc' : 'desc' },
      take: limit + 1,
      select: { id: true, number: true, status: true, currency: true, totalMinor: true, buyerId: true, createdAt: true },
    });
    return sliceCursorPage(rows, limit, 'id', query.backward);
  }

  // -------------------------------------------------------------- Transitions

  /** Annulation par l'acheteur (PENDING uniquement) ou le staff (PENDING/PAID). */
  async cancel(orderId: string, actor: Actor, reason?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Commande introuvable.');
    const staff = isStaff(actor.role as never);
    if (order.buyerId !== actor.id && !staff) {
      throw AppException.forbidden(ERROR_CODES.NOT_FOUND, 'Seul l’acheteur peut annuler sa commande.');
    }
    const target = OrderStatus.CANCELLED;
    if (!canTransitionOrder(order.status, target)) {
      throw AppException.unprocessable(
        ERROR_CODES.ORDER_INVALID_TRANSITION,
        `Transition interdite : ${order.status} → ${target}.`,
        { from: order.status, to: target },
      );
    }
    return this.applyTransition(order, target, actor, reason ?? 'Annulation');
  }

  /** Transition seller/staff : SHIPPED, DELIVERED (via livraison), RETURNED… */
  async transition(orderId: string, to: OrderStatus, actor: Actor, note?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Commande introuvable.');
    if (!(await this.isShopOwnerOrStaff(actor, order.shopId))) {
      throw AppException.forbidden(ERROR_CODES.NOT_FOUND, 'Seuls la boutique ou le staff pilotent le statut.');
    }
    if (!canTransitionOrder(order.status, to)) {
      throw AppException.unprocessable(
        ERROR_CODES.ORDER_INVALID_TRANSITION,
        `Transition interdite : ${order.status} → ${to}.`,
        { from: order.status, to },
      );
    }
    return this.applyTransition(order, to, actor, note);
  }

  /** Marquer PAID après confirmation du paiement (utilisé par PaymentsModule). */
  async markPaid(orderId: string, actorId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Commande introuvable.');
    if (order.status === OrderStatus.PAID) return order; // idempotent
    if (!canTransitionOrder(order.status, OrderStatus.PAID)) {
      throw AppException.unprocessable(
        ERROR_CODES.ORDER_INVALID_TRANSITION,
        `Commande non payable en statut ${order.status}.`,
        { from: order.status, to: OrderStatus.PAID },
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await this.commitReservations(tx, order.id);
      await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.PAID } });
      await tx.orderStatusHistory.create({
        data: { orderId: order.id, status: OrderStatus.PAID, note: 'Paiement confirmé', actorId },
      });
    });
    return this.prisma.order.findUnique({ where: { id: orderId }, select: ORDER_SELECT });
  }

  /** Commit du stock réservé au paiement réussi (reserved → quantity consommée). */
  async commitReservations(tx: Prisma.TransactionClient, orderId: string) {
    const reservations = await tx.stockReservation.findMany({
      where: { orderId, status: StockReservationStatus.ACTIVE },
    });
    for (const res of reservations) {
      await tx.stockItem.update({
        where: { variantId_warehouseId: { variantId: res.variantId, warehouseId: res.warehouseId } },
        data: { quantity: { decrement: res.quantity }, reserved: { decrement: res.quantity } },
      });
      await tx.stockReservation.update({ where: { id: res.id }, data: { status: StockReservationStatus.COMMITTED } });
    }
    // Compteur de ventes des produits concernés.
    const items = await tx.orderItem.findMany({ where: { orderId }, select: { variantId: true, quantity: true } });
    for (const item of items) {
      const variant = await tx.productVariant.findUnique({
        where: { id: item.variantId },
        select: { productId: true },
      });
      if (variant) {
        await tx.product.update({
          where: { id: variant.productId },
          data: { soldCount: { increment: item.quantity } },
        });
      }
    }
    return reservations.length;
  }

  /** Libère le stock réservé d'une commande (annulation/expiration). */
  async releaseReservations(tx: Prisma.TransactionClient, orderId: string) {
    const reservations = await tx.stockReservation.findMany({
      where: { orderId, status: StockReservationStatus.ACTIVE },
    });
    for (const res of reservations) {
      await tx.stockItem.update({
        where: { variantId_warehouseId: { variantId: res.variantId, warehouseId: res.warehouseId } },
        data: { reserved: { decrement: res.quantity } },
      });
      await tx.stockReservation.update({ where: { id: res.id }, data: { status: StockReservationStatus.RELEASED } });
    }
    return reservations.length;
  }

  /** Job de balayage : expire les PENDING dont expiresAt est dépassé. */
  async expirePending(now = new Date()) {
    const expired = await this.prisma.order.findMany({
      where: { status: OrderStatus.PENDING, expiresAt: { lt: now } },
      select: { id: true },
      take: 100,
    });
    let count = 0;
    for (const o of expired) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const order = await tx.order.findUnique({ where: { id: o.id } });
          if (!order || order.status !== OrderStatus.PENDING) return;
          await this.releaseReservations(tx, order.id);
          await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.CANCELLED } });
          await tx.orderStatusHistory.create({
            data: { orderId: order.id, status: OrderStatus.CANCELLED, note: 'Expiration délai de paiement' },
          });
        });
        count += 1;
      } catch (err) {
        this.logger.error(`Expiration commande ${o.id} échouée : ${(err as Error).message}`);
      }
    }
    return { scanned: expired.length, cancelled: count };
  }

  // ------------------------------------------------------------------ Interne

  private async applyTransition(order: { id: string; status: OrderStatus }, to: OrderStatus, actor: Actor, note?: string) {
    await this.prisma.$transaction(async (tx) => {
      if (to === OrderStatus.CANCELLED) {
        await this.releaseReservations(tx, order.id);
      }
      await tx.order.update({ where: { id: order.id }, data: { status: to } });
      await tx.orderStatusHistory.create({
        data: { orderId: order.id, status: to, note, actorId: actor.id === 'SYSTEM' ? null : actor.id },
      });
    });
    return this.prisma.order.findUnique({ where: { id: order.id }, select: ORDER_SELECT });
  }

  private async nextOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
    const d = new Date();
    const stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rand = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
      const number = `ORD-${stamp}-${rand}`;
      const clash = await tx.order.findUnique({ where: { number }, select: { id: true } });
      if (!clash) return number;
    }
    // Ultra-rare collision : on retombe sur un UUID tronqué.
    return `ORD-${stamp}-${encodeCursor({ t: Date.now(), r: Math.random() }).slice(0, 10)}`;
  }

  private async isShopOwnerOrStaff(actor: Actor, shopId: string): Promise<boolean> {
    if (isStaff(actor.role as never)) return true;
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId }, select: { ownerId: true } });
    return shop?.ownerId === actor.id;
  }

  /** Garde réutilisable : produit actif pour l'affichage public. */
  static isActiveProduct(status: ProductStatus): boolean {
    return status === ProductStatus.ACTIVE || status === ProductStatus.OUT_OF_STOCK;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ProductStatus } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { PrismaService } from '../../database/prisma.service';
import type { AddCartItemDto, SetCartItemQuantityDto } from './dto/cart.dto';

/** Nombre maximal de références distinctes dans un panier. */
const MAX_CART_LINES = 50;

export interface CartLineView {
  id: string;
  variantId: string;
  quantity: number;
  productId: string;
  title: string;
  productStatus: ProductStatus;
  sku: string;
  unitPriceMinor: number;
  currency: string;
  available: number;
  lineTotalMinor: number;
  /** Raison pour laquelle la ligne n'est pas commandable (null = OK). */
  issue: string | null;
}

export interface CartView {
  currency: string;
  items: CartLineView[];
  subtotalMinor: number;
  itemCount: number;
  payable: boolean;
}

/**
 * Panier persistant (une ligne par utilisateur — Cart.userId unique).
 * Le calcul des totaux et la disponibilité stock/statut sont recalculés à
 * chaque lecture : le panier est une vue, jamais une vérité comptable.
 */
@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(private readonly prisma: PrismaService) {}

  // --------------------------------------------------------------- Mutations

  async addItem(userId: string, dto: AddCartItemDto): Promise<CartView> {
    const quantity = dto.quantity ?? 1;
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: dto.variantId },
      include: { product: { select: { id: true, status: true, deletedAt: true, currency: true } } },
    });
    if (!variant || variant.product.deletedAt) {
      throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Variante inconnue.');
    }

    const cart = await this.prisma.cart.upsert({
      where: { userId },
      create: { userId, currency: variant.product.currency },
      update: {},
    });

    const existing = await this.prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } },
    });
    const nextQty = (existing?.quantity ?? 0) + quantity;
    if (existing) {
      await this.prisma.cartItem.update({ where: { id: existing.id }, data: { quantity: nextQty } });
    } else {
      const lineCount = await this.prisma.cartItem.count({ where: { cartId: cart.id } });
      if (lineCount >= MAX_CART_LINES) {
        throw AppException.badRequest(
          ERROR_CODES.VALIDATION_FAILED,
          `Panier plein : ${MAX_CART_LINES} références maximum.`,
        );
      }
      await this.prisma.cartItem.create({ data: { cartId: cart.id, variantId: variant.id, quantity: nextQty } });
    }
    return this.getCart(userId);
  }

  async setQuantity(userId: string, itemId: string, dto: SetCartItemQuantityDto): Promise<CartView> {
    const item = await this.prisma.cartItem.findFirst({ where: { id: itemId, cart: { userId } } });
    if (!item) throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Ligne de panier introuvable.');

    if (dto.quantity === 0) {
      await this.prisma.cartItem.delete({ where: { id: item.id } });
    } else {
      await this.prisma.cartItem.update({ where: { id: item.id }, data: { quantity: dto.quantity } });
    }
    return this.getCart(userId);
  }

  async removeItem(userId: string, itemId: string): Promise<CartView> {
    const deleted = await this.prisma.cartItem.deleteMany({ where: { id: itemId, cart: { userId } } });
    if (deleted.count === 0) {
      throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Ligne de panier introuvable.');
    }
    return this.getCart(userId);
  }

  async clear(userId: string): Promise<CartView> {
    await this.prisma.cartItem.deleteMany({ where: { cart: { userId } } });
    return this.getCart(userId);
  }

  // ------------------------------------------------------------------ Lecture

  /** Vue enrichie du panier : prix effectifs, disponibilité, problèmes de ligne. */
  async getCart(userId: string): Promise<CartView> {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      include: {
        items: {
          orderBy: { createdAt: 'asc' },
          include: {
            variant: {
              include: {
                product: { select: { id: true, title: true, status: true, deletedAt: true, currency: true } },
                stockItems: { select: { quantity: true, reserved: true } },
              },
            },
          },
        },
      },
    });
    if (!cart) {
      return { currency: 'XOF', items: [], subtotalMinor: 0, itemCount: 0, payable: false };
    }

    let subtotal = 0;
    const items: CartLineView[] = cart.items.map((item) => {
      const variant = item.variant;
      const product = variant.product;
      const available = variant.stockItems.reduce((sum, s) => sum + Math.max(0, s.quantity - s.reserved), 0);
      const effectiveUnit = variant.salePriceMinor ?? variant.priceMinor;
      const lineTotal = effectiveUnit * item.quantity;

      let issue: string | null = null;
      if (product.deletedAt) issue = 'produit supprimé';
      else if (product.status === ProductStatus.ARCHIVED) issue = 'produit archivé';
      else if (available <= 0) issue = 'rupture de stock';
      else if (item.quantity > available) issue = `stock insuffisant (${available} dispo)`;

      if (!issue) subtotal += lineTotal;
      return {
        id: item.id,
        variantId: variant.id,
        quantity: item.quantity,
        productId: product.id,
        title: product.title,
        productStatus: product.status,
        sku: variant.sku,
        unitPriceMinor: effectiveUnit,
        currency: product.currency,
        available,
        lineTotalMinor: lineTotal,
        issue,
      };
    });

    const mixedCurrency = new Set(items.map((i) => i.currency));
    if (mixedCurrency.size > 1 && items.length > 0) {
      this.logger.warn(`Panier ${cart.id}: devises multiples (${[...mixedCurrency].join(',')}), commande bloquée.`);
    }

    return {
      currency: cart.currency,
      items,
      subtotalMinor: subtotal,
      itemCount: items.reduce((n, i) => n + i.quantity, 0),
      payable: items.length > 0 && items.every((i) => i.issue === null) && mixedCurrency.size <= 1,
    };
  }
}

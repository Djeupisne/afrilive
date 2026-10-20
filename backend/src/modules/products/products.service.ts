import { Injectable } from '@nestjs/common';
import { MediaKind, Prisma, ProductStatus } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { isStaff } from '../../common/enums/role.enum';
import { decodeCursor, encodeCursor } from '../../common/utils/pagination';
import { PrismaService } from '../../database/prisma.service';
import type { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';
import type {
  AddMediaDto,
  AdjustStockDto,
  CreateProductDto,
  CreateVariantDto,
  UpdateProductDto,
} from './dto/product.dto';

/** Transitions de statut produit autorisées (ARCHIVED est définitif). */
const PRODUCT_TRANSITIONS: Record<ProductStatus, ProductStatus[]> = {
  [ProductStatus.DRAFT]: [ProductStatus.ACTIVE, ProductStatus.ARCHIVED],
  [ProductStatus.ACTIVE]: [ProductStatus.OUT_OF_STOCK, ProductStatus.ARCHIVED],
  [ProductStatus.OUT_OF_STOCK]: [ProductStatus.ACTIVE, ProductStatus.ARCHIVED],
  [ProductStatus.ARCHIVED]: [],
};

interface Actor {
  id: string;
  role: string;
}

const PRODUCT_SELECT = {
  id: true,
  shopId: true,
  title: true,
  description: true,
  category: true,
  status: true,
  currency: true,
  basePriceMinor: true,
  ratingAvg: true,
  ratingCount: true,
  soldCount: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Catalogue produits rattaché aux boutiques. Toute écriture exige la propriété
 * de la boutique (owner ou staff). Prix en unités mineures entières uniquement.
 */
@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------- Lecture

  /** Fiche publique (produits non supprimés uniquement). */
  async getById(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: {
        ...PRODUCT_SELECT,
        media: { orderBy: { position: 'asc' }, select: { id: true, type: true, key: true, position: true } },
        variants: {
          select: {
            id: true, sku: true, attributes: true, priceMinor: true,
            compareAtPriceMinor: true, salePriceMinor: true, saleStartsAt: true, saleEndsAt: true,
          },
        },
        shop: { select: { slug: true, name: true, currency: true, status: true } },
      },
    });
    if (!product) throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Produit introuvable.');
    return product;
  }

  /** Catalogue paginé par curseur (keyset sur id), filtrable par boutique/catégorie/statut. */
  async list(query: CursorPaginationQueryDto & { shopId?: string; category?: string; status?: ProductStatus }) {
    const limit = query.limit ?? 20;
    const where: Prisma.ProductWhereInput = { deletedAt: null };
    if (query.shopId) where.shopId = query.shopId;
    if (query.category) where.category = query.category as never;
    where.status = query.status ?? ProductStatus.ACTIVE;

    const cursor = decodeCursor(query.cursor);
    if (cursor?.id) {
      where.id = query.backward ? { lt: String(cursor.id) } : { gt: String(cursor.id) };
    }

    const rows = await this.prisma.product.findMany({
      where,
      select: PRODUCT_SELECT,
      orderBy: { id: query.backward ? 'asc' : 'desc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    return {
      items,
      meta: { nextCursor: hasMore && last ? encodeCursor({ id: last.id }) : null, hasMore },
    };
  }

  /** Liste des produits du vendeur (tous statuts, hors soft-deleted). */
  async listForOwner(actor: Actor, shopRef: string, query: CursorPaginationQueryDto) {
    const shop = await this.resolveOwnedShop(actor, shopRef);
    return this.list({ ...query, shopId: shop.id, status: undefined });
  }

  // ------------------------------------------------------------- Création

  async create(actor: Actor, shopRef: string, dto: CreateProductDto) {
    const shop = await this.resolveOwnedShop(actor, shopRef);
    const currency = dto.currency ?? shop.currency;
    if (currency !== shop.currency) {
      throw AppException.badRequest(
        ERROR_CODES.VALIDATION_FAILED,
        `La devise ${currency} ne correspond pas à celle de la boutique (${shop.currency}).`,
        { currency: ['devise incompatible'] },
      );
    }
    return this.prisma.product.create({
      data: {
        shopId: shop.id,
        title: dto.title,
        description: dto.description ?? '',
        category: dto.category,
        basePriceMinor: dto.basePriceMinor,
        currency,
        status: ProductStatus.DRAFT,
      },
      select: PRODUCT_SELECT,
    });
  }

  async update(actor: Actor, productId: string, dto: UpdateProductDto) {
    await this.resolveOwnedProduct(actor, productId);
    return this.prisma.product.update({
      where: { id: productId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.basePriceMinor !== undefined ? { basePriceMinor: dto.basePriceMinor } : {}),
      },
      select: PRODUCT_SELECT,
    });
  }

  /** Transition d'état défensive : seules les arêtes autorisées passent. */
  async setStatus(actor: Actor, productId: string, to: ProductStatus) {
    const product = await this.resolveOwnedProduct(actor, productId);
    const allowed = PRODUCT_TRANSITIONS[product.status] ?? [];
    if (!allowed.includes(to)) {
      throw AppException.unprocessable(
        ERROR_CODES.CONFLICT,
        `Transition ${product.status} → ${to} interdite.`,
        { from: product.status, to, allowed },
      );
    }
    if (to === ProductStatus.ACTIVE) {
      // Un produit actif doit avoir au moins une variante avec SKU.
      const variants = await this.prisma.productVariant.count({ where: { productId } });
      if (variants === 0) {
        throw AppException.unprocessable(
          ERROR_CODES.VALIDATION_FAILED,
          'Impossible d’activer un produit sans variante.',
        );
      }
    }
    return this.prisma.product.update({
      where: { id: productId },
      data: { status: to },
      select: PRODUCT_SELECT,
    });
  }

  /** Suppression logique (deletedAt) — jamais physique (historique commandes). */
  async remove(actor: Actor, productId: string) {
    await this.resolveOwnedProduct(actor, productId);
    await this.prisma.product.update({ where: { id: productId }, data: { deletedAt: new Date() } });
    return { id: productId, deleted: true };
  }

  // -------------------------------------------------------------- Variantes

  async addVariant(actor: Actor, productId: string, dto: CreateVariantDto) {
    await this.resolveOwnedProduct(actor, productId);
    const sku = dto.sku.toUpperCase();
    const clash = await this.prisma.productVariant.findUnique({ where: { sku }, select: { id: true } });
    if (clash) {
      throw AppException.conflict(ERROR_CODES.CONFLICT, `Le SKU « ${sku} » existe déjà.`);
    }
    try {
      return await this.prisma.productVariant.create({
        data: {
          productId,
          sku,
          attributes: (dto.attributes ?? {}) as Prisma.InputJsonValue,
          priceMinor: dto.priceMinor,
          compareAtPriceMinor: dto.compareAtPriceMinor ?? null,
          salePriceMinor: dto.salePriceMinor ?? null,
          weightGrams: dto.weightGrams ?? 500,
          unit: dto.unit ?? 'piece',
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw AppException.conflict(ERROR_CODES.CONFLICT, `Le SKU « ${sku} » existe déjà.`);
      }
      throw e;
    }
  }

  // ----------------------------------------------------------------- Média

  /** Attache des clés déjà uploadées (presign via shops) en positions séquentielles. */
  async addMedia(actor: Actor, productId: string, dto: AddMediaDto) {
    await this.resolveOwnedProduct(actor, productId);
    const start = dto.startPosition ?? 0;
    const created = [];
    for (let i = 0; i < dto.keys.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const row = await this.prisma.productMedia.create({
        data: { productId, key: dto.keys[i], type: MediaKind.IMAGE, position: start + i },
        select: { id: true, key: true, position: true, type: true },
      });
      created.push(row);
    }
    return created;
  }

  // ------------------------------------------------------------------ Stock

  /**
   * Ajuste le stock d'une variante dans un entrepôt (upsert + delta atomique).
   * Refuse tout solde disponible (quantity − reserved) négatif → OUT_OF_STOCK.
   */
  async adjustStock(actor: Actor, variantId: string, warehouseId: string, dto: AdjustStockDto) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      include: { product: { select: { shopId: true } } },
    });
    if (!variant) throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Variante inconnue.');
    await this.resolveOwnedShop(actor, variant.product.shopId);

    const warehouse = await this.prisma.warehouse.findFirst({ where: { id: warehouseId, shopId: variant.product.shopId } });
    if (!warehouse) throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Entrepôt inconnu pour cette boutique.');

    const existing = await this.prisma.stockItem.findUnique({
      where: { variantId_warehouseId: { variantId, warehouseId } },
    });
    const currentQty = existing?.quantity ?? 0;
    const reserved = existing?.reserved ?? 0;
    const nextQty = currentQty + dto.delta;
    if (nextQty < reserved) {
      throw AppException.unprocessable(
        ERROR_CODES.OUT_OF_STOCK,
        `Retrait refusé : ${nextQty} en stock < ${reserved} réservé(s) par des commandes.`,
        { quantity: nextQty, reserved },
      );
    }
    const stock = await this.prisma.stockItem.upsert({
      where: { variantId_warehouseId: { variantId, warehouseId } },
      create: {
        variantId,
        warehouseId,
        quantity: Math.max(nextQty, 0),
        lowStockThreshold: dto.lowStockThreshold ?? existing?.lowStockThreshold ?? 5,
      },
      update: {
        quantity: { increment: dto.delta },
        ...(dto.lowStockThreshold !== undefined ? { lowStockThreshold: dto.lowStockThreshold } : {}),
      },
    });
    return { variantId, warehouseId, quantity: stock.quantity, reserved: stock.reserved, available: stock.quantity - stock.reserved };
  }

  // -------------------------------------------------------------- Interne

  private async resolveOwnedProduct(actor: Actor, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      include: { shop: { select: { id: true, ownerId: true } } },
    });
    if (!product) throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Produit introuvable.');
    this.assertOwnership(actor, product.shop.ownerId);
    return product;
  }

  private async resolveOwnedShop(actor: Actor, shopRef: string) {
    const shop =
      (await this.prisma.shop.findUnique({ where: { id: shopRef } })) ??
      (await this.prisma.shop.findUnique({ where: { slug: shopRef.toLowerCase() } }));
    if (!shop) throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Boutique introuvable.');
    this.assertOwnership(actor, shop.ownerId);
    return shop;
  }

  private assertOwnership(actor: Actor, ownerId: string): void {
    if (ownerId === actor.id || isStaff(actor.role as never)) return;
    throw AppException.forbidden(ERROR_CODES.ACCOUNT_SUSPENDED, 'Vous n’êtes pas propriétaire de cette ressource.');
  }
}

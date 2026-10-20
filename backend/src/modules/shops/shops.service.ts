import { Injectable } from '@nestjs/common';
import { KycStatus, Prisma, Role } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { SELLER_ROLES, isStaff } from '../../common/enums/role.enum';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../integrations/redis/redis.service';
import { StorageService, buildObjectKey } from '../../integrations/storage/storage.service';
import type { CreateShopDto, UpdateShopDto } from './dto/shop.dto';

/** Slugs réservés : jamais attribuables à une boutique. */
const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'auth', 'static', 'assets', 'shop', 'shops', 'store',
  'products', 'orders', 'wallet', 'live', 'lives', 'video', 'videos', 'user',
  'users', 'support', 'help', 'about', 'terms', 'privacy', 'search', 'feed',
]);

/** Statuts de boutique acceptés par la transition manuelle. */
const SHOP_STATUSES = ['ACTIVE', 'SUSPENDED', 'CLOSED'] as const;

/** Normalise un nom en slug URL-safe (sans diacritiques). */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

interface Actor {
  id: string;
  role: string;
}

/**
 * Boutiques : une seule par utilisateur (ownerId unique). Lecture publique
 * par slug ; écriture réservée au propriétaire (ou staff pour sanctions).
 */
@Injectable()
export class ShopsService {
  /** TTL cache slug → fiche publique (Redis) en secondes. */
  private static readonly SLUG_CACHE_TTL = 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  // ------------------------------------------------------------- Création

  async create(actor: Actor, dto: CreateShopDto) {
    const role = actor.role as Role;
    if (!SELLER_ROLES.includes(role)) {
      throw AppException.forbidden(
        ERROR_CODES.ACCOUNT_SUSPENDED,
        'Rôle insuffisant : un compte vendeur, influenceur ou entreprise est requis.',
      );
    }
    const existing = await this.prisma.shop.findUnique({ where: { ownerId: actor.id } });
    if (existing) {
      throw AppException.conflict(ERROR_CODES.CONFLICT, 'Vous possédez déjà une boutique.');
    }

    const baseSlug = (dto.slug ?? slugify(dto.name)) || `shop-${Date.now()}`;
    if (RESERVED_SLUGS.has(baseSlug)) {
      throw AppException.badRequest(
        ERROR_CODES.VALIDATION_FAILED,
        `Le slug « ${baseSlug} » est réservé.`,
        { slug: ['slug réservé'] },
      );
    }
    const slug = await this.ensureUniqueSlug(baseSlug);

    return this.prisma.shop.create({
      data: {
        ownerId: actor.id,
        name: dto.name,
        slug,
        description: dto.description ?? '',
        countryCode: dto.countryCode ?? 'CI',
        currency: dto.currency ?? 'XOF',
        companyName: dto.companyName ?? null,
        taxId: dto.taxId ?? null,
      },
    });
  }

  /** Ajoute un suffixe numérique (-2, -3…) jusqu'à rendre le slug libre. */
  private async ensureUniqueSlug(base: string): Promise<string> {
    let candidate = base;
    for (let i = 2; i <= 50; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const taken = await this.prisma.shop.findUnique({ where: { slug: candidate }, select: { id: true } });
      if (!taken) return candidate;
      candidate = `${base.slice(0, 57)}-${i}`;
    }
    throw AppException.conflict(ERROR_CODES.CONFLICT, 'Impossible de générer un slug disponible.');
  }

  // -------------------------------------------------------------- Lecture

  /** Fiche publique d'une boutique via son slug (cache Redis 60 s, taxId masqué). */
  async getBySlug(slug: string) {
    const normalized = slug.toLowerCase();
    const cacheKey = `shop:slug:${normalized}`;
    const cached = await this.redis.getJson<Record<string, unknown>>(cacheKey);
    if (cached) return cached;

    const shop = await this.prisma.shop.findUnique({
      where: { slug: normalized },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        logoUrl: true,
        bannerUrl: true,
        theme: true,
        countryCode: true,
        currency: true,
        companyName: true,
        returnPolicy: true,
        openingHours: true,
        status: true,
        ratingAvg: true,
        ratingCount: true,
        createdAt: true,
        owner: { select: { id: true, username: true, displayName: true, avatarUrl: true, isVerified: true } },
      },
    });
    if (!shop) throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Boutique introuvable.');
    await this.redis.setJson(cacheKey, shop, ShopsService.SLUG_CACHE_TTL);
    return shop;
  }

  /** Boutique du titulaire du compte (avec champs privés dont taxId + entrepôts). */
  async getMine(userId: string) {
    const shop = await this.prisma.shop.findUnique({
      where: { ownerId: userId },
      include: { warehouses: true },
    });
    if (!shop) {
      throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Vous n’avez pas encore de boutique.');
    }
    return shop;
  }

  /** Idempotent : renvoie la boutique existante si l'utilisateur en a déjà une. */
  async findOrCreate(actor: Actor, dto: CreateShopDto) {
    const existing = await this.prisma.shop.findUnique({ where: { ownerId: actor.id } });
    if (existing) return existing;
    return this.create(actor, dto);
  }

  // ------------------------------------------------------------ Écriture

  /** Mise à jour des infos vitrine — owner ou staff uniquement. */
  async updateByOwner(userId: string, dto: UpdateShopDto) {
    const shop = await this.getMine(userId);
    return this.applyUpdate(shop.id, dto);
  }

  async updateBySlugOrId(actor: Actor, shopRef: string, dto: UpdateShopDto) {
    const shop = await this.resolveShop(shopRef);
    this.assertCanManage(actor, shop);
    return this.applyUpdate(shop.id, dto);
  }

  private async applyUpdate(shopId: string, dto: UpdateShopDto) {
    const updated = await this.prisma.shop.update({
      where: { id: shopId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl } : {}),
        ...(dto.bannerUrl !== undefined ? { bannerUrl: dto.bannerUrl } : {}),
        ...(dto.theme !== undefined ? { theme: dto.theme as Prisma.InputJsonValue } : {}),
        ...(dto.returnPolicy !== undefined ? { returnPolicy: dto.returnPolicy } : {}),
        ...(dto.openingHours !== undefined ? { openingHours: dto.openingHours as Prisma.InputJsonValue } : {}),
      },
    });
    await this.redis.del(`shop:slug:${updated.slug}`);
    return updated;
  }

  /**
   * Transition de statut : le owner peut fermer (CLOSED) sa boutique ;
   * suspension/réactivation réservées au staff.
   */
  async setStatus(actor: Actor, shopRef: string, status: string) {
    if (!SHOP_STATUSES.includes(status as (typeof SHOP_STATUSES)[number])) {
      throw AppException.badRequest(ERROR_CODES.VALIDATION_FAILED, `Statut inconnu : ${status}`);
    }
    const shop = await this.resolveShop(shopRef);
    const owner = shop.ownerId === actor.id;
    const staff = isStaff(actor.role as Role);
    if (!owner && !staff) {
      throw AppException.forbidden(ERROR_CODES.ACCOUNT_SUSPENDED, 'Non autorisé.');
    }
    if (owner && !staff && status !== 'CLOSED') {
      throw AppException.forbidden(
        ERROR_CODES.ACCOUNT_SUSPENDED,
        'Un vendeur ne peut que fermer sa propre boutique ; la réouverture relève du support.',
      );
    }
    const updated = await this.prisma.shop.update({ where: { id: shop.id }, data: { status } });
    await this.redis.del(`shop:slug:${updated.slug}`);
    return { id: updated.id, slug: updated.slug, status: updated.status };
  }

  /** Upload image vitrine : presign PUT S3/R2 + URL CDN dérivée. */
  async requestMediaUploadUrl(actor: Actor, filename: string, contentType: string) {
    const shop = await this.getMine(actor.id);
    const key = buildObjectKey(`shops/${shop.slug}`, filename);
    const presigned = await this.storage.presignPut(key, contentType, 900);
    return { ...presigned, cdnUrl: this.storage.publicUrl(key) };
  }

  // -------------------------------------------------------- Vérification

  /** Garde transversale : boutique ACTIVE et KYC approuvé pour vendre. */
  async assertSellable(shopId: string): Promise<void> {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { status: true, owner: { select: { kycStatus: true } } },
    });
    if (!shop || shop.status !== 'ACTIVE' || shop.owner.kycStatus !== KycStatus.APPROVED) {
      throw AppException.forbidden(
        ERROR_CODES.SHOP_NOT_VERIFIED,
        'Boutique inactive ou KYC non approuvé : vente impossible.',
      );
    }
  }

  // ------------------------------------------------------------- Interne

  private async resolveShop(ref: string) {
    const byId = await this.prisma.shop.findUnique({ where: { id: ref } });
    if (byId) return byId;
    const bySlug = await this.prisma.shop.findUnique({ where: { slug: ref.toLowerCase() } });
    if (bySlug) return bySlug;
    throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Boutique introuvable.');
  }

  private assertCanManage(actor: Actor, shop: { ownerId: string }): void {
    if (shop.ownerId === actor.id || isStaff(actor.role as Role)) return;
    throw AppException.forbidden(ERROR_CODES.ACCOUNT_SUSPENDED, 'Vous n’êtes pas le propriétaire de cette boutique.');
  }
}

import { Injectable } from '@nestjs/common';
import { UserSettings } from '@prisma/client';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../integrations/redis/redis.service';
import { decodeCursor, encodeCursor } from '../../common/utils/pagination';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import type { UpdateSettingsDto } from './dto/settings.dto';
import type { AddEmailDto, AddPhoneDto } from './dto/contact-channels.dto';

/** Champs publics d'un profil — jamais phone/email complets ni champs sensibles. */
const PUBLIC_USER_SELECT = {
  id: true,
  username: true,
  displayName: true,
  bio: true,
  avatarUrl: true,
  coverUrl: true,
  countryCode: true,
  language: true,
  roles: true,
  mode: true,
  isVerified: true,
  kycStatus: true,
  followersCount: true,
  followingCount: true,
  videosCount: true,
  salesCount: true,
  ratingAvg: true,
  ratingCount: true,
  createdAt: true,
} as const;

interface CursorPage<T> {
  items: T[];
  meta: { nextCursor: string | null; hasMore: boolean };
}

/** Masquage partiel du téléphone : +22507****678 (derniers chiffres conservés). */
export function maskPhone(phone: string): string {
  if (phone.length < 7) return '••••';
  const head = phone.slice(0, phone.length - 6);
  return `${head}****${phone.slice(-3)}`;
}

/** Masquage e-mail : a***@domaine.com (première lettre + domaine visibles). */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '•••@•••';
  const [local, domain] = [email.slice(0, at), email.slice(at + 1)];
  return `${local[0]}***@${domain}`;
}

/**
 * Module users : profils publics/privés, paramètres, canaux de contact,
 * blocages, suppression de compte. Les follow/close-friends relèvent du
 * module follows ; l'authentification reste dans auth/.
 */
@Injectable()
export class UsersService {
  /** TTL cache profil public (Redis) en secondes. */
  private static readonly PROFILE_CACHE_TTL = 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ------------------------------------------------------------- Lecture

  /** Profil public avec cache Redis + flag viewerBlocked (relation avec le visiteur). */
  async getProfile(username: string, viewerId?: string): Promise<Record<string, unknown>> {
    const cacheKey = `user:profile:${username.toLowerCase()}`;
    let profile = await this.redis.getJson<Record<string, unknown>>(cacheKey);
    if (!profile) {
      profile = (await this.prisma.user.findUnique({
        where: { username: username.toLowerCase() },
        select: PUBLIC_USER_SELECT,
      })) as Record<string, unknown> | null;
      if (!profile || (profile as { status?: string }).status === 'DELETED') {
        throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Utilisateur introuvable.');
      }
      await this.redis.setJson(cacheKey, profile, UsersService.PROFILE_CACHE_TTL);
    }
    let viewerBlocked = false;
    if (viewerId && viewerId !== (profile as { id: string }).id) {
      viewerBlocked = await this.isBlockedEitherWay(viewerId, (profile as { id: string }).id);
    }
    return { ...profile, viewerBlocked };
  }

  /** Profil complet du titulaire (téléphone/e-mail masqués, boutique incluse). */
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { settings: true, shop: { select: { id: true, name: true, slug: true, status: true } } },
    });
    if (!user) throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Utilisateur introuvable.');
    const { phone, email, deletedAt: _deletedAt, ...rest } = user;
    return {
      ...rest,
      phone: phone ? maskPhone(phone) : null,
      email: email ? maskEmail(email) : null,
    };
  }

  /** Liste d'abonnés/abonnements paginée par curseur keyset sur l'ID de la relation. */
  async listRelations(
    userId: string,
    kind: 'followers' | 'following',
    cursor?: string,
    limit = 20,
  ): Promise<CursorPage<unknown>> {
    const idField = kind === 'followers' ? 'followerId' : 'followingId';
    const relation = kind === 'followers' ? 'follower' : 'following';
    const where: Record<string, unknown> =
      kind === 'followers' ? { followingId: userId } : { followerId: userId };
    const cursorWhere = decodeCursor(cursor) as Record<string, string | undefined>;
    if (cursorWhere?.[idField]) {
      where[idField] = { lt: cursorWhere[idField] };
    }
    const rows = await this.prisma.follow.findMany({
      where,
      take: limit + 1,
      orderBy: [{ [idField]: 'desc' }],
      select: {
        [idField]: true,
        [relation]: { select: PUBLIC_USER_SELECT },
      },
    }) as unknown as Array<Record<string, unknown>>;
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const edge = items[items.length - 1];
    const nextCursor = edge ? encodeCursor({ [idField]: edge[idField] }) : null;
    return { items, meta: { nextCursor: hasMore ? nextCursor : null, hasMore } };
  }

  // ------------------------------------------------------------- Écriture

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Utilisateur introuvable.');
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: PUBLIC_USER_SELECT,
    });
    await this.redis.del(`user:profile:${user.username.toLowerCase()}`);
    return updated;
  }

  async updateUsername(userId: string, username: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Utilisateur introuvable.');
    const taken = await this.prisma.user.findUnique({ where: { username } });
    if (taken && taken.id !== userId) {
      throw AppException.conflict(ERROR_CODES.CONFLICT, "Ce nom d'utilisateur est déjà pris.");
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { username },
      select: PUBLIC_USER_SELECT,
    });
    await this.redis.del(`user:profile:${user.username.toLowerCase()}`);
    return updated;
  }

  /** Upsert des préférences (ligne UserSettings créée à la demande). */
  async updateSettings(userId: string, dto: UpdateSettingsDto): Promise<UserSettings> {
    const { quietHours, notificationPrefs, ...flags } = dto;
    return this.prisma.userSettings.upsert({
      where: { userId },
      create: { userId, ...flags, ...(quietHours !== undefined ? { quietHours: quietHours as object } : {}), ...(notificationPrefs !== undefined ? { notificationPrefs: notificationPrefs as object } : {}) },
      update: { ...flags, ...(quietHours !== undefined ? { quietHours: quietHours as object } : {}), ...(notificationPrefs !== undefined ? { notificationPrefs: notificationPrefs as object } : {}) },
    });
  }

  async addPhone(userId: string, dto: AddPhoneDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Utilisateur introuvable.');
    if (user.phone) {
      throw AppException.conflict(
        ERROR_CODES.CONFLICT,
        'Un numéro est déjà rattaché — utilisez la changement de numéro via support.',
      );
    }
    const taken = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (taken) throw AppException.conflict(ERROR_CODES.PHONE_ALREADY_TAKEN);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { phone: dto.phone },
    });
    await this.redis.del(`user:profile:${user.username.toLowerCase()}`);
    return { phone: maskPhone(updated.phone!) };
  }

  async addEmail(userId: string, dto: AddEmailDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Utilisateur introuvable.');
    if (user.email) {
      throw AppException.conflict(ERROR_CODES.CONFLICT, 'Une adresse e-mail est déjà rattachée.');
    }
    const normalized = dto.email.toLowerCase();
    const taken = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (taken) throw AppException.conflict(ERROR_CODES.EMAIL_ALREADY_TAKEN);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { email: normalized },
    });
    await this.redis.del(`user:profile:${user.username.toLowerCase()}`);
    return { email: maskEmail(updated.email!) };
  }

  // ------------------------------------------------------------- Blocages

  /** Blocage réciproque vérifié dans les deux sens (blocker→blocked et blocked→blocker). */
  async isBlockedEitherWay(a: string, b: string): Promise<boolean> {
    const found = await this.prisma.block.findFirst({
      where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] },
      select: { blockerId: true },
    });
    return !!found;
  }

  async block(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) {
      throw AppException.badRequest(ERROR_CODES.VALIDATION_FAILED, 'Impossible de se bloquer soi-même.');
    }
    const target = await this.prisma.user.findUnique({ where: { id: blockedId }, select: { id: true } });
    if (!target) throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Utilisateur introuvable.');
    await this.prisma.block.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      create: { blockerId, blockedId },
      update: {},
    });
    // Casser une relation Follow dans les deux sens (un blocage annule l'abonnement réciproque).
    await this.prisma.follow.deleteMany({
      where: { OR: [{ followerId: blockerId, followingId: blockedId }, { followerId: blockedId, followingId: blockerId }] },
    });
    return { blocked: true };
  }

  async unblock(blockerId: string, blockedId: string) {
    await this.prisma.block.deleteMany({ where: { blockerId, blockedId } });
    return { blocked: false };
  }

  async listBlocks(userId: string, cursor?: string, limit = 20): Promise<CursorPage<unknown>> {
    const where: Record<string, unknown> = { blockerId: userId };
    const cursorWhere = decodeCursor(cursor) as { blockedId?: string } | undefined;
    if (cursorWhere?.blockedId) {
      where.blockedId = { lt: cursorWhere.blockedId };
    }
    const rows = (await this.prisma.block.findMany({
      where,
      take: limit + 1,
      orderBy: [{ blockedId: 'desc' }],
      select: {
        blockedId: true,
        blocked: { select: PUBLIC_USER_SELECT },
      },
    })) as unknown as Array<Record<string, unknown>>;
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const edge = items[items.length - 1];
    const nextCursor = edge ? encodeCursor({ blockedId: edge.blockedId }) : null;
    return { items, meta: { nextCursor: hasMore ? nextCursor : null, hasMore } };
  }

  // ------------------------------------------------------------- Suppression

  /** Soft delete : status DELETED + deletedAt, purge cache, sessions révoquées par logout global. */
  async deactivate(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Utilisateur introuvable.');
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: 'DELETED' as never, deletedAt: new Date() },
    });
    await this.redis.del(`user:profile:${user.username.toLowerCase()}`);
    return { deactivated: true };
  }
}

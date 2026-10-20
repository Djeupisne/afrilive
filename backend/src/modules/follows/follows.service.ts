import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FollowStatus, NotificationType, UserStatus } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { DOMAIN_EVENTS } from '../../common/events/domain-events';
import { PrismaService } from '../../database/prisma.service';
import { UsersService } from '../users/users.service';

interface Actor {
  id: string;
  role: string;
}

/** Projection publique minimale d'un utilisateur (listes followers/following). */
const USER_CARD_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  isVerified: true,
  followersCount: true,
} as const;

/**
 * Relations sociales : follow/unfollow avec invariants forts.
 * - pas d'auto-follow ;
 * - blocage dans un sens => follow impossible + purge des follows réciproques
 *   (cohérent avec le teardown de UsersService.block) ;
 * - compte privé => follow PENDING, accepté par le propriétaire ;
 * - compteurs followersCount/followingCount synchronisés à chaque transition.
 */
@Injectable()
export class FollowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly events: EventEmitter2,
  ) {}

  /** POST /follows/:id — suit (ou met en attente si compte privé). */
  async follow(actor: Actor, targetId: string) {
    if (actor.id === targetId) {
      throw AppException.badRequest(ERROR_CODES.VALIDATION_FAILED, 'Impossible de vous suivre vous-même.');
    }
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, settings: { select: { isPrivate: true } } },
    });
    if (!target) throw AppException.notFound();
    if (await this.users.isBlockedEitherWay(actor.id, targetId)) {
      throw AppException.forbidden();
    }
    const existing = await this.prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: actor.id, followingId: targetId } },
    });
    if (existing) return { following: true, status: existing.status };

    const status = target.settings?.isPrivate ? FollowStatus.PENDING : FollowStatus.ACCEPTED;
    try {
      await this.prisma.follow.create({ data: { followerId: actor.id, followingId: targetId, status } });
    } catch (err) {
      // Course : création concurrente → état existant renvoyé sans erreur.
      if ((err as { code?: string }).code !== 'P2002') throw err;
      const row = await this.prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: actor.id, followingId: targetId } },
      });
      return { following: true, status: row?.status ?? FollowStatus.PENDING };
    }
    if (status === FollowStatus.ACCEPTED) {
      await this.prisma.user.updateMany({ where: { id: { in: [actor.id, targetId] } }, data: { followingCount: { increment: 1 } } });
      await this.prisma.user.update({ where: { id: targetId }, data: { followersCount: { increment: 1 } } });
      await this.notify(targetId, NotificationType.FOLLOW, 'Nouveau abonné', `${actor.id} s'est abonné à votre compte`, { followerId: actor.id });
      this.events.emit(DOMAIN_EVENTS.FOLLOW_CREATED, { followerId: actor.id, followingId: targetId });
    }
    return { following: status === FollowStatus.ACCEPTED, status };
  }

  /** DELETE /follows/:id — unfollow (idempotent). */
  async unfollow(actor: Actor, targetId: string) {
    const deleted = await this.prisma.follow.deleteMany({
      where: { followerId: actor.id, followingId: targetId },
    });
    if (deleted.count > 0) {
      await this.prisma.user.updateMany({ where: { id: { in: [actor.id, targetId] } }, data: { followingCount: { decrement: 1 } } });
      await this.prisma.user.update({ where: { id: targetId }, data: { followersCount: { decrement: 1 } } });
      this.events.emit(DOMAIN_EVENTS.FOLLOW_REMOVED, { followerId: actor.id, followingId: targetId });
    }
    return { following: false };
  }

  /** PATCH /follows/:requester/accept — le propriétaire accepte une demande. */
  async accept(actor: Actor, requesterId: string) {
    const updated = await this.prisma.follow.updateMany({
      where: { followerId: requesterId, followingId: actor.id, status: FollowStatus.PENDING },
      data: { status: FollowStatus.ACCEPTED },
    });
    if (updated.count === 0) throw AppException.notFound();
    await this.prisma.user.updateMany({ where: { id: { in: [requesterId, actor.id] } }, data: { followingCount: { increment: 1 } } });
    await this.prisma.user.update({ where: { id: actor.id }, data: { followersCount: { increment: 1 } } });
    await this.notify(requesterId, NotificationType.FOLLOW, 'Demande acceptée', 'Vous suivez maintenant ce compte.', { followingId: actor.id });
    this.events.emit(DOMAIN_EVENTS.FOLLOW_CREATED, { followerId: requesterId, followingId: actor.id });
    return { status: FollowStatus.ACCEPTED };
  }

  /** PATCH /follows/:requester/reject — refuse une demande (supprime la ligne). */
  async reject(actor: Actor, requesterId: string) {
    await this.prisma.follow.deleteMany({
      where: { followerId: requesterId, followingId: actor.id, status: FollowStatus.PENDING },
    });
    return { status: 'REJECTED' as const };
  }

  /** GET /follows/pending — demandes reçues en attente (compte privé). */
  async listPending(actor: Actor, limit = 50) {
    const rows = await this.prisma.follow.findMany({
      where: { followingId: actor.id, status: FollowStatus.PENDING },
      take: Math.min(limit, 100),
      orderBy: { createdAt: 'desc' },
      select: { followerId: true, createdAt: true, follower: { select: USER_CARD_SELECT } },
    });
    return { items: rows };
  }

  /** État de la relation entre l'acteur et la cible (pour les boutons mobile). */
  async state(actor: Actor | null, targetId: string) {
    if (!actor || actor.id === targetId) return { following: false, pendingByMe: false, pendingForMe: false, blocked: false };
    const blocked = await this.users.isBlockedEitherWay(actor.id, targetId);
    const out = await this.prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: actor.id, followingId: targetId } },
      select: { status: true },
    });
    const inc = await this.prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: targetId, followingId: actor.id } },
      select: { status: true },
    });
    return {
      following: out?.status === FollowStatus.ACCEPTED,
      pendingByMe: out?.status === FollowStatus.PENDING,
      pendingForMe: inc?.status === FollowStatus.PENDING,
      blocked,
    };
  }

  /** Idées d'abonnements : comptes suivis par ceux que je suis (2e degré). */
  async suggestions(actor: Actor, limit = 20) {
    const mine = await this.prisma.follow.findMany({
      where: { followerId: actor.id, status: FollowStatus.ACCEPTED },
      select: { followingId: true },
    });
    const exclude = [actor.id, ...mine.map((m) => m.followingId)];
    const secondDegree = await this.prisma.follow.findMany({
      where: { followerId: { in: mine.map((m) => m.followingId) }, status: FollowStatus.ACCEPTED },
      select: { followingId: true },
      take: 200,
    });
    const counts = new Map<string, number>();
    for (const row of secondDegree) {
      if (exclude.includes(row.followingId)) continue;
      counts.set(row.followingId, (counts.get(row.followingId) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
    const users = await this.prisma.user.findMany({
      where: { id: { in: ranked.map(([id]) => id) }, status: UserStatus.ACTIVE },
      select: USER_CARD_SELECT,
    });
    return { items: users.map((u) => ({ ...u, mutualCount: counts.get(u.id) ?? 0 })) };
  }

  private async notify(userId: string, type: NotificationType, title: string, body: string, data: Record<string, string>) {
    await this.prisma.notification
      .create({ data: { userId, type, title, body, data: data as never } })
      .catch(() => undefined); // best effort : la notification ne bloque jamais la mutation
  }
}

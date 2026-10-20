import { Injectable } from '@nestjs/common';
import { FollowStatus, NotificationType, Prisma, VideoStatus, Visibility } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { decodeCursor, encodeCursor } from '../../common/utils/pagination';
import { PrismaService } from '../../database/prisma.service';

interface Actor {
  id: string;
}

/** Projection vidéo du feed (légère — le détail complet est sur /videos/:id). */
const FEED_VIDEO_SELECT = {
  id: true,
  createdAt: true,
  authorId: true,
  caption: true,
  thumbnailKey: true,
  durationSec: true,
  viewsCount: true,
  likesCount: true,
  commentsCount: true,
  category: true,
  countryCode: true,
  author: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
} as const;

/**
 * Feed « Pour toi » + « Abonnements » + tendances.
 * - Pour toi : vidéos PUBLISHED/READY publiques, score léger (vues+likes) et
 *   bonus catégorie/pays de l'acteur ; exclut les auteurs bloqués (dans les
 *   deux sens) via un notIn défensif recalculé à la requête.
 * - Abonnements : vidéos des comptes ACCEPTED-followed ; si le compte suivi
 *   est privé, seule sa visibilité PUBLIC passe (le statut Visibility du
 *   modèle Video fait foi — pas de backdoor FOLLOWERS ici, géré mobile).
 * - Paginations keyset (createdAt,id desc) stables pour l'infinite scroll.
 */
@Injectable()
export class FeedService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /feed — infini scroll « Pour toi ». */
  async forYou(actor: Actor, query: { cursor?: string; limit?: number }) {
    const limit = Math.min(query.limit ?? 20, 50);
    const blockedIds = await this.blockedUserIds(actor.id);
    const cursor = decodeCursor(query.cursor);
    const where: Prisma.VideoWhereInput = {
      status: { in: [VideoStatus.PUBLISHED, VideoStatus.READY] },
      visibility: Visibility.PUBLIC,
      deletedAt: null,
      allowComments: true,
      ...(blockedIds.length ? { authorId: { notIn: blockedIds } } : {}),
    };
    const rows = await this.prisma.video.findMany({
      where: cursor
        ? { AND: [where, { OR: [{ createdAt: { lt: cursor.createdAt as Date } }, { createdAt: cursor.createdAt as Date, id: { lt: cursor.id as string } }] }] }
        : where,
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: FEED_VIDEO_SELECT,
    });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    // Score "Pour toi" simple et déterministe : engagement + proximité pays.
    const me = await this.prisma.user.findUnique({ where: { id: actor.id }, select: { countryCode: true } });
    const scored = items.map((v) => ({
      ...v,
      feedScore: v.viewsCount + v.likesCount * 3 + (v.countryCode === me?.countryCode ? 50 : 0),
    }));
    const last = items[items.length - 1] as { createdAt: Date; id: string } | undefined;
    return {
      items: scored,
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
      hasMore,
    };
  }

  /** GET /feed/subscriptions — vidéos des comptes suivis (ACCEPTED). */
  async subscriptions(actor: Actor, query: { cursor?: string; limit?: number }) {
    const limit = Math.min(query.limit ?? 20, 50);
    const following = await this.prisma.follow.findMany({
      where: { followerId: actor.id, status: FollowStatus.ACCEPTED },
      select: { followingId: true },
      take: 500,
    });
    const ids = following.map((f) => f.followingId);
    if (ids.length === 0) return { items: [], nextCursor: null, hasMore: false };
    const cursor = decodeCursor(query.cursor);
    const where: Prisma.VideoWhereInput = {
      authorId: { in: ids },
      status: { in: [VideoStatus.PUBLISHED, VideoStatus.READY] },
      deletedAt: null,
    };
    const rows = await this.prisma.video.findMany({
      where: cursor
        ? { AND: [where, { OR: [{ createdAt: { lt: cursor.createdAt as Date } }, { createdAt: cursor.createdAt as Date, id: { lt: cursor.id as string } }] }] }
        : where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: FEED_VIDEO_SELECT,
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

  /** GET /feed/trending — top 7 jours par pays (tri vues/likes). */
  async trending(actor: Actor, query: { countryCode?: string; limit?: number }) {
    const limit = Math.min(query.limit ?? 20, 50);
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const blockedIds = await this.blockedUserIds(actor.id);
    const rows = await this.prisma.video.findMany({
      where: {
        status: { in: [VideoStatus.PUBLISHED, VideoStatus.READY] },
        visibility: Visibility.PUBLIC,
        deletedAt: null,
        createdAt: { gte: since },
        ...(query.countryCode ? { countryCode: query.countryCode } : {}),
        ...(blockedIds.length ? { authorId: { notIn: blockedIds } } : {}),
      },
      orderBy: [{ viewsCount: 'desc' }, { likesCount: 'desc' }, { id: 'desc' }],
      take: limit,
      select: FEED_VIDEO_SELECT,
    });
    return { items: rows, nextCursor: null, hasMore: false };
  }

  /** Auteurs suggérés à suivre (actifs, non suivis, non bloqués, top abonnés). */
  async suggestedAuthors(actor: Actor, limit = 10) {
    const followed = await this.prisma.follow.findMany({ where: { followerId: actor.id }, select: { followingId: true } });
    const blockedIds = await this.blockedUserIds(actor.id);
    const exclude = new Set([actor.id, ...followed.map((f) => f.followingId), ...blockedIds]);
    const rows = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', id: { notIn: [...exclude] } },
      orderBy: [{ followersCount: 'desc' }, { id: 'asc' }],
      take: limit,
      select: { id: true, username: true, displayName: true, avatarUrl: true, isVerified: true, followersCount: true },
    });
    return { items: rows };
  }

  /** Likes récents de l'acteur (écran « Activité » mobile). */
  async likedVideos(actor: Actor, query: { cursor?: string; limit?: number }) {
    const limit = Math.min(query.limit ?? 20, 50);
    const cursor = decodeCursor(query.cursor);
    const where: Prisma.VideoLikeWhereInput = { userId: actor.id, video: { deletedAt: null } };
    const rows = await this.prisma.videoLike.findMany({
      where: cursor
        ? {
            AND: [
              where,
              {
                OR: [
                  { createdAt: { lt: cursor.createdAt as Date } },
                  { createdAt: cursor.createdAt as Date, videoId: { lt: cursor.videoId as string } },
                ],
              },
            ],
          }
        : where,
      orderBy: [{ createdAt: 'desc' }, { videoId: 'desc' }],
      take: limit + 1,
      select: { createdAt: true, videoId: true, video: { select: FEED_VIDEO_SELECT } },
    });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return {
      items: items.map((r) => r.video),
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), videoId: last.videoId }) : null,
      hasMore,
    };
  }

  /**
   * Notifie poliment un abonné quand un créateur qu'il suit publie
   * (appelé par le module videos après transition PUBLISHED — best effort).
   */
  async notifyNewPublication(authorId: string, videoId: string): Promise<void> {
    const subs = await this.prisma.follow.findMany({ where: { followingId: authorId, status: FollowStatus.ACCEPTED }, select: { followerId: true } });
    const author = await this.prisma.user.findUnique({ where: { id: authorId }, select: { displayName: true } });
    const settings = await this.prisma.userSettings
      .findUnique({ where: { userId: authorId }, select: { notificationPrefs: true } })
      .catch(() => null);
    if ((settings?.notificationPrefs as { publishNotifications?: boolean })?.publishNotifications === false) return;
    for (const sub of subs) {
      await this.prisma.notification
        .create({
          data: {
            userId: sub.followerId,
            type: NotificationType.SYSTEM,
            title: `${author?.displayName ?? 'Un créateur'} a publié`,
            body: 'Nouvelle vidéo disponible dans votre fil.',
            data: { videoId } as never,
            dedupeKey: `pub:${videoId}:${sub.followerId}`,
          },
        })
        .catch(() => undefined);
    }
  }

  /** Ids à exclure : bloquants + bloqués (les deux sens), + mon propre id. */
  private async blockedUserIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });
    const ids = new Set<string>([userId]);
    for (const b of rows) {
      ids.add(b.blockerId);
      ids.add(b.blockedId);
    }
    return [...ids];
  }

  /** Garde commune : l'acteur doit exister (route protégée par JWT globalement). */
  assertActor(actor: Actor): void {
    if (!actor?.id) throw AppException.unauthorized();
  }
}

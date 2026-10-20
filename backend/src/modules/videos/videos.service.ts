import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { EngagementType, Prisma, UploadStatus, VideoStatus, Visibility } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { isStaff } from '../../common/enums/role.enum';
import { decodeCursor, encodeCursor } from '../../common/utils/pagination';
import { DOMAIN_EVENTS } from '../../common/events/domain-events';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../../integrations/storage/storage.service';
import { QUEUES } from '../../integrations/queue/queue.module';
import type { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';
import type { CreateUploadUrlDto, CreateVideoDto, SetVideoStatusDto, UpdateVideoDto } from './dto/videos.dto';

interface Actor {
  id: string;
  role: string;
}

/** Statuts dont la vidéo est visible publiquement (feed / profil). */
const VISIBLE_STATUSES: VideoStatus[] = [VideoStatus.READY, VideoStatus.PUBLISHED];

/** Transitions de statut autorisées — machine à états stricte du pipeline. */
const STATUS_TRANSITIONS: Record<VideoStatus, VideoStatus[]> = {
  [VideoStatus.UPLOADING]: [VideoStatus.PROCESSING, VideoStatus.DELETED],
  [VideoStatus.PROCESSING]: [VideoStatus.READY, VideoStatus.REJECTED, VideoStatus.DELETED],
  [VideoStatus.READY]: [VideoStatus.PUBLISHED, VideoStatus.REJECTED, VideoStatus.DELETED],
  [VideoStatus.PUBLISHED]: [VideoStatus.REJECTED, VideoStatus.DELETED],
  [VideoStatus.REJECTED]: [VideoStatus.DELETED],
  [VideoStatus.DELETED]: [],
};

const VIDEO_SELECT = {
  id: true,
  createdAt: true,
  updatedAt: true,
  authorId: true,
  caption: true,
  status: true,
  visibility: true,
  durationSec: true,
  width: true,
  height: true,
  sourceKey: true,
  thumbnailKey: true,
  soundId: true,
  remixOfId: true,
  remixType: true,
  category: true,
  language: true,
  countryCode: true,
  allowComments: true,
  allowDuets: true,
  allowDownload: true,
  likesCount: true,
  commentsCount: true,
  sharesCount: true,
  viewsCount: true,
  favoritesCount: true,
  publishedAt: true,
} as const;

/**
 * Pipeline vidéos AFRI : upload multipart presigné (S3/R2), déclaration,
 * machine à états UPLOADING -> PROCESSING -> READY -> PUBLISHED (REJECTED/DELETED
 * possibles), vue incrémentale atomique, et garde de propriété sur les mutations.
 *
 * Invariants :
 * - seul l'auteur (ou le staff) modifie une vidéo ; lecture filtrée par statut
 *   ET visibilité (PRIVATE/FOLLOWERS jamais servis hors auteur/staff) ;
 * - transition de statut illégale => CONFLICT (AFRI-VIDEO-001) ;
 * - un like n'est pas dupliqué (contrainte unique (videoId,userId), P2002 =>
 *   état renvoyé sans erreur) ;
 * - compteur de vues incrémente en base (updateMany atomique), pas en mémoire.
 */
@Injectable()
export class VideosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly events: EventEmitter2,
    @InjectQueue(QUEUES.VIDEO_TRANSCODE) private readonly transcodeQueue: Queue,
  ) {}

  // ------------------------------------------------------------- Upload S3

  /** Presign multipart + UploadSession traçable (statut INITIATED). */
  async createUploadUrl(actor: Actor, dto: CreateUploadUrlDto) {
    const safeName = dto.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    const key = `videos/${actor.id}/${Date.now()}-${safeName}`;
    const init = await this.storage.multipartCreate(key, dto.contentType);
    const partSize = 8 * 1024 * 1024;
    const totalParts = Math.max(1, Math.ceil((dto.sizeBytes ?? partSize) / partSize));
    const session = await this.prisma.uploadSession.create({
      data: { userId: actor.id, objectKey: key, uploadId: init.uploadId, partSize, totalParts },
    });
    return { uploadSessionId: session.id, key, partSize, totalParts };
  }

  /** URLs présignées des parties demandées (numéros 1..totalParts). */
  async presignParts(actor: Actor, uploadSessionId: string, partNumbers: number[]) {
    const session = await this.prisma.uploadSession.findUnique({ where: { id: uploadSessionId } });
    if (!session || session.userId !== actor.id) throw AppException.notFound();
    if (session.status !== UploadStatus.INITIATED) {
      throw AppException.conflict(ERROR_CODES.CONFLICT, 'Session d\u2019upload non active.');
    }
    const init = { key: session.objectKey, uploadId: session.uploadId };
    const parts = await Promise.all(
      partNumbers.map(async (n) => ({
        partNumber: n,
        url: await this.storage.multipartPresignPart(init, n),
      })),
    );
    return { uploadSessionId, parts };
  }

  /** Complète le multipart, marque la session COMPLETED et lie la vidéo si demandée. */
  async completeUpload(actor: Actor, uploadSessionId: string, parts: { partNumber: number; etag: string }[], videoId?: string) {
    const session = await this.prisma.uploadSession.findUnique({ where: { id: uploadSessionId } });
    if (!session || session.userId !== actor.id) throw AppException.notFound();
    const init = { key: session.objectKey, uploadId: session.uploadId };
    const result = await this.storage.multipartComplete(init, parts);
    await this.prisma.uploadSession.update({
      where: { id: session.id },
      data: { status: UploadStatus.COMPLETED, ...(videoId ? { videoId } : {}) },
    });
    if (videoId) {
      await this.mustGetEditableVideo(actor, videoId);
      await this.prisma.video.update({ where: { id: videoId }, data: { sourceKey: result.key } });
    }
    return { key: result.key };
  }

  // ------------------------------------------------------------ Déclaration

  /** POST /videos — crée la fiche vidéo en statut UPLOADING, puis enfile le transcodage. */
  async declare(actor: Actor, dto: CreateVideoDto) {
    const video = await this.prisma.video.create({
      data: {
        authorId: actor.id,
        caption: dto.caption ?? '',
        status: VideoStatus.UPLOADING,
        visibility: dto.visibility ?? Visibility.PUBLIC,
        sourceKey: dto.sourceKey,
        thumbnailKey: dto.thumbnailKey,
        durationSec: dto.durationSec ?? 0,
        width: dto.width ?? 0,
        height: dto.height ?? 0,
        soundId: dto.soundId,
        remixOfId: dto.remixOfId,
        remixType: dto.remixType,
        category: dto.category,
        language: dto.language,
        countryCode: dto.countryCode,
        allowComments: dto.allowComments,
        allowDuets: dto.allowDuets,
        allowDownload: dto.allowDownload,
      },
      select: VIDEO_SELECT,
    });
    await this.transcodeQueue.add('transcode', { videoId: video.id, sourceKey: video.sourceKey ?? null });
    this.events.emit(DOMAIN_EVENTS.VIDEO_UPLOADED, { videoId: video.id, authorId: actor.id });
    return video;
  }

  // --------------------------------------------------------------- Lecture

  /** Détail public : filtre statut + visibilité selon l'acteur. */
  async getOne(actor: Actor | null, id: string) {
    const video = await this.prisma.video.findFirst({
      where: { id, deletedAt: null },
      select: { ...VIDEO_SELECT, author: { select: { id: true, username: true, displayName: true } } },
    });
    if (!video) throw AppException.notFound();
    const isOwner = !!actor && video.authorId === actor.id;
    const staff = !!actor && isStaff(actor.role as never);
    if (!isOwner && !staff) {
      if (!VISIBLE_STATUSES.includes(video.status)) throw AppException.notFound();
      if (video.visibility !== Visibility.PUBLIC) throw AppException.forbidden();
    }
    return video;
  }

  /** Vidéos d'un auteur, visibles selon le rôle de l'acteur (keyset desc). */
  async listByAuthor(actor: Actor | null, authorId: string, query: CursorPaginationQueryDto) {
    const where: Prisma.VideoWhereInput = { authorId, deletedAt: null };
    const isSelf = !!actor && actor.id === authorId;
    if (!isSelf && !(actor && isStaff(actor.role as never))) {
      where.status = { in: VISIBLE_STATUSES };
      where.visibility = Visibility.PUBLIC;
    }
    return this.paginateVideos(where, query);
  }

  private async paginateVideos(where: Prisma.VideoWhereInput, query: CursorPaginationQueryDto) {
    const limit = query.limit ?? 20;
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.video.findMany({
      where: cursor ? { AND: [where, { OR: [{ createdAt: { lt: cursor.createdAt as Date } }, { createdAt: cursor.createdAt as Date, id: { lt: cursor.id as string } }] }] } : where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: VIDEO_SELECT,
    });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1] as { createdAt: Date; id: string } | undefined;
    return { items, nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null, hasMore };
  }

  // ------------------------------------------------------------- Mutations

  /** PATCH métadonnées — auteur ou staff uniquement. */
  async update(actor: Actor, id: string, dto: UpdateVideoDto) {
    await this.mustGetEditableVideo(actor, id);
    return this.prisma.video.update({ where: { id }, data: dto, select: VIDEO_SELECT });
  }

  /** Soft delete (auteur ou staff) : status DELETED + deletedAt. */
  async remove(actor: Actor, id: string) {
    await this.mustGetEditableVideo(actor, id);
    return this.prisma.video.update({
      where: { id },
      data: { status: VideoStatus.DELETED, deletedAt: new Date() },
      select: VIDEO_SELECT,
    });
  }

  /** Like/unlike idempotent ; compteur synchronisé avec la table VideoLike. */
  async toggleLike(actor: Actor, id: string) {
    await this.getReadableVideo(actor, id);
    const existing = await this.prisma.videoLike.findUnique({ where: { videoId_userId: { videoId: id, userId: actor.id } } });
    if (existing) {
      await this.prisma.videoLike.delete({ where: { videoId_userId: { videoId: id, userId: actor.id } } });
      await this.prisma.video.update({ where: { id }, data: { likesCount: { decrement: 1 } } });
      return { liked: false };
    }
    try {
      await this.prisma.videoLike.create({ data: { videoId: id, userId: actor.id } });
    } catch (err) {
      if ((err as Prisma.PrismaClientKnownRequestError).code !== 'P2002') throw err;
      return { liked: true };
    }
    await this.prisma.video.update({ where: { id }, data: { likesCount: { increment: 1 } } });
    return { liked: true };
  }

  /**
   * Vue incrémentale atomique : updateMany conditionnel (jamais sur DELETED).
   * Renvoie le nouveau compteur relu apr\u00e8s incr\u00e9mentation.
   */
  async registerView(actor: Actor | null, id: string) {
    const touched = await this.prisma.video.updateMany({
      where: { id, status: { notIn: [VideoStatus.DELETED] } },
      data: { viewsCount: { increment: 1 } },
    });
    if (touched.count === 0) throw AppException.notFound();
    if (actor) {
      await this.prisma.engagementEvent
        .create({ data: { videoId: id, userId: actor.id, type: EngagementType.VIEW } })
        .catch(() => undefined); // best effort : l'event d'engagement ne bloque pas la vue
    }
    const video = await this.prisma.video.findUnique({ where: { id }, select: { viewsCount: true } });
    return { viewsCount: video?.viewsCount ?? 0 };
  }

  /** Callback worker/staff : transition gard\u00e9e par la machine \u00e0 \u00e9tats. */
  async setStatus(staff: Actor, id: string, dto: SetVideoStatusDto) {
    if (!isStaff(staff.role as never)) throw AppException.forbidden();
    const video = await this.prisma.video.findFirst({ where: { id, deletedAt: null }, select: { id: true, status: true } });
    if (!video) throw AppException.notFound();
    if (!STATUS_TRANSITIONS[video.status].includes(dto.status)) {
      throw AppException.conflict(
        ERROR_CODES.CONFLICT,
        `Transition de statut interdite : ${video.status} → ${dto.status}.`,
      );
    }
    const updated = await this.prisma.video.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.hlsKey ? { hlsKey: dto.hlsKey } : {}),
        ...(dto.thumbnailKey ? { thumbnailKey: dto.thumbnailKey } : {}),
        ...(dto.status === VideoStatus.PUBLISHED ? { publishedAt: new Date() } : {}),
      },
      select: VIDEO_SELECT,
    });
    if (dto.status === VideoStatus.READY) {
      this.events.emit(DOMAIN_EVENTS.VIDEO_TRANSCODED, { videoId: id });
    }
    return updated;
  }

  // --------------------------------------------------------------- Aides

  private async getReadableVideo(actor: Actor | null, id: string) {
    const video = await this.prisma.video.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true, visibility: true, authorId: true, allowDuets: true },
    });
    if (!video) throw AppException.notFound();
    if (!actor) throw AppException.unauthorized();
    if (video.authorId === actor.id || isStaff(actor.role as never)) return video;
    if (!VISIBLE_STATUSES.includes(video.status)) throw AppException.notFound();
    return video;
  }

  private async mustGetEditableVideo(actor: Actor, id: string) {
    const video = await this.prisma.video.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, authorId: true },
    });
    if (!video) throw AppException.notFound();
    if (video.authorId !== actor.id && !isStaff(actor.role as never)) {
      throw AppException.forbidden();
    }
    return video;
  }
}

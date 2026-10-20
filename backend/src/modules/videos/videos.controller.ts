import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';
import { VideosService } from './videos.service';
import type { Actor } from './videos.types';
import { CreateUploadUrlDto, CreateVideoDto, SetVideoStatusDto, UpdateVideoDto } from './dto/videos.dto';

/** Presign des parties d'un upload multipart. */
class PresignPartsDto {
  partNumbers!: number[];
}

class CompleteUploadDto {
  parts!: { partNumber: number; etag: string }[];
  videoId?: string;
}

/**
 * Pipeline vidéos AFRI. Routes effectives /api/v1/videos/*.
 * Upload : presign -> (client envoie les parties) -> complete -> declare.
 * Mutations gardées par propriété (auteur ou staff).
 */
@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videos: VideosService) {}

  @Post('upload-url')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Ouvre une session multipart et renvoie key + taille de partie' })
  createUploadUrl(@CurrentUser() actor: Actor, @Body() dto: CreateUploadUrlDto) {
    return this.videos.createUploadUrl(actor, dto);
  }

  @Post(':id/upload-session/presign')
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({ summary: 'URLs présignées des parties demandées' })
  presignParts(@Param('id') _videoId: string, @CurrentUser() actor: Actor, @Query('uploadSessionId') uploadSessionId: string, @Body() dto: PresignPartsDto) {
    return this.videos.presignParts(actor, uploadSessionId, dto.partNumbers ?? []);
  }

  @Post(':id/upload-session/complete')
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({ summary: 'Valide le multipart côté S3 et clôture la session' })
  completeUpload(@Param('id') _videoId: string, @CurrentUser() actor: Actor, @Query('uploadSessionId') uploadSessionId: string, @Body() dto: CompleteUploadDto) {
    return this.videos.completeUpload(actor, uploadSessionId, dto.parts ?? [], dto.videoId);
  }

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Déclare la vidéo (UPLOADING) et enfile le transcodage' })
  declare(@CurrentUser() actor: Actor, @Body() dto: CreateVideoDto) {
    return this.videos.declare(actor, dto);
  }

  @Get('authors/:authorId')
  @ApiOperation({ summary: 'Vidéos visibles d\u2019un auteur (keyset)' })
  listByAuthor(@CurrentUser() actor: Actor, @Param('authorId') authorId: string, @Query() query: CursorPaginationQueryDto) {
    return this.videos.listByAuthor(actor, authorId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail d\u2019une vidéo (statut + visibilité filtrés)' })
  getOne(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.videos.getOne(actor, id);
  }

  @Post(':id/view')
  @HttpCode(201)
  @ApiOperation({ summary: 'Compteur de vues incrémental atomique' })
  registerView(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.videos.registerView(actor, id);
  }

  @Post(':id/like')
  @HttpCode(200)
  @ApiOperation({ summary: 'Like/unlike idempotent (unique (videoId,userId))' })
  toggleLike(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.videos.toggleLike(actor, id);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Édite les métadonnées (auteur ou staff)' })
  update(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: UpdateVideoDto) {
    return this.videos.update(actor, id, dto);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Soft delete (auteur ou staff)' })
  remove(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.videos.remove(actor, id);
  }

  @Patch(':id/status')
  @ApiBearerAuth()
  @Roles('ADMIN', 'SUPER_ADMIN', 'SUPPORT')
  @ApiOperation({ summary: 'Staff/worker : transition de statut gardée par la machine à états' })
  setStatus(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: SetVideoStatusDto) {
    return this.videos.setStatus(actor, id, dto);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';
import { LivesService } from './lives.service';
import type { Actor } from '../videos/videos.types';
import { AddLiveProductDto, CreateLiveDto, LiveMessageDto, TipDto, UpdateLiveDto } from './dto/lives.dto';

/**
 * Sessions live-commerce AFRI. Routes effectives /api/v1/lives/*.
 * Cycle de vie (start/end/cancel), vitrine produits, chat, tips portefeuille,
 * tokens LiveKit et abonnements « host en direct ».
 */
@ApiTags('lives')
@ApiBearerAuth()
@Controller('lives')
export class LivesController {
  constructor(private readonly lives: LivesService) {}

  // ------------------------------------------------------------- Consultation

  @Get()
  @ApiOperation({ summary: 'Lives en cours / planifiés (filtres pays & catégorie, keyset)' })
  list(
    @Query() query: CursorPaginationQueryDto,
    @Query('countryCode') countryCode?: string,
    @Query('category') category?: string,
  ) {
    return this.lives.listLive({ ...query, countryCode, category });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail d’une session (hôte + vitrine produits)' })
  getOne(@Param('id') id: string) {
    return this.lives.getOne(id);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Historique du chat (keyset ascendant)' })
  listMessages(@Param('id') id: string, @Query() query: CursorPaginationQueryDto) {
    return this.lives.listMessages(id, query);
  }

  @Post(':id/token')
  @HttpCode(200)
  @ApiOperation({ summary: 'JWT LiveKit : publisher si hôte/staff, subscriber sinon' })
  token(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.lives.tokenFor(actor, id);
  }

  // ------------------------------------------------------------ Cycle de vie

  @Post()
  @ApiOperation({ summary: 'Planifie (SCHEDULED) ou ouvre (startNow=true) une session' })
  create(@CurrentUser() actor: Actor, @Body() dto: CreateLiveDto) {
    return this.lives.create(actor, dto);
  }

  @Post(':id/start')
  @HttpCode(200)
  @ApiOperation({ summary: 'Démarre le direct (SCHEDULED → LIVE, anti-double-démarrage)' })
  start(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.lives.start(actor, id);
  }

  @Post(':id/end')
  @HttpCode(200)
  @ApiOperation({ summary: 'Termine le direct (LIVE → ENDED + fermeture room LiveKit)' })
  end(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.lives.end(actor, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Annule une session planifiée (hôte ou staff)' })
  cancel(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.lives.cancel(actor, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Métadonnées (titre / allowTips) — hôte ou staff' })
  update(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: UpdateLiveDto) {
    return this.lives.update(actor, id, dto);
  }

  // ------------------------------------------------------------------ Vitrine

  @Post(':id/products')
  @ApiOperation({ summary: 'Attache un produit à la vitrine du live (session active)' })
  addProduct(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: AddLiveProductDto) {
    return this.lives.addProduct(actor, id, dto);
  }

  @Post(':id/products/:liveProductId/pin')
  @HttpCode(200)
  @ApiOperation({ summary: 'Épingle un produit (un seul pinned par session)' })
  pinProduct(@CurrentUser() actor: Actor, @Param('id') id: string, @Param('liveProductId') liveProductId: string) {
    return this.lives.pinProduct(actor, id, liveProductId);
  }

  // --------------------------------------------------------------------- Chat

  @Post(':id/messages')
  @ApiOperation({ summary: 'Message du chat (pinned réservé hôte/staff, live LIVE requis)' })
  postMessage(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: LiveMessageDto) {
    return this.lives.postMessage(actor, id, dto);
  }

  // --------------------------------------------------------------------- Tips

  @Post(':id/tip')
  @ApiOperation({ summary: 'Don via portefeuille (débit idempotent obligatoire)' })
  tip(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: TipDto) {
    return this.lives.tip(actor, id, dto);
  }

  // ---------------------------------------------------------- Abonnements live

  @Post('hosts/:hostId/subscribe')
  @HttpCode(200)
  @Roles('USER', 'SELLER', 'INFLUENCER', 'COMPANY', 'COURIER', 'ADMIN', 'SUPER_ADMIN', 'SUPPORT')
  @ApiOperation({ summary: 'S’abonner aux notifications « host en direct » (upsert idempotent)' })
  subscribe(@CurrentUser() actor: Actor, @Param('hostId') hostId: string) {
    return this.lives.subscribe(actor, hostId);
  }

  @Delete('hosts/:hostId/subscribe')
  @HttpCode(200)
  @ApiOperation({ summary: 'Se désabonner des notifications live d’un hôte' })
  unsubscribe(@CurrentUser() actor: Actor, @Param('hostId') hostId: string) {
    return this.lives.unsubscribe(actor, hostId);
  }
}

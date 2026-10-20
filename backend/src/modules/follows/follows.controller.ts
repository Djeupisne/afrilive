import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FollowsService } from './follows.service';
import type { Actor } from '../videos/videos.types';

/**
 * Relations sociales. Routes effectives /api/v1/follows/*.
 * (Les listes followers/following d'un profil restent sur /users/u/:username/…)
 */
@ApiTags('follows')
@ApiBearerAuth()
@Controller('follows')
export class FollowsController {
  constructor(private readonly follows: FollowsService) {}

  @Get('suggestions')
  @ApiOperation({ summary: 'Suggestions 2ᵉ degré (comptes suivis par mes abonnements)' })
  suggestions(@CurrentUser() actor: Actor, @Query('limit') limit?: string) {
    return this.follows.suggestions(actor, limit ? Number(limit) : 20);
  }

  @Get('pending')
  @ApiOperation({ summary: 'Demandes d’abonnement reçues (compte privé)' })
  listPending(@CurrentUser() actor: Actor) {
    return this.follows.listPending(actor);
  }

  @Get(':targetId/state')
  @ApiOperation({ summary: 'État de la relation avec un compte (boutons mobile)' })
  state(@CurrentUser() actor: Actor, @Param('targetId') targetId: string) {
    return this.follows.state(actor, targetId);
  }

  @Post(':targetId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Suivre un compte (PENDING si privé)' })
  follow(@CurrentUser() actor: Actor, @Param('targetId') targetId: string) {
    return this.follows.follow(actor, targetId);
  }

  @Delete(':targetId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ne plus suivre (idempotent)' })
  unfollow(@CurrentUser() actor: Actor, @Param('targetId') targetId: string) {
    return this.follows.unfollow(actor, targetId);
  }

  @Patch(':requesterId/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accepter une demande d’abonnement (propriétaire)' })
  accept(@CurrentUser() actor: Actor, @Param('requesterId') requesterId: string) {
    return this.follows.accept(actor, requesterId);
  }

  @Patch(':requesterId/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refuser une demande d’abonnement (propriétaire)' })
  reject(@CurrentUser() actor: Actor, @Param('requesterId') requesterId: string) {
    return this.follows.reject(actor, requesterId);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';
import { Public } from '../../common/decorators/public.decorator';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUsernameDto } from './dto/username.dto';
import { UpdateSettingsDto } from './dto/settings.dto';
import { AddEmailDto, AddPhoneDto } from './dto/contact-channels.dto';

/**
 * Gestion du compte et des profils. Routes effectives sous /api/v1/users/*.
 */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // ------------------------------------------------------------ Moi (owner)

  @Get('me')
  @ApiOperation({ summary: 'Profil complet du titulaire (contacts masqués)' })
  getMe(@CurrentUser('id') userId: string) {
    return this.users.getMe(userId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Mettre à jour le profil public' })
  updateProfile(@CurrentUser('id') userId: string, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(userId, dto);
  }

  @Patch('me/username')
  @ApiOperation({ summary: "Changer le nom d'utilisateur (@handle)" })
  updateUsername(@CurrentUser('id') userId: string, @Body() dto: UpdateUsernameDto) {
    return this.users.updateUsername(userId, dto.username);
  }

  @Get('me/settings')
  @ApiOperation({ summary: 'Préférences du compte' })
  async getSettings(@CurrentUser('id') userId: string) {
    const me = await this.users.getMe(userId);
    return (me as { settings?: unknown }).settings ?? null;
  }

  @Patch('me/settings')
  @ApiOperation({ summary: 'Mettre à jour les préférences (compte privé, téléchargements…)' })
  updateSettings(@CurrentUser('id') userId: string, @Body() dto: UpdateSettingsDto) {
    return this.users.updateSettings(userId, dto);
  }

  @Post('me/phone')
  @ApiOperation({ summary: 'Rattacher un numéro de téléphone (si aucun)' })
  addPhone(@CurrentUser('id') userId: string, @Body() dto: AddPhoneDto) {
    return this.users.addPhone(userId, dto);
  }

  @Post('me/email')
  @ApiOperation({ summary: 'Rattacher une adresse e-mail (si aucune)' })
  addEmail(@CurrentUser('id') userId: string, @Body() dto: AddEmailDto) {
    return this.users.addEmail(userId, dto);
  }

  @Delete('me')
  @HttpCode(204)
  @ApiOperation({ summary: 'Supprimer (soft delete) son compte' })
  async deactivate(@CurrentUser('id') userId: string) {
    await this.users.deactivate(userId);
  }

  // ------------------------------------------------------------ Blocages

  @Get('me/blocks')
  @ApiOperation({ summary: 'Liste des utilisateurs bloqués (curseur)' })
  listBlocks(@CurrentUser('id') userId: string, @Query() q: CursorPaginationQueryDto) {
    return this.users.listBlocks(userId, q.cursor, q.limit);
  }

  @Post('blocks/:userId')
  @ApiOperation({ summary: "Bloquer un utilisateur (casse l'abonnement réciproque)" })
  block(@CurrentUser('id') userId: string, @Param('userId') targetId: string) {
    return this.users.block(userId, targetId);
  }

  @Delete('blocks/:userId')
  @ApiOperation({ summary: 'Débloquer un utilisateur' })
  unblock(@CurrentUser('id') userId: string, @Param('userId') targetId: string) {
    return this.users.unblock(userId, targetId);
  }

  // ------------------------------------------------------------ Profils publics

  @Public()
  @Get('u/:username')
  @ApiOperation({ summary: 'Profil public par @handle (cache Redis, flag viewerBlocked)' })
  getProfile(@Param('username') username: string, @CurrentUser('id') viewerId?: string) {
    return this.users.getProfile(username, viewerId);
  }

  @Public()
  @Get('u/:username/followers')
  @ApiOperation({ summary: 'Abonnés (curseur keyset)' })
  listFollowers(
    @Param('username') username: string,
    @Query() q: CursorPaginationQueryDto,
    @CurrentUser('id') viewerId?: string,
  ) {
    return this.resolveThenList(username, 'followers', q, viewerId);
  }

  @Public()
  @Get('u/:username/following')
  @ApiOperation({ summary: 'Abonnements (curseur keyset)' })
  listFollowing(
    @Param('username') username: string,
    @Query() q: CursorPaginationQueryDto,
    @CurrentUser('id') viewerId?: string,
  ) {
    return this.resolveThenList(username, 'following', q, viewerId);
  }

  private async resolveThenList(
    username: string,
    kind: 'followers' | 'following',
    q: CursorPaginationQueryDto,
    viewerId?: string,
  ) {
    const profile = await this.users.getProfile(username, viewerId);
    return this.users.listRelations((profile as { id: string }).id, kind, q.cursor, q.limit);
  }
}

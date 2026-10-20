import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';
import { NotificationsService } from './notifications.service';
import type { Actor } from '../videos/videos.types';

/** POST /notifications/devices — enregistrement d'un token push. */
class RegisterDeviceDto {
  @IsString()
  @MaxLength(512)
  token!: string;

  @IsIn(['IOS', 'ANDROID', 'WEB', 'HMS'])
  platform!: 'IOS' | 'ANDROID' | 'WEB' | 'HMS';

  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;
}

/**
 * Notifications in-app + push. Routes effectives /api/v1/notifications/*.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Historique des notifications (keyset, ?unread=true)' })
  list(@CurrentUser() actor: Actor, @Query() query: CursorPaginationQueryDto, @Query('unread') unread?: string) {
    return this.notifications.list(actor, { ...query, unread: unread === 'true' });
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Nombre de notifications non lues (badge mobile)' })
  unreadCount(@CurrentUser() actor: Actor) {
    return this.notifications.unreadCount(actor);
  }

  @Put(':id/read')
  @ApiOperation({ summary: 'Marquer une notification comme lue' })
  markRead(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.notifications.markRead(actor, id);
  }

  @Post('read-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Tout marquer comme lu' })
  markAllRead(@CurrentUser() actor: Actor) {
    return this.notifications.markAllRead(actor);
  }

  @Post('devices')
  @HttpCode(200)
  @ApiOperation({ summary: 'Enregistrer/rafraîchir un token device (FCM/APNs/HMS)' })
  registerDevice(@CurrentUser() actor: Actor, @Body() dto: RegisterDeviceDto) {
    return this.notifications.registerDevice(actor, dto);
  }

  @Delete('devices/:token')
  @HttpCode(200)
  @ApiOperation({ summary: 'Désenregistrer un token device (logout push)' })
  unregisterDevice(@CurrentUser() actor: Actor, @Param('token') token: string) {
    return this.notifications.unregisterDevice(actor, token);
  }
}

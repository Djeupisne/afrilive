import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';
import { FeedService } from './feed.service';
import type { Actor } from '../videos/videos.types';

/**
 * Flux vidéo (Pour toi / Abonnements / Tendances). Routes /api/v1/feed/*.
 */
@ApiTags('feed')
@ApiBearerAuth()
@Controller('feed')
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Get()
  @ApiOperation({ summary: 'Fil « Pour toi » (keyset, score léger engagement+pays)' })
  forYou(@CurrentUser() actor: Actor, @Query() query: CursorPaginationQueryDto) {
    return this.feed.forYou(actor, query);
  }

  @Get('subscriptions')
  @ApiOperation({ summary: 'Fil des abonnements (comptes suivis ACCEPTED)' })
  subscriptions(@CurrentUser() actor: Actor, @Query() query: CursorPaginationQueryDto) {
    return this.feed.subscriptions(actor, query);
  }

  @Get('trending')
  @ApiOperation({ summary: 'Tendances 7 jours (?countryCode=&limit=)' })
  trending(@CurrentUser() actor: Actor, @Query('countryCode') countryCode?: string, @Query('limit') limit?: string) {
    return this.feed.trending(actor, { countryCode, limit: limit ? Number(limit) : undefined });
  }

  @Get('suggested-authors')
  @ApiOperation({ summary: 'Auteurs suggérés à suivre' })
  suggestedAuthors(@CurrentUser() actor: Actor, @Query('limit') limit?: string) {
    return this.feed.suggestedAuthors(actor, limit ? Number(limit) : 10);
  }

  @Get('liked')
  @ApiOperation({ summary: 'Vidéos likées par l’acteur (écran Activité)' })
  liked(@CurrentUser() actor: Actor, @Query() query: CursorPaginationQueryDto) {
    return this.feed.likedVideos(actor, query);
  }
}

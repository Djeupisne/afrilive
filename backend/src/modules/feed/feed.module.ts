import { Module } from '@nestjs/common';
import { FeedController } from './feed.controller';
import { FeedService } from './feed.service';

/**
 * Feed vidéo : Pour toi (score déterministe), Abonnements, Tendances,
 * suggestions d'auteurs et historique de likes. Lecture seule + fan-out
 * de publication (notifyNewPublication) pour le module videos.
 */
@Module({
  controllers: [FeedController],
  providers: [FeedService],
  exports: [FeedService],
})
export class FeedModule {}

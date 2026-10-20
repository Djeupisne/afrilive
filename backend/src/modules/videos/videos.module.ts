import { Module } from '@nestjs/common';
import { StorageModule } from '../../integrations/storage/storage.module';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';

/**
 * Pipeline vidéos : presign S3/R2, déclaration, machine à états de statut,
 * likes/vues. StorageModule fournit StorageService ; QueueModule est @Global
 * (la queue video-transcode y est déjà enregistrée via BullModule.registerQueue).
 */
@Module({
  imports: [StorageModule],
  controllers: [VideosController],
  providers: [VideosService],
  exports: [VideosService],
})
export class VideosModule {}

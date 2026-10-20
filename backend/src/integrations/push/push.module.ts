import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { PushService } from './push.service';
import { FcmProvider } from './fcm.provider';
import { HmsProvider } from './hms.provider';

/** Module push : FCM (+APNs/Web) et HMS, routage par plateforme du device. */
@Module({
  imports: [PrismaModule],
  providers: [PushService, FcmProvider, HmsProvider],
  exports: [PushService],
})
export class PushModule {}

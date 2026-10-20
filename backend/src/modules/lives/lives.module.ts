import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { LivesController } from './lives.controller';
import { LivesGateway } from './lives.gateway';
import { LivesService } from './lives.service';
import { LivekitService } from './livekit.service';

/**
 * Live-commerce AFRI : cycle de vie des sessions (machine à états défensive),
 * vitrine produits, chat temps réel (Socket.IO), tips débitant le WalletService
 * (idempotence garantie), tokens LiveKit (publisher hôte / subscriber spectateur).
 */
@Module({
  imports: [WalletModule],
  controllers: [LivesController],
  providers: [LivesService, LivesGateway, LivekitService],
  exports: [LivesService],
})
export class LivesModule {}

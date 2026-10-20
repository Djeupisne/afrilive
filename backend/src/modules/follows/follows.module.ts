import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { FollowsController } from './follows.controller';
import { FollowsService } from './follows.service';

/**
 * Follow/unfollow, demandes d'abonnement (comptes privés), suggestions 2e
 * degré. S'appuie sur UsersService pour les gardes de blocage.
 */
@Module({
  imports: [UsersModule],
  controllers: [FollowsController],
  providers: [FollowsService],
  exports: [FollowsService],
})
export class FollowsModule {}

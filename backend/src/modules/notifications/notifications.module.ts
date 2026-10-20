import { Module } from '@nestjs/common';
import { PushModule } from '../../integrations/push/push.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * Hub notifications : in-app (table Notification), push (PushService),
 * gestion des tokens devices et fan-out déclenché par les DomainEvents
 * (live.started, order.paid, payment.succeeded, product.stock.low).
 */
@Module({
  imports: [PushModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}

import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/**
 * Paiements : cycle de vie (initiation idempotente, webhooks signature-first,
 * escrow, remboursements). Repose sur OrdersModule pour marquer la commande
 * PAID après succès d'un paiement purpose=ORDER.
 */
@Module({
  imports: [OrdersModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}

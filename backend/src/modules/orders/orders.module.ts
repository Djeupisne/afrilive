import { Module } from '@nestjs/common';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

/**
 * Panier + commandes. Exporte OrdersService pour que PaymentsModule puisse
 * marquer une commande PAID après confirmation d'un paiement.
 */
@Module({
  controllers: [CartController, OrdersController],
  providers: [CartService, OrdersService],
  exports: [CartService, OrdersService],
})
export class OrdersModule {}

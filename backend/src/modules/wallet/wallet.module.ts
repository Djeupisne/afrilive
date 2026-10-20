import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

/**
 * Wallets multi-devises (XOF défaut) : écritures atomiques, gel administratif,
 * idempotence via LedgerTransaction.idempotencyKey, retraits plafonnés et
 * conversion coins→argent. Service exporté pour les modules payants (orders,
 * payments, lives/tips) qui doivent débiter/créditer des soldes.
 */
@Module({
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}

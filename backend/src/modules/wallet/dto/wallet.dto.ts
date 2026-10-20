import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

/** Défaut interne : devise du wallet principal (marché cible AFRI-WALLET). */
export const DEFAULT_WALLET_CURRENCY = 'XOF';

/** Débit / crédit internes (crédit commission, débit remboursement…). */
export class AdjustBalanceDto {
  @ApiProperty({ description: 'Montant en unités mineures (entier strictement positif)', example: 1500 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountMinor!: number;

  @ApiProperty({ description: 'Clé d’idempotence obligatoire (évite les doubles écritures)' })
  @IsString()
  @MaxLength(64)
  idempotencyKey!: string;

  @ApiPropertyOptional({ description: 'Note interne visible par le staff uniquement', maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

/** Transfert entre deux wallets de même devise (scopé propriétaire). */
export class TransferWalletDto extends AdjustBalanceDto {}

/** Demande de retrait (minage du compteur quotidien + plafond journalier). */
export class RequestWithdrawalDto {
  @ApiProperty({ description: 'Montant à retirer, unités mineures', example: 250000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountMinor!: number;

  @ApiProperty({ description: 'Clé d’idempotence obligatoire' })
  @IsString()
  @MaxLength(64)
  idempotencyKey!: string;

  @ApiPropertyOptional({ description: 'Destination (numéro mobile money / IBAN)', maxLength: 64 })
  @IsOptional()
  @Matches(/^\+?[0-9A-Za-z\s-]{6,64}$/, { message: 'destination invalide' })
  destination?: string;
}

/** Conversion coins → argent (unités mineures), rate = mineurs par coin. */
export class ConvertCoinsDto {
  @ApiProperty({ description: 'Nombre de coins à convertir (entier strictement positif)', example: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  coins!: number;

  @ApiProperty({ description: 'Clé d’idempotence obligatoire' })
  @IsString()
  @MaxLength(64)
  idempotencyKey!: string;
}

/** Staff : gel / dégel d’un wallet (garde WALLET_FROZEN sur toutes les écritures). */
export class SetWalletFrozenDto {
  @ApiProperty({ description: 'true = geler (bloque toute écriture), false = dégeler' })
  @Type(() => Boolean)
  frozen!: boolean;

  @ApiPropertyOptional({ description: 'Motif (journalisation)', maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

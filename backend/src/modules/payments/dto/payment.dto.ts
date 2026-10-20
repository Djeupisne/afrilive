import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod, PaymentPurpose, PaymentProviderName } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

/** Initier un paiement pour une commande (ou un rechargement wallet). */
export class InitiatePaymentDto {
  @ApiProperty({ enum: PaymentPurpose, example: PaymentPurpose.ORDER })
  @IsEnum(PaymentPurpose)
  purpose!: PaymentPurpose;

  @ApiPropertyOptional({ description: 'Commande à payer (requis si purpose=ORDER)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  orderId?: string;

  @ApiProperty({ enum: PaymentProviderName, example: PaymentProviderName.ORANGE_MONEY })
  @IsEnum(PaymentProviderName)
  provider!: PaymentProviderName;

  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.MOBILE_MONEY })
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @ApiPropertyOptional({ description: 'Montant en unités mineures (défaut : total de la commande ou du top-up)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountMinor?: number;

  @ApiPropertyOptional({ example: 'XOF' })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'currency doit être un code ISO 4217 majuscule' })
  currency?: string;

  @ApiPropertyOptional({ description: 'Numéro destinataire du push mobile money' })
  @IsOptional()
  @Matches(/^\+?[0-9\s-]{7,17}$/, { message: 'phone invalide' })
  phone?: string;

  @ApiPropertyOptional({ example: 'CI' })
  @IsOptional()
  @Matches(/^[A-Z]{2}$/)
  countryCode?: string;

  @ApiProperty({ description: 'Clé d’idempotence obligatoire (évite les doubles débits)' })
  @IsString()
  @MaxLength(64)
  idempotencyKey!: string;
}

/** Confirmation manuelle (webhook simulable en dev / callback opérateur). */
export class ConfirmPaymentDto {
  @ApiProperty({ description: 'Référence fournie par l’opérateur', maxLength: 128 })
  @IsString()
  @MaxLength(128)
  providerRef!: string;

  @ApiPropertyOptional({ description: 'Métadonnées brutes de la réponse opérateur' })
  @IsOptional()
  response?: Record<string, unknown>;
}

/** Remboursement total ou partiel (staff). */
export class RefundPaymentDto {
  @ApiPropertyOptional({ description: 'Montant remboursé en unités mineures (défaut : tout)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountMinor?: number;

  @ApiProperty({ maxLength: 300 })
  @IsString()
  @MaxLength(300)
  reason!: string;
}

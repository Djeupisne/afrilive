import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderSource } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

/** Adresse de livraison : texte libre + géolocalisation optionnelle (JSON en base). */
export interface ShippingAddressInput {
  fullName: string;
  phone: string;
  city: string;
  district?: string;
  landmark?: string;
  lat?: number;
  lng?: number;
  notes?: string;
}

/** Créer une commande depuis le panier (ou une sélection de lignes). */
export class CreateOrderDto {
  @ApiProperty({ description: 'Adresse de livraison complète' })
  @IsObject()
  shippingAddress!: ShippingAddressInput;

  @ApiPropertyOptional({ example: 'CI', description: 'Pays de livraison (ISO 3166-1 alpha-2)' })
  @IsOptional()
  @Matches(/^[A-Z]{2}$/, { message: 'countryCode doit être un code ISO 3166-1 alpha-2 majuscule' })
  countryCode?: string;

  @ApiPropertyOptional({ enum: OrderSource, default: OrderSource.SHOP })
  @IsOptional()
  @IsEnum(OrderSource)
  source?: OrderSource;

  @ApiPropertyOptional({ description: 'Session live à laquelle la commande est rattachée' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  liveSessionId?: string;

  @ApiPropertyOptional({ description: 'Lignes précises à commander (défaut : tout le panier)', type: 'array', items: { type: 'string' } })
  @IsOptional()
  @IsString({ each: true })
  itemIds?: string[];

  @ApiPropertyOptional({ description: 'Frais de port (unités mineures, défaut 0)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  shippingMinor?: number;

  @ApiPropertyOptional({ description: 'Clé d’idempotence (UUID recommandé)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  idempotencyKey?: string;

  @ApiPropertyOptional({ description: 'Code promo de la boutique (remise appliquée au sous-total)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  couponCode?: string;
}

/** Transition manuelle d'état de commande (seller/staff selon l'étape). */
export class TransitionOrderDto {
  @ApiProperty({ description: 'Nouveau statut', enum: ['SHIPPED', 'DELIVERED', 'RETURNED'] })
  @IsString()
  @MaxLength(30)
  status!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

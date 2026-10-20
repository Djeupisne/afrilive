import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Category, ProductStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Slug produit : minuscules, chiffres et tirets uniquement. */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])?$/;

export class CreateProductDto {
  @ApiProperty({ example: 'Robe wax Ankara', maxLength: 120 })
  @IsString()
  @MaxLength(120)
  title!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ enum: Category, example: Category.FASHION })
  @IsEnum(Category)
  category!: Category;

  @ApiProperty({ example: 15000, description: 'Prix de base en unités mineures (entier, jamais flottant)' })
  @IsInt()
  @Min(1)
  basePriceMinor!: number;

  @ApiPropertyOptional({ example: 'XOF', description: 'Devise ISO 4217 ; doit correspondre à celle de la boutique' })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'currency doit être un code ISO 4217' })
  currency?: string;

  @ApiPropertyOptional({ example: 'robe-wax-ankara' })
  @IsOptional()
  @Matches(SLUG_RE, { message: 'slug invalide' })
  slug?: string;
}

export class UpdateProductDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ enum: Category })
  @IsOptional()
  @IsEnum(Category)
  category?: Category;

  @ApiPropertyOptional({ example: 15000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  basePriceMinor?: number;

  @ApiPropertyOptional({ example: 'robe-wax-ankara' })
  @IsOptional()
  @Matches(SLUG_RE, { message: 'slug invalide' })
  slug?: string;
}

/** Transition d'état du produit (DRAFT → ACTIVE → OUT_OF_STOCK/ARCHIVED). */
export class SetProductStatusDto {
  @ApiProperty({ enum: ProductStatus, example: ProductStatus.ACTIVE })
  @IsEnum(ProductStatus)
  status!: ProductStatus;
}

export class CreateVariantDto {
  @ApiProperty({ example: 'ROBE-WAX-M', description: 'SKU unique global' })
  @IsString()
  @MaxLength(64)
  sku!: string;

  @ApiPropertyOptional({ example: { taille: 'M', couleur: 'bleu' } })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @ApiProperty({ example: 17500, description: 'Prix en unités mineures' })
  @IsInt()
  @Min(1)
  priceMinor!: number;

  @ApiPropertyOptional({ example: 20000, description: 'Prix barré (comparaison), unités mineures' })
  @IsOptional()
  @IsInt()
  @Min(1)
  compareAtPriceMinor?: number;

  @ApiPropertyOptional({ example: 15000, description: 'Prix promo, unités mineures' })
  @IsOptional()
  @IsInt()
  @Min(1)
  salePriceMinor?: number;

  @ApiPropertyOptional({ example: 800, description: 'Poids en grammes' })
  @IsOptional()
  @IsInt()
  @Min(1)
  weightGrams?: number;

  @ApiPropertyOptional({ example: 'piece' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;
}

/** Correction de stock par le vendeur (delta signé appliqué atomiquement). */
export class AdjustStockDto {
  @ApiProperty({ example: 10, description: 'Quantité ajoutée (négatif = retrait)' })
  @Type(() => Number)
  @IsInt()
  delta!: number;

  @ApiPropertyOptional({ example: 5, description: 'Seuil d’alerte stock bas' })
  @IsOptional()
  @IsInt()
  @Min(0)
  lowStockThreshold?: number;
}

export class AddMediaDto {
  @ApiProperty({
    type: 'array',
    items: { type: 'string' },
    example: ['awa/produits/img-1.jpg'],
    description: 'Clés retournées par /shops/media/upload-url (après upload S3)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  keys!: string[];

  @ApiPropertyOptional({ example: 0, description: 'Position de départ (incrémentée par clé)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(99)
  startPosition?: number;
}

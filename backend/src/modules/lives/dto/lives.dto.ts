import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Category, LiveStatus } from '@prisma/client';

/** POST /lives — planifie ou ouvre directement une session live. */
export class CreateLiveDto {
  @IsString()
  @MaxLength(140)
  title!: string;

  @IsOptional()
  @IsString()
  shopId?: string;

  @IsOptional()
  scheduledAt?: Date;

  @IsOptional()
  @IsBoolean()
  allowTips?: boolean;

  @IsOptional()
  @IsEnum(Category)
  category?: Category;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  countryCode?: string;

  /** true demarre la session immediatement (LIVE) au lieu de SCHEDULED. */
  @IsOptional()
  @IsBoolean()
  startNow?: boolean;
}

/** PATCH /lives/:id — mtadatas et statut (transition gardee cote service). */
export class UpdateLiveDto {
  @IsOptional()
  @IsString()
  @MaxLength(140)
  title?: string;

  @IsOptional()
  @IsBoolean()
  allowTips?: boolean;

  @IsOptional()
  @IsEnum(LiveStatus)
  status?: LiveStatus;
}

/** POST /lives/:id/products — attache un produit a la vitrine du live. */
export class AddLiveProductDto {
  @IsString()
  productId!: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  position?: number;

  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  /** Prix promo en unites mineures (facultatif : prix nominal du produit). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  livePriceMinor?: number;

  @IsOptional()
  flashEndsAt?: Date;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockLimit?: number;
}

/** POST /lives/:id/messages — message du chat (pinned reserve au host/staff). */
export class LiveMessageDto {
  @IsString()
  @MaxLength(500)
  text!: string;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}

/** POST /lives/:id/tip — don via le portefeuille (cle d'idempotence obligatoire). */
export class TipDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountMinor!: number;

  @IsString()
  @MaxLength(3)
  currency!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  message?: string;

  @IsString()
  @MaxLength(200)
  idempotencyKey!: string;
}

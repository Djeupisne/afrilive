import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** Ajouter / incrémenter une variante dans le panier. */
export class AddCartItemDto {
  @ApiProperty({ description: 'Identifiant de la variante produit' })
  @IsString()
  @MaxLength(64)
  variantId!: string;

  @ApiPropertyOptional({ example: 1, description: 'Quantité additionnée (défaut 1)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;
}

/** Remplacer la quantité d'une ligne du panier. */
export class SetCartItemQuantityDto {
  @ApiProperty({ example: 3, description: 'Nouvelle quantité (0 = retirer la ligne)' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantity!: number;
}

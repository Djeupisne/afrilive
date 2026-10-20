import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Création de la boutique du vendeur (une seule boutique par utilisateur — ownerId unique). */
export class CreateShopDto {
  @ApiProperty({ example: 'Boutique Awa', maxLength: 80 })
  @IsString()
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({
    example: 'awa-mode',
    description: 'Identifiant URL ; slugs réservés refusés (admin, api, shop…)',
    maxLength: 60,
  })
  @IsOptional()
  @Matches(/^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])?$/, {
    message: 'slug : minuscules/chiffres/tirets, 2 à 60 caractères, ne commence/fini pas par un tiret',
  })
  slug?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: 'CI', description: 'Code pays ISO alpha-2' })
  @IsOptional()
  @Matches(/^[A-Z]{2}$/, { message: 'countryCode doit être un code ISO 3166-1 alpha-2 majuscule' })
  countryCode?: string;

  @ApiPropertyOptional({ example: 'XOF', description: 'Devise ISO 4217' })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'currency doit être un code ISO 4217 (ex. XOF)' })
  currency?: string;

  @ApiPropertyOptional({ example: 'Diarra SARL' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  companyName?: string;

  @ApiPropertyOptional({ example: 'CI-1234567-TAX' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  taxId?: string;
}

/** Mise à jour des informations de la boutique (owner ou staff uniquement). */
export class UpdateShopDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'URL logo (CDN)' })
  @IsOptional()
  @Matches(/^https?:\/\//, { message: 'logoUrl doit être une URL http(s)' })
  logoUrl?: string;

  @ApiPropertyOptional({ description: 'URL bannière (CDN)' })
  @IsOptional()
  @Matches(/^https?:\/\//, { message: 'bannerUrl doit être une URL http(s)' })
  bannerUrl?: string;

  @ApiPropertyOptional({ description: 'Thème personnalisé (couleurs, polices…)' })
  @IsOptional()
  @IsObject()
  theme?: Record<string, unknown>;

  @ApiPropertyOptional({ example: '14 jours' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  returnPolicy?: string;

  @ApiPropertyOptional({ description: 'Horaires d’ouverture JSON (jour → créneaux)' })
  @IsOptional()
  @IsObject()
  openingHours?: Record<string, unknown>;
}

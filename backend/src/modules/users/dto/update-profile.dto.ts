import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

/** Mise à jour du profil public (les champs sensibles passent par des endpoints dédiés). */
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Awa Diarra', maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  displayName?: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  bio?: string;

  @ApiPropertyOptional({ description: 'URL avatar (issue de /uploads presign, CDN)' })
  @IsOptional()
  @Matches(/^https?:\/\//, { message: 'avatarUrl doit être une URL http(s)' })
  avatarUrl?: string;

  @ApiPropertyOptional({ description: 'URL image de couverture' })
  @IsOptional()
  @Matches(/^https?:\/\//, { message: 'coverUrl doit être une URL http(s)' })
  coverUrl?: string;

  @ApiPropertyOptional({ example: 'CI', description: 'Code pays ISO 3166-1 alpha-2' })
  @IsOptional()
  @Matches(/^[A-Z]{2}$/, { message: 'countryCode doit être un code ISO 3166-1 alpha-2 majuscule' })
  countryCode?: string;

  @ApiPropertyOptional({ example: 'fr' })
  @IsOptional()
  @Matches(/^[a-z]{2}(-[A-Z]{2})?$/, { message: 'language invalide (ex. fr, en, fr-CI)' })
  language?: string;

  @ApiPropertyOptional({ example: 1995, minimum: 1900, maximum: 2100 })
  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  birthYear?: number;
}

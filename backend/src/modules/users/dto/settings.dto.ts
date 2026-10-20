import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsObject, IsOptional } from 'class-validator';

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === 1 || value === '1'
    ? true
    : value === false || value === 'false' || value === 0 || value === '0'
      ? false
      : value;

/** Préférences du compte (schéma UserSettings côté Prisma). */
export class UpdateSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isPrivate?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  allowDownloads?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  allowComments?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  allowDuets?: boolean;

  @ApiPropertyOptional({ description: 'Heures silencieuses, ex. {"start":"22:00","end":"07:00"}' })
  @IsOptional()
  @IsObject()
  quietHours?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Préférences de notification par type' })
  @IsOptional()
  @IsObject()
  notificationPrefs?: Record<string, unknown>;
}

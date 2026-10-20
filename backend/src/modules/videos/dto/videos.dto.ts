import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Category, RemixType, VideoStatus, Visibility } from '@prisma/client';

/** POST /videos — déclare une vidéo en cours d'upload (status UPLOADING). */
export class CreateVideoDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  caption?: string;

  @IsOptional()
  @IsEnum(Visibility)
  visibility?: Visibility;

  @IsOptional()
  @IsString()
  sourceKey?: string;

  @IsOptional()
  @IsString()
  thumbnailKey?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3600)
  durationSec?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  width?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  height?: number;

  @IsOptional()
  @IsString()
  soundId?: string;

  @IsOptional()
  @IsString()
  remixOfId?: string;

  @IsOptional()
  @IsEnum(RemixType)
  remixType?: RemixType;

  @IsOptional()
  @IsEnum(Category)
  category?: Category;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  countryCode?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  allowComments?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  allowDuets?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  allowDownload?: boolean;
}

/** PATCH /videos/:id — métadonnées éditables par l'auteur. */
export class UpdateVideoDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  caption?: string;

  @IsOptional()
  @IsEnum(Visibility)
  visibility?: Visibility;

  @IsOptional()
  @IsEnum(Category)
  category?: Category;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  allowComments?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  allowDuets?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  allowDownload?: boolean;
}

/** POST /videos/upload-url — presign multipart S3/R2 + UploadSession. */
export class CreateUploadUrlDto {
  @IsString()
  @MaxLength(512)
  filename!: string;

  @IsString()
  @MaxLength(64)
  contentType!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sizeBytes?: number;
}

/** PATCH /videos/:id/status — callback du worker de transcodage (staff only). */
export class SetVideoStatusDto {
  @IsEnum(VideoStatus)
  status!: VideoStatus;

  @IsOptional()
  @IsString()
  hlsKey?: string;

  @IsOptional()
  @IsString()
  thumbnailKey?: string;
}

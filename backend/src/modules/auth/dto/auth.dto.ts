import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Téléphone E.164 normalisé (sans espaces ni tirets). */
const PHONE_REGEX = /^\+[1-9]\d{7,14}$/;

export class RequestOtpDto {
  @ApiProperty({ example: '+2250712345678', description: 'Numéro E.164 (canal SMS/WhatsApp)' })
  @IsString()
  @Matches(PHONE_REGEX, { message: 'phone doit être au format E.164 (ex. +2250712345678)' })
  phone!: string;

  @ApiPropertyOptional({ enum: ['sms', 'whatsapp'], default: 'sms' })
  @IsOptional()
  @IsIn(['sms', 'whatsapp'])
  channel?: 'sms' | 'whatsapp';
}

export class VerifyOtpDto {
  @ApiProperty({ example: '+2250712345678' })
  @IsString()
  @Matches(PHONE_REGEX, { message: 'phone doit être au format E.164' })
  phone!: string;

  @ApiProperty({ example: '482913', description: 'Code à 6 chiffres' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code doit contenir exactement 6 chiffres' })
  code!: string;

  @ApiPropertyOptional({ description: 'ID d’appareil pour rattacher la session' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string;

  @ApiPropertyOptional({ description: 'Marque-page : enchaîne une autre action après vérification' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  redirectTo?: string;
}

export class RegisterDto {
  @ApiProperty({ example: '+2250712345678' })
  @IsString()
  @Matches(PHONE_REGEX, { message: 'phone doit être au format E.164' })
  phone!: string;

  @ApiProperty({ example: '482913', description: 'OTP préalablement envoyé (verify=true saute l’envoi)' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'otp doit contenir exactement 6 chiffres' })
  otp!: string;

  @ApiProperty({ example: 'awa_traore', minLength: 3, maxLength: 30 })
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-z0-9._]{3,30}$/, { message: 'username : minuscules, chiffres, point, underscore' })
  username!: string;

  @ApiProperty({ example: 'Awa Traoré' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  displayName!: string;

  @ApiPropertyOptional({ example: 'awa@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'CI', minLength: 2, maxLength: 2 })
  @IsOptional()
  @Matches(/^[A-Z]{2}$/)
  countryCode?: string;
}

export class SocialLoginDto {
  @ApiProperty({ enum: ['google', 'facebook', 'apple', 'tiktok'] })
  @IsIn(['google', 'facebook', 'apple', 'tiktok'])
  provider!: 'google' | 'facebook' | 'apple' | 'tiktok';

  @ApiProperty({ description: 'id_token (Google/Apple) ou access_token (Facebook/TikTok)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  token!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string;
}

export class RefreshTokenDto {
  @ApiProperty({ description: 'Refresh token émis à la connexion (rotation à chaque usage)' })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class TwoFactorEnableStartDto {
  @ApiPropertyOptional({ description: 'Nom de l’émetteur affiché dans l’app TOTP', default: 'AfriLive' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  issuer?: string;
}

export class TwoFactorVerifyDto {
  @ApiProperty({ example: '384920', description: 'Code TOTP 6 chiffres ou code de secours' })
  @IsString()
  @Matches(/^(\d{6}|[a-z0-9]{10})$/i, { message: 'code invalide (TOTP 6 chiffres ou backup 10 caractères)' })
  code!: string;
}

export class TwoFactorDisableDto {
  @ApiProperty({ description: 'Mot de passe OTP récent : code TOTP valide requis pour désactiver' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'totp requis' })
  totp!: string;
}

export class LogoutDto {
  @ApiPropertyOptional({ description: 'Révoquer toutes les sessions (family-wide)' })
  @IsOptional()
  allDevices?: boolean;
}

export class UploadKycDto {
  @ApiProperty({ enum: ['ID_CARD', 'PASSPORT', 'SELFIE', 'PROOF_OF_ADDRESS', 'MOBILE_MONEY_ACCOUNT'] })
  @IsIn(['ID_CARD', 'PASSPORT', 'SELFIE', 'PROOF_OF_ADDRESS', 'MOBILE_MONEY_ACCOUNT'])
  type!: string;

  @ApiProperty({ description: 'Clé S3 retournée par POST /kyc/upload-url' })
  @IsString()
  @IsNotEmpty()
  fileKey!: string;
}

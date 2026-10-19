import { plainToInstance } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength, validateSync } from 'class-validator';

/** Contraints minimales sur les variables d'environnement (validées au bootstrap). */
export class EnvironmentVariables {
  @IsString()
  @MinLength(1)
  DATABASE_URL!: string;

  @IsString()
  REDIS_URL!: string;

  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @MinLength(32)
  JWT_REFRESH_SECRET!: string;

  @IsString()
  @MinLength(64)
  ENCRYPTION_KEY!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;

  @IsOptional()
  @IsIn(['development', 'production', 'test'])
  NODE_ENV: 'development' | 'production' | 'test' = 'development';

  @IsOptional()
  @IsIn(['debug', 'log', 'warn', 'error', 'silent'])
  LOG_LEVEL: string = 'debug';

  @IsOptional() @IsString() JWT_ACCESS_TTL?: string;
  @IsOptional() @IsString() JWT_REFRESH_TTL?: string;

  @IsOptional() @IsIn(['console', 'real']) SMS_MODE?: string;
  @IsOptional() @IsIn(['mock', 'live']) PAYMENT_MODE?: string;
  @IsOptional() @IsIn(['console', 'real']) PUSH_MODE?: string;
  @IsOptional() @IsIn(['console', 'real']) EMAIL_MODE?: string;
  @IsOptional() @IsIn(['memory', 's3']) STORAGE_MODE?: string;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors.map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`).join('\n');
    throw new Error(`Variables d'environnement invalides :\n${details}`);
  }
  return validated;
}

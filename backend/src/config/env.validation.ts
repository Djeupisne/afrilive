import { plainToInstance } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength, validateSync } from 'class-validator';

/** Regex URL http(s) simple (validateur d'URL strict en production). */
const HTTP_URL_RE = /^https?:\/\/[^\s]+$/i;

/** Clé AWS KMS : ARN complet ou alias. */
const KMS_ARN_RE = /^(arn:aws(-cn|-us-gov)?:kms:[a-z0-9-]+:\d{12}:key\/[0-9a-f-]{36}|alias\/[\w\/-]+)$/;

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

  // --- Secrets managés (AWS Secrets Manager / SSM Parameter Store) ---
  @IsOptional() @IsIn(['env', 'aws']) SECRETS_BACKEND?: string;
  @IsOptional() @IsString() AWS_SECRETSMANAGER_SECRET_ID?: string;
  @IsOptional() @IsString() AWS_SSM_PATH_PREFIX?: string;
  @IsOptional() @IsString() AWS_KMS_KEY_ID?: string;

  // --- Variables lues par les règles croisées (non décorées : transmises via extras) ---
  APP_BASE_URL?: string;
  FLUTTERWAVE_SECRET_KEY?: string;
  FLUTTERWAVE_PUBLIC_KEY?: string;
  PAYSTACK_SECRET_KEY?: string;
  PAYSTACK_PUBLIC_KEY?: string;
  PAYMENT_WEBHOOK_SECRET?: string;

  /** Point d'entrée public pour validateEnv (wrapper de la méthode privée). */
  enforceProductionRulesPublic(): string[] {
    return this.enforceProductionRules();
  }

  /**
   * Durcissement production : certaines variables optionnelles en dev
   * deviennent obligatoires, et des valeurs unsafe sont refusées.
   */
  private enforceProductionRules(): string[] {
    const errors: string[] = [];
    const reqStr = (name: string, min = 8): void => {
      const v = (this as unknown as Record<string, unknown>)[name];
      if (typeof v !== 'string' || v.trim().length < min) {
        errors.push(`${name}: requis en production (longueur minimale ${min})`);
      }
    };

    // URLs : https obligatoire hors localhost en production.
    const checkUrl = (name: string) => {
      const v = (this as unknown as Record<string, unknown>)[name];
      if (typeof v !== 'string' || !HTTP_URL_RE.test(v)) {
        errors.push(`${name}: URL http(s) invalide`);
        return;
      }
      if (/^http:\/\//i.test(v) && !/localhost|127\.0\.0\.1/.test(v)) {
        errors.push(`${name}: http interdit en production hors localhost (https requis)`);
      }
    };

    if (this.NODE_ENV === 'production') {
      reqStr('REDIS_URL');
      checkUrl('REDIS_URL');
      reqStr('APP_BASE_URL');
      checkUrl('APP_BASE_URL');
      reqStr('CORS_ORIGINS');
      if ((this.CORS_ORIGINS ?? '').includes('*')) {
        errors.push('CORS_ORIGINS: le joker "*" est interdit en production');
      }
      // Les modes "console" ou "mock" n'ont pas leur place en prod.
      if (this.SMS_MODE !== 'real') errors.push('SMS_MODE: doit valoir "real" en production');
      if (this.PUSH_MODE !== 'real') errors.push('PUSH_MODE: doit valoir "real" en production');
      if (this.EMAIL_MODE !== 'real') errors.push('EMAIL_MODE: doit valoir "real" en production');
      if (this.STORAGE_MODE !== 's3') errors.push('STORAGE_MODE: doit valoir "s3" en production');
      if (this.PAYMENT_MODE !== 'live') errors.push('PAYMENT_MODE: doit valoir "live" en production');
      // En PAYMENT_MODE=live, au moins un secret agrégateur doit exister.
      if (this.PAYMENT_MODE === 'live') {
        const hasAggregator = Boolean(this.FLUTTERWAVE_SECRET_KEY || this.PAYSTACK_SECRET_KEY);
        if (!hasAggregator) {
          errors.push('PAYMENT_MODE=live: FLUTTERWAVE_SECRET_KEY ou PAYSTACK_SECRET_KEY requis');
        }
      }
      // Webhook : signature obligatoire dès que le mode live est actif.
      if (this.PAYMENT_MODE === 'live') {
        reqStr('PAYMENT_WEBHOOK_SECRET', 16);
      }
      // Secrets backend AWS : cohérence de la config.
      if (this.SECRETS_BACKEND === 'aws') {
        const hasSource = Boolean(this.AWS_SECRETSMANAGER_SECRET_ID || this.AWS_SSM_PATH_PREFIX);
        if (!hasSource) {
          errors.push('SECRETS_BACKEND=aws: AWS_SECRETSMANAGER_SECRET_ID ou AWS_SSM_PATH_PREFIX requis');
        }
        if (this.AWS_KMS_KEY_ID && !KMS_ARN_RE.test(this.AWS_KMS_KEY_ID)) {
          errors.push('AWS_KMS_KEY_ID: ARN KMS ou alias ("alias/...") attendu');
        }
      }
      // JWT : interdire les secrets de placeholder connus.
      for (const k of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY'] as const) {
        const v = String((this as unknown as Record<string, unknown>)[k] ?? '');
        if (/change(me|this)|secret123|placeholder|xxx/i.test(v)) {
          errors.push(`${k}: valeur de placeholder interdite en production`);
        }
      }
    }
    return errors;
  }
}

/** Variables supplémentaires déclarées sans décorateurs (présentes dans process.env). */
interface ExtraEnvVars {
  APP_BASE_URL?: string;
  FLUTTERWAVE_SECRET_KEY?: string;
  FLUTTERWAVE_PUBLIC_KEY?: string;
  PAYSTACK_SECRET_KEY?: string;
  PAYSTACK_PUBLIC_KEY?: string;
  PAYMENT_WEBHOOK_SECRET?: string;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  // Conserver les variables non décorées pour les règles croisées (agrégateurs, webhook).
  const extras: ExtraEnvVars = {
    APP_BASE_URL: typeof config.APP_BASE_URL === 'string' ? config.APP_BASE_URL : undefined,
    FLUTTERWAVE_SECRET_KEY: typeof config.FLUTTERWAVE_SECRET_KEY === 'string' ? config.FLUTTERWAVE_SECRET_KEY : undefined,
    FLUTTERWAVE_PUBLIC_KEY: typeof config.FLUTTERWAVE_PUBLIC_KEY === 'string' ? config.FLUTTERWAVE_PUBLIC_KEY : undefined,
    PAYSTACK_SECRET_KEY: typeof config.PAYSTACK_SECRET_KEY === 'string' ? config.PAYSTACK_SECRET_KEY : undefined,
    PAYSTACK_PUBLIC_KEY: typeof config.PAYSTACK_PUBLIC_KEY === 'string' ? config.PAYSTACK_PUBLIC_KEY : undefined,
    PAYMENT_WEBHOOK_SECRET: typeof config.PAYMENT_WEBHOOK_SECRET === 'string' ? config.PAYMENT_WEBHOOK_SECRET : undefined,
  };
  Object.assign(validated, extras);

  const errors = validateSync(validated, { skipMissingProperties: false });
  const messages = errors.map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`);
  messages.push(...validated.enforceProductionRulesPublic());
  if (messages.length > 0) {
    throw new Error(`Variables d'environnement invalides :\n${messages.join('\n')}`);
  }
  return validated;
}

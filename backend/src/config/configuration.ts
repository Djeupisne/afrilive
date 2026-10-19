import { registerAs } from '@nestjs/config';
import { validateEnv } from './env.validation';

/**
 * Configuration typée centralisée : lit process.env, valide une première fois
 * ici aussi (pour les tests/unit), et expose des namespaces via ConfigService.
 */
export default registerAs('app', () => {
  const env = validateEnv(process.env as Record<string, unknown>);
  return {
    env: env.NODE_ENV,
    port: env.PORT,
    corsOrigins: (process.env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim()),
    logLevel: env.LOG_LEVEL,

    database: { url: env.DATABASE_URL },
    redis: { url: env.REDIS_URL },

    jwt: {
      accessSecret: env.JWT_ACCESS_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
      refreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
    },
    encryptionKey: env.ENCRYPTION_KEY,

    modes: {
      sms: env.SMS_MODE ?? 'console',
      payment: env.PAYMENT_MODE ?? 'mock',
      push: env.PUSH_MODE ?? 'console',
      email: env.EMAIL_MODE ?? 'console',
      storage: env.STORAGE_MODE ?? 'memory',
    },

    business: {
      commissionPercent: Number(process.env.COMMISSION_PERCENT ?? 8),
      escrowAutoReleaseHours: Number(process.env.ESCROW_AUTO_RELEASE_HOURS ?? 72),
      orderPaymentTtlMin: Number(process.env.ORDER_PAYMENT_TTL_MIN ?? 15),
      blockedCountries: (process.env.BLOCKED_COUNTRIES ?? '').split(',').filter(Boolean),
      badgeMinFollowers: Number(process.env.BADGE_MIN_FOLLOWERS ?? 1000),
      badgeMinDeliveredOrders: Number(process.env.BADGE_MIN_DELIVERED_ORDERS ?? 50),
      badgeMinRating: Number(process.env.BADGE_MIN_RATING ?? 4.5),
      maxAccountsPerDevice: Number(process.env.MAX_ACCOUNTS_PER_DEVICE ?? 3),
    },

    livekit: {
      url: process.env.LIVEKIT_URL ?? 'ws://localhost:7880',
      apiKey: process.env.LIVEKIT_API_KEY ?? '',
      apiSecret: process.env.LIVEKIT_API_SECRET ?? '',
    },
    meili: {
      host: process.env.MEILI_HOST ?? 'http://localhost:7700',
      key: process.env.MEILI_KEY ?? '',
    },
    storage: {
      endpoint: process.env.S3_ENDPOINT ?? '',
      region: process.env.S3_REGION ?? 'auto',
      bucket: process.env.S3_BUCKET ?? 'afrilive',
      accessKey: process.env.S3_ACCESS_KEY ?? '',
      secretKey: process.env.S3_SECRET_KEY ?? '',
      cdnBaseUrl: process.env.CDN_BASE_URL ?? '',
      cdnTokenKey: process.env.CDN_TOKEN_KEY ?? '',
    },
  };
});

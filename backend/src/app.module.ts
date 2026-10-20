import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './database/prisma.module';
import { RedisModule } from './integrations/redis/redis.module';
import { RedisService } from './integrations/redis/redis.service';
import { StorageModule } from './integrations/storage/storage.module';
import { QueueModule } from './integrations/queue/queue.module';
import { SmsModule } from './integrations/sms/sms.module';
import { PushModule } from './integrations/push/push.module';
import { EmailModule } from './integrations/email/email.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ShopsModule } from './modules/shops/shops.module';
import { ProductsModule } from './modules/products/products.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { WalletModule } from './modules/wallet/wallet.module';

/**
 * Racine de l'application.
 * Modules métier : auth enregistré (étape 4 en cours) ; users/wallet/etc.
 * suivront au fil de l'implémentation.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validate: (config) => validateEnv(config),
    }),
    EventEmitterModule.forRoot({ wildcard: true, delimiter: '.' }),
    ScheduleModule.forRoot(),
    RedisModule,
    // Rate-limit global stocké sur Redis (partagé entre instances) plutôt qu'en mémoire.
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [{ ttl: 60_000, limit: 100 }],
        // Cast : signature increment() du storage @nest-lab (5 args) plus large
        // que celle attendue par @nestjs/throttler v5 (2 args) — compatible à l'exécution.
        storage: new ThrottlerStorageRedisService(redis.client) as unknown as import('@nestjs/throttler').ThrottlerStorage,
      }),
    }),
    PrismaModule,
    StorageModule,
    QueueModule,
    SmsModule,
    PushModule,
    EmailModule,
    AuthModule,
    UsersModule,
    ShopsModule,
    ProductsModule,
    OrdersModule,
    PaymentsModule,
    WalletModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(_consumer: MiddlewareConsumer): void {
    // Point d'extension pour les middlewares futurs (ex. parsing multipart, tenant).
  }
}

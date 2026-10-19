import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

/** Module Redis global : un seul client ioredis partagé (cache, locks, throttler, idempotence, pub/sub). */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}

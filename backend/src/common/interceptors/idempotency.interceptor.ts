import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { Observable, of, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../errors/app.exception';
import { ERROR_CODES } from '../errors/error-codes';

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
const LOCK_TTL_MS = 60_000; // verrou "en cours" : 1 min
const RESULT_TTL_SEC = 24 * 3600; // réponse mémorisée : 24 h

interface CachedResult {
  status: number;
  body: unknown;
}

/**
 * Intercepteur global d'idempotence : sur les méthodes mutantes (POST/PATCH/PUT)
 * avec un en-tête `Idempotency-Key`, mémorise la réponse dans Redis et rejoue
 * cette réponse en cas de doublon. Sans clé ou sans Redis : no-op.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);
  private redis: Redis | null = null;

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {
    const url = this.config.get<string>('REDIS_URL');
    if (url) {
      try {
        this.redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: false });
        this.redis.on('error', (e) => this.logger.warn(`Redis idempotency: ${e.message}`));
      } catch (e) {
        this.logger.warn('Redis indisponible pour l’idempotence — désactivé.');
        this.redis = null;
      }
    }
  }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    if (!['POST', 'PATCH', 'PUT'].includes(request.method) || !this.redis) {
      return next.handle();
    }
    const key = request.headers[IDEMPOTENCY_KEY_HEADER] as string | undefined;
    if (!key) return next.handle();

    const scope = `${request.method}:${request.baseUrl ?? request.path}:${request.user ? (request.user as { id?: string }).id ?? 'anon' : 'anon'}`;
    const redisKey = `idem:${scope}:${key}`;
    const lockKey = `${redisKey}:lock`;

    // Réponse déjà calculée → on la rejoue.
    const cached = await this.redis.get(redisKey);
    if (cached) {
      const parsed = JSON.parse(cached) as CachedResult;
      response.status(parsed.status);
      response.setHeader('idempotency-replayed', 'true');
      return of(parsed.body);
    }

    // Verrou SET NX : requête simultanée avec la même clé → 409.
    const locked = await this.redis.set(lockKey, '1', 'PX', LOCK_TTL_MS, 'NX');
    if (!locked) {
      return throwError(
        () =>
          new AppException(ERROR_CODES.IDEMPOTENCY_CONFLICT, {
            status: HttpStatus.CONFLICT,
            detail: 'Une requête identique est déjà en cours de traitement.',
          }),
      );
    }

    return next.handle().pipe(
      tap((body) => {
        void this.redis!
          .set(redisKey, JSON.stringify({ status: response.statusCode, body }), 'EX', RESULT_TTL_SEC)
          .then(() => this.redis!.del(lockKey))
          .catch(() => undefined);
      }),
      catchError((err: unknown) => {
        // En cas d'échec on libère le verrou pour permettre une nouvelle tentative.
        void this.redis!.del(lockKey).catch(() => undefined);
        return throwError(() => err);
      }),
    );
  }
}

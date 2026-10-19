import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, of, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { RedisService } from '../../integrations/redis/redis.service';
import { AppException } from '../errors/app.exception';
import { ERROR_CODES } from '../errors/error-codes';

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
const LOCK_TTL_SEC = 60; // verrou « en cours » : 1 min
const RESULT_TTL_SEC = 24 * 3600; // réponse mémorisée : 24 h

interface CachedResult {
  status: number;
  body: unknown;
}

/**
 * Intercepteur global d'idempotence : sur les méthodes mutantes (POST/PATCH/PUT)
 * avec un en-tête `Idempotency-Key`, mémorise la réponse dans Redis et rejoue
 * cette réponse en cas de doublon. Redis est OBLIGATOIRE (pas de no-op) :
 * une erreur Redis remonte en 503 plutôt que de laisser passer des doublons.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly redis: RedisService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    if (!['POST', 'PATCH', 'PUT'].includes(request.method)) return next.handle();
    const key = request.headers[IDEMPOTENCY_KEY_HEADER] as string | undefined;
    if (!key) return next.handle();

    const scope = `${request.method}:${request.baseUrl ?? request.path}:${request.user ? (request.user as { id?: string }).id ?? 'anon' : 'anon'}`;
    const redisKey = `idem:${scope}:${key}`;
    const lockKey = `${redisKey}:lock`;

    try {
      // Réponse déjà calculée → on la rejoue.
      const cached = await this.redis.get(redisKey);
      if (cached) {
        const parsed = JSON.parse(cached) as CachedResult;
        response.status(parsed.status);
        response.setHeader('idempotency-replayed', 'true');
        return of(parsed.body);
      }

      // Verrou SET NX : requête simultanée avec la même clé → 409.
      const locked = await this.redis.setNx(lockKey, '1', LOCK_TTL_SEC);
      if (!locked) {
        return throwError(
          () =>
            new AppException(ERROR_CODES.IDEMPOTENCY_CONFLICT, {
              status: HttpStatus.CONFLICT,
              detail: 'Une requête identique est déjà en cours de traitement.',
            }),
        );
      }
    } catch (e) {
      this.logger.error(`Redis indisponible pour l'idempotence: ${(e as Error).message}`);
      return throwError(
        () =>
          new AppException(ERROR_CODES.INTERNAL_ERROR, {
            status: HttpStatus.SERVICE_UNAVAILABLE,
            detail: "Service d'idempotence indisponible, réessayez.",
          }),
      );
    }

    return next.handle().pipe(
      tap((body) => {
        void this.redis
          .set(redisKey, JSON.stringify({ status: response.statusCode, body }), RESULT_TTL_SEC)
          .then(() => this.redis.del(lockKey))
          .catch(() => undefined);
      }),
      catchError((err: unknown) => {
        // En cas d'échec on libère le verrou pour permettre une nouvelle tentative.
        void this.redis.del(lockKey).catch(() => undefined);
        return throwError(() => err);
      }),
    );
  }
}

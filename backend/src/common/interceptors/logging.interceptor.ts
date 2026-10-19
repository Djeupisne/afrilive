import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { randomUUID } from 'node:crypto';
import { tap } from 'rxjs/operators';

/**
 * Journalise chaque requête (méthode, URL, statut, durée) et propage/attache
 * un corrélateur `x-request-id` pour le traçage bout-en-bout.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const requestId = (request.headers['x-request-id'] as string) ?? randomUUID();
    request.headers['x-request-id'] = requestId;
    response.setHeader('x-request-id', requestId);

    const start = process.hrtime.bigint();
    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Number(process.hrtime.bigint() - start) / 1e6;
          this.logger.log(
            `${request.method} ${request.originalUrl} ${response.statusCode} ${ms.toFixed(1)}ms rid=${requestId}`,
          );
        },
        error: (err: Error) => {
          const ms = Number(process.hrtime.bigint() - start) / 1e6;
          this.logger.warn(
            `${request.method} ${request.originalUrl} ERR ${err.message} ${ms.toFixed(1)}ms rid=${requestId}`,
          );
        },
      }),
    );
  }
}

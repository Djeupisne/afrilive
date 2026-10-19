import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { AppException, ProblemDetails } from '../errors/app.exception';
import { ERROR_CODES } from '../errors/error-codes';

type MessagePack = { fr: string; en: string };

const MESSAGES: Record<string, MessagePack> = {
  [String(HttpStatus.BAD_REQUEST)]: { fr: 'Requête invalide.', en: 'Bad request.' },
  [String(HttpStatus.UNAUTHORIZED)]: { fr: 'Authentification requise.', en: 'Authentication required.' },
  [String(HttpStatus.FORBIDDEN)]: { fr: 'Accès refusé.', en: 'Access denied.' },
  [String(HttpStatus.NOT_FOUND)]: { fr: 'Ressource introuvable.', en: 'Resource not found.' },
  [String(HttpStatus.CONFLICT)]: { fr: 'Conflit avec l’état actuel de la ressource.', en: 'Conflict with the current resource state.' },
  [String(HttpStatus.UNPROCESSABLE_ENTITY)]: { fr: 'Traitement impossible.', en: 'Unprocessable entity.' },
  [String(HttpStatus.TOO_MANY_REQUESTS)]: { fr: 'Trop de requêtes, réessayez plus tard.', en: 'Too many requests, try again later.' },
  [String(HttpStatus.INTERNAL_SERVER_ERROR)]: { fr: 'Erreur interne du serveur.', en: 'Internal server error.' },
  [String(HttpStatus.SERVICE_UNAVAILABLE)]: { fr: 'Service temporairement indisponible.', en: 'Service temporarily unavailable.' },
};

function pickLocale(acceptLanguage: string | undefined): 'fr' | 'en' {
  if (!acceptLanguage) return 'fr';
  const first = acceptLanguage.split(',')[0]?.trim().toLowerCase() ?? '';
  return first.startsWith('en') ? 'en' : 'fr';
}

/**
 * Filtre global d'exceptions : produit systématiquement une réponse
 * application/problem+json (RFC 7807), en français ou anglais selon
 * l'en-tête Accept-Language. À enregistrer globalement dans main.ts.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const locale = pickLocale(request.headers['accept-language']);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ERROR_CODES.INTERNAL_ERROR;
    let title: MessagePack = {
      fr: 'Erreur interne',
      en: 'Internal error',
    };
    let detail: MessagePack | undefined;
    let errors: Record<string, string[]> | undefined;

    if (exception instanceof AppException) {
      const body = exception.getResponse() as ProblemDetails;
      status = exception.getStatus();
      code = body.code ?? ERROR_CODES.INTERNAL_ERROR;
      title = { fr: body.title ?? 'Erreur', en: body.title ?? 'Error' };
      detail = body.detail ? { fr: body.detail, en: body.detail } : undefined;
      errors = body.errors;
    } else if (exception instanceof BadRequestException) {
      // Validation class-validator : message tableau à convertir en errors map.
      status = HttpStatus.BAD_REQUEST;
      code = ERROR_CODES.VALIDATION_FAILED;
      title = MESSAGES[String(status)];
      const r = exception.getResponse() as { message?: string | string[] };
      const messages = Array.isArray(r.message) ? r.message : [String(r.message ?? '')];
      detail = locale === 'en' ? { fr: '', en: 'The provided data is invalid.' } : { fr: 'Les données fournies sont invalides.', en: '' };
      errors = { fields: messages.filter(Boolean) };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      const msg = typeof r === 'string' ? r : ((r as { message?: string | string[]; code?: string }).message ?? '');
      const messages = Array.isArray(msg) ? msg : [msg];
      const first = messages[0] ?? '';
      if (first && !/^(Error|Exception)/.test(first)) {
        // Message déjà rédigé par le développeur : identique dans les deux langues.
        detail = { fr: first, en: first };
      }
      const codeFromBody = typeof r === 'object' ? (r as { code?: string }).code : undefined;
      code = codeFromBody ?? this.codeForStatus(status);
      title = MESSAGES[String(status)] ?? { fr: 'Erreur', en: 'Error' };
    } else if (
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      exception.code === 'P2002'
    ) {
      status = HttpStatus.CONFLICT;
      code = ERROR_CODES.CONFLICT;
      title = MESSAGES[String(status)];
      const target = (exception.meta?.target as string[] | string | undefined) ?? '';
      const field = Array.isArray(target) ? target.join(', ') : String(target);
      detail =
        locale === 'en'
          ? { fr: '', en: `A record already exists for: ${field}.` }
          : { fr: `Un enregistrement existe déjà pour : ${field}.`, en: '' };
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      title = MESSAGES[String(status)];
    } else {
      this.logger.error('Unknown non-error exception', String(exception));
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      title = MESSAGES[String(status)];
    }

    // Ne jamais fuiter de détail technique en 5xx.
    if (status >= 500) {
      detail = undefined;
      errors = undefined;
      code = ERROR_CODES.INTERNAL_ERROR;
    }

    const fallback = MESSAGES[String(status)] ?? { fr: 'Erreur', en: 'Error' };
    const problem: ProblemDetails = {
      type: `https://errors.afrilive.app/${code.toLowerCase()}`,
      title: title[locale] ?? title.fr,
      status,
      detail: (detail?.[locale] || fallback[locale]) as string,
      instance: request.originalUrl ?? request.url,
      code,
      traceId: (request.headers['x-request-id'] as string) ?? undefined,
      ...(errors ? { errors } : {}),
    };

    response.status(status).type('application/problem+json').json(problem);
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return ERROR_CODES.INVALID_CREDENTIALS;
      case HttpStatus.FORBIDDEN:
        return ERROR_CODES.ACCOUNT_SUSPENDED;
      case HttpStatus.NOT_FOUND:
        return ERROR_CODES.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ERROR_CODES.CONFLICT;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ERROR_CODES.RATE_LIMITED;
      default:
        return ERROR_CODES.VALIDATION_FAILED;
    }
  }
}

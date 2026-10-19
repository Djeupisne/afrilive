import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_CODES, ErrorCode, ERROR_DESCRIPTIONS } from './error-codes';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  code: string;
  errors?: Record<string, string[]>;
  [key: string]: unknown;
}

/**
 * Exception applicative standard produisant une réponse RFC 7807
 * (application/problem+json) via AllExceptionsFilter.
 */
export class AppException extends HttpException {
  public readonly code: ErrorCode | string;
  public readonly errors?: Record<string, string[]>;

  constructor(
    code: ErrorCode | string,
    options?: {
      status?: HttpStatus;
      title?: string;
      detail?: string;
      instance?: string;
      errors?: Record<string, string[]>;
      meta?: Record<string, unknown>;
    },
  ) {
    const status = options?.status ?? AppException.defaultStatus(code);
    const title = options?.title ?? AppException.titleFor(status);
    const detail =
      options?.detail ?? ERROR_DESCRIPTIONS[code] ?? 'Erreur inconnue.';
    super(
      {
        type: `https://errors.afrilive.app/${code.toLowerCase()}`,
        title,
        status,
        detail,
        instance: options?.instance,
        code,
        errors: options?.errors,
        ...(options?.meta ?? {}),
      } satisfies ProblemDetails,
      status,
    );
    this.code = code;
    this.errors = options?.errors;
  }

  static badRequest(
    code: ErrorCode | string = ERROR_CODES.VALIDATION_FAILED,
    detail?: string,
    errors?: Record<string, string[]>,
  ): AppException {
    return new AppException(code, {
      status: HttpStatus.BAD_REQUEST,
      detail,
      errors,
    });
  }

  static unauthorized(
    code: ErrorCode | string = ERROR_CODES.INVALID_CREDENTIALS,
    detail?: string,
  ): AppException {
    return new AppException(code, {
      status: HttpStatus.UNAUTHORIZED,
      detail,
    });
  }

  static forbidden(
    code: ErrorCode | string = ERROR_CODES.ACCOUNT_SUSPENDED,
    detail?: string,
  ): AppException {
    return new AppException(code, {
      status: HttpStatus.FORBIDDEN,
      detail,
    });
  }

  static notFound(
    code: ErrorCode | string = ERROR_CODES.NOT_FOUND,
    detail?: string,
  ): AppException {
    return new AppException(code, {
      status: HttpStatus.NOT_FOUND,
      detail,
    });
  }

  static conflict(
    code: ErrorCode | string = ERROR_CODES.CONFLICT,
    detail?: string,
  ): AppException {
    return new AppException(code, {
      status: HttpStatus.CONFLICT,
      detail,
    });
  }

  static unprocessable(
    code: ErrorCode | string,
    detail?: string,
    meta?: Record<string, unknown>,
  ): AppException {
    return new AppException(code, {
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      detail,
      meta,
    });
  }

  private static defaultStatus(code: string): HttpStatus {
    if (code.startsWith('AFRI-AUTH')) return HttpStatus.UNAUTHORIZED;
    if (code.startsWith('AFRI-KYC') || code.startsWith('AFRI-MOD'))
      return HttpStatus.FORBIDDEN;
    if (code.startsWith('AFRI-WALLET') || code.startsWith('AFRI-PAY'))
      return HttpStatus.UNPROCESSABLE_ENTITY;
    if (code.startsWith('AFRI-ORDER') || code.startsWith('AFRI-PROD'))
      return HttpStatus.CONFLICT;
    return HttpStatus.BAD_REQUEST;
  }

  private static titleFor(status: HttpStatus): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'Requête invalide';
      case HttpStatus.UNAUTHORIZED:
        return 'Authentification requise';
      case HttpStatus.FORBIDDEN:
        return 'Accès refusé';
      case HttpStatus.NOT_FOUND:
        return 'Ressource introuvable';
      case HttpStatus.CONFLICT:
        return 'Conflit d’état';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'Traitement impossible';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'Trop de requêtes';
      default:
        return 'Erreur interne';
    }
  }
}

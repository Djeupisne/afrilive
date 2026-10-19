import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_HTTP_STATUS, ErrorCode, ErrorCodes } from './error-codes';

export interface AppErrorDetails {
  [key: string]: unknown;
}

/**
 * Exception applicative standardisée (RFC 7807).
 * Le filtre global la convertit en Problem Details :
 * { type, title, status, detail, instance, code, details }
 */
export class AppException extends HttpException {
  readonly code: ErrorCode;
  readonly details?: AppErrorDetails;

  constructor(code: ErrorCode, detail?: string, details?: AppErrorDetails) {
    const status = ERROR_HTTP_STATUS[code] ?? HttpStatus.BAD_REQUEST;
    super(
      {
        code,
        detail: detail ?? ErrorCodes[code],
        details,
      },
      status,
    );
    this.code = code;
    this.details = details;
  }

  // ---- Fabriques pratiques ----
  static notFound(detail = 'Ressource introuvable', details?: AppErrorDetails): AppException {
    return new AppException(ErrorCodes.NOT_FOUND, detail, details);
  }

  static conflict(detail = 'Conflit', details?: AppErrorDetails): AppException {
    return new AppException(ErrorCodes.CONFLICT, detail, details);
  }

  static validation(detail = 'Données invalides', details?: AppErrorDetails): AppException {
    return new AppException(ErrorCodes.VALIDATION_FAILED, detail, details);
  }

  static forbidden(detail = 'Accès refusé', details?: AppErrorDetails): AppException {
    return new AppException(ErrorCodes.FORBIDDEN, detail, details);
  }

  static unauthorized(code: ErrorCode = ErrorCodes.AUTH_TOKEN_INVALID, detail = 'Non authentifié'): AppException {
    return new AppException(code, detail);
  }

  static internal(detail = 'Erreur interne', details?: AppErrorDetails): AppException {
    return new AppException(ErrorCodes.INTERNAL_ERROR, detail, details);
  }

  static rateLimited(retryAfterSec = 60): AppException {
    return new AppException(ErrorCodes.RATE_LIMITED, 'Trop de requêtes, réessayez plus tard.', { retryAfterSec });
  }
}

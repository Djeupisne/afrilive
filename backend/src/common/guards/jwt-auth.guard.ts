import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ERROR_CODES } from '../errors/error-codes';

/**
 * Garde JWT appliqué globalement : refuse toute route non marquée @Public().
 * À enregistrer dans app.module.ts : { provide: APP_GUARD, useClass: JwtAuthGuard }.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest<TUser>(err: unknown, user: TUser | false): TUser {
    if (err || !user) {
      throw err instanceof Error && err.name === 'TokenExpiredError'
        ? new UnauthorizedException({ code: ERROR_CODES.TOKEN_EXPIRED, detail: 'Jeton expiré.' })
        : new UnauthorizedException({ code: ERROR_CODES.INVALID_CREDENTIALS, detail: 'Authentification requise.' });
    }
    return user;
  }
}

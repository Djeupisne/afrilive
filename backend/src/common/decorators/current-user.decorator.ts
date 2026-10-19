import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/** Utilisateur authentifié injecté par JwtAuthGuard (payload JWT vérifié). */
export interface AuthUser {
  id: string;
  phone?: string;
  email?: string;
  role: string;
  sessionId?: string;
}

/**
 * Décorateur de paramètre : injecte l'utilisateur courant, ou un champ précis.
 * Utilisation : `@CurrentUser() user: AuthUser` ou `@CurrentUser('id') userId: string`.
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);

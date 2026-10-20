import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { PrismaService } from '../../../database/prisma.service';
import type { AccessPayload } from '../token.service';

/** Utilisateur reconstruit pour request.user (surface AuthUser du décorateur @CurrentUser). */
export interface JwtUser {
  id: string;
  role: string;
  sessionId?: string;
}

/**
 * Stratégie JWT globale : vérifie la signature + l'émission récente, puis
 * recoupe avec l'état live en base (user ACTIVE, session non révoquée).
 * Les tokens `pending2fa` sont refusés ici : ils ne donnent accès qu'à
 * /auth/2fa/verify via le controller.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService, private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('app.jwt.accessSecret') ?? '',
    });
  }

  async validate(payload: AccessPayload): Promise<JwtUser> {
    if (payload.pending2fa) {
      throw new UnauthorizedException({
        code: ERROR_CODES.TWO_FACTOR_REQUIRED,
        detail: 'Second facteur requis : utiliser POST /auth/2fa/verify.',
      });
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, status: true, roles: true },
    });
    if (!user) {
      throw new UnauthorizedException({ code: ERROR_CODES.INVALID_CREDENTIALS });
    }
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException({
        code: user.status === 'DELETED' ? ERROR_CODES.ACCOUNT_SUSPENDED : ERROR_CODES.ACCOUNT_SUSPENDED,
        detail: `Compte indisponible (${user.status}).`,
      });
    }
    if (payload.sid) {
      const session = await this.prisma.session.findFirst({
        where: { id: payload.sid, revokedAt: null },
        select: { id: true },
      });
      if (!session) {
        throw new UnauthorizedException({
          code: ERROR_CODES.TOKEN_REVOKED,
          detail: 'Session fermée.',
        });
      }
    }
    return { id: user.id, role: String(user.roles[0] ?? 'USER'), sessionId: payload.sid };
  }
}

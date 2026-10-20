import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../database/prisma.service';

export interface AccessPayload {
  sub: string; // userId
  sid?: string; // sessionId
  role: string;
  /** Présent pendant le challenge 2FA : token insuffisant pour l'accès aux routes. */
  pending2fa?: true;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  expiresIn: number; // secondes (access)
}

/** Hash SHA-256 hex du refresh token — la base ne stocke jamais le jeton en clair. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Parse une durée type '15m' | '30d' | '90s' en secondes. */
function parseTtl(ttl: string): number {
  const m = /^(\d+)([smhd])$/.exec(ttl);
  if (!m) return 900;
  const n = Number(m[1]);
  return n * { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as 's' | 'm' | 'h' | 'd'];
}

/**
 * Jetons : access JWT court + refresh opaque rotatif stocké en base (Session).
 * - Rotation : chaque usage d'un refresh consomme la Session et émet une nouvelle
 *   ligne dans la même `familyId`.
 * - Détection de réutilisation : si un refresh déjà consommé est présenté,
 *   toute la famille est révoquée (jeton volé) → TOKEN_REVOKED.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private readonly accessTtlSec: number;
  private readonly refreshTtlSec: number;
  private readonly accessSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.accessTtlSec = parseTtl(config.get<string>('app.jwt.accessTtl') ?? '15m');
    this.refreshTtlSec = parseTtl(config.get<string>('app.jwt.refreshTtl') ?? '30d');
    this.accessSecret = config.get<string>('app.jwt.accessSecret') ?? '';
  }

  /** Crée une nouvelle session (famille = nouvelle au premier login). */
  async issueTokensForUser(
    userId: string,
    role: string,
    meta: { deviceId?: string; deviceName?: string; ip?: string; userAgent?: string; familyId?: string },
  ): Promise<TokenPair> {
    const refreshToken = randomBytes(48).toString('base64url');
    const familyId = meta.familyId ?? randomUUID();
    const expiresAt = new Date(Date.now() + this.refreshTtlSec * 1000);

    const session = await this.prisma.session.create({
      data: {
        userId,
        refreshTokenHash: hashToken(refreshToken),
        familyId,
        deviceId: meta.deviceId,
        deviceName: meta.deviceName,
        ip: meta.ip,
        userAgent: meta.userAgent,
        expiresAt,
      },
    });

    const accessToken = await this.signAccess({ sub: userId, sid: session.id, role });
    return {
      accessToken,
      refreshToken,
      sessionId: session.id,
      expiresIn: this.accessTtlSec,
    };
  }

  /** Challenge 2FA : JWT court marqué pending2fa, sans session active. */
  async signPendingTwoFactor(userId: string, role: string): Promise<string> {
    return this.signAccess({ sub: userId, role, pending2fa: true }, '5m');
  }

  /** Vérifie la signature d'un token pending2fa (pas de session associée à ce stade). */
  async verifyPendingToken(token: string): Promise<AccessPayload> {
    try {
      return await this.jwt.verifyAsync<AccessPayload>(token, { secret: this.accessSecret });
    } catch {
      throw new AppException(ERROR_CODES.TOKEN_EXPIRED, { status: HttpStatus.UNAUTHORIZED });
    }
  }

  async verifyAccessToken(payloadLike: string): Promise<AccessPayload> {
    try {
      return await this.jwt.verifyAsync<AccessPayload>(payloadLike, {
        secret: this.accessSecret,
      });
    } catch (err) {
      if ((err as Error).name === 'TokenExpiredError') {
        throw new AppException(ERROR_CODES.TOKEN_EXPIRED, { status: HttpStatus.UNAUTHORIZED });
      }
      throw new AppException(ERROR_CODES.INVALID_CREDENTIALS, { status: HttpStatus.UNAUTHORIZED });
    }
  }

  /**
   * Rotation du refresh : vérifie la Session, la consomme, émet un nouveau couple
   * dans la même famille. Réutilisation détectée → révocation de la famille.
   */
  async rotateRefreshToken(refreshToken: string): Promise<TokenPair> {
    const hash = hashToken(refreshToken);
    const session = await this.prisma.session.findFirst({ where: { refreshTokenHash: hash } });
    if (!session) {
      throw new AppException(ERROR_CODES.INVALID_CREDENTIALS, {
        status: HttpStatus.UNAUTHORIZED,
        detail: 'Refresh token inconnu.',
      });
    }
    if (session.revokedAt) {
      // Réutilisation d'un jeton déjà consommé : compromission supposée.
      this.logger.warn(`Réutilisation de refresh token détectée — révocation famille ${session.familyId}`);
      await this.prisma.session.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new AppException(ERROR_CODES.TOKEN_REVOKED, {
        status: HttpStatus.UNAUTHORIZED,
        detail: 'Session compromise, reconnexion requise.',
      });
    }
    if (session.expiresAt.getTime() < Date.now()) {
      throw new AppException(ERROR_CODES.TOKEN_EXPIRED, { status: HttpStatus.UNAUTHORIZED });
    }

    const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!user || user.status !== 'ACTIVE') {
      await this.revokeFamily(session.familyId);
      throw new AppException(ERROR_CODES.ACCOUNT_SUSPENDED, { status: HttpStatus.FORBIDDEN });
    }

    // Consomme l'ancienne session puis émet dans la même famille.
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), refreshTokenHash: `${hash}:used:${session.id}` },
    });
    return this.issueTokensForUser(user.id, String(user.roles[0] ?? 'USER'), {
      deviceId: session.deviceId ?? undefined,
      deviceName: session.deviceName ?? undefined,
      ip: session.ip ?? undefined,
      userAgent: session.userAgent ?? undefined,
      familyId: session.familyId,
    });
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private signAccess(payload: AccessPayload, expiresIn?: string): Promise<string> {
    return this.jwt.signAsync(payload, {
      secret: this.accessSecret,
      expiresIn: expiresIn ?? `${this.accessTtlSec}s`,
    });
  }
}

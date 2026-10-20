import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthProvider, OtpChannel, User } from '@prisma/client';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../integrations/redis/redis.service';
import { TokenService, TokenPair } from './token.service';
import { OtpService } from './otp.service';
import { TwoFactorService } from './two-factor.service';
import { GoogleVerifier } from './social/google.verifier';
import { FacebookVerifier } from './social/facebook.verifier';
import { AppleVerifier } from './social/apple.verifier';
import type { SocialVerifier, VerifiedSocialProfile } from './social/social-verifier.interface';
import type { RegisterDto, SocialLoginDto, VerifyOtpDto } from './dto/auth.dto';

export interface LoginResult {
  user?: Pick<User, 'id' | 'username' | 'displayName' | 'avatarUrl' | 'roles' | 'kycStatus'>;
  tokens?: TokenPair;
  /** Vrai quand le compte exige le second facteur : présenter challengeTfaToken. */
  requiresTwoFactor?: boolean;
  challengeTfaToken?: string;
  /** Aucun compte pour ce téléphone : le client doit appeler /auth/register. */
  needsRegistration?: boolean;
  redirectTo?: string;
}

/** Payload minimal exposé par l'API (jamais les champs sensibles complets). */
function publicUser(u: User) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    roles: u.roles,
    kycStatus: u.kycStatus,
  };
}

/**
 * Orchestration de l'authentification : OTP-first (pas de mot de passe),
 * connexion sociale (Google/Facebook/Apple), rotation de refresh, 2FA.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly maxAccountsPerDevice: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly twoFactor: TwoFactorService,
    private readonly google: GoogleVerifier,
    private readonly facebook: FacebookVerifier,
    private readonly apple: AppleVerifier,
    config: ConfigService,
  ) {
    this.maxAccountsPerDevice = config.get<number>('auth.maxAccountsPerDevice') ?? 3;
  }

  // ---------------------------------------------------------------- OTP flow

  async requestOtp(phone: string, channel: 'sms' | 'whatsapp' = 'sms', ip?: string) {
    const issued = await this.otp.issue(phone, channel === 'whatsapp' ? OtpChannel.WHATSAPP : OtpChannel.SMS, ip);
    return { sent: true, channel, expiresAt: issued.expiresAt, ...(issued.debugCode ? { debugCode: issued.debugCode } : {}) };
  }

  /** Vérifie l'OTP puis ouvre une session (ou signale needsRegistration). */
  async verifyOtp(dto: VerifyOtpDto, ctx: { ip?: string; userAgent?: string }): Promise<LoginResult> {
    await this.otp.verify(dto.phone, OtpChannel.SMS, dto.code).catch(async () => {
      // Le client peut avoir choisi WhatsApp : retenter sur ce canal avant d'échouer.
      await this.otp.verify(dto.phone, OtpChannel.WHATSAPP, dto.code);
    });
    const user = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (!user) {
      return { needsRegistration: true, redirectTo: dto.redirectTo };
    }
    return this.loginUser(user, { deviceId: dto.deviceId, ip: ctx.ip, userAgent: ctx.userAgent }, dto.redirectTo);
  }

  async register(dto: RegisterDto, ctx: { ip?: string; userAgent?: string }) {
    // OTP consommé d'abord (le code prouve la possession du numéro).
    await this.otp.verify(dto.phone, OtpChannel.SMS, dto.otp).catch(async () => {
      await this.otp.verify(dto.phone, OtpChannel.WHATSAPP, dto.otp);
    });

    if (await this.prisma.user.findUnique({ where: { phone: dto.phone } })) {
      throw new AppException(ERROR_CODES.PHONE_ALREADY_TAKEN, { status: HttpStatus.CONFLICT });
    }
    if (dto.email && (await this.prisma.user.findUnique({ where: { email: dto.email } }))) {
      throw new AppException(ERROR_CODES.EMAIL_ALREADY_TAKEN, { status: HttpStatus.CONFLICT });
    }
    if (await this.prisma.user.findUnique({ where: { username: dto.username } })) {
      throw new AppException(ERROR_CODES.CONFLICT, {
        status: HttpStatus.CONFLICT,
        detail: "Ce nom d'utilisateur est déjà pris.",
      });
    }

    const user = await this.prisma.user.create({
      data: {
        phone: dto.phone,
        email: dto.email,
        username: dto.username,
        displayName: dto.displayName,
        countryCode: dto.countryCode ?? this.countryFromPhone(dto.phone),
      },
    });
    await this.prisma.authIdentity.create({
      data: { provider: AuthProvider.PHONE, providerUserId: dto.phone, userId: user.id, email: dto.email },
    });
    this.logger.log(`Compte créé : ${user.id} (${user.username})`);
    const result = await this.loginUser(user, { ip: ctx.ip, userAgent: ctx.userAgent });
    return { ...result, isNewUser: true };
  }

  // ------------------------------------------------------------ Social login

  private verifierFor(provider: SocialLoginDto['provider']): SocialVerifier {
    switch (provider) {
      case 'google':
        return this.google;
      case 'facebook':
        return this.facebook;
      case 'apple':
        return this.apple;
      default:
        throw new AppException(ERROR_CODES.INVALID_CREDENTIALS, {
          status: HttpStatus.BAD_REQUEST,
          detail: `Fournisseur social non pris en charge : ${provider}.`,
        });
    }
  }

  async socialLogin(dto: SocialLoginDto, ctx: { ip?: string; userAgent?: string }): Promise<LoginResult> {
    const verifier = this.verifierFor(dto.provider);
    if (!verifier.isConfigured()) {
      throw new AppException(ERROR_CODES.INVALID_CREDENTIALS, {
        status: HttpStatus.BAD_REQUEST,
        detail: `Connexion ${dto.provider} non configurée sur cet environnement.`,
      });
    }
    const profile: VerifiedSocialProfile = await verifier.verify(dto.token);
    const identity = await this.prisma.authIdentity.findUnique({
      where: { provider_providerUserId: { provider: profile.provider, providerUserId: profile.providerUserId } },
      include: { user: true },
    });
    const user = identity ? identity.user : (await this.linkOrCreateFromSocial(profile, ctx)).user;
    if (user.status !== 'ACTIVE') {
      throw new AppException(ERROR_CODES.ACCOUNT_SUSPENDED, { status: HttpStatus.FORBIDDEN });
    }
    return this.loginUser(user, { deviceId: dto.deviceId, ip: ctx.ip, userAgent: ctx.userAgent });
  }

  /** Rattache l'identité à un compte existant (email vérifié côté fournisseur) ou crée un compte. */
  private async linkOrCreateFromSocial(profile: VerifiedSocialProfile, ctx: { ip?: string }) {
    if (profile.email) {
      const existing = await this.prisma.user.findUnique({ where: { email: profile.email } });
      if (existing) {
        return this.prisma.authIdentity.create({
          data: {
            provider: profile.provider,
            providerUserId: profile.providerUserId,
            userId: existing.id,
            email: profile.email,
          },
          include: { user: true },
        });
      }
    }
    const username = await this.uniqueUsername(`${String(profile.provider).toLowerCase()}_${profile.providerUserId.slice(0, 8)}`);
    const user = await this.prisma.user.create({
      data: {
        username,
        displayName: profile.name ?? username,
        email: profile.email,
        avatarUrl: profile.pictureUrl,
        isVerified: false,
      },
    });
    await this.prisma.authIdentity.create({
      data: { provider: profile.provider, providerUserId: profile.providerUserId, userId: user.id, email: profile.email },
    });
    this.logger.log(`Compte social créé via ${profile.provider} : ${user.id}`);
    return { user };
  }

  // -------------------------------------------------------------- Sessions

  /** Émet les jetons (avec garde-fou 2FA et limite de comptes par appareil). */
  private async loginUser(
    user: User,
    meta: { deviceId?: string; ip?: string; userAgent?: string; deviceName?: string },
    redirectTo?: string,
  ): Promise<LoginResult> {
    if (user.status !== 'ACTIVE') {
      throw new AppException(ERROR_CODES.ACCOUNT_SUSPENDED, {
        status: HttpStatus.FORBIDDEN,
        detail: `Compte indisponible (${user.status}).`,
      });
    }
    if (meta.deviceId) await this.enforceDeviceLimit(user.id, meta.deviceId);

    if (await this.twoFactor.isEnabled(user.id)) {
      const challengeTfaToken = await this.tokens.signPendingTwoFactor(user.id, String(user.roles[0] ?? 'USER'));
      return { requiresTwoFactor: true, challengeTfaToken, ...(redirectTo ? { redirectTo } : {}) };
    }
    const role = String(user.roles[0] ?? 'USER');
    const tokens = await this.tokens.issueTokensForUser(user.id, role, {
      deviceId: meta.deviceId,
      deviceName: meta.deviceName,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { user: publicUser(user), tokens, ...(redirectTo ? { redirectTo } : {}) };
  }

  /** Deuxième étape du login 2FA : le client rejoue ici avec le code TOTP/backup. */
  async completeTwoFactor(pendingToken: string, code: string, meta: { deviceId?: string; ip?: string; userAgent?: string }): Promise<LoginResult> {
    const payload = await this.decodePendingToken(pendingToken);
    if (!payload.pending2fa) {
      throw new AppException(ERROR_CODES.INVALID_CREDENTIALS, { status: HttpStatus.UNAUTHORIZED });
    }
    await this.twoFactor.verifyLoginCode(payload.sub, code);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: payload.sub } });
    return this.loginUser(user, meta);
  }

  async refresh(refreshToken: string): Promise<{ tokens: TokenPair }> {
    const tokens = await this.tokens.rotateRefreshToken(refreshToken);
    return { tokens };
  }

  async logout(userId: string, sessionId?: string, allDevices = false): Promise<void> {
    if (allDevices) await this.tokens.revokeAllForUser(userId);
    else if (sessionId) await this.tokens.revokeSession(sessionId);
  }

  /** Limite le nombre de comptes distincts utilisés sur un même appareil (anti-farm). */
  private async enforceDeviceLimit(userId: string, deviceId: string): Promise<void> {
    const key = `device:${deviceId}:users`;
    await this.redis.sAdd(key, 90 * 86400, userId);
    const members = await this.redis.sMembers(key);
    if (members.length > this.maxAccountsPerDevice) {
      throw new AppException(ERROR_CODES.DEVICE_LIMIT_REACHED, {
        status: HttpStatus.FORBIDDEN,
        detail: `Cet appareil a déjà été utilisé pour ${this.maxAccountsPerDevice} comptes.`,
      });
    }
  }

  private async uniqueUsername(base: string): Promise<string> {
    let candidate = base.slice(0, 30);
    for (let i = 0; i < 20; i++) {
      const taken = await this.prisma.user.findUnique({ where: { username: candidate }, select: { id: true } });
      if (!taken) return candidate;
      candidate = `${base.slice(0, 24)}_${Math.floor(Math.random() * 1e6)}`;
    }
    throw new AppException(ERROR_CODES.CONFLICT, { status: HttpStatus.CONFLICT, detail: 'Impossible de générer un nom unique.' });
  }

  /** Décode un token pending2fa sans recoupement de session (aucune sid à ce stade). */
  private async decodePendingToken(token: string) {
    try {
      return await this.tokens.verifyPendingToken(token);
    } catch {
      throw new AppException(ERROR_CODES.INVALID_CREDENTIALS, { status: HttpStatus.UNAUTHORIZED });
    }
  }

  private countryFromPhone(phone: string): string {
    const map: Record<string, string> = { '225': 'CI', '234': 'NG', '233': 'GH', '221': 'SN', '223': 'ML', '226': 'BF', '228': 'TG', '229': 'BJ', '227': 'NE', '216': 'TN', '212': 'MA', '213': 'DZ', '20': 'EG' };
    const digits = phone.replace('+', '');
    for (const [cc, country] of Object.entries(map)) {
      if (digits.startsWith(cc)) return country;
    }
    return 'CI';
  }
}

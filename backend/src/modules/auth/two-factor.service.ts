import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authenticator } from 'otplib';
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'crypto';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../database/prisma.service';

/** Clé AES-256 dérivée de ENCRYPTION_KEY (hex 64, base64 32o, sinon SHA-256 de la valeur). */
function getKey(config: ConfigService): Buffer {
  const raw = config.get<string>('app.encryptionKey') ?? '';
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  const hash = createHash('sha256').update(raw || 'afrilive-dev-encryption-key').digest();
  return hash;
}

function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${enc.toString('base64url')}`;
}

function decrypt(payload: string, key: Buffer): string {
  const [ivB, tagB, dataB] = payload.split('.');
  if (!ivB || !tagB || !dataB) throw new Error('Secret 2FA illisible.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64url')), decipher.final()]).toString('utf8');
}

export interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
}

/**
 * 2FA TOTP (RFC 6238) + codes de secours à usage unique.
 * - Secret jamais stocké en clair : AES-256-GCM dans TwoFactorSecret.secretEnc.
 * - Activation seulement après vérification d'un premier code (enabledAt posé).
 * - Backup codes hachés SHA-256, consommés à l'usage.
 */
@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);
  private readonly key: Buffer;

  constructor(private readonly prisma: PrismaService, config: ConfigService) {
    this.key = getKey(config);

  }

  /**
   * Vérifie un code TOTP avec une fenêtre explicite de ±1 pas (30 s), sans
   * état global ni fenêtre implicite du preset par défaut (otplib 12 a une
   * fenêtre par défaut non nulle qui élargirait silencieusement la tolérance).
   * create() doit recevoir les options COMPLÈTES (keyEncoder/keyDecoder du
   * preset inclus) — d'où le spread de allOptions().
   */
  private checkTotp(code: string, secret: string): boolean {
    const now = Math.floor(Date.now() / 1000);
    const base = { ...authenticator.allOptions(), window: 0 };
    for (const delta of [-30, 0, 30]) {
      try {
        if (authenticator.create({ ...base, time: now + delta }).generate(secret) === code) return true;
      } catch {
        /* secret illisible : on passe au pas suivant */
      }
    }
    return false;
  }

  /** Génère (ou régénère) un secret non encore activé et retourne l'URL otpauth. */
  async startSetup(userId: string, issuer = 'AfriLive'): Promise<TwoFactorSetup> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new AppException(ERROR_CODES.NOT_FOUND, { status: HttpStatus.NOT_FOUND });
    const secret = authenticator.generateSecret(20);
    const label = encodeURIComponent(`${issuer}:${userId}`);
    const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
    await this.prisma.twoFactorSecret.upsert({
      where: { userId },
      create: { userId, secretEnc: encrypt(secret, this.key) },
      update: { secretEnc: encrypt(secret, this.key), enabledAt: null, backupCodesHash: [] },
    });
    return { secret, otpauthUrl };
  }

  /** Valide un premier code TOTP, active la 2FA ; retourne les backup codes en clair (une seule fois). */
  async enable(userId: string, totpCode: string): Promise<{ codes: string[] }> {
    const record = await this.getRecord(userId);
    const secret = decrypt(record.secretEnc, this.key);
    if (!this.checkTotp(totpCode, secret)) {
      throw new AppException(ERROR_CODES.TWO_FACTOR_INVALID, {
        status: HttpStatus.UNAUTHORIZED,
        detail: 'Code TOTP invalide pendant la configuration.',
      });
    }
    const codes = Array.from({ length: 8 }, () =>
      randomBytes(8)
        .toString('base64url')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 10)
        .padEnd(10, '0'),
    );
    await this.prisma.twoFactorSecret.update({
      where: { userId },
      data: { enabledAt: new Date(), backupCodesHash: codes.map((c) => this.hashBackup(c)) },
    });
    this.logger.log(`2FA activée pour l'utilisateur ${userId}.`);
    return { codes };
  }

  async isEnabled(userId: string): Promise<boolean> {
    const record = await this.prisma.twoFactorSecret.findUnique({ where: { userId } });
    return Boolean(record?.enabledAt);
  }

  /** Code de login : TOTP (fenêtre ±1 pas) ou backup à usage unique. */
  async verifyLoginCode(userId: string, code: string): Promise<void> {
    const record = await this.getRecord(userId);
    if (!record.enabledAt) {
      throw new AppException(ERROR_CODES.TWO_FACTOR_INVALID, {
        status: HttpStatus.BAD_REQUEST,
        detail: '2FA non configurée pour ce compte.',
      });
    }
    const secret = decrypt(record.secretEnc, this.key);
    if (this.checkTotp(code, secret)) return;
    if (/^[a-z0-9]{10}$/i.test(code)) {
      const candidate = this.hashBackup(code.toLowerCase());
      const idx = record.backupCodesHash.findIndex((h) => this.safeEqualHex(h, candidate));
      if (idx >= 0) {
        const remaining = [...record.backupCodesHash];
        remaining.splice(idx, 1);
        await this.prisma.twoFactorSecret.update({ where: { userId }, data: { backupCodesHash: remaining } });
        return;
      }
    }
    throw new AppException(ERROR_CODES.TWO_FACTOR_INVALID, {
      status: HttpStatus.UNAUTHORIZED,
      detail: 'Code de second facteur invalide.',
    });
  }

  /** Désactivation : exige un TOTP valide (backup refusé pour cette opération sensible). */
  async disable(userId: string, totpCode: string): Promise<void> {
    const record = await this.getRecord(userId);
    const secret = decrypt(record.secretEnc, this.key);
    if (!this.checkTotp(totpCode, secret)) {
      throw new AppException(ERROR_CODES.TWO_FACTOR_INVALID, {
        status: HttpStatus.UNAUTHORIZED,
        detail: 'Code TOTP requis et valide pour désactiver la 2FA.',
      });
    }
    await this.prisma.twoFactorSecret.delete({ where: { userId } });
    this.logger.log(`2FA désactivée pour l'utilisateur ${userId}.`);
  }

  /** Régénère les backup codes (TOTP valide requis). */
  async regenerateBackupCodes(userId: string, totpCode: string): Promise<{ codes: string[] }> {
    const record = await this.getRecord(userId);
    const secret = decrypt(record.secretEnc, this.key);
    if (!record.enabledAt || !this.checkTotp(totpCode, secret)) {
      throw new AppException(ERROR_CODES.TWO_FACTOR_INVALID, { status: HttpStatus.UNAUTHORIZED });
    }
    const codes = Array.from({ length: 8 }, () =>
      randomBytes(8)
        .toString('base64url')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 10)
        .padEnd(10, '0'),
    );
    await this.prisma.twoFactorSecret.update({
      where: { userId },
      data: { backupCodesHash: codes.map((c) => this.hashBackup(c)) },
    });
    return { codes };
  }

  private hashBackup(code: string): string {
    return createHash('sha256').update(`backup:${code}`).digest('hex');
  }

  private safeEqualHex(a: string, b: string): boolean {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }

  private async getRecord(userId: string) {
    const record = await this.prisma.twoFactorSecret.findUnique({ where: { userId } });
    if (!record) {
      throw new AppException(ERROR_CODES.TWO_FACTOR_INVALID, {
        status: HttpStatus.BAD_REQUEST,
        detail: 'Aucun secret 2FA : commencer par POST /auth/2fa/setup.',
      });
    }
    return record;
  }
}

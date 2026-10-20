import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpChannel } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomInt } from 'crypto';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../integrations/redis/redis.service';
import { SmsService } from '../../integrations/sms/sms.service';
import { EmailService } from '../../integrations/email/email.service';

export interface IssuedOtp {
  id: string;
  expiresAt: Date;
  /** Présent uniquement en mode console/dev (jamais renvoyé par l'API). */
  debugCode?: string;
}

/**
 * OTP à 6 chiffres, usage unique.
 * - Le code n'est jamais stocké en clair : hash argon2id dans OtpChallenge.codeHash.
 * - Anti-abus via Redis : 1 demande / 60 s par cible, max 5 / heure,
 *   3 tentatives de vérification par challenge (OTP_TOO_MANY_ATTEMPTS).
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly ttlSec: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly sms: SmsService,
    private readonly email: EmailService,
    config: ConfigService,
  ) {
    this.ttlSec = config.get<number>('otp.ttlSec') ?? 300; // 5 min
    this.maxAttempts = config.get<number>('otp.maxAttempts') ?? 3;
  }

  /** Émet et envoie un OTP sur le canal demandé (sms | whatsapp | email). */
  async issue(target: string, channel: OtpChannel, ip?: string): Promise<IssuedOtp> {
    const key = `otp:${channel}:${target}`;

    // Fenêtre minimale entre deux envois (setNx = verrou d'émission).
    const sent = await this.redis.setNx(`${key}:lock`, '1', 60);
    if (!sent) {
      throw new AppException(ERROR_CODES.RATE_LIMITED, {
        status: HttpStatus.TOO_MANY_REQUESTS,
        detail: 'Un OTP a déjà été envoyé il y a moins de 60 secondes.',
      });
    }
    // Quota horaire glissant.
    const hourKey = `${key}:hour`;
    const count = await this.redis.incr(hourKey);
    if (count === 1) await this.redis.expire(hourKey, 3600);
    if (count > 5) {
      throw new AppException(ERROR_CODES.RATE_LIMITED, {
        status: HttpStatus.TOO_MANY_REQUESTS,
        detail: 'Trop de demandes d’OTP pour cette destination (max 5/h).',
      });
    }

    const code = String(randomInt(100000, 1000000));
    const codeHash = await argon2.hash(code, { type: argon2.argon2id });
    const expiresAt = new Date(Date.now() + this.ttlSec * 1000);

    const challenge = await this.prisma.otpChallenge.create({
      data: { target, channel, codeHash, expiresAt, ip },
    });

    const message = `AfriLive : votre code est ${code}. Valide ${Math.round(this.ttlSec / 60)} min. Ne le partagez jamais.`;
    try {
      if (channel === OtpChannel.EMAIL) {
        await this.email.send({ to: target, subject: 'Votre code AfriLive', text: message });
      } else {
        await this.sms.send(target, message);
      }
    } catch (err) {
      this.logger.warn(`Envoi OTP échoué (${channel} -> ${target}) : ${(err as Error).message}`);
      await this.prisma.otpChallenge.delete({ where: { id: challenge.id } });
      await this.redis.del(`${key}:lock`); // permet une nouvelle tentative immédiate
      throw err;
    }

    const isConsole = process.env.SMS_MODE === 'console' || process.env.NODE_ENV !== 'production';
    return {
      id: challenge.id,
      expiresAt,
      ...(isConsole ? { debugCode: code } : {}),
    };
  }

  /**
   * Vérifie un OTP : expire → OTP_EXPIRED, épuisement des tentatives →
   * OTP_TOO_MANY_ATTEMPTS, mismatch → OTP_INVALID. Consomme le challenge au succès.
   */
  async verify(target: string, channel: OtpChannel, code: string): Promise<void> {
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { target, channel, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) {
      throw new AppException(ERROR_CODES.OTP_INVALID, {
        status: HttpStatus.UNAUTHORIZED,
        detail: 'Aucun OTP en attente pour cette destination.',
      });
    }
    if (challenge.expiresAt.getTime() < Date.now()) {
      throw new AppException(ERROR_CODES.OTP_EXPIRED, {
        status: HttpStatus.UNAUTHORIZED,
        detail: 'OTP expiré, redemandez un code.',
      });
    }
    if (challenge.attempts >= this.maxAttempts) {
      throw new AppException(ERROR_CODES.OTP_TOO_MANY_ATTEMPTS, {
        status: HttpStatus.TOO_MANY_REQUESTS,
        detail: 'Trop de tentatives, redemandez un code.',
      });
    }

    const ok = await argon2.verify(challenge.codeHash, code);
    if (!ok) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw new AppException(ERROR_CODES.OTP_INVALID, {
        status: HttpStatus.UNAUTHORIZED,
        detail: 'Code incorrect.',
      });
    }

    await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });
    // Réinitialise les compteurs anti-abus pour la destination.
    await this.redis.del(`otp:${channel}:${target}:lock`, `otp:${channel}:${target}:hour`);
  }
}

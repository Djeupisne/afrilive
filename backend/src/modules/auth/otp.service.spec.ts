import { OtpChannel } from '@prisma/client';
import * as argon2 from 'argon2';
import { AppException } from '../../common/errors/app.exception';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { PrismaService } from '../../database/prisma.service';
import type { RedisService } from '../../integrations/redis/redis.service';
import type { SmsService } from '../../integrations/sms/sms.service';
import type { EmailService } from '../../integrations/email/email.service';
import { OtpService } from './otp.service';

jest.mock('argon2', () => ({
  hash: jest.fn(async (v: string) => `hash:${v}`),
  verify: jest.fn(async (h: string, v: string) => h === `hash:${v}`),
  argon2id: 2,
}));

interface FakeChallenge {
  id: string;
  target: string;
  channel: OtpChannel;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
  createdAt: Date;
}

function makeService(opts?: { lockAllowed?: boolean; hourCount?: number }) {
  const store: FakeChallenge[] = [];
  let seq = 0;
  const prisma = {
    otpChallenge: {
      create: jest.fn(async ({ data }: any) => {
        const c: FakeChallenge = {
          id: `otp-${++seq}`,
          attempts: 0,
          consumedAt: null,
          createdAt: new Date(),
          ...data,
        };
        store.push(c);
        return c;
      }),
      findFirst: jest.fn(async ({ where }: any) =>
        [...store].reverse().find((c) => c.target === where.target && c.channel === where.channel && (where.consumedAt === undefined || c.consumedAt === where.consumedAt)) ?? null,
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const c = store.find((x) => x.id === where.id);
        if (!c) throw new Error('missing');
        if (typeof data.attempts === 'number') c.attempts = data.attempts;
        else if (data.attempts?.increment) c.attempts += data.attempts.increment;
        if (data.consumedAt !== undefined) c.consumedAt = data.consumedAt;
        return c;
      }),
      delete: jest.fn(async ({ where }: any) => {
        const i = store.findIndex((x) => x.id === where.id);
        if (i >= 0) store.splice(i, 1);
      }),
    },
  } as unknown as PrismaService;

  const redis = {
    setNx: jest.fn(async () => opts?.lockAllowed ?? true),
    incr: jest.fn(async () => opts?.hourCount ?? 1),
    expire: jest.fn(async () => undefined),
    del: jest.fn(async () => undefined),
  } as unknown as RedisService;

  const sms = { send: jest.fn(async () => ({ ok: true })) } as unknown as SmsService;
  const email = { send: jest.fn(async () => undefined) } as unknown as EmailService;
  const config = { get: jest.fn((k: string) => (k === 'otp.ttlSec' ? 300 : k === 'otp.maxAttempts' ? 3 : undefined)) } as any;

  const svc = new OtpService(prisma, redis, sms, email, config);
  return { svc, prisma, redis, sms, email, store };
}

describe('OtpService', () => {
  const phone = '+2250712345678';

  describe('issue()', () => {
    it('émet un challenge avec hash argon2id (jamais le code en clair) et envoie par SMS', async () => {
      const { svc, store, sms } = makeService();
      const issued = await svc.issue(phone, OtpChannel.SMS);
      expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(store).toHaveLength(1);
      expect(store[0].codeHash).toMatch(/^hash:/); // jamais \d{6} en clair
      expect(sms.send).toHaveBeenCalledWith(phone, expect.stringContaining('code'));
    });

    it('bloque la deuxième demande < 60 s (setNx refusé) → RATE_LIMITED', async () => {
      const { svc, store } = makeService({ lockAllowed: false });
      await expect(svc.issue(phone, OtpChannel.SMS)).rejects.toMatchObject({
        code: ERROR_CODES.RATE_LIMITED,
      });
      expect(store).toHaveLength(0);
    });

    it('refuse au-delà de 5 OTP/h sur la même destination', async () => {
      const { svc } = makeService({ hourCount: 6 });
      await expect(svc.issue(phone, OtpChannel.SMS)).rejects.toBeInstanceOf(AppException);
    });

    it('route EMAIL vers EmailService et ne touche pas SmsService', async () => {
      const { svc, sms, email } = makeService();
      await svc.issue('a@b.ci', OtpChannel.EMAIL);
      expect(email.send).toHaveBeenCalled();
      expect(sms.send).not.toHaveBeenCalled();
    });

    it('si l’envoi échoue, supprime le challenge et libère le verrou d’émission', async () => {
      const { svc, store, redis } = makeService();
      (svc as any).sms.send = jest.fn(async () => {
        throw new Error('provider down');
      });
      await expect(svc.issue(phone, OtpChannel.SMS)).rejects.toThrow('provider down');
      expect(store).toHaveLength(0);
      expect(redis.del).toHaveBeenCalledWith(expect.stringContaining(':lock'));
    });
  });

  describe('verify()', () => {
    it('consomme le challenge au succès et purge les compteurs anti-abus', async () => {
      const { svc, store, redis } = makeService();
      const issued = await svc.issue(phone, OtpChannel.SMS);
      const code = (issued as any).debugCode ?? '123456';
      // re-hash connu : on force le hash stocké pour connaître le code
      store[0].codeHash = await argon2.hash(code, { type: argon2.argon2id });
      await svc.verify(phone, OtpChannel.SMS, code);
      expect(store[0].consumedAt).not.toBeNull();
      expect(redis.del).toHaveBeenCalledWith(`otp:SMS:${phone}:lock`, `otp:SMS:${phone}:hour`);
    });

    it('OTP_INVALID si aucun challenge en attente', async () => {
      const { svc } = makeService();
      await expect(svc.verify(phone, OtpChannel.SMS, '123456')).rejects.toMatchObject({
        code: ERROR_CODES.OTP_INVALID,
      });
    });

    it('OTP_EXPIRED après expiration', async () => {
      const { svc, store } = makeService();
      await svc.issue(phone, OtpChannel.SMS);
      store[0].expiresAt = new Date(Date.now() - 1000);
      await expect(svc.verify(phone, OtpChannel.SMS, '123456')).rejects.toMatchObject({
        code: ERROR_CODES.OTP_EXPIRED,
      });
    });

    it('incrémente attempts à chaque mauvais code puis OTP_TOO_MANY_ATTEMPTS au 4e', async () => {
      const { svc, store } = makeService();
      await svc.issue(phone, OtpChannel.SMS);
      for (let i = 0; i < 3; i++) {
        await expect(svc.verify(phone, OtpChannel.SMS, '000000')).rejects.toMatchObject({
          code: ERROR_CODES.OTP_INVALID,
        });
      }
      expect(store[0].attempts).toBe(3);
      await expect(svc.verify(phone, OtpChannel.SMS, '000000')).rejects.toMatchObject({
        code: ERROR_CODES.OTP_TOO_MANY_ATTEMPTS,
      });
    });

    it('un challenge consommé ne peut plus être rejoué', async () => {
      const { svc, store } = makeService();
      const issued = await svc.issue(phone, OtpChannel.SMS);
      const code = (issued as any).debugCode ?? '123456';
      store[0].codeHash = await argon2.hash(code, { type: argon2.argon2id });
      await svc.verify(phone, OtpChannel.SMS, code);
      await expect(svc.verify(phone, OtpChannel.SMS, code)).rejects.toMatchObject({
        code: ERROR_CODES.OTP_INVALID,
      });
    });
  });
});

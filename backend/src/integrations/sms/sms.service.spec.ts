import { ConfigService } from '@nestjs/config';
import { AppException } from '../../common/errors/app.exception';
import { AfricasTalkingProvider } from './africastalking.provider';
import { SmsService } from './sms.service';
import { TermiiProvider } from './termii.provider';

/** Faux providers typés : seule la surface publique du service est testée. */
function makeTermii(overrides: Partial<TermiiProvider> = {}): TermiiProvider {
  return {
    configured: true,
    send: jest.fn().mockResolvedValue({ messageId: 'tm-1', status: 'sent' }),
    ...overrides,
  } as unknown as TermiiProvider;
}

function makeAt(overrides: Partial<AfricasTalkingProvider> = {}): AfricasTalkingProvider {
  return {
    configured: true,
    send: jest.fn().mockResolvedValue({ messageId: 'at-1', status: 'sent' }),
    ...overrides,
  } as unknown as AfricasTalkingProvider;
}

function makeService(mode: string, termii = makeTermii(), at = makeAt()) {
  const config = { get: (key: string) => (key === 'app.modes.sms' ? mode : undefined) } as unknown as ConfigService;
  return { service: new SmsService(config, termii, at), termii, at };
}

describe('SmsService', () => {
  describe('sélection du fournisseur par indicatif pays', () => {
    it('Nigeria (+234) et Ghana (+233) → Termii', () => {
      const { service } = makeService('real');
      expect(service.pickProvider('+234801234567')).toBe('termii');
      expect(service.pickProvider('234801234567')).toBe('termii');
      expect(service.pickProvider('+233209876543')).toBe('termii');
    });
    it('autres pays (CI +225, SN +221, KE +254, FR +33) → Africa’s Talking', () => {
      const { service } = makeService('real');
      expect(service.pickProvider('+2250712345678')).toBe('africastalking');
      expect(service.pickProvider('+221771234567')).toBe('africastalking');
      expect(service.pickProvider('+254712345678')).toBe('africastalking');
      expect(service.pickProvider('+33612345678')).toBe('africastalking');
    });
    it('send route vers le bon provider', async () => {
      const { service, termii, at } = makeService('real');
      await service.send('+234801234567', 'Code 123456');
      expect(termii.send).toHaveBeenCalledWith({ to: '+234801234567', message: 'Code 123456', channel: 'sms' });
      expect(at.send).not.toHaveBeenCalled();

      await service.send('+2250712345678', 'Code 654321');
      expect(at.send).toHaveBeenCalledWith({ to: '+2250712345678', message: 'Code 654321' });
    });
  });

  describe('mode console', () => {
    it('journalise et n’appelle aucun provider', async () => {
      const { service, termii, at } = makeService('console');
      const res = await service.send('+234801234567', 'Bonjour');
      expect(res.provider).toBe('console');
      expect(res.channel).toBe('sms');
      expect(res.messageId).toMatch(/^console-/);
      expect(termii.send).not.toHaveBeenCalled();
      expect(at.send).not.toHaveBeenCalled();
    });
  });

  describe('repli WhatsApp', () => {
    it('échec SMS (AT) → retry via Termii canal whatsapp', async () => {
      const termii = makeTermii();
      const at = makeAt({ send: jest.fn().mockRejectedValue(new Error('crédit insuffisant')) });
      const { service } = makeService('real', termii, at);
      (termii.send as jest.Mock).mockResolvedValueOnce({ messageId: 'sms-x', status: 'sent' }); // sms (non utilisé ici)
      const res = await service.send('+2250712345678', 'Code OTP');
      expect(res.provider).toBe('termii');
      expect(res.channel).toBe('whatsapp');
      expect(termii.send).toHaveBeenCalledWith({ to: '+2250712345678', message: 'Code OTP', channel: 'whatsapp' });
    });

    it('échec SMS Termii → repli whatsapp si Termii configuré', async () => {
      const termii = makeTermii({
        send: jest
          .fn()
          .mockRejectedValueOnce(new Error('503'))
          .mockResolvedValueOnce({ messageId: 'wa-1', status: 'sent' }),
      });
      const { service } = makeService('real', termii, makeAt());
      const res = await service.send('+234801234567', 'msg');
      expect(res.channel).toBe('whatsapp');
    });

    it('pas de repli si Termii non configuré → AppException propagée', async () => {
      const termii = makeTermii({ configured: false });
      const at = makeAt({ send: jest.fn().mockRejectedValue(new Error('network down')) });
      const { service } = makeService('real', termii, at);
      await expect(service.send('+2250712345678', 'msg')).rejects.toBeInstanceOf(AppException);
      expect(termii.send).not.toHaveBeenCalled();
    });

    it('repli WhatsApp en échec également → AppException', async () => {
      const termii = makeTermii({
        send: jest.fn().mockRejectedValue(new Error('provider indisponible')),
      });
      const { service } = makeService('real', termii, makeAt());
      await expect(service.send('+234801234567', 'msg')).rejects.toBeInstanceOf(AppException);
      // 1 tentative sms + 1 tentative whatsapp
      expect(termii.send).toHaveBeenCalledTimes(2);
    });

    it('repli désactivable via SMS_WHATSAPP_FALLBACK=false', async () => {
      process.env.SMS_WHATSAPP_FALLBACK = 'false';
      try {
        const termii = makeTermii({
          send: jest.fn().mockRejectedValue(new Error('503')),
        });
        const { service } = makeService('real', termii, makeAt());
        await expect(service.send('+234801234567', 'msg')).rejects.toBeInstanceOf(AppException);
        expect(termii.send).toHaveBeenCalledTimes(1); // pas de seconde tentative whatsapp
      } finally {
        delete process.env.SMS_WHATSAPP_FALLBACK;
      }
    });
  });
});

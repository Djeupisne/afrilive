import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../common/errors/app.exception';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { TermiiProvider } from './termii.provider';
import { AfricasTalkingProvider } from './africastalking.provider';

export interface SmsSendResult {
  provider: 'termii' | 'africastalking' | 'console';
  channel: 'sms' | 'whatsapp';
  messageId: string;
}

/** Préfixes internationaux pour lesquels Termii est retenu (cahier des charges). */
const TERMII_PREFIXES = ['234', '233']; // Nigeria, Ghana

/**
 * Envoi SMS multi-fournisseurs.
 * - Choix du fournisseur par indicatif pays : Termii pour NG/GH, Africa's Talking sinon.
 * - Repli WhatsApp : si l'envoi SMS échoue et que le numéro est joignable sur
 *   WhatsApp (WhatsApp-enabled via env), on retente via Termii canal whatsapp.
 * - SMS_MODE=console : le message est journalisé, aucun appel réseau.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly mode: string;

  constructor(
    private readonly config: ConfigService,
    private readonly termii: TermiiProvider,
    private readonly africastalking: AfricasTalkingProvider,
  ) {
    this.mode = this.config.get<string>('app.modes.sms') ?? 'console';
  }

  /** Sélectionne le fournisseur principal selon l'indicatif du numéro (E.164 sans `+`). */
  pickProvider(phone: string): 'termii' | 'africastalking' {
    const digits = phone.replace(/^\+/, '');
    return TERMII_PREFIXES.some((p) => digits.startsWith(p)) ? 'termii' : 'africastalking';
  }

  async send(phone: string, message: string): Promise<SmsSendResult> {
    if (this.mode === 'console') {
      this.logger.log(`[SMS console] -> ${phone} : ${message}`);
      return { provider: 'console', channel: 'sms', messageId: `console-${Date.now()}` };
    }

    const primary = this.pickProvider(phone);
    try {
      if (primary === 'termii') {
        const r = await this.termii.send({ to: phone, message, channel: 'sms' });
        return { provider: 'termii', channel: 'sms', messageId: r.messageId };
      }
      const r = await this.africastalking.send({ to: phone, message });
      return { provider: 'africastalking', channel: 'sms', messageId: r.messageId };
    } catch (err) {
      // Repli WhatsApp uniquement si Termii est configuré et le fallback activé.
      const waFallback = (process.env.SMS_WHATSAPP_FALLBACK ?? 'true') !== 'false';
      if (waFallback && this.termii.configured) {
        this.logger.warn(`Envoi SMS (${primary}) vers ${phone} en échec, repli WhatsApp via Termii : ${this.reason(err)}`);
        try {
          const r = await this.termii.send({ to: phone, message, channel: 'whatsapp' });
          return { provider: 'termii', channel: 'whatsapp', messageId: r.messageId };
        } catch (err2) {
          this.logger.error(`Repli WhatsApp également en échec : ${this.reason(err2)}`);
          throw err instanceof AppException ? err : this.mapUnknown(err2);
        }
      }
      throw err instanceof AppException ? err : this.mapUnknown(err);
    }
  }

  private reason(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  private mapUnknown(err: unknown): AppException {
    return new AppException(ERROR_CODES.PAYMENT_PROVIDER_UNAVAILABLE, {
      detail: `Envoi SMS impossible : ${this.reason(err)}`,
    });
  }
}

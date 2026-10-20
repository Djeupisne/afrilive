import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { AppException } from '../../common/errors/app.exception';
import { ERROR_CODES } from '../../common/errors/error-codes';

export interface TermiiSendResult {
  messageId: string;
  status: 'sent' | 'queued' | 'failed';
}

/**
 * Fournisseur Termii (https://termii.com) — retenu pour NG et GH.
 * Canaux : `sms` et `whatsapp` (repli WhatsApp du SmsService).
 * Timeout court + 2 retries (backoff exponentiel) ; erreurs mappées AppException.
 */
@Injectable()
export class TermiiProvider {
  private readonly logger = new Logger(TermiiProvider.name);
  private readonly baseUrl = 'https://api.termii.dev/api/sms';
  private readonly apiKey: string;
  private readonly smsSenderId: string;
  private readonly whatsappSenderId: string;

  constructor(config: ConfigService) {
    this.apiKey = process.env.TERMII_API_KEY ?? '';
    this.smsSenderId = process.env.TERMII_SENDER_ID ?? 'AfriLive';
    this.whatsappSenderId = process.env.TERMII_WHATSAPP_SENDER_ID ?? '';
    void config; // ConfigModule global : lecture directe des variables fournisseur.
  }

  get configured(): boolean {
    return this.apiKey.length > 0;
  }

  async send(params: {
    to: string;
    message: string;
    channel?: 'sms' | 'whatsapp';
  }): Promise<TermiiSendResult> {
    if (!this.configured) {
      throw new AppException(ERROR_CODES.PAYMENT_PROVIDER_UNAVAILABLE, {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        title: 'Service indisponible',
        detail: 'Termii non configuré (TERMII_API_KEY absent).',
      });
    }
    const channel = params.channel ?? 'sms';
    const body = {
      api_key: this.apiKey,
      channel,
      to: params.to,
      from: channel === 'whatsapp' ? this.whatsappSenderId || this.smsSenderId : this.smsSenderId,
      message: params.message,
      type: channel === 'whatsapp' ? 'template' : 'plain',
    };
    const data = await this.postWithRetry<{ message_id?: string }>(body);
    return { messageId: data.message_id ?? '', status: 'sent' };
  }

  /** POST avec timeout 8 s et 2 retries (1 s, 2 s) sur réseau / 429 / 5xx. */
  private async postWithRetry<T extends Record<string, unknown>>(body: Record<string, unknown>, attempt = 0): Promise<T> {
    try {
      const res = await axios.post<{ data?: T } & T>(`${this.baseUrl}/send`, body, {
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        timeout: 8_000,
      });
      // Termii enveloppe parfois la réponse dans { data: {...} }.
      return ((res.data as { data?: T })?.data ?? res.data) as T;
    } catch (err) {
      if (this.isRetriable(err) && attempt < 2) {
        const delay = 1_000 * 2 ** attempt;
        this.logger.warn(`Termii appel ${attempt + 1} échoué (${this.describe(err)}), nouvelle tentative dans ${delay} ms`);
        await new Promise((r) => setTimeout(r, delay));
        return this.postWithRetry(body, attempt + 1);
      }
      throw this.mapError(err);
    }
  }

  private isRetriable(err: unknown): boolean {
    if (err instanceof AxiosError) {
      if (!err.response) return true; // réseau / timeout
      const s = err.response.status;
      return s === 429 || s >= 500;
    }
    return err instanceof Error;
  }

  private describe(err: unknown): string {
    if (err instanceof AxiosError) {
      return `${err.code ?? ''} ${err.response?.status ?? ''}`.trim() || String(err.message);
    }
    return String(err);
  }

  private mapError(err: unknown): AppException {
    if (err instanceof AppException) return err;
    const detail =
      err instanceof AxiosError && err.response
        ? `Termii a répondu ${err.response.status}.`
        : 'Termii injoignable (timeout ou erreur réseau).';
    this.logger.error(`Erreur Termii : ${this.describe(err)}`);
    return new AppException(ERROR_CODES.PAYMENT_PROVIDER_UNAVAILABLE, {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      title: 'Service indisponible',
      detail,
    });
  }
}

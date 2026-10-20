import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { AppException } from '../../common/errors/app.exception';
import { ERROR_CODES } from '../../common/errors/error-codes';

export interface AfricasTalkingSendResult {
  messageId: string;
  status: 'sent' | 'queued' | 'failed';
}

/**
 * Fournisseur Africa's Talking (https://africastalking.com) — retenu pour les
 * pays hors NG/GH. API HTTP `POST /version1/messaging` (Basic auth username +
 * clé API). Timeout court + 2 retries ; erreurs mappées AppException.
 */
@Injectable()
export class AfricasTalkingProvider {
  private readonly logger = new Logger(AfricasTalkingProvider.name);
  private readonly baseUrl = 'https://api.africastalking.com/version1';
  private readonly username: string;
  private readonly apiKey: string;
  private readonly senderId: string;

  constructor() {
    this.username = process.env.AFRICASTALKING_USERNAME ?? 'afrilive';
    this.apiKey = process.env.AFRICASTALKING_API_KEY ?? '';
    this.senderId = process.env.AFRICASTALKING_SENDER_ID ?? '';
  }

  get configured(): boolean {
    return this.apiKey.length > 0;
  }

  async send(params: { to: string; message: string }): Promise<AfricasTalkingSendResult> {
    if (!this.configured) {
      throw new AppException(ERROR_CODES.PAYMENT_PROVIDER_UNAVAILABLE, {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        title: 'Service indisponible',
        detail: "Africa's Talking non configuré (AFRICASTALKING_API_KEY absent).",
      });
    }
    const form = new URLSearchParams({
      to: params.to,
      message: params.message,
      ...(this.senderId ? { from: this.senderId } : {}),
    });
    const data = await this.postWithRetry(form.toString(), 0);
    const recipient = data.SMSMessageData?.Recipients?.[0];
    return {
      messageId: recipient?.messageId ?? '',
      status: recipient?.status === 'success' || recipient?.status === 'queued' ? 'sent' : 'failed',
    };
  }

  private async postWithRetry(body: string, attempt: number): Promise<AtResponse> {
    try {
      const res = await axios.post<AtResponse>(`${this.baseUrl}/messaging`, body, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          apikey: this.apiKey,
        },
        timeout: 8_000,
        auth: { username: this.username, password: this.apiKey },
      });
      return res.data;
    } catch (err) {
      if (this.isRetriable(err) && attempt < 2) {
        const delay = 1_000 * 2 ** attempt;
        this.logger.warn(`Africa's Talking appel ${attempt + 1} échoué (${this.describe(err)}), retry dans ${delay} ms`);
        await new Promise((r) => setTimeout(r, delay));
        return this.postWithRetry(body, attempt + 1);
      }
      throw this.mapError(err);
    }
  }

  private isRetriable(err: unknown): boolean {
    if (err instanceof AxiosError) {
      if (!err.response) return true;
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
        ? `Africa's Talking a répondu ${err.response.status}.`
        : "Africa's Talking injoignable (timeout ou erreur réseau).";
    this.logger.error(`Erreur Africa's Talking : ${this.describe(err)}`);
    return new AppException(ERROR_CODES.PAYMENT_PROVIDER_UNAVAILABLE, {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      title: 'Service indisponible',
      detail,
    });
  }
}

interface AtRecipient {
  messageId?: string;
  status?: string;
  errorCode?: string;
}
interface AtResponse {
  SMSMessageData?: { Recipients?: AtRecipient[] };
}

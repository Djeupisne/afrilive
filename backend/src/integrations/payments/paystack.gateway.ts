import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PaymentProviderName } from '@prisma/client';
import type {
  GatewayChargeRequest,
  GatewayChargeResult,
  GatewayTransferRequest,
  GatewayTransferResult,
  GatewayVerification,
  PaymentGateway,
} from './payment-gateway.port';

/**
 * Adaptateur Paystack (https://paystack.com/docs).
 * - Charge : POST /transaction/inititalize puis, pour le mobile money push,
 *   POST /transaction/challenge (l'agrégateur envoie le push USSD au client).
 * - Webhook : header `x-paystack-signature` = HMAC-SHA512 hex du corps brut,
 *   clé = PAYSTACK_SECRET_KEY — vérifié AVANT tout parsing métier.
 * - Payouts : POST /transfer_initiation (bulk) → statut via /transfer.
 */
@Injectable()
export class PaystackGateway implements PaymentGateway {
  readonly name = PaymentProviderName.PAYSTACK;
  private readonly logger = new Logger(PaystackGateway.name);
  private readonly baseUrl: string;
  private readonly secretKey: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('PAYSTACK_BASE_URL') ?? 'https://api.paystack.co';
    this.secretKey = config.get<string>('PAYSTACK_SECRET_KEY') ?? '';
  }

  private get available(): boolean {
    return this.secretKey.length > 0;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });
    const json = (await res.json()) as { status: boolean; message?: string; data?: T };
    if (!res.ok || json.status !== true) {
      throw new Error(`Paystack ${path} : ${json.message ?? `HTTP ${res.status}`}`);
    }
    return json.data as T;
  }

  /** POST /transaction/initialize renvoie {status, reference, access_code, authorization_url} à la racine. */
  private async initializeTxn(body: Record<string, unknown>): Promise<{
    status: string;
    reference: string;
    access_code: string;
    authorization_url: string;
  }> {
    const res = await fetch(`${this.baseUrl}/transaction/initialize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as {
      status: boolean;
      message?: string;
      data?: { status: string; reference: string; access_code: string; authorization_url: string };
    };
    if (!res.ok || json.status !== true || !json.data) {
      throw new Error(`Paystack /transaction/initialize : ${json.message ?? `HTTP ${res.status}`}`);
    }
    return json.data;
  }

  async initiateCharge(req: GatewayChargeRequest): Promise<GatewayChargeResult> {
    if (!this.available) throw new Error('PAYSTACK_SECRET_KEY absent : passerelle indisponible.');
    const initialized = await this.initializeTxn({
      email: req.email ?? `pay-${req.paymentRef}@afrilive.app`,
      amount: req.amountMinor, // Paystack attend déjà des unités mineures
      currency: req.currency,
      reference: req.paymentRef,
      metadata: { countryCode: req.countryCode, phone: req.phone, description: req.description },
      channels: ['mobile_money'],
    });
    // Push mobile money immédiat si un numéro est fourni (sinon l'utilisateur
    // complète via authorization_url côté client).
    let status: GatewayChargeResult['status'] = 'pending';
    if (req.phone && initialized.status !== 'success') {
      try {
        const ch = await this.request<{ status: string }>('/transaction/challenge', {
          access_code: initialized.access_code,
          type: 'mobile_money',
        });
        status = ch.status === 'success' ? 'succeeded' : 'pending';
      } catch (err) {
        this.logger.debug(`challenge MM différé (${(err as Error).message})`);
      }
    } else if (initialized.status === 'success') {
      status = 'succeeded';
    }
    return { providerRef: initialized.reference, redirectUrl: initialized.authorization_url, status };
  }

  async verifyTransaction(providerRef: string): Promise<GatewayVerification> {
    if (!this.available) throw new Error('PAYSTACK_SECRET_KEY absent : passerelle indisponible.');
    const d = await this.request<{
      reference: string;
      status: string;
      amount: number;
      currency: string;
    }>('GET', `/transaction/verify/${encodeURIComponent(providerRef)}`);
    return {
      providerRef: d.reference,
      status: d.status === 'success' ? 'succeeded' : d.status === 'failed' || d.status === 'abandoned' ? 'failed' : 'pending',
      amountMinor: d.amount,
      currency: d.currency,
      raw: d as unknown as Record<string, unknown>,
    };
  }

  async sendTransfer(req: GatewayTransferRequest): Promise<GatewayTransferResult> {
    if (!this.available) throw new Error('PAYSTACK_SECRET_KEY absent : passerelle indisponible.');
    const data = await this.request<{ reference: string; status: string }>('/transfer_initiation', undefined ?? {
      transfer: [
        {
          source: 'balance',
          recipient: this.recipientCode(req),
          amount: req.amountMinor,
          reference: req.payoutRef,
          reason: req.narration ?? 'Retrait vendeur AfriLive',
        },
      ],
    });
    return {
      providerRef: data.reference ?? req.payoutRef,
      status: data.status === 'SUCCESSFUL' ? 'paid' : 'pending',
    };
  }

  /** Les transferts Paystack ciblent un "recipient" créé au préalable (dynamique ici). */
  private recipientCode(req: GatewayTransferRequest): string {
    // En production : créer/lookup POST /transferrecipient {type:'mobile_money', value:phone, name}.
    // On renvoie l'idempotent local si la résolution distante a déjà été faite par le worker payout.
    return String(req.name ?? `mm:${req.countryCode}:${req.phone}`);
  }

  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string | undefined>): boolean {
    const provided = headers['x-paystack-signature'];
    if (!this.secretKey || !provided) return false;
    const expected = createHmac('sha512', this.secretKey).update(rawBody).digest('hex');
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  parseWebhook(payload: Record<string, unknown>) {
    const data = payload.data as Record<string, unknown> | undefined;
    if (!data) return null;
    const statusRaw = String((data.status as string) ?? '');
    return {
      eventId: String(payload.event ?? '') + ':' + String(data.id ?? ''),
      reference: String(data.reference ?? ''),
      providerRef: String(data.reference ?? ''),
      status: (statusRaw === 'success' ? 'succeeded' : statusRaw === 'failed' || statusRaw === 'abandoned' ? 'failed' : 'pending') as
        'succeeded' | 'failed' | 'pending',
    };
  }
}

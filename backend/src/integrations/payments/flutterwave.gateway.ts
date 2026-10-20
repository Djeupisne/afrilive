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

/** Mapping pays → opérateur local Flutterwave (mobile money). */
const MOMO_PROVIDER_BY_COUNTRY: Record<string, string> = {
  CI: 'MTN_MOMO_CIV',
  SN: 'MTN_MOMO_SEN',
  ML: 'MTN_MOMO_MLI',
  UG: 'MTN_MOMO_UGA',
  NG: 'MTN_Nigeria',
  GH: 'MTNGHana',
  KE: 'MPESA_Kenya',
  TZ: 'TANZANIATigoPesa',
  ZM: 'MTNZambia',
  RW: 'AirtelRwanda',
  ZA: 'MTNSouthAfrica',
};

/**
 * Adaptateur Flutterwave v3 (https://developer.flutterwave.com/docs).
 * - Mobile money push : POST /api/v3/charges type=mobilemoneymno (ou
 *   mobilemoneyghana/mpesa selon le pays) — pas de redirect obligatoire.
 * - Webhook : header `verif-hash` égal à FLUTTERWAVE_WEBHOOK_HASH (config
 *   dashboard), sinon signature HMAC-SHA256 du corps sur la clé secrète.
 * - Payouts : POST /api/v3/transfers (disbursement vers wallet MM vendeur).
 */
@Injectable()
export class FlutterwaveGateway implements PaymentGateway {
  readonly name = PaymentProviderName.FLUTTERWAVE;
  private readonly logger = new Logger(FlutterwaveGateway.name);
  private readonly baseUrl: string;
  private readonly secretKey: string;
  private readonly webhookHash: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('FLUTTERWAVE_BASE_URL') ?? 'https://api.flutterwave.com';
    this.secretKey = config.get<string>('FLUTTERWAVE_SECRET_KEY') ?? '';
    this.webhookHash = config.get<string>('FLUTTERWAVE_WEBHOOK_HASH') ?? '';
  }

  private get available(): boolean {
    return this.secretKey.length > 0;
  }

  private async api<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { status: string; message?: string; data?: T };
    if (!res.ok || json.status !== 'success') {
      throw new Error(`Flutterwave ${path} : ${json.message ?? `HTTP ${res.status}`}`);
    }
    return json.data as T;
  }

  async initiateCharge(req: GatewayChargeRequest): Promise<GatewayChargeResult> {
    if (!this.available) throw new Error('FLUTTERWAVE_SECRET_KEY absent : passerelle indisponible.');
    const country = (req.countryCode ?? 'CI').toUpperCase();
    const isMpesa = country === 'KE';
    const isGhana = country === 'GH';
    const type = isMpesa ? 'mpesa' : isGhana ? 'mobilemoneyghana' : 'mobilemoneymno';
    const data = await this.api<{ flw_ref: string; status: string; redirect_url?: string }>('/api/v3/charges', {
      txnid: req.paymentRef,
      amount: req.amountMinor / 100, // Flutterwave attend des unités majeures
      currency: req.currency,
      email: req.email ?? `pay-${req.paymentRef}@afrilive.app`,
      phonenumber: req.phone,
      country: country === 'KE' ? 'KE' : undefined,
      narration: req.description ?? 'Paiement AfriLive',
      type,
      channel: type === 'mobilemoneymno' ? MOMO_PROVIDER_BY_COUNTRY[country] : undefined,
      redirect_url: undefined,
    });
    return {
      providerRef: data.flw_ref,
      redirectUrl: data.redirect_url ?? null,
      status: data.status === 'successful' ? 'succeeded' : data.status === 'failed' ? 'failed' : 'pending',
    };
  }

  async verifyTransaction(providerRef: string): Promise<GatewayVerification> {
    if (!this.available) throw new Error('FLUTTERWAVE_SECRET_KEY absent : passerelle indisponible.');
    const res = await fetch(`${this.baseUrl}/api/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(providerRef)}`, {
      headers: { Authorization: `Bearer ${this.secretKey}` },
    });
    const json = (await res.json()) as {
      status: string;
      data?: { flw_ref: string; status: string; amount?: number; currency?: string };
    };
    const d = json.data;
    if (!d) throw new Error(`Flutterwave verify : transaction ${providerRef} introuvable.`);
    return {
      providerRef: d.flw_ref,
      status: d.status === 'successful' ? 'succeeded' : d.status === 'failed' ? 'failed' : 'pending',
      amountMinor: d.amount != null ? Math.round(d.amount * 100) : undefined,
      currency: d.currency,
      raw: d as unknown as Record<string, unknown>,
    };
  }

  async sendTransfer(req: GatewayTransferRequest): Promise<GatewayTransferResult> {
    if (!this.available) throw new Error('FLUTTERWAVE_SECRET_KEY absent : passerelle indisponible.');
    const country = (req.countryCode ?? 'CI').toUpperCase();
    const data = await this.api<{ reference: string; status: string }>('/api/v3/transfers', {
      account_bank: this.bankCodeFor(country),
      account_number: req.phone.replace(/\D/g, ''),
      amount: req.amountMinor / 100,
      currency: req.currency,
      narration: req.narration ?? 'Retrait vendeur AfriLive',
      reference: req.payoutRef,
    });
    return {
      providerRef: data.reference,
      status: data.status === 'SUCCESSFUL' || data.status === 'COMPLETED' ? 'paid' : data.status === 'FAILED' ? 'failed' : 'pending',
    };
  }

  /** Codes établissement Flutterwave pour les wallets mobile money usuels. */
  private bankCodeFor(country: string): string {
    const map: Record<string, string> = {
      CI: 'MTNCI', SN: 'MTNSEN', ML: 'MTNMLI', UG: 'MTNUMG', NG: 'MTNN',
      GH: 'MTNGH', KE: 'MPESA', TZ: 'TIGOPES', ZA: 'FNB', RW: 'AIRTEL',
    };
    return map[country.toUpperCase()] ?? 'MTNN';
  }

  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string | undefined>): boolean {
    // 1) Secret partagé "verif-hash" (recommandé par Flutterwave) : simple equality, timing-safe.
    const hash = headers['verif-hash'];
    if (this.webhookHash && typeof hash === 'string') {
      return this.timingSafe(hash, this.webhookHash);
    }
    // 2) À défaut : HMAC-SHA256 du corps brut avec la clé secrète (header x-hook-signature).
    const provided = headers['x-hook-signature'];
    if (!this.secretKey || !provided) return false;
    const expected = createHmac('sha256', this.secretKey).update(rawBody).digest('hex');
    return this.timingSafe(provided, expected);
  }

  parseWebhook(payload: Record<string, unknown>) {
    const data = payload.data as Record<string, unknown> | undefined;
    if (!data) return null;
    const eventId = String(data.id ?? payload.event ?? '');
    const statusRaw = String(data.status ?? '');
    return {
      eventId,
      reference: String(data.tx_ref ?? data.flw_ref ?? ''),
      providerRef: String(data.flw_ref ?? ''),
      status: (statusRaw === 'successful' ? 'succeeded' : statusRaw === 'failed' ? 'failed' : 'pending') as
        'succeeded' | 'failed' | 'pending',
    };
  }

  private timingSafe(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  }
}

import { PaymentProviderName } from '@prisma/client';

/** Demande d'initiation transmise par PaymentsService à l'agrégateur. */
export interface GatewayChargeRequest {
  /** Référence interne du paiement (idempotencyKey ou id) renvoyée dans les webhooks. */
  paymentRef: string;
  amountMinor: number;
  currency: string;
  email?: string;
  phone?: string;
  countryCode?: string;
  providerHint?: PaymentProviderName;
  description?: string;
}

/** Réponse normalisée d'une initiation côté agrégateur. */
export interface GatewayChargeResult {
  /** Référence fournie par l'agrégateur (à stocker dans Payment.providerRef). */
  providerRef: string;
  /** URL de confirmation éventuelle (3DS / push USSD) — null pour mobile money direct. */
  redirectUrl: string | null;
  /** Statut initial côté agrégateur, normalisé. */
  status: 'pending' | 'succeeded' | 'failed';
}

/** Résultat normalisé d'une vérification de transaction (polling/webhook). */
export interface GatewayVerification {
  providerRef: string;
  status: 'pending' | 'succeeded' | 'failed';
  amountMinor?: number;
  currency?: string;
  raw?: Record<string, unknown>;
}

/** Demande de transfert sortant (payout mobile money). */
export interface GatewayTransferRequest {
  payoutRef: string; // idempotencyKey du Payout
  amountMinor: number;
  currency: string;
  phone: string;
  countryCode: string;
  name?: string;
  narration?: string;
}

/** Résultat d'un transfert payout. */
export interface GatewayTransferResult {
  providerRef: string;
  status: 'pending' | 'paid' | 'failed';
}

/**
 * Port des agrégateurs de paiement (Flutterwave, Paystack…).
 * Implémentations branchées quand PAYMENT_MODE=live ; MOCK/WALLET court-circuités
 * par PaymentsService. Les erreurs réseau/API doivent remonter en Error : le
 * service les traduit en PaymentAttempt échoué + retry BullMQ.
 */
export interface PaymentGateway {
  readonly name: PaymentProviderName.FLUTTERWAVE | PaymentProviderName.PAYSTACK;

  /** Initie une charge (mobile money push ou carte). */
  initiateCharge(req: GatewayChargeRequest): Promise<GatewayChargeResult>;

  /** Vérifie le statut réel d'une transaction (source de vérité webhook + polling). */
  verifyTransaction(providerRef: string): Promise<GatewayVerification>;

  /** Transfert sortant (payout vers un wallet mobile money vendeur). */
  sendTransfer(req: GatewayTransferRequest): Promise<GatewayTransferResult>;

  /**
   * Vérifie la signature d'un webhook entrant AVANT tout traitement.
   * @param rawBody corps brut exact (Buffer) reçu par l'HTTP layer.
   */
  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string | undefined>): boolean;

  /** Extrait du payload brut les champs normalisés utilisés par handleWebhook. */
  parseWebhook(payload: Record<string, unknown>): {
    eventId: string;
    reference: string;
    status: 'succeeded' | 'failed' | 'pending';
    providerRef: string;
  } | null;
}

export const PAYMENT_GATEWAY = 'PAYMENT_GATEWAY';

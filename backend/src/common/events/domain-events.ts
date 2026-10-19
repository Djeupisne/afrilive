/**
 * Événements de domaine (bus interne @nestjs/event-emitter).
 * Noms stables : <domaine>.<action> — préfixe utilisé par @On(...).
 */
export const DOMAIN_EVENTS = {
  USER_REGISTERED: 'user.registered',
  USER_KYC_APPROVED: 'user.kyc.approved',
  USER_KYC_REJECTED: 'user.kyc.rejected',
  USER_SUSPENDED: 'user.suspended',

  ORDER_CREATED: 'order.created',
  ORDER_PAID: 'order.paid',
  ORDER_SHIPPED: 'order.shipped',
  ORDER_DELIVERED: 'order.delivered',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_EXPIRED: 'order.expired',

  PAYMENT_INITIATED: 'payment.initiated',
  PAYMENT_SUCCEEDED: 'payment.succeeded',
  PAYMENT_FAILED: 'payment.failed',
  ESCROW_RELEASED: 'payment.escrow.released',
  PAYOUT_REQUESTED: 'payout.requested',
  PAYOUT_COMPLETED: 'payout.completed',

  WALLET_CREDITED: 'wallet.credited',
  WALLET_DEBITED: 'wallet.debited',

  LIVE_STARTED: 'live.started',
  LIVE_ENDED: 'live.ended',
  LIVE_PRODUCT_PINNED: 'live.product.pinned',

  VIDEO_UPLOADED: 'video.uploaded',
  VIDEO_TRANSCODED: 'video.transcoded',
  VIDEO_FLAGGED: 'video.flagged',

  FOLLOW_CREATED: 'follow.created',
  FOLLOW_REMOVED: 'follow.removed',

  PRODUCT_CREATED: 'product.created',
  PRODUCT_STOCK_LOW: 'product.stock.low',

  MODERATION_ACTION: 'moderation.action',
} as const;

export type DomainEventName = (typeof DOMAIN_EVENTS)[keyof typeof DOMAIN_EVENTS];

export interface UserRegisteredEvent {
  userId: string;
  phone: string;
  role: string;
  country: string;
  occurredAt: string;
}

export interface OrderPaidEvent {
  orderId: string;
  buyerId: string;
  shopId: string;
  amountMinor: number;
  currency: string;
  occurredAt: string;
}

export interface LiveStartedEvent {
  liveId: string;
  hostId: string;
  roomName: string;
  occurredAt: string;
}

export interface PaymentSucceededEvent {
  paymentId: string;
  orderId: string;
  provider: string;
  providerRef: string;
  amountMinor: number;
  currency: string;
  occurredAt: string;
}

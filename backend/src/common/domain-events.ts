/**
 * Événements de domaine (bus interne via @nestjs/event-emitter).
 * Noms d'événements constants + payloads typés. Les listeners s'enregistrent
 * avec @OnEvent(DomainEvents.X).
 */
export const DomainEvents = {
  // Auth / users
  USER_REGISTERED: 'user.registered',
  USER_LOGIN: 'user.login',
  USER_BANNED: 'user.banned',
  USER_UNBANNED: 'user.unbanned',

  // KYC
  KYC_SUBMITTED: 'kyc.submitted',
  KYC_APPROVED: 'kyc.approved',
  KYC_REJECTED: 'kyc.rejected',

  // Boutique / produits
  SHOP_CREATED: 'shop.created',
  PRODUCT_CREATED: 'product.created',
  PRODUCT_PRICE_CHANGED: 'product.priceChanged',
  PRODUCT_STOCK_LOW: 'product.stockLow',

  // Commandes
  ORDER_CREATED: 'order.created',
  ORDER_PAID: 'order.paid',
  ORDER_SHIPPED: 'order.shipped',
  ORDER_DELIVERED: 'order.delivered',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_DISPUTED: 'order.disputed',

  // Paiement / escrow
  PAYMENT_INITIATED: 'payment.initiated',
  PAYMENT_SUCCEEDED: 'payment.succeeded',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_REFUNDED: 'payment.refunded',
  ESCROW_RELEASED: 'escrow.released',
  WITHDRAWAL_REQUESTED: 'withdrawal.requested',
  WITHDRAWAL_COMPLETED: 'withdrawal.completed',

  // Live / vidéos
  LIVE_STARTED: 'live.started',
  LIVE_ENDED: 'live.ended',
  VIDEO_UPLOADED: 'video.uploaded',
  VIDEO_PUBLISHED: 'video.published',

  // Social
  USER_FOLLOWED: 'social.followed',
  REACTION_ADDED: 'social.reactionAdded',
  REVIEW_CREATED: 'social.reviewCreated',

  // Livraison
  DELIVERY_CREATED: 'delivery.created',
  DELIVERY_ASSIGNED: 'delivery.assigned',
  DELIVERY_COMPLETED: 'delivery.completed',

  // Modération
  CONTENT_REPORTED: 'moderation.reported',
  CONTENT_REMOVED: 'moderation.removed',
} as const;

export type DomainEventName = (typeof DomainEvents)[keyof typeof DomainEvents];

export interface DomainEvent<TPayload extends object = object> {
  name: DomainEventName;
  occurredAt: Date;
  /** id du déclencheur (utilisateur, système = 'system') */
  actorId: string;
  payload: TPayload;
}

// ---- Payloads typés des événements principaux ----
export interface UserRegisteredEvent {
  userId: string;
  phone: string;
  role: string;
  country: string;
}

export interface OrderPaidEvent {
  orderId: string;
  userId: string;
  sellerId: string;
  amountMinor: number;
  currency: string;
  paymentId: string;
}

export interface OrderDeliveredEvent {
  orderId: string;
  userId: string;
  sellerId: string;
  escrowId?: string;
}

export interface LiveStartedEvent {
  liveId: string;
  hostId: string;
  roomName: string;
}

export interface PaymentSucceededEvent {
  paymentId: string;
  orderId?: string;
  provider: string;
  amountMinor: number;
  currency: string;
}

export function buildDomainEvent<P extends object>(name: DomainEventName, actorId: string, payload: P): DomainEvent<P> {
  return { name, occurredAt: new Date(), actorId, payload };
}

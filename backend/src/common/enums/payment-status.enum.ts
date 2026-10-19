import { PaymentStatus } from '@prisma/client';

export const PaymentStatusEnum = PaymentStatus;
export type PaymentStatusType = PaymentStatus;

/** Statuts considérés comme « payé » pour la logique métier. */
export const PAYMENT_SUCCESS_STATUSES: PaymentStatus[] = [PaymentStatus.SUCCEEDED];

/** Statuts terminaux d'un paiement. */
export const PAYMENT_TERMINAL_STATUSES: PaymentStatus[] = [
  PaymentStatus.FAILED,
  PaymentStatus.CANCELLED,
  PaymentStatus.REFUNDED,
  PaymentStatus.PARTIALLY_REFUNDED,
];

export function isPaymentSuccess(status: PaymentStatus): boolean {
  return PAYMENT_SUCCESS_STATUSES.includes(status);
}

export function isPaymentTerminal(status: PaymentStatus): boolean {
  return PAYMENT_TERMINAL_STATUSES.includes(status);
}

/**
 * Statuts de paiement — re-export de l'enum généré par Prisma (source de vérité :
 * backend/prisma/schema.prisma). Ne jamais redéfinir les valeurs ici.
 */
import { PaymentStatus as PrismaPaymentStatus } from '@prisma/client';

export const PaymentStatus = PrismaPaymentStatus;
export type PaymentStatus = PrismaPaymentStatus;

/** Statuts terminaux (plus aucune transition possible). */
export const FINAL_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  PaymentStatus.SUCCEEDED,
  PaymentStatus.FAILED,
  PaymentStatus.CANCELLED,
  PaymentStatus.REFUNDED,
] as const;

/** Transitions autorisées du cycle de vie d'un paiement. */
export const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  [PaymentStatus.INITIATED]: [PaymentStatus.PENDING, PaymentStatus.SUCCEEDED, PaymentStatus.FAILED, PaymentStatus.CANCELLED],
  [PaymentStatus.PENDING]: [PaymentStatus.SUCCEEDED, PaymentStatus.FAILED, PaymentStatus.CANCELLED],
  [PaymentStatus.SUCCEEDED]: [PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED],
  [PaymentStatus.FAILED]: [],
  [PaymentStatus.CANCELLED]: [],
  [PaymentStatus.REFUNDED]: [],
  [PaymentStatus.PARTIALLY_REFUNDED]: [PaymentStatus.REFUNDED],
};

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

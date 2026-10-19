/**
 * Statuts de commande — re-export de l'enum généré par Prisma (source de vérité :
 * backend/prisma/schema.prisma). Ne jamais redéfinir les valeurs ici.
 */
import { OrderStatus as PrismaOrderStatus } from '@prisma/client';

export const OrderStatus = PrismaOrderStatus;
export type OrderStatus = PrismaOrderStatus;

/** Statuts terminaux d'une commande (plus aucune transition possible). */
export const FINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.CANCELLED,
  OrderStatus.REFUNDED,
] as const;

/** Transitions autorisées du cycle de vie d'une commande. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.PAID, OrderStatus.CANCELLED],
  [OrderStatus.PAID]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED, OrderStatus.DISPUTED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED, OrderStatus.DISPUTED],
  [OrderStatus.DELIVERED]: [OrderStatus.RETURNED, OrderStatus.DISPUTED],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.RETURNED]: [OrderStatus.REFUNDED],
  [OrderStatus.REFUNDED]: [],
  [OrderStatus.DISPUTED]: [OrderStatus.REFUNDED, OrderStatus.DELIVERED, OrderStatus.CANCELLED],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

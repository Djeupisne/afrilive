import { OrderStatus } from '@prisma/client';

export const OrderStatusEnum = OrderStatus;
export type OrderStatusType = OrderStatus;

/** Statuts dans lesquels une commande peut encore être annulée par l'acheteur. */
export const ORDER_CANCELLABLE: OrderStatus[] = [OrderStatus.PENDING, OrderStatus.PAID];

/** Statuts terminaux (plus de transition possible). */
export const ORDER_TERMINAL: OrderStatus[] = [
  OrderStatus.CANCELLED,
  OrderStatus.RETURNED,
  OrderStatus.REFUNDED,
];

/** Machine à états : transitions autorisées. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.PAID, OrderStatus.CANCELLED],
  [OrderStatus.PAID]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED, OrderStatus.DISPUTED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED, OrderStatus.DISPUTED],
  [OrderStatus.DELIVERED]: [OrderStatus.RETURNED, OrderStatus.REFUNDED, OrderStatus.DISPUTED],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.RETURNED]: [OrderStatus.REFUNDED],
  [OrderStatus.REFUNDED]: [],
  [OrderStatus.DISPUTED]: [OrderStatus.REFUNDED, OrderStatus.DELIVERED, OrderStatus.CANCELLED],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

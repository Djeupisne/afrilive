import {
  FINAL_ORDER_STATUSES,
  ORDER_TRANSITIONS,
  OrderStatus,
  canTransitionOrder,
} from './order-status.enum';
import {
  FINAL_PAYMENT_STATUSES,
  PAYMENT_TRANSITIONS,
  PaymentStatus,
  canTransitionPayment,
} from './payment-status.enum';

describe('transitions de cycle de vie', () => {
  describe('OrderStatus', () => {
    it('transitions autorisées', () => {
      expect(canTransitionOrder(OrderStatus.PENDING, OrderStatus.PAID)).toBe(true);
      expect(canTransitionOrder(OrderStatus.PENDING, OrderStatus.CANCELLED)).toBe(true);
      expect(canTransitionOrder(OrderStatus.PAID, OrderStatus.SHIPPED)).toBe(true);
      expect(canTransitionOrder(OrderStatus.PAID, OrderStatus.DISPUTED)).toBe(true);
      expect(canTransitionOrder(OrderStatus.SHIPPED, OrderStatus.DELIVERED)).toBe(true);
      expect(canTransitionOrder(OrderStatus.DELIVERED, OrderStatus.RETURNED)).toBe(true);
      expect(canTransitionOrder(OrderStatus.RETURNED, OrderStatus.REFUNDED)).toBe(true);
      expect(canTransitionOrder(OrderStatus.DISPUTED, OrderStatus.REFUNDED)).toBe(true);
      expect(canTransitionOrder(OrderStatus.DISPUTED, OrderStatus.DELIVERED)).toBe(true);
    });
    it('transitions interdites', () => {
      // pas de saut d'étape
      expect(canTransitionOrder(OrderStatus.PENDING, OrderStatus.SHIPPED)).toBe(false);
      expect(canTransitionOrder(OrderStatus.PENDING, OrderStatus.DELIVERED)).toBe(false);
      expect(canTransitionOrder(OrderStatus.PENDING, OrderStatus.REFUNDED)).toBe(false);
      expect(canTransitionOrder(OrderStatus.SHIPPED, OrderStatus.PAID)).toBe(false); // pas de retour en arrière
      expect(canTransitionOrder(OrderStatus.DELIVERED, OrderStatus.PAID)).toBe(false);
      // auto-transitions interdites
      for (const s of Object.values(OrderStatus)) {
        expect(canTransitionOrder(s, s)).toBe(false);
      }
    });
    it('statuts terminaux : CANCELLED et REFUNDED n’ont aucune sortie', () => {
      expect(FINAL_ORDER_STATUSES).toEqual([OrderStatus.CANCELLED, OrderStatus.REFUNDED]);
      for (const to of Object.values(OrderStatus)) {
        expect(canTransitionOrder(OrderStatus.CANCELLED, to)).toBe(false);
        expect(canTransitionOrder(OrderStatus.REFUNDED, to)).toBe(false);
      }
    });
    it('la table couvre tous les statuts de l’enum', () => {
      expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual(Object.values(OrderStatus).sort());
    });
  });

  describe('PaymentStatus', () => {
    it('transitions autorisées', () => {
      expect(canTransitionPayment(PaymentStatus.INITIATED, PaymentStatus.PENDING)).toBe(true);
      expect(canTransitionPayment(PaymentStatus.INITIATED, PaymentStatus.SUCCEEDED)).toBe(true); // confirmation immédiate
      expect(canTransitionPayment(PaymentStatus.INITIATED, PaymentStatus.FAILED)).toBe(true);
      expect(canTransitionPayment(PaymentStatus.PENDING, PaymentStatus.SUCCEEDED)).toBe(true);
      expect(canTransitionPayment(PaymentStatus.PENDING, PaymentStatus.FAILED)).toBe(true);
      expect(canTransitionPayment(PaymentStatus.PENDING, PaymentStatus.CANCELLED)).toBe(true);
      expect(canTransitionPayment(PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDED)).toBe(true);
      expect(canTransitionPayment(PaymentStatus.SUCCEEDED, PaymentStatus.PARTIALLY_REFUNDED)).toBe(true);
      expect(canTransitionPayment(PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED)).toBe(true);
    });
    it('transitions interdites', () => {
      expect(canTransitionPayment(PaymentStatus.FAILED, PaymentStatus.SUCCEEDED)).toBe(false); // un échec ne se rattrape pas
      expect(canTransitionPayment(PaymentStatus.CANCELLED, PaymentStatus.PENDING)).toBe(false);
      expect(canTransitionPayment(PaymentStatus.REFUNDED, PaymentStatus.SUCCEEDED)).toBe(false);
      expect(canTransitionPayment(PaymentStatus.SUCCEEDED, PaymentStatus.PENDING)).toBe(false);
      expect(canTransitionPayment(PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.PARTIALLY_REFUNDED)).toBe(false);
      for (const s of Object.values(PaymentStatus)) {
        expect(canTransitionPayment(s, s)).toBe(false);
      }
    });
    it('statuts terminaux : SUCCEEDED/FAILED/CANCELLED/REFUNDED sauf déboursement refunds', () => {
      expect(FINAL_PAYMENT_STATUSES).toEqual([
        PaymentStatus.SUCCEEDED,
        PaymentStatus.FAILED,
        PaymentStatus.CANCELLED,
        PaymentStatus.REFUNDED,
      ]);
      for (const to of Object.values(PaymentStatus)) {
        expect(canTransitionPayment(PaymentStatus.FAILED, to)).toBe(false);
        expect(canTransitionPayment(PaymentStatus.CANCELLED, to)).toBe(false);
        expect(canTransitionPayment(PaymentStatus.REFUNDED, to)).toBe(false);
      }
      // SUCCEEDED est « terminal » pour le flux entrant mais peut encore refunder
      expect(ORDER_TRANSITIONS[OrderStatus.PAID].length).toBeGreaterThan(0);
    });
    it('la table couvre tous les statuts de l’enum', () => {
      expect(Object.keys(PAYMENT_TRANSITIONS).sort()).toEqual(Object.values(PaymentStatus).sort());
    });
  });
});

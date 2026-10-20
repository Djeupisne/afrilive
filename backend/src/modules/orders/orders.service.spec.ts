import { OrderStatus, ProductStatus } from '@prisma/client';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { OrdersService } from './orders.service';
import type { CartView } from './cart.service';

/**
 * Spec unitaire commandes : PrismaService mocké, $transaction exécuté avec un
 * client simulé. Vérifie la comptabilité entière (fee 2,5 %, TVA pays), le
 * coupon, l'allocation de stock et les transitions défendues.
 */
const BUYER = { id: 'u-buyer', role: 'USER' };
const SELLER = { id: 'u-seller', role: 'SELLER' };

function makeMocks() {
  const tx = {
    order: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
    orderStatusHistory: { create: jest.fn() },
    orderItem: { findMany: jest.fn() },
    productVariant: { findUnique: jest.fn() },
    product: { update: jest.fn() },
    stockItem: { findMany: jest.fn(), update: jest.fn() },
    stockReservation: { create: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    coupon: { update: jest.fn() },
    cartItem: { deleteMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    order: { findUnique: jest.fn(), findMany: jest.fn() },
    cartItem: { findFirst: jest.fn() },
    shop: { findUnique: jest.fn() },
    coupon: { findFirst: jest.fn() },
  };
  const service = new OrdersService(prisma as never);
  return { prisma, tx, service };
}

const cartView = (overrides: Partial<CartView> = {}): CartView => ({
  currency: 'XOF',
  items: [
    {
      id: 'ci-1', variantId: 'v-1', quantity: 2, productId: 'p-1', title: 'T-shirt',
      productStatus: ProductStatus.ACTIVE, sku: 'SKU-1', unitPriceMinor: 5_000,
      currency: 'XOF', available: 10, lineTotalMinor: 10_000, issue: null,
    },
  ],
  subtotalMinor: 10_000,
  itemCount: 2,
  payable: true,
  ...overrides,
});

const checkoutDto = (extra: Record<string, unknown> = {}) =>
  ({ shippingAddress: { fullName: 'A', phone: '+22507000000', city: 'Abidjan' }, countryCode: 'CI', ...extra }) as never;

/** Câble les mocks pour un checkout nominal (boutique ACTIVE, stock OK). */
function wireCheckout(
  mocks: Pick<ReturnType<typeof makeMocks>, 'prisma' | 'tx'>,
  createdOrder = { id: 'o-1' },
) {
  const { prisma, tx } = mocks;
  prisma.cartItem.findFirst.mockResolvedValue({ variant: { product: { shopId: 's-1', currency: 'XOF' } } });
  prisma.shop.findUnique.mockResolvedValue({ id: 's-1', status: 'ACTIVE', countryCode: 'CI', ownerId: 'u-seller' });
  prisma.order.findUnique.mockResolvedValue({ ...createdOrder, buyerId: 'u-buyer', shopId: 's-1', status: OrderStatus.PENDING, items: [], history: [] });
  tx.order.findUnique.mockResolvedValue(null); // pas de collision de numéro
  tx.order.create.mockResolvedValue(createdOrder);
  tx.stockItem.findMany.mockResolvedValue([{ id: 'st-1', warehouseId: 'w-1', quantity: 10, reserved: 0 }]);
  tx.stockReservation.create.mockResolvedValue({});
  return createdOrder;
}

describe('OrdersService.createFromCart — comptabilité', () => {
  it('panier vide → CART_EMPTY', async () => {
    const { service } = makeMocks();
    await expect(service.createFromCart(BUYER, cartView({ items: [], payable: false }), checkoutDto())).rejects.toMatchObject({
      code: ERROR_CODES.CART_EMPTY,
    });
  });

  it('ligne non commandable → OUT_OF_STOCK', async () => {
    const view = cartView({ payable: false, items: [{ ...cartView().items[0], issue: 'rupture de stock', available: 0 }] });
    const { service } = makeMocks();
    await expect(service.createFromCart(BUYER, view, checkoutDto())).rejects.toMatchObject({ code: ERROR_CODES.OUT_OF_STOCK });
  });

  it('boutique inactive → SHOP_NOT_VERIFIED', async () => {
    const { prisma, service } = makeMocks();
    prisma.cartItem.findFirst.mockResolvedValue({ variant: { product: { shopId: 's-1', currency: 'XOF' } } });
    prisma.shop.findUnique.mockResolvedValue({ id: 's-1', status: 'SUSPENDED', countryCode: 'CI' });
    await expect(service.createFromCart(BUYER, cartView(), checkoutDto())).rejects.toMatchObject({ code: ERROR_CODES.SHOP_NOT_VERIFIED });
  });

  it('frais plateforme 2,5 % + TVA CI 17,5 % en entiers stricts', async () => {
    const { prisma, tx, service } = makeMocks();
    wireCheckout({ prisma, tx });
    await service.createFromCart(BUYER, cartView(), checkoutDto());
    const data = tx.order.create.mock.calls[0][0].data;
    expect(data.subtotalMinor).toBe(10_000);
    expect(data.feeMinor).toBe(250); // floor(10000*250/10000)
    expect(data.taxMinor).toBe(1_793); // floor(10000*1750/10000)
    expect(data.totalMinor).toBe(12_043);
    expect(data.status).toBe(OrderStatus.PENDING);
    expect(data.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60 * 1000);
  });

  it('pas de TVA hors zone TVA (GH)', async () => {
    const { prisma, tx, service } = makeMocks();
    wireCheckout({ prisma, tx });
    await service.createFromCart(BUYER, cartView(), checkoutDto({ countryCode: 'GH' }));
    const data = tx.order.create.mock.calls[0][0].data;
    expect(data.taxMinor).toBe(0);
    expect(data.totalMinor).toBe(10_250);
  });

  it('coupon PERCENT borné : remise déduite avant TVA, usedCount incrémenté', async () => {
    const { prisma, tx, service } = makeMocks();
    wireCheckout({ prisma, tx });
    prisma.coupon.findFirst.mockResolvedValue({
      id: 'cp-1', type: 'PERCENT', value: 10, minOrderMinor: 5_000, maxUses: 100, usedCount: 3,
      startsAt: new Date('2026-01-01'), endsAt: new Date('2027-01-01'), active: true,
    });
    await service.createFromCart(BUYER, cartView(), checkoutDto({ couponCode: 'BIENVENUE' }));
    const data = tx.order.create.mock.calls[0][0].data;
    expect(data.discountMinor).toBe(1_000);
    expect(data.taxMinor).toBe(Math.floor((10_000 - 1_000) * 1750 / 10_000)); // TVA sur base HT remise + port
    expect(data.couponId).toBe('cp-1');
    expect(tx.coupon.update).toHaveBeenCalledWith({ where: { id: 'cp-1' }, data: { usedCount: { increment: 1 } } });
  });

  it('coupon expiré → VALIDATION_FAILED', async () => {
    const { prisma, tx, service } = makeMocks();
    wireCheckout({ prisma, tx });
    prisma.coupon.findFirst.mockResolvedValue({
      id: 'cp-1', type: 'PERCENT', value: 10, minOrderMinor: 0, maxUses: null, usedCount: 0,
      startsAt: new Date('2025-01-01'), endsAt: new Date('2025-06-01'), active: true,
    });
    await expect(service.createFromCart(BUYER, cartView(), checkoutDto({ couponCode: 'OLD' }))).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  });

  it('stock épuisé pendant l’allocation → OUT_OF_STOCK (réservation incomplète)', async () => {
    const { prisma, tx, service } = makeMocks();
    wireCheckout({ prisma, tx });
    tx.stockItem.findMany.mockResolvedValue([{ id: 'st-1', warehouseId: 'w-1', quantity: 3, reserved: 2 }]); // dispo 1 < 2
    await expect(service.createFromCart(BUYER, cartView(), checkoutDto())).rejects.toMatchObject({ code: ERROR_CODES.OUT_OF_STOCK });
  });

  it('idempotencyKey déjà utilisée → commande existante, aucune création', async () => {
    const { prisma, tx, service } = makeMocks();
    prisma.order.findUnique.mockResolvedValue({ id: 'o-existing', buyerId: 'u-buyer', shopId: 's-1', status: OrderStatus.PENDING, items: [], history: [] });
    prisma.cartItem.findFirst.mockResolvedValue({ variant: { product: { shopId: 's-1', currency: 'XOF' } } });
    prisma.shop.findUnique.mockResolvedValue({ id: 's-1', status: 'ACTIVE', countryCode: 'CI', ownerId: 'u-seller' });
    await service.createFromCart(BUYER, cartView(), checkoutDto({ idempotencyKey: 'key-1' }));
    expect(tx.order.create).not.toHaveBeenCalled();
  });
});

describe('OrdersService.transitions', () => {
  const pendingOrder = { id: 'o-1', status: OrderStatus.PENDING, buyerId: 'u-buyer', shopId: 's-1' };

  it('cancel par l’acheteur (PENDING) → CANCELLED + libération des réservations', async () => {
    const { prisma, tx, service } = makeMocks();
    prisma.order.findUnique.mockResolvedValue(pendingOrder);
    tx.stockReservation.findMany.mockResolvedValue([
      { id: 'r-1', variantId: 'v-1', warehouseId: 'w-1', quantity: 2, status: 'ACTIVE' },
    ]);
    await service.cancel('o-1', BUYER);
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: 'o-1' }, data: { status: OrderStatus.CANCELLED } });
    expect(tx.stockItem.update).toHaveBeenCalledWith({
      where: { variantId_warehouseId: { variantId: 'v-1', warehouseId: 'w-1' } },
      data: { reserved: { decrement: 2 } },
    });
    expect(tx.stockReservation.update).toHaveBeenCalledWith({ where: { id: 'r-1' }, data: { status: 'RELEASED' } });
  });

  it('cancel par un tiers → NOT_FOUND (403)', async () => {
    const { prisma, service } = makeMocks();
    prisma.order.findUnique.mockResolvedValue(pendingOrder);
    prisma.shop.findUnique.mockResolvedValue({ ownerId: 'u-autre' });
    await expect(service.cancel('o-1', { id: 'u-x', role: 'USER' })).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
  });

  it('transition interdite SHIPPED→PAID → ORDER_INVALID_TRANSITION', async () => {
    const { prisma, service } = makeMocks();
    prisma.order.findUnique.mockResolvedValue({ ...pendingOrder, status: OrderStatus.SHIPPED });
    prisma.shop.findUnique.mockResolvedValue({ ownerId: 'u-seller' });
    await expect(service.transition('o-1', OrderStatus.PAID, SELLER)).rejects.toMatchObject({
      code: ERROR_CODES.ORDER_INVALID_TRANSITION,
    });
  });

  it('markPaid idempotent : déjà PAID → retour sans transaction', async () => {
    const { prisma, tx, service } = makeMocks();
    prisma.order.findUnique.mockResolvedValue({ ...pendingOrder, status: OrderStatus.PAID });
    await service.markPaid('o-1', 'u-buyer');
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('markPaid depuis PENDING commit les réservations et incrémente soldCount', async () => {
    const { prisma, tx, service } = makeMocks();
    prisma.order.findUnique
      .mockResolvedValueOnce(pendingOrder)
      .mockResolvedValue({ ...pendingOrder, status: OrderStatus.PAID, items: [], history: [] });
    tx.stockReservation.findMany.mockResolvedValue([
      { id: 'r-1', variantId: 'v-1', warehouseId: 'w-1', quantity: 2, status: 'ACTIVE' },
    ]);
    tx.orderItem.findMany.mockResolvedValue([{ variantId: 'v-1', quantity: 2 }]);
    tx.productVariant.findUnique.mockResolvedValue({ productId: 'p-1' });
    await service.markPaid('o-1', 'u-buyer');
    expect(tx.stockItem.update).toHaveBeenCalledWith({
      where: { variantId_warehouseId: { variantId: 'v-1', warehouseId: 'w-1' } },
      data: { quantity: { decrement: 2 }, reserved: { decrement: 2 } },
    });
    expect(tx.product.update).toHaveBeenCalledWith({ where: { id: 'p-1' }, data: { soldCount: { increment: 2 } } });
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: 'o-1' }, data: { status: OrderStatus.PAID } });
  });

  it('transition par un vendeur d’une autre boutique → refusée', async () => {
    const { prisma, service } = makeMocks();
    prisma.order.findUnique.mockResolvedValue(pendingOrder);
    prisma.shop.findUnique.mockResolvedValue({ ownerId: 'u-seller' });
    await expect(service.transition('o-1', OrderStatus.CANCELLED, { id: 'u-pirate', role: 'SELLER' })).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });
});

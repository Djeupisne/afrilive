import { ProductStatus } from '@prisma/client';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { CartService } from './cart.service';

/**
 * Spec unitaire panier : PrismaService mocké directement. Le panier est une
 * vue recalculée à chaque lecture (jamais une vérité comptable).
 */
function makeMocks() {
  const prisma = {
    cart: { findUnique: jest.fn(), upsert: jest.fn() },
    cartItem: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn(), create: jest.fn(), delete: jest.fn(), count: jest.fn() },
    productVariant: { findUnique: jest.fn() },
  };
  const service = new CartService(prisma as never);
  return { prisma, service };
}

const line = (overrides: Record<string, unknown> = {}) => ({
  id: 'ci-1',
  variantId: 'v-1',
  quantity: 2,
  createdAt: new Date('2026-01-01'),
  variant: {
    id: 'v-1',
    sku: 'SKU-1',
    priceMinor: 5_000,
    salePriceMinor: null,
    product: { id: 'p-1', title: 'T-shirt', status: ProductStatus.ACTIVE, deletedAt: null, currency: 'XOF' },
    stockItems: [{ quantity: 10, reserved: 3 }],
  },
  ...overrides,
});

describe('CartService.getCart (vue enrichie)', () => {
  it('panier inexistant → vue vide non commandable', async () => {
    const { prisma, service } = makeMocks();
    prisma.cart.findUnique.mockResolvedValue(null);
    const view = await service.getCart('u-1');
    expect(view).toEqual({ currency: 'XOF', items: [], subtotalMinor: 0, itemCount: 0, payable: false });
  });

  it('calcule prix effectif (salePrice prioritaire), sous-total et disponibilité', async () => {
    const { prisma, service } = makeMocks();
    prisma.cart.findUnique.mockResolvedValue({
      id: 'c-1',
      currency: 'XOF',
      items: [line({ variant: { ...line().variant, salePriceMinor: 4_200 } })],
    });
    const view = await service.getCart('u-1');
    expect(view.items[0].unitPriceMinor).toBe(4_200);
    expect(view.items[0].available).toBe(7); // 10 - 3 réservés
    expect(view.subtotalMinor).toBe(8_400);
    expect(view.itemCount).toBe(2);
    expect(view.payable).toBe(true);
  });

  it('marque une rupture de stock et bloque la commande (sous-total l’ignore)', async () => {
    const { prisma, service } = makeMocks();
    prisma.cart.findUnique.mockResolvedValue({
      id: 'c-1',
      currency: 'XOF',
      items: [
        line(),
        line({
          id: 'ci-2',
          variantId: 'v-2',
          variant: {
            ...line().variant,
            id: 'v-2',
            sku: 'SKU-2',
            stockItems: [{ quantity: 2, reserved: 2 }],
          },
        }),
      ],
    });
    const view = await service.getCart('u-1');
    expect(view.items[1].issue).toBe('rupture de stock');
    expect(view.subtotalMinor).toBe(10_000); // seule la ligne saine compte
    expect(view.payable).toBe(false);
  });

  it('quantité supérieure au stock dispo → issue "stock insuffisant"', async () => {
    const { prisma, service } = makeMocks();
    prisma.cart.findUnique.mockResolvedValue({ id: 'c-1', currency: 'XOF', items: [line({ quantity: 8 })] });
    const view = await service.getCart('u-1');
    expect(view.items[0].issue).toContain('stock insuffisant');
    expect(view.payable).toBe(false);
  });

  it('produit archivé ou supprimé → ligne non commandable', async () => {
    const { prisma, service } = makeMocks();
    prisma.cart.findUnique.mockResolvedValue({
      id: 'c-1',
      currency: 'XOF',
      items: [
        line({ variant: { ...line().variant, product: { ...line().variant.product, status: ProductStatus.ARCHIVED } } }),
        line({ id: 'ci-2', variant: { ...line().variant, id: 'v-2', product: { ...line().variant.product, deletedAt: new Date() } } }),
      ],
    });
    const view = await service.getCart('u-1');
    expect(view.items[0].issue).toBe('produit archivé');
    expect(view.items[1].issue).toBe('produit supprimé');
    expect(view.payable).toBe(false);
  });

  it('devises mélangées → payable=false même si tout est en stock', async () => {
    const { prisma, service } = makeMocks();
    prisma.cart.findUnique.mockResolvedValue({
      id: 'c-1',
      currency: 'XOF',
      items: [
        line(),
        line({ id: 'ci-2', variant: { ...line().variant, id: 'v-2', product: { ...line().variant.product, currency: 'GHS' } } }),
      ],
    });
    const view = await service.getCart('u-1');
    expect(view.payable).toBe(false);
  });
});

describe('CartService.addItem', () => {
  it('variante inconnue → 404', async () => {
    const { prisma, service } = makeMocks();
    prisma.productVariant.findUnique.mockResolvedValue(null);
    await expect(service.addItem('u-1', { variantId: 'nope' } as never)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });

  it('incrémente la quantité d’une ligne existante', async () => {
    const { prisma, service } = makeMocks();
    prisma.productVariant.findUnique.mockResolvedValue(line().variant);
    prisma.cart.upsert.mockResolvedValue({ id: 'c-1' });
    prisma.cartItem.findUnique.mockResolvedValue({ id: 'ci-1', quantity: 2 });
    prisma.cart.findUnique.mockResolvedValue({ id: 'c-1', currency: 'XOF', items: [] });
    await service.addItem('u-1', { variantId: 'v-1', quantity: 3 } as never);
    expect(prisma.cartItem.update).toHaveBeenCalledWith({ where: { id: 'ci-1' }, data: { quantity: 5 } });
  });

  it('refuse au-delà de 50 lignes distinctes', async () => {
    const { prisma, service } = makeMocks();
    prisma.productVariant.findUnique.mockResolvedValue(line().variant);
    prisma.cart.upsert.mockResolvedValue({ id: 'c-1' });
    prisma.cartItem.findUnique.mockResolvedValue(null);
    prisma.cartItem.count.mockResolvedValue(50);
    await expect(service.addItem('u-1', { variantId: 'v-1' } as never)).rejects.toBeDefined();
    expect(prisma.cartItem.create).not.toHaveBeenCalled();
  });
});

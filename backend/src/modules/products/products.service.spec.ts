import { Category, ProductStatus, Role } from '@prisma/client';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { ProductsService } from './products.service';
import type { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';

/** Liste de requêtes de pagination : limit imposé par le DTO, le reste optionnel. */
const listQuery = (extra: Partial<CursorPaginationQueryDto> = {}) =>
  ({ limit: 20, ...extra }) as Parameters<ProductsService['list']>[0];

/**
 * Spec unitaire catalogue : PrismaService mocké directement.
 */
function makeMocks() {
  const prisma = {
    product: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    productVariant: {
      findUnique: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    productMedia: {
      create: jest.fn(),
    },
    stockItem: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    warehouse: {
      findFirst: jest.fn(),
    },
    shop: {
      findUnique: jest.fn(),
    },
  };
  const service = new ProductsService(prisma as never);
  return { prisma, service };
}

const seller = { id: 'u1', role: Role.SELLER };
const shopOwned = { id: 's1', slug: 'ali', ownerId: 'u1', currency: 'XOF' };

describe('products — création', () => {
  it('crée en DRAFT avec la devise de la boutique par défaut', async () => {
    const { service, prisma } = makeMocks();
    prisma.shop.findUnique.mockResolvedValue(shopOwned);
    prisma.product.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve(data),
    );

    const created = await service.create(seller, 's1', {
      title: 'Robe wax',
      category: Category.FASHION,
      basePriceMinor: 15000,
    });

    expect(created).toMatchObject({ status: ProductStatus.DRAFT, currency: 'XOF', basePriceMinor: 15000 });
  });

  it('refuse une devise différente de celle de la boutique', async () => {
    const { service, prisma } = makeMocks();
    prisma.shop.findUnique.mockResolvedValue(shopOwned);

    await expect(
      service.create(seller, 's1', {
        title: 'Robe',
        category: Category.FASHION,
        basePriceMinor: 15000,
        currency: 'NGN',
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('interdit la création sur la boutique d\'autrui', async () => {
    const { service, prisma } = makeMocks();
    prisma.shop.findUnique.mockResolvedValue({ ...shopOwned, ownerId: 'autre' });

    await expect(
      service.create(seller, 's1', {
        title: 'Robe',
        category: Category.FASHION,
        basePriceMinor: 100,
      }),
    ).rejects.toThrow();
  });
});

describe('products — transitions de statut', () => {
  const ownedProduct = (status: ProductStatus) => ({
    id: 'p1',
    status,
    shop: { id: 's1', ownerId: 'u1' },
  });

  it('DRAFT → ACTIVE autorisé si variante existante', async () => {
    const { service, prisma } = makeMocks();
    prisma.product.findFirst.mockResolvedValue(ownedProduct(ProductStatus.DRAFT));
    prisma.productVariant.count.mockResolvedValue(1);
    prisma.product.update.mockResolvedValue({ id: 'p1', status: ProductStatus.ACTIVE });

    const res = await service.setStatus(seller, 'p1', ProductStatus.ACTIVE);

    expect(res.status).toBe(ProductStatus.ACTIVE);
  });

  it('ACTIVE sans variante refusé (422)', async () => {
    const { service, prisma } = makeMocks();
    prisma.product.findFirst.mockResolvedValue(ownedProduct(ProductStatus.DRAFT));
    prisma.productVariant.count.mockResolvedValue(0);

    await expect(service.setStatus(seller, 'p1', ProductStatus.ACTIVE)).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
    });
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('ARCHIVED est définitif (toute sortie interdite)', async () => {
    const { service, prisma } = makeMocks();
    prisma.product.findFirst.mockResolvedValue(ownedProduct(ProductStatus.ARCHIVED));

    await expect(service.setStatus(seller, 'p1', ProductStatus.ACTIVE)).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
  });

  it('DRAFT → OUT_OF_STOCK interdit (arête absente du graphe)', async () => {
    const { service, prisma } = makeMocks();
    prisma.product.findFirst.mockResolvedValue(ownedProduct(ProductStatus.DRAFT));

    await expect(service.setStatus(seller, 'p1', ProductStatus.OUT_OF_STOCK)).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
  });

  it('OUT_OF_STOCK → ACTIVE réautorisé', async () => {
    const { service, prisma } = makeMocks();
    prisma.product.findFirst.mockResolvedValue(ownedProduct(ProductStatus.OUT_OF_STOCK));
    prisma.productVariant.count.mockResolvedValue(2);
    prisma.product.update.mockResolvedValue({ id: 'p1', status: ProductStatus.ACTIVE });

    const res = await service.setStatus(seller, 'p1', ProductStatus.ACTIVE);
    expect(res.status).toBe(ProductStatus.ACTIVE);
  });
});

describe('products — variantes / SKU', () => {
  it('normalise le SKU en majuscules', async () => {
    const { service, prisma } = makeMocks();
    prisma.product.findFirst.mockResolvedValue({ id: 'p1', status: 'DRAFT', shop: { ownerId: 'u1' } });
    prisma.productVariant.findUnique.mockResolvedValue(null);
    prisma.productVariant.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve(data),
    );

    const v = await service.addVariant(seller, 'p1', { sku: 'robe-m-rouge', priceMinor: 12000 });

    expect(v.sku).toBe('ROBE-M-ROUGE');
  });

  it('conflit de SKU → 409', async () => {
    const { service, prisma } = makeMocks();
    prisma.product.findFirst.mockResolvedValue({ id: 'p1', shop: { ownerId: 'u1' } });
    prisma.productVariant.findUnique.mockResolvedValue({ id: 'other' });

    await expect(
      service.addVariant(seller, 'p1', { sku: 'ABC', priceMinor: 100 }),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
  });

  it('course race P2002 à la création → 409', async () => {
    const { service, prisma } = makeMocks();
    prisma.product.findFirst.mockResolvedValue({ id: 'p1', shop: { ownerId: 'u1' } });
    prisma.productVariant.findUnique.mockResolvedValue(null);
    prisma.productVariant.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.addVariant(seller, 'p1', { sku: 'ABC', priceMinor: 100 }),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
  });
});

describe('products — médias', () => {
  it('crée une ligne par clé en positions séquentielles', async () => {
    const { service, prisma } = makeMocks();
    prisma.product.findFirst.mockResolvedValue({ id: 'p1', shop: { ownerId: 'u1' } });
    prisma.productMedia.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve(data),
    );

    const rows = await service.addMedia(seller, 'p1', { keys: ['a.jpg', 'b.jpg', 'c.jpg'], startPosition: 2 });

    expect(rows.map((r: { position: number }) => r.position)).toEqual([2, 3, 4]);
    expect(prisma.productMedia.create).toHaveBeenCalledTimes(3);
  });
});

describe('products — stock (delta vs réservé)', () => {
  const variantCtx = { id: 'v1', product: { shopId: 's1' } };

  it('upsert incrémental positif : renvoie quantity/reserved/available', async () => {
    const { service, prisma } = makeMocks();
    prisma.productVariant.findUnique.mockResolvedValue(variantCtx);
    prisma.shop.findUnique.mockResolvedValue(shopOwned);
    prisma.warehouse.findFirst.mockResolvedValue({ id: 'w1' });
    prisma.stockItem.findUnique.mockResolvedValue({ quantity: 10, reserved: 3, lowStockThreshold: 5 });
    prisma.stockItem.upsert.mockImplementation(({ update }: { update: { quantity: { increment: number } } }) =>
      Promise.resolve({ quantity: 10 + update.quantity.increment, reserved: 3 }),
    );

    const res = await service.adjustStock(seller, 'v1', 'w1', { delta: 5 });

    expect(res).toEqual({ variantId: 'v1', warehouseId: 'w1', quantity: 15, reserved: 3, available: 12 });
  });

  it('retrait refusé si solde < réservé → OUT_OF_STOCK', async () => {
    const { service, prisma } = makeMocks();
    prisma.productVariant.findUnique.mockResolvedValue(variantCtx);
    prisma.shop.findUnique.mockResolvedValue(shopOwned);
    prisma.warehouse.findFirst.mockResolvedValue({ id: 'w1' });
    prisma.stockItem.findUnique.mockResolvedValue({ quantity: 4, reserved: 3 });

    await expect(service.adjustStock(seller, 'v1', 'w1', { delta: -2 })).rejects.toMatchObject({
      code: ERROR_CODES.OUT_OF_STOCK,
    });
    expect(prisma.stockItem.upsert).not.toHaveBeenCalled();
  });

  it('entrepôt d\'une autre boutique → 404', async () => {
    const { service, prisma } = makeMocks();
    prisma.productVariant.findUnique.mockResolvedValue(variantCtx);
    prisma.shop.findUnique.mockResolvedValue(shopOwned);
    prisma.warehouse.findFirst.mockResolvedValue(null);

    await expect(service.adjustStock(seller, 'v1', 'w-other', { delta: 1 })).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });
});

describe('products — list (curseur keyset)', () => {
  it('limite à `limit` et émet nextCursor quand hasMore', async () => {
    const { service, prisma } = makeMocks();
    prisma.product.findMany.mockResolvedValue([
      { id: 'p3' }, { id: 'p2' }, { id: 'p1' }, // tri desc par id
    ]);

    const res = await service.list({ limit: 2 });

    expect(res.items).toHaveLength(2);
    expect(res.meta.hasMore).toBe(true);
    expect(res.meta.nextCursor).toBeTruthy();
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3, where: expect.objectContaining({ status: ProductStatus.ACTIVE }) }),
    );
  });

  it('dernière page : hasMore=false et nextCursor=null', async () => {
    const { service, prisma } = makeMocks();
    prisma.product.findMany.mockResolvedValue([{ id: 'p1' }]);

    const res = await service.list({ limit: 20 });

    expect(res.meta).toEqual({ nextCursor: null, hasMore: false });
  });

  it('exclut les produits soft-deleted', async () => {
    const { service, prisma } = makeMocks();
    prisma.product.findMany.mockResolvedValue([]);

    await service.list(listQuery());

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
  });
});

describe('products — suppression logique', () => {
  it('marque deletedAt sans suppression physique', async () => {
    const { service, prisma } = makeMocks();
    prisma.product.findFirst.mockResolvedValue({ id: 'p1', shop: { ownerId: 'u1' } });
    prisma.product.update.mockResolvedValue({ id: 'p1' });

    const res = await service.remove(seller, 'p1');

    expect(res).toEqual({ id: 'p1', deleted: true });
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
    );
  });
});

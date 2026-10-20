import { Role } from '@prisma/client';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { ShopsService, slugify } from './shops.service';

/**
 * Spec unitaire boutiques : PrismaService / RedisService / StorageService sont
 * mockés directement (même pattern que users.service.spec.ts).
 */
function makeMocks() {
  const prisma = {
    shop: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const redis = {
    getJson: jest.fn(),
    setJson: jest.fn(),
    del: jest.fn(),
  };
  const storage = {
    presignPut: jest.fn(),
    publicUrl: jest.fn(),
  };
  const service = new ShopsService(
    prisma as never,
    redis as never,
    storage as never,
  );
  return { prisma, redis, storage, service };
}

const seller = { id: 'u1', role: Role.SELLER };
const admin = { id: 'staff1', role: Role.ADMIN };

describe('shops — slugify', () => {
  it('normalise diacritiques, casse et séparateurs', () => {
    expect(slugify('Épicerie Générale!')).toBe('epicerie-generale');
    expect(slugify('  Multi   Spaces  ')).toBe('multi-spaces');
    expect(slugify('***')).toBe('');
  });

  it('tronque à 60 caractères sans tiret traînant', () => {
    const long = slugify('a'.repeat(80));
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long).not.toMatch(/-$/);
  });
});

describe('shops — create', () => {
  it('refuse un rôle non vendeur (USER)', async () => {
    const { service } = makeMocks();
    await expect(
      service.create({ id: 'u9', role: Role.USER }, { name: 'Ma boutique' }),
    ).rejects.toThrow(expect.objectContaining({ code: expect.any(String) }));
  });

  it('refuse une deuxième boutique pour le même utilisateur', async () => {
    const { service, prisma } = makeMocks();
    prisma.shop.findUnique.mockResolvedValue({ id: 'shop-existing' }); // ownerId déjà pris
    await expect(service.create(seller, { name: 'Seconde' })).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
    expect(prisma.shop.create).not.toHaveBeenCalled();
  });

  it('rejette un slug réservé', async () => {
    const { service, prisma } = makeMocks();
    prisma.shop.findUnique.mockResolvedValue(null); // pas de boutique existante
    await expect(service.create(seller, { name: 'X', slug: 'admin' })).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  });

  it('génère le slug depuis le nom et suffixe jusqu\'à unicité', async () => {
    const { service, prisma } = makeMocks();
    prisma.shop.findUnique
      .mockResolvedValueOnce(null) // findUnique ownerId → pas encore de boutique
      .mockResolvedValueOnce({ id: 'taken' }) // slug "ma-boutique" pris
      .mockResolvedValueOnce(null); // "ma-boutique-2" libre
    prisma.shop.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve(data),
    );

    const created = await service.create(seller, { name: 'Ma Boutique' });

    expect(created.slug).toBe('ma-boutique-2');
    expect(prisma.shop.create).toHaveBeenCalledTimes(1);
  });

  it('applique les valeurs par défaut pays/devise', async () => {
    const { service, prisma } = makeMocks();
    prisma.shop.findUnique.mockResolvedValue(null);
    prisma.shop.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve(data),
    );

    const created = await service.create(seller, { name: 'Bleuet' });

    expect(created).toMatchObject({ countryCode: 'CI', currency: 'XOF', description: '' });
  });
});

describe('shops — getBySlug (cache + masking)', () => {
  it('retourne le cache sans toucher Prisma', async () => {
    const { service, prisma, redis } = makeMocks();
    redis.getJson.mockResolvedValue({ id: 's1', slug: 'ali-store' });

    const shop = await service.getBySlug('Ali-Store');

    expect(redis.getJson).toHaveBeenCalledWith('shop:slug:ali-store'); // casse insensible
    expect(prisma.shop.findUnique).not.toHaveBeenCalled();
    expect(shop).toMatchObject({ id: 's1' });
  });

  it('charge, met en cache TTL 60 s et n\'expose jamais taxId', async () => {
    const { service, prisma, redis } = makeMocks();
    redis.getJson.mockResolvedValue(null);
    prisma.shop.findUnique.mockResolvedValue({ id: 's2', slug: 'koko', status: 'ACTIVE' });

    const shop = await service.getBySlug('koko');

    expect(redis.setJson).toHaveBeenCalledWith('shop:slug:koko', expect.objectContaining({ id: 's2' }), 60);
    expect(shop).not.toHaveProperty('taxId');
  });

  it('404 si boutique inconnue', async () => {
    const { service, prisma, redis } = makeMocks();
    redis.getJson.mockResolvedValue(null);
    prisma.shop.findUnique.mockResolvedValue(null);

    await expect(service.getBySlug('ghost')).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
  });
});

describe('shops — setStatus (garde owner/staff)', () => {
  it('le owner peut fermer (CLOSED) sa boutique', async () => {
    const { service, prisma, redis } = makeMocks();
    prisma.shop.findUnique.mockResolvedValue({ id: 's1', slug: 'ali', ownerId: 'u1', status: 'ACTIVE' });
    prisma.shop.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 's1', slug: 'ali', ...data }),
    );

    const res = await service.setStatus(seller, 's1', 'CLOSED');

    expect(res.status).toBe('CLOSED');
    expect(redis.del).toHaveBeenCalledWith('shop:slug:ali');
  });

  it('le owner ne peut PAS se suspendre lui-même', async () => {
    const { service, prisma } = makeMocks();
    prisma.shop.findUnique.mockResolvedValue({ id: 's1', slug: 'ali', ownerId: 'u1', status: 'ACTIVE' });

    await expect(service.setStatus(seller, 's1', 'SUSPENDED')).rejects.toThrow();
    expect(prisma.shop.update).not.toHaveBeenCalled();
  });

  it('le staff peut suspendre la boutique d\'autrui', async () => {
    const { service, prisma } = makeMocks();
    prisma.shop.findUnique.mockResolvedValue({ id: 's1', slug: 'ali', ownerId: 'u1', status: 'ACTIVE' });
    prisma.shop.update.mockResolvedValue({ id: 's1', slug: 'ali', status: 'SUSPENDED' });

    const res = await service.setStatus(admin, 'ali', 'SUSPENDED'); // résolution par slug

    expect(res.status).toBe('SUSPENDED');
  });

  it('statut inconnu → erreur de validation', async () => {
    const { service } = makeMocks();
    await expect(service.setStatus(admin, 's1', 'DESTROYED')).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  });

  it('tiers non-staff → interdit', async () => {
    const { service, prisma } = makeMocks();
    prisma.shop.findUnique.mockResolvedValue({ id: 's1', slug: 'ali', ownerId: 'u1', status: 'ACTIVE' });

    await expect(
      service.setStatus({ id: 'u2', role: Role.SELLER }, 's1', 'CLOSED'),
    ).rejects.toThrow();
  });
});

describe('shops — assertSellable (garde vente)', () => {
  it('passe si boutique ACTIVE et KYC APPROVED', async () => {
    const { service, prisma } = makeMocks();
    prisma.shop.findUnique.mockResolvedValue({ status: 'ACTIVE', owner: { kycStatus: 'APPROVED' } });

    await expect(service.assertSellable('s1')).resolves.toBeUndefined();
  });

  it('SHOP_NOT_VERIFIED si KYC pending', async () => {
    const { service, prisma } = makeMocks();
    prisma.shop.findUnique.mockResolvedValue({ status: 'ACTIVE', owner: { kycStatus: 'PENDING' } });

    await expect(service.assertSellable('s1')).rejects.toMatchObject({ code: ERROR_CODES.SHOP_NOT_VERIFIED });
  });

  it('SHOP_NOT_VERIFIED si boutique suspendue', async () => {
    const { service, prisma } = makeMocks();
    prisma.shop.findUnique.mockResolvedValue({ status: 'SUSPENDED', owner: { kycStatus: 'APPROVED' } });

    await expect(service.assertSellable('s1')).rejects.toMatchObject({ code: ERROR_CODES.SHOP_NOT_VERIFIED });
  });
});

describe('shops — updateByOwner', () => {
  it('met à jour puis invalide le cache slug', async () => {
    const { service, prisma, redis } = makeMocks();
    prisma.shop.findUnique.mockResolvedValue({ id: 's1', ownerId: 'u1', slug: 'ali' }); // getMine
    prisma.shop.update.mockResolvedValue({ id: 's1', slug: 'ali', name: 'Nouveau nom' });

    const updated = await service.updateByOwner('u1', { name: 'Nouveau nom' });

    expect(updated.name).toBe('Nouveau nom');
    expect(redis.del).toHaveBeenCalledWith('shop:slug:ali');
  });

  it('404 si l\'utilisateur na pas de boutique', async () => {
    const { service, prisma } = makeMocks();
    prisma.shop.findUnique.mockResolvedValue(null);

    await expect(service.updateByOwner('u1', { name: 'X' })).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
  });
});

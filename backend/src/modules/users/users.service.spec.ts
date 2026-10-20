import { UsersService, maskEmail, maskPhone } from './users.service';

/**
 * Spec unitaire du module users : on mocke PrismaService et RedisService
 * (aucune dépendance NestJS runtime hormis les erreurs métier maison).
 */
function makeMocks() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    userSettings: {
      upsert: jest.fn(),
    },
    follow: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    block: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const redis = {
    getJson: jest.fn(),
    setJson: jest.fn(),
    del: jest.fn(),
  };
  return { prisma, redis, service: new UsersService(prisma as never, redis as never) };
}

describe('users — masquage PII', () => {
  it('maskPhone conserve la tête et les 3 derniers chiffres', () => {
    expect(maskPhone('+2250712345678')).toBe('+2250712****678');
    expect(maskPhone('12345')).toBe('••••'); // trop court → entièrement masqué
  });

  it('maskEmail ne montre que la première lettre et le domaine', () => {
    expect(maskEmail('alice@example.com')).toBe('a***@example.com');
    expect(maskEmail('bad-email')).toBe('•••@•••');
  });
});

describe('users — getProfile (cache Redis)', () => {
  it('retourne le cache sans toucher Prisma', async () => {
    const { service, prisma, redis } = makeMocks();
    redis.getJson.mockResolvedValue({ id: 'u1', username: 'ali' });

    const profile = await service.getProfile('Ali');

    expect(redis.getJson).toHaveBeenCalledWith('user:profile:ali'); // casse insensible
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(profile).toMatchObject({ id: 'u1', viewerBlocked: false });
  });

  it('charge depuis Prisma, écrit le cache TTL 60s, et signale un blocage réciproque', async () => {
    const { service, prisma, redis } = makeMocks();
    redis.getJson.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({ id: 'u2', username: 'bob', status: 'ACTIVE' });
    prisma.block.findFirst.mockResolvedValue({ blockerId: 'u2' }); // bob a bloqué le viewer

    const profile = await service.getProfile('bob', 'viewer-1');

    expect(redis.setJson).toHaveBeenCalledWith(
      'user:profile:bob',
      expect.objectContaining({ id: 'u2' }),
      60,
    );
    expect(profile).toMatchObject({ viewerBlocked: true });
  });

  it('404 si utilisateur inexistant ou supprimé', async () => {
    const { service, prisma, redis } = makeMocks();
    redis.getJson.mockResolvedValue(null);
    prisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'u3', username: 'x', status: 'DELETED' });

    await expect(service.getProfile('ghost')).rejects.toMatchObject({ code: expect.anything() });
    await expect(service.getProfile('x')).rejects.toBeTruthy();
  });
});

describe('users — getMe (auto PII masking)', () => {
  it('masque téléphone et e-mail, retire deletedAt', async () => {
    const { service, prisma } = makeMocks();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      username: 'ali',
      phone: '+2250712345678',
      email: 'Ali@Example.com',
      deletedAt: null,
      settings: { userId: 'u1' },
      shop: null,
    });

    const me = (await service.getMe('u1')) as Record<string, unknown>;

    expect(me.phone).toBe('+2250712****678');
    expect(me.email).toBe('A***@Example.com');
    expect(me).not.toHaveProperty('deletedAt');
  });
});

describe('users — conflits d\'identité', () => {
  it('updateUsername refuse un username pris par un autre compte', async () => {
    const { service, prisma } = makeMocks();
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'me', username: 'old' }) // moi
      .mockResolvedValueOnce({ id: 'other', username: 'taken' }); // occupant

    await expect(service.updateUsername('me', 'taken')).rejects.toBeTruthy();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('updateUsername accepte de conserver son propre username', async () => {
    const { service, prisma, redis } = makeMocks();
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'me', username: 'old' })
      .mockResolvedValueOnce({ id: 'me', username: 'mine' });
    prisma.user.update.mockResolvedValue({ id: 'me', username: 'mine' });

    await expect(service.updateUsername('me', 'mine')).resolves.toMatchObject({ username: 'mine' });
    expect(redis.del).toHaveBeenCalledWith('user:profile:old');
  });

  it('addPhone refuse si un numéro est déjà rattaché', async () => {
    const { service, prisma } = makeMocks();
    prisma.user.findUnique.mockResolvedValue({ id: 'me', username: 'ali', phone: '+2250700000000' });

    await expect(service.addPhone('me', { phone: '+2250799999999' })).rejects.toBeTruthy();
  });

  it('addEmail normalise en minuscules et refuse les doublons', async () => {
    const { service, prisma } = makeMocks();
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'me', username: 'ali', email: null })
      .mockResolvedValueOnce({ id: 'other', email: 'a@b.com' });

    await expect(service.addEmail('me', { email: 'A@B.com' })).rejects.toBeTruthy();
    expect(prisma.user.findUnique).toHaveBeenLastCalledWith({ where: { email: 'a@b.com' } });
  });
});

describe('users — blocages', () => {
  it('block interdit l\'auto-blocage', async () => {
    const { service } = makeMocks();
    await expect(service.block('me', 'me')).rejects.toBeTruthy();
  });

  it('block upserte puis casse les follows dans les deux sens', async () => {
    const { service, prisma } = makeMocks();
    prisma.user.findUnique.mockResolvedValue({ id: 'them' });
    prisma.block.upsert.mockResolvedValue({});
    prisma.follow.deleteMany.mockResolvedValue({ count: 2 });

    await expect(service.block('me', 'them')).resolves.toEqual({ blocked: true });

    expect(prisma.block.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { blockerId_blockedId: { blockerId: 'me', blockedId: 'them' } } }),
    );
    expect(prisma.follow.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { followerId: 'me', followingId: 'them' },
          { followerId: 'them', followingId: 'me' },
        ],
      },
    });
  });

  it('isBlockedEitherWay détecte le blocage dans les deux sens', async () => {
    const { service, prisma } = makeMocks();
    prisma.block.findFirst.mockResolvedValue({ blockerId: 'b' });
    await expect(service.isBlockedEitherWay('a', 'b')).resolves.toBe(true);
    expect(prisma.block.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ blockerId: 'a', blockedId: 'b' }, { blockerId: 'b', blockedId: 'a' }] },
      select: { blockerId: true },
    });
  });
});

describe('users — pagination par curseur', () => {
  const enc = (o: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');

  it('listRelations limite à `limit`, expose nextCursor et hasMore', async () => {
    const { service, prisma } = makeMocks();
    const rows = Array.from({ length: 3 }, (_, i) => ({
      followerId: `f${i}`,
      follower: { id: `f${i}`, username: `u${i}` },
    }));
    prisma.follow.findMany.mockResolvedValue(rows);

    const page = await service.listRelations('target', 'followers', undefined, 2);

    expect(prisma.follow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3, orderBy: [{ followerId: 'desc' }] }),
    );
    expect(page.items).toHaveLength(2);
    expect(page.meta.hasMore).toBe(true);
    expect(page.meta.nextCursor).toBe(enc({ followerId: 'f1' }));
  });

  it('liste vide → hasMore faux et curseur nul', async () => {
    const { service, prisma } = makeMocks();
    prisma.follow.findMany.mockResolvedValue([]);

    const page = await service.listRelations('target', 'following', undefined, 20);

    expect(page.items).toEqual([]);
    expect(page.meta).toEqual({ nextCursor: null, hasMore: false });
  });
});

describe('users — paramètres & suppression', () => {
  it('updateSettings upserte la ligne UserSettings', async () => {
    const { service, prisma } = makeMocks();
    prisma.userSettings.upsert.mockResolvedValue({ userId: 'me', isPrivate: true });

    const out = await service.updateSettings('me', { isPrivate: true });

    expect(prisma.userSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'me' } }),
    );
    expect(out).toMatchObject({ isPrivate: true });
  });

  it('deactivate soft-delete et purge le cache profil', async () => {
    const { service, prisma, redis } = makeMocks();
    prisma.user.findUnique.mockResolvedValue({ id: 'me', username: 'Ali' });
    prisma.user.update.mockResolvedValue({});

    await expect(service.deactivate('me')).resolves.toEqual({ deactivated: true });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DELETED', deletedAt: expect.any(Date) }),
      }),
    );
    expect(redis.del).toHaveBeenCalledWith('user:profile:ali');
  });
});

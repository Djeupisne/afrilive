import {
  buildCursorArgs,
  decodeCursor,
  encodeCursor,
  offsetMeta,
  sliceCursorPage,
} from './pagination';

interface Row extends Record<string, unknown> {
  id: string;
  name?: string;
}

const rows = (ids: string[]): Row[] => ids.map((id) => ({ id }));

describe('pagination — curseur keyset', () => {
  describe('encode/decode aller-retour', () => {
    it('encode puis décode le même where', () => {
      const where = { createdAt: '2026-01-02T03:04:05.000Z', id: 'c_abc123' };
      const cursor = encodeCursor(where);
      expect(typeof cursor).toBe('string');
      // base64url : pas de +, / ni =
      expect(cursor).not.toMatch(/[+/=]/);
      expect(decodeCursor(cursor)).toEqual(where);
    });
    it('décode undefined → undefined', () => {
      expect(decodeCursor(undefined)).toBeUndefined();
    });
    it('curseur corrompu → undefined (pas d’exception)', () => {
      expect(decodeCursor('%%%pas-du-base64%%%')).toBeUndefined();
      expect(decodeCursor(Buffer.from('[1,2]', 'utf8').toString('base64url'))).toBeUndefined(); // tableau refusé
      expect(decodeCursor(Buffer.from('"juste-un-string"', 'utf8').toString('base64url'))).toBeUndefined();
    });
  });

  describe('buildCursorArgs', () => {
    it('take + orderBy toujours présents', () => {
      expect(buildCursorArgs({ take: 11, orderBy: { id: 'desc' } })).toEqual({
        take: 11,
        orderBy: { id: 'desc' },
      });
    });
    it('cursorWhere devient where ; select/include propagués', () => {
      const args = buildCursorArgs({
        take: -11,
        cursorWhere: { id: { gt: 'x' } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
        include: { items: true },
      });
      expect(args).toEqual({
        take: -11,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
        include: { items: true },
        where: { id: { gt: 'x' } },
      });
    });
  });

  describe('sliceCursorPage — aller (forward)', () => {
    it('page complète avec plus de lignes que limit → hasMore + nextCursor', () => {
      const page = sliceCursorPage(rows(['d', 'c', 'b', 'a']), 3, 'id');
      expect(page.items.map((r) => r.id)).toEqual(['d', 'c', 'b']);
      expect(page.hasMore).toBe(true);
      // curseur sur la dernière ligne affichée (ordre desc → « après » = lt)
      expect(decodeCursor(page.nextCursor as string)).toEqual({ id: 'b' });
    });
    it('page exacte sans surplus → dernière page', () => {
      const page = sliceCursorPage(rows(['c', 'b', 'a']), 3, 'id');
      expect(page.items).toHaveLength(3);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });
    it('page partielle → dernière page', () => {
      const page = sliceCursorPage(rows(['b', 'a']), 3, 'id');
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });
    it('ensemble vide', () => {
      const page = sliceCursorPage([], 3, 'id');
      expect(page.items).toEqual([]);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });
  });

  describe('sliceCursorPage — retour (backward)', () => {
    it('take négatif : garde les limit premiers, curseur sur le bord haut', () => {
      // requête backward typique : take=-(limit+1), lignes en ordre asc inversé
      const fetched = rows(['e', 'd', 'c', 'b']); // 4 pour limit 3, ordre desc
      const page = sliceCursorPage(fetched, 3, 'id', true);
      expect(page.hasMore).toBe(true);
      expect(page.items.map((r) => r.id)).toEqual(['e', 'd', 'c']);
      // en backward, le curseur de reprise est le PREMIER item affiché
      expect(decodeCursor(page.nextCursor as string)).toEqual({ id: 'e' });
    });
    it('backward sans surplus → plus rien avant', () => {
      const page = sliceCursorPage(rows(['c', 'b', 'a']), 3, 'id', true);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });
  });

  describe('aller-retour complet', () => {
    it('parcourt toutes les pages forward puis revient en arrière', () => {
      const all = rows(['g', 'f', 'e', 'd', 'c', 'b', 'a']); // 7 items, limit 3
      let cursor: string | null | undefined;
      const seen: string[] = [];
      let guard = 0;
      for (;;) {
        const windowStart = cursor ? all.findIndex((r) => r.id === (decodeCursor(cursor as string) as { id: string }).id) : 0;
        const fetched = all.slice(windowStart + (cursor ? 1 : 0), windowStart + (cursor ? 1 : 0) + 4);
        const page = sliceCursorPage(fetched, 3, 'id');
        seen.push(...page.items.map((r) => r.id));
        if (!page.hasMore) break;
        cursor = page.nextCursor;
        if (++guard > 10) throw new Error('boucle infinie');
      }
      expect(seen).toEqual(['g', 'f', 'e', 'd', 'c', 'b', 'a']);

      // retour arrière depuis le dernier curseur 'b'
      const backFetched = all.slice(0, all.findIndex((r) => r.id === 'b')); // a-t-il des éléments avant b ? oui g..c
      const back = sliceCursorPage(backFetched.slice(0, 3), 3, 'id', true);
      expect(back.items.map((r) => r.id)).toEqual(['g', 'f', 'e']);
    });
  });

  describe('offsetMeta', () => {
    it('calcule totalPages', () => {
      expect(offsetMeta(2, 10, 95)).toEqual({ page: 2, limit: 10, total: 95, totalPages: 10 });
    });
    it('total 0 → au moins 1 page', () => {
      expect(offsetMeta(1, 10, 0).totalPages).toBe(1);
    });
  });
});

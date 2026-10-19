/**
 * Pagination par curseur (keyset) — utilisée pour les feeds, vidéos, commandes…
 * Le curseur est un opaque base64 de `{ id, sort }` pour éviter la fuite de
 * structure interne et les problèmes de profondeur du OFFSET.
 */

export interface CursorPageMeta {
  nextCursor: string | null;
  prevCursor: string | null;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface CursorPage<TItem> {
  items: TItem[];
  meta: CursorPageMeta;
}

export interface CursorInput {
  cursor?: string;
  limit?: number;
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export function clampLimit(limit?: number): number {
  if (!limit || limit <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(limit, MAX_PAGE_SIZE);
}

interface CursorPayload {
  id: string;
  sort?: string | number;
}

export function encodeCursor(id: string, sort?: string | number): string {
  const payload: CursorPayload = { id, sort };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor?: string): CursorPayload | null {
  if (!cursor) return null;
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    if (parsed && typeof parsed === 'object' && 'id' in parsed && typeof (parsed as CursorPayload).id === 'string') {
      return parsed as CursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Construit une page à partir d'une liste « limit + 1 » récupérée en base :
 * si on a plus que `limit` éléments, il y a une page suivante.
 */
export function buildCursorPage<T extends { id: string }>(rows: T[], input: CursorInput, reversed = false): CursorPage<T> {
  const limit = clampLimit(input.limit);
  const hasNext = rows.length > limit;
  const items = hasNext ? rows.slice(0, limit) : rows;
  const first = items[0];
  const last = items[items.length - 1];
  const hasPrev = Boolean(input.cursor);
  return {
    items: reversed ? [...items].reverse() : items,
    meta: {
      nextCursor: hasNext && last ? encodeCursor(last.id) : null,
      prevCursor: hasPrev && first ? encodeCursor(first.id) : null,
      hasNext,
      hasPrev,
    },
  };
}

/** where Prisma « take after cursor » pour un tri descendant par createdAt+id. */
export function cursorWhereDesc(cursorId?: string): { id?: { lt: string } } | Record<string, never> {
  return cursorId ? { id: { lt: cursorId } } : {};
}

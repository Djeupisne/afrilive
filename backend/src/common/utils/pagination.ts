/**
 * Helpers de pagination par curseur (keyset) pour Prisma.
 * Le curseur est un `where` JSON encodé en base64url, opaque côté client.
 */

export function encodeCursor(where: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(where), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined): Record<string, unknown> | undefined {
  if (!cursor) return undefined;
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export interface CursorArgsInput {
  /** limit + 1 lignes demandées pour détecter hasMore (positif) ou -limit-1 (backward). */
  take: number;
  /** Condition keyset « strictement après le curseur » (ex. { id: { lt: '...' } }). */
  cursorWhere?: Record<string, unknown>;
  orderBy: Record<string, 'asc' | 'desc'> | Record<string, 'asc' | 'desc'>[];
  select?: object;
  include?: object;
}

/** Construit les arguments findMany Prisma pour une requête paginée par curseur. */
export function buildCursorArgs(args: CursorArgsInput): Record<string, unknown> {
  const { take, cursorWhere, orderBy, select, include } = args;
  const result: Record<string, unknown> = { take, orderBy };
  if (select) result.select = select;
  if (include) result.include = include;
  if (cursorWhere) result.where = cursorWhere;
  return result;
}

export interface CursorPageResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * À partir de rows récupérées avec take = limit+1 (ou -(limit+1) en backward),
 * découpe la page et calcule nextCursor sur le champ `cursorField`.
 */
export function sliceCursorPage<T extends Record<string, unknown>>(
  rows: T[],
  limit: number,
  cursorField: string,
  backward = false,
): CursorPageResult<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const edge = backward ? items[0] : items[items.length - 1];
  const nextCursor =
    hasMore && edge !== undefined && edge[cursorField] !== undefined
      ? encodeCursor({ [cursorField]: edge[cursorField] })
      : null;
  return { items, nextCursor, hasMore };
}

/** Convertit une page offset en meta standard. */
export function offsetMeta(page: number, limit: number, total: number) {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

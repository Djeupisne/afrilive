import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Pagination par offset classique (?page=1&limit=20). */
export class OffsetPaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

/** Pagination par curseur (« infinite scroll » mobile) : ?cursor=<id>&limit=20. */
export class CursorPaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === 'null' ? undefined : String(value)))
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  /** Sens de parcours depuis le curseur : backward=true pour charger « avant ». */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  backward?: boolean;
}

/** Enveloppe standard d'une page de résultats. */
export interface PageMeta {
  nextCursor: string | null;
  hasMore: boolean;
}

export interface OffsetPage<T> {
  items: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface CursorPage<T> {
  items: T[];
  meta: PageMeta;
}

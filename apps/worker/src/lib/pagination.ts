import type { Context } from 'hono';

// §7 共通規約: 一覧は ?page=1&per_page=20（max 100）で {items, total, page, perPage}
export interface Pagination {
  page: number;
  perPage: number;
  offset: number;
}

function toInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function getPagination(c: Context): Pagination {
  const page = toInt(c.req.query('page'), 1);
  const perPage = Math.min(toInt(c.req.query('per_page'), 20), 100);
  return { page, perPage, offset: (page - 1) * perPage };
}

export function pageResult<T>(
  items: T[],
  total: number,
  { page, perPage }: Pagination,
): { items: T[]; total: number; page: number; perPage: number } {
  return { items, total, page, perPage };
}

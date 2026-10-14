export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export function buildQuery(params: Record<string, string | number | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      usp.set(key, String(value));
    }
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

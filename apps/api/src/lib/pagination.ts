export interface PaginationMeta {
  next_cursor: string | null;
  has_more: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

export function paginate<T extends { id: string }>(
  items: T[],
  limit: number,
): PaginatedResponse<T> {
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;
  const nextCursor =
    hasMore && data.length > 0 ? (data[data.length - 1]?.id ?? null) : null;
  return {
    data,
    pagination: {
      next_cursor: nextCursor,
      has_more: hasMore,
    },
  };
}

export function parseLimit(
  raw: string | undefined,
  defaultLimit = 50,
  max = 100,
): number {
  if (!raw) return defaultLimit;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return defaultLimit;
  return Math.min(n, max);
}

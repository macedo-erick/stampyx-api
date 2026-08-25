export interface PageResponse<T> {
  readonly content: readonly T[];
  readonly page: number;
  readonly size: number;
  readonly totalElements: number;
  readonly totalPages: number;
}

export function pageOf<T>(
  content: readonly T[],
  page: number,
  size: number,
  totalElements: number,
): PageResponse<T> {
  return {
    content,
    page,
    size,
    totalElements,
    totalPages: size > 0 ? Math.ceil(totalElements / size) : 0,
  };
}

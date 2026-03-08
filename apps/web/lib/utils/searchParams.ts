export type RouteSearchParams = Record<string, string | string[] | undefined>;

export function getSingleSearchParam(value?: string | string[]) {
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === 'string' && entry.trim().length > 0);
    return first?.trim() || null;
  }
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return null;
}

export function readSearchParam(searchParams: RouteSearchParams | undefined, key: string) {
  return getSingleSearchParam(searchParams?.[key]);
}

export function hasPresentSearchParams(searchParams?: RouteSearchParams) {
  return Object.values(searchParams ?? {}).some((value) => getSingleSearchParam(value) !== null);
}

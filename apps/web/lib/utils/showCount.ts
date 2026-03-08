export function resolveShowCount(value: string | string[] | undefined, total: number, step: number) {
  const safeTotal = Math.max(0, Math.trunc(total));
  if (safeTotal === 0) return 0;

  const safeStep = Math.max(1, Math.trunc(step));
  const raw = getFirst(value).trim();
  if (!raw) return Math.min(safeStep, safeTotal);

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return Math.min(safeStep, safeTotal);

  const normalized = Math.max(safeStep, Math.trunc(parsed));
  return Math.min(normalized, safeTotal);
}

function getFirst(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

export function formatTimestamp(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

export function formatJson(value: unknown) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function formatAlertDetails(details?: Record<string, unknown> | null) {
  if (details == null) return null;
  if (typeof details === 'string') return details;
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

export function formatObservedCount(count: number | null | undefined) {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.trunc(Number(count))) : 0;
  return `${safeCount} ${safeCount === 1 ? 'time observed' : 'times observed'}`;
}

function readAlertNumber(details: Record<string, unknown> | null | undefined, key: string) {
  const value = details?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatAlertDetailValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.length ? value.map((item) => formatAlertDetailValue(item)).join(', ') : '—';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function formatWs45SourceSnapshot(details?: Record<string, unknown> | null) {
  const pdfsFound = readAlertNumber(details, 'pdfsFound');
  const forecastPdfsFound = readAlertNumber(details, 'forecastPdfsFound');
  const faqPdfsFound = readAlertNumber(details, 'faqPdfsFound');
  if (pdfsFound == null && forecastPdfsFound == null && faqPdfsFound == null) return null;
  const totalLabel = pdfsFound === 1 ? 'PDF' : 'PDFs';
  return `Source snapshot: ${formatAlertDetailValue(pdfsFound)} total ${totalLabel} • ${formatAlertDetailValue(forecastPdfsFound)} forecast • ${formatAlertDetailValue(faqPdfsFound)} FAQ`;
}

export function formatRunDuration(startedAt?: string, endedAt?: string | null) {
  if (!startedAt || !endedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const totalSeconds = Math.round((end - start) / 1000);
  return formatDurationSeconds(totalSeconds);
}

export function formatDurationSeconds(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds)) return '—';
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const minutesRemainder = minutes % 60;
  return `${hours}h ${minutesRemainder}m`;
}

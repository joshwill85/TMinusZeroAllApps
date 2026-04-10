import { isLaunchRefreshDiagnosticsEnabled } from '@/lib/server/env';

type LaunchRefreshDiagnosticValue = string | number | boolean | null;

function normalizeDiagnosticValue(value: unknown): LaunchRefreshDiagnosticValue {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

export function logLaunchRefreshDiagnostic(
  event: string,
  payload: Record<string, unknown>
) {
  if (!isLaunchRefreshDiagnosticsEnabled()) {
    return;
  }

  const normalized = Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [key, normalizeDiagnosticValue(value)])
  );

  console.info(`[launch-refresh] ${event}`, {
    at: new Date().toISOString(),
    ...normalized
  });
}

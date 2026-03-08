import { formatJson } from './format';

export function formatSyncTriggerError(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;

  const data = payload as Record<string, any>;
  const code = typeof data.error === 'string' && data.error.trim() ? data.error.trim() : null;

  const message = typeof data.message === 'string' ? data.message.trim() : '';
  if (message) return code ? `${code}: ${message}` : message;

  const ws45Errors = data.result?.stats?.errors;
  if (Array.isArray(ws45Errors) && ws45Errors.length) {
    const first = ws45Errors[0] as Record<string, unknown> | undefined;
    const step = typeof first?.step === 'string' ? first.step : 'error';
    const error = typeof first?.error === 'string' ? first.error : formatJson(first) || 'unknown_error';
    const more = ws45Errors.length > 1 ? ` (+${ws45Errors.length - 1} more)` : '';
    return code ? `${code}: ${step}: ${error}${more}` : `${step}: ${error}${more}`;
  }

  const body = data.body;
  if (body && typeof body === 'object') {
    const bodyObj = body as Record<string, any>;
    const bodyError = typeof bodyObj.error === 'string' ? bodyObj.error.trim() : '';
    if (bodyError) return code ? `${code}: ${bodyError}` : bodyError;
    const bodyMessage = typeof bodyObj.message === 'string' ? bodyObj.message.trim() : '';
    if (bodyMessage) return code ? `${code}: ${bodyMessage}` : bodyMessage;
    const serialized = formatJson(bodyObj);
    if (serialized) return code ? `${code}: ${serialized}` : serialized;
  }

  return null;
}


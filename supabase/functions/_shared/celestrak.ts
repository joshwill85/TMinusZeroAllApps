export const CELESTRAK_BASE = 'https://celestrak.org';

export const CELESTRAK_CURRENT_GP_PAGE = `${CELESTRAK_BASE}/NORAD/elements/`;
export const CELESTRAK_GP_ENDPOINT = `${CELESTRAK_BASE}/NORAD/elements/gp.php`;
export const CELESTRAK_SUPGP_ENDPOINT = `${CELESTRAK_BASE}/NORAD/elements/supplemental/sup-gp.php`;
export const CELESTRAK_SATCAT_ENDPOINT = `${CELESTRAK_BASE}/satcat/records.php`;

export const DEFAULT_CELESTRAK_USER_AGENT = 'TMinusZero/0.1 (support@tminuszero.app)';

export function buildUrl(base: string, params: Record<string, unknown>) {
  const url = new URL(base);
  for (const [rawKey, value] of Object.entries(params)) {
    if (value == null) continue;
    const key = rawKey.toUpperCase();
    if (typeof value === 'boolean') {
      url.searchParams.set(key, value ? '1' : '0');
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export function normalizeEpochForPg(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const epoch = raw.trim();
  if (!epoch) return null;
  if (/[zZ]$/.test(epoch) || /[+-]\\d{2}:?\\d{2}$/.test(epoch)) return epoch;
  return `${epoch}Z`;
}

export async function sleep(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchTextWithRetries(
  url: string,
  init: RequestInit,
  {
    retries = 3,
    backoffMs = 750
  }: {
    retries?: number;
    backoffMs?: number;
  } = {}
): Promise<{ ok: true; status: number; text: string; headers: Headers } | { ok: false; status: number; error: string; text: string }> {
  const maxRetries = Math.max(1, Math.min(5, retries));

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      const res = await fetch(url, { ...init, redirect: 'follow' });
      const text = await res.text().catch(() => '');
      if (res.status === 200) {
        return { ok: true, status: res.status, text, headers: res.headers };
      }

      if (attempt + 1 < maxRetries) {
        await sleep(backoffMs * 2 ** attempt + Math.round(Math.random() * 250));
        continue;
      }
      return { ok: false, status: res.status, error: `http_${res.status}`, text };
    } catch (err) {
      const msg = stringifyError(err);
      if (attempt + 1 < maxRetries) {
        await sleep(backoffMs * 2 ** attempt + Math.round(Math.random() * 250));
        continue;
      }
      return { ok: false, status: 0, error: msg, text: '' };
    }
  }

  return { ok: false, status: 0, error: 'unexpected_retry_state', text: '' };
}

export async function fetchJsonWithRetries<T>(
  url: string,
  init: RequestInit,
  opts?: { retries?: number; backoffMs?: number }
): Promise<
  | { ok: true; status: number; data: T; text: string; headers: Headers }
  | { ok: false; status: number; error: string; text: string }
> {
  const res = await fetchTextWithRetries(url, init, opts);
  if (!res.ok) return res;

  try {
    const data = JSON.parse(res.text) as T;
    return { ok: true, status: res.status, data, text: res.text, headers: res.headers };
  } catch (err) {
    return { ok: false, status: res.status, error: `json_parse_${stringifyError(err)}`, text: res.text };
  }
}

export function parseCurrentGpGroups(html: string) {
  const re = new RegExp(
    String.raw`<td[^>]*>((?:(?!<\/td>|<table|<tr|<td)[\s\S])*?)<a[^>]*href="gp\.php\?GROUP=([^&"#]+)&`,
    'gi'
  );
  const out = new Map<string, string>();

  for (const match of html.matchAll(re)) {
    const code = match[2]?.trim();
    const labelHtml = match[1] ?? '';
    if (!code) continue;
    const label = normalizeGroupLabel(labelHtml);
    if (!label) continue;
    const prev = out.get(code);
    if (!prev || label.length < prev.length) out.set(code, label);
  }

  return [...out.entries()].map(([code, label]) => ({ code, label }));
}

function normalizeGroupLabel(labelHtml: string) {
  const stripped = stripTags(labelHtml);
  const decoded = decodeHtmlEntities(stripped);
  return decoded.replace(/\\s+/g, ' ').trim();
}

function stripTags(text: string) {
  return text.replace(/<[^>]+>/g, ' ');
}

function decodeHtmlEntities(text: string) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') return JSON.stringify(err);
  return String(err);
}

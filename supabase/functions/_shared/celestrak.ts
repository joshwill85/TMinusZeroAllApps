export const CELESTRAK_BASE = 'https://celestrak.org';

export const CELESTRAK_CURRENT_GP_PAGE = `${CELESTRAK_BASE}/NORAD/elements/`;
export const CELESTRAK_CURRENT_SUPGP_PAGE = `${CELESTRAK_BASE}/NORAD/elements/supplemental/`;
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

export type CelestrakSupgpDataset = {
  file: string;
  label: string;
  category: 'family_feed' | 'launch_file';
  launchAt: string | null;
  deployAt: string | null;
  launchWindowStartAt: string | null;
  launchWindowEndAt: string | null;
};

export function parseCurrentSupgpDatasets(html: string): CelestrakSupgpDataset[] {
  const cellRe = /<td[^>]*class\s*=\s*["']?center["']?[^>]*>([\s\S]*?)<\/td>/gi;
  const byFile = new Map<string, CelestrakSupgpDataset>();

  for (const cellMatch of html.matchAll(cellRe)) {
    const cellHtml = cellMatch[1] ?? '';
    if (!/sup-gp\.php\?FILE=/i.test(cellHtml)) continue;

    const fileMatches = [...cellHtml.matchAll(/sup-gp\.php\?FILE=([^&"#]+)&/gi)];
    if (!fileMatches.length) continue;

    const firstFileIndex = fileMatches[0]?.index ?? 0;
    const cellBaseLabel = normalizeGroupLabel(cellHtml.slice(0, firstFileIndex));

    for (let index = 0; index < fileMatches.length; index += 1) {
      const fileMatch = fileMatches[index];
      const rawFile = fileMatch[1] ? decodeURIComponent(fileMatch[1]).trim() : '';
      if (!rawFile) continue;

      const segmentStart = fileMatch.index ?? 0;
      const segmentEnd = fileMatches[index + 1]?.index ?? cellHtml.length;
      const segmentPrefix = normalizeGroupLabel(cellHtml.slice(Math.max(0, segmentStart - 220), segmentStart));
      const segmentText = normalizeGroupLabel(cellHtml.slice(segmentStart, segmentEnd));
      const backupMatch = segmentPrefix.match(/Backup Launch Opportunity #(\d+)/i) ?? segmentText.match(/Backup Launch Opportunity #(\d+)/i);
      const category = classifySupgpCategory(rawFile, cellBaseLabel, segmentPrefix, segmentText);
      const entry: CelestrakSupgpDataset = {
        file: rawFile,
        label: deriveSupgpLabel({
          file: rawFile,
          category,
          cellBaseLabel,
          segmentPrefix,
          backupIndex: backupMatch?.[1] ?? null
        }),
        category,
        launchAt: extractSupgpTimestamp(segmentText, 'Launch'),
        deployAt: extractSupgpTimestamp(segmentText, 'Deploy'),
        launchWindowStartAt: extractSupgpWindow(segmentText)?.start ?? null,
        launchWindowEndAt: extractSupgpWindow(segmentText)?.end ?? null
      };

      const previous = byFile.get(rawFile);
      if (!previous || scoreSupgpDataset(entry) >= scoreSupgpDataset(previous)) {
        byFile.set(rawFile, entry);
      }
    }
  }

  return [...byFile.values()].sort((left, right) => left.file.localeCompare(right.file));
}

function normalizeGroupLabel(labelHtml: string) {
  const stripped = stripTags(labelHtml);
  const decoded = decodeHtmlEntities(stripped);
  return decoded.replace(/\\s+/g, ' ').trim();
}

function classifySupgpCategory(file: string, cellBaseLabel: string, segmentPrefix: string, segmentText: string): 'family_feed' | 'launch_file' {
  const raw = `${file} ${cellBaseLabel} ${segmentPrefix} ${segmentText}`.toLowerCase();
  if (raw.includes('pre-launch') || raw.includes('backup launch opportunity')) return 'launch_file';
  if (/starlink-g\d+-\d+/.test(raw) || /transporter-\d+/.test(raw) || /bandwagon-\d+/.test(raw)) return 'launch_file';
  if (/(^|[-_])(b\d+|g\d+-\d+|\d{1,2})([-_]|$)/.test(file.toLowerCase())) return 'launch_file';
  return 'family_feed';
}

function deriveSupgpLabel({
  file,
  category,
  cellBaseLabel,
  segmentPrefix,
  backupIndex
}: {
  file: string;
  category: 'family_feed' | 'launch_file';
  cellBaseLabel: string;
  segmentPrefix: string;
  backupIndex: string | null;
}) {
  if (backupIndex) {
    const base = cellBaseLabel.replace(/\\s+pre-launch$/i, '').trim() || humanizeSupgpFile(file).replace(/\\s+Backup\\s+#\\d+$/i, '').trim();
    return `${base} Backup #${backupIndex}`;
  }

  if (segmentPrefix && !/^backup launch opportunity/i.test(segmentPrefix)) {
    return segmentPrefix;
  }

  if (cellBaseLabel) return cellBaseLabel;
  if (category === 'family_feed') return humanizeSupgpFile(file);
  return `${humanizeSupgpFile(file)} Pre-Launch`;
}

function extractSupgpTimestamp(text: string, label: 'Launch' | 'Deploy') {
  const match = text.match(new RegExp(`${label}:\\s*(\\d{4}-\\d{2}-\\d{2})\\s+(\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?)\\s*UTC`, 'i'));
  if (!match) return null;
  return toUtcIso(match[1], match[2]);
}

function extractSupgpWindow(text: string) {
  const match = text.match(
    /Launch window:\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?)\s*UTC\s+to\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?)\s*UTC/i
  );
  if (!match) return null;
  return {
    start: toUtcIso(match[1], match[2]),
    end: toUtcIso(match[3], match[4])
  };
}

function toUtcIso(datePart: string, timePart: string) {
  const normalizedTime = timePart.includes('.') ? timePart : `${timePart}.000`;
  return `${datePart}T${normalizedTime}Z`;
}

function humanizeSupgpFile(file: string) {
  return file
    .replace(/[-_]+/g, ' ')
    .replace(/\\b([a-z])/g, (match) => match.toUpperCase())
    .replace(/\\bG(\\d+)\\s+(\\d+)\\b/g, 'G$1-$2')
    .replace(/\\bB(\\d+)\\b/g, 'B$1')
    .trim();
}

function scoreSupgpDataset(dataset: CelestrakSupgpDataset) {
  let score = dataset.category === 'launch_file' ? 4 : 2;
  if (dataset.launchAt) score += 2;
  if (dataset.launchWindowEndAt) score += 1;
  if (dataset.deployAt) score += 1;
  return score;
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

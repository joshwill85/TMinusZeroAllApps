import { createClient } from '@supabase/supabase-js';

type Row = {
  id: string;
  mission_key: string;
  title: string;
  summary: string | null;
  source_type: string | null;
  source_url: string | null;
  event_time: string | null;
  announced_time: string;
  updated_at: string | null;
  is_superseded: boolean;
  supersedes_event_id: string | null;
};

function norm(v: unknown) {
  return typeof v === 'string' ? v.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

function dateBucket(v: string | null | undefined) {
  if (!v) return 'na';
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : 'na';
}

function normalizeSourceUrlKey(value: string | null | undefined) {
  const normalized = norm(value);
  if (!normalized) return 'na';
  const withoutTrailingSlash = normalized.replace(/\/+$/, '');
  return withoutTrailingSlash || 'na';
}

function cmpDescDate(a: string | null | undefined, b: string | null | undefined) {
  const ams = Date.parse(a || '');
  const bms = Date.parse(b || '');
  const safeA = Number.isFinite(ams) ? ams : -1;
  const safeB = Number.isFinite(bms) ? bms : -1;
  return safeB - safeA;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing supabase env vars');

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from('artemis_timeline_events')
    .select('id,mission_key,title,summary,source_type,source_url,event_time,announced_time,updated_at,is_superseded,supersedes_event_id')
    .eq('is_superseded', false)
    .order('announced_time', { ascending: false, nullsFirst: false })
    .limit(5000);

  if (error) throw error;

  const rows = (data || []) as Row[];
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const titleNorm = norm(row.title);
    if (!titleNorm.includes('refreshed')) continue;

    const key = [
      norm(row.mission_key) || 'program',
      titleNorm,
      norm(row.source_type) || 'na',
      dateBucket(row.event_time || row.announced_time),
      norm(row.summary) || 'na',
      normalizeSourceUrlKey(row.source_url)
    ].join('|');

    const list = grouped.get(key) || [];
    list.push(row);
    grouped.set(key, list);
  }

  const report = [...grouped.entries()]
    .map(([key, rs]) => {
      const sorted = rs.slice().sort((a, b) => {
        const byUpdated = cmpDescDate(a.updated_at, b.updated_at);
        if (byUpdated) return byUpdated;
        const byAnnounced = cmpDescDate(a.announced_time, b.announced_time);
        if (byAnnounced) return byAnnounced;
        return b.id.localeCompare(a.id);
      });
      return { key, count: sorted.length, keepId: sorted[0]?.id, supersedeIds: sorted.slice(1).map((r) => r.id), rows: sorted };
    })
    .filter((g) => g.count > 1)
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  const rowsToSupersede = report.reduce((n, g) => n + g.supersedeIds.length, 0);

  console.log(JSON.stringify({ groups: report.length, rowsToSupersede }, null, 2));
  for (const g of report) {
    console.log('\nGROUP', g.key, 'count=', g.count, 'keep=', g.keepId, 'supersede=', g.supersedeIds.join(','));
    for (const r of g.rows) {
      console.log(JSON.stringify({ id: r.id, title: r.title, summary: r.summary, source_url: r.source_url, announced_time: r.announced_time, updated_at: r.updated_at }));
    }
  }
}

void main();

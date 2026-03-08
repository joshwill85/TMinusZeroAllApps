import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

type TimelineRow = {
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

type RefreshGroup = {
  key: string;
  keepId: string;
  supersedeIds: string[];
  count: number;
};

const EXPECTED_SUPERSEDE_ROWS = 3;

function norm(v: unknown) {
  return typeof v === 'string' ? v.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

function dateBucket(v: string | null | undefined) {
  if (!v) return 'na';
  const parsed = Date.parse(v);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : 'na';
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
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase env vars.');
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const generatedAt = new Date().toISOString();
  const artifactsDir = path.resolve('.artifacts', 'artemis-qa');
  mkdirSync(artifactsDir, { recursive: true });

  const { data, error } = await supabase
    .from('artemis_timeline_events')
    .select('id,mission_key,title,summary,source_type,source_url,event_time,announced_time,updated_at,is_superseded,supersedes_event_id')
    .eq('is_superseded', false)
    .order('announced_time', { ascending: false, nullsFirst: false })
    .limit(5000);

  if (error) throw error;

  const rows = (data || []) as TimelineRow[];
  const grouped = new Map<string, TimelineRow[]>();

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

  const groups: RefreshGroup[] = [...grouped.entries()]
    .map(([key, groupRows]) => {
      const sorted = groupRows.slice().sort((a, b) => {
        const byUpdated = cmpDescDate(a.updated_at, b.updated_at);
        if (byUpdated !== 0) return byUpdated;
        const byAnnounced = cmpDescDate(a.announced_time, b.announced_time);
        if (byAnnounced !== 0) return byAnnounced;
        return b.id.localeCompare(a.id);
      });

      return {
        key,
        keepId: sorted[0]?.id,
        supersedeIds: sorted.slice(1).map((r) => r.id),
        count: sorted.length
      };
    })
    .filter((group) => group.count > 1)
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  const rowsToSupersede = groups.reduce((acc, group) => acc + group.supersedeIds.length, 0);
  if (rowsToSupersede !== EXPECTED_SUPERSEDE_ROWS) {
    throw new Error(
      'Safety guard failed: expected rows to supersede=' + EXPECTED_SUPERSEDE_ROWS + ', found=' + rowsToSupersede
    );
  }

  const keepIds = groups.map((group) => group.keepId);
  const supersedeIds = groups.flatMap((group) => group.supersedeIds);
  const allAffectedIds = [...new Set([...keepIds, ...supersedeIds])];

  const { data: beforeData, error: beforeError } = await supabase
    .from('artemis_timeline_events')
    .select('id,mission_key,title,summary,source_type,source_url,event_time,announced_time,updated_at,is_superseded,supersedes_event_id')
    .in('id', allAffectedIds)
    .order('announced_time', { ascending: false, nullsFirst: false });

  if (beforeError) throw beforeError;

  const preArtifactPath = path.join(artifactsDir, 'timeline-refresh-apply-pre.json');
  writeFileSync(
    preArtifactPath,
    JSON.stringify(
      {
        generatedAt,
        expectedRowsToSupersede: EXPECTED_SUPERSEDE_ROWS,
        groups,
        beforeRows: beforeData || []
      },
      null,
      2
    ) + '\n',
    'utf8'
  );

  for (const group of groups) {
    for (const supersedeId of group.supersedeIds) {
      const { data: updated, error: updateError } = await supabase
        .from('artemis_timeline_events')
        .update({
          is_superseded: true,
          supersedes_event_id: group.keepId,
          updated_at: new Date().toISOString()
        })
        .eq('id', supersedeId)
        .eq('is_superseded', false)
        .is('supersedes_event_id', null)
        .select('id,is_superseded,supersedes_event_id,title,mission_key,updated_at')
        .maybeSingle();

      if (updateError) throw updateError;
      if (!updated) {
        throw new Error('Safety guard failed: row not updated due to state drift, row=' + supersedeId);
      }

      if (updated.id !== supersedeId || updated.is_superseded !== true || updated.supersedes_event_id !== group.keepId) {
        throw new Error('Post-update verification failed for row=' + supersedeId);
      }
    }
  }

  const { data: afterData, error: afterError } = await supabase
    .from('artemis_timeline_events')
    .select('id,mission_key,title,summary,source_type,source_url,event_time,announced_time,updated_at,is_superseded,supersedes_event_id')
    .in('id', allAffectedIds)
    .order('announced_time', { ascending: false, nullsFirst: false });

  if (afterError) throw afterError;

  const byId = new Map((afterData || []).map((row) => [row.id, row as TimelineRow]));
  for (const group of groups) {
    const keepRow = byId.get(group.keepId);
    if (!keepRow || keepRow.is_superseded) {
      throw new Error('Post-apply verification failed: keep row invalid, id=' + group.keepId);
    }

    for (const supersedeId of group.supersedeIds) {
      const row = byId.get(supersedeId);
      if (!row) {
        throw new Error('Post-apply verification failed: superseded row missing, id=' + supersedeId);
      }
      if (!row.is_superseded || row.supersedes_event_id !== group.keepId) {
        throw new Error('Post-apply verification failed for superseded row=' + supersedeId);
      }
    }
  }

  const postArtifactPath = path.join(artifactsDir, 'timeline-refresh-apply-post.json');
  writeFileSync(
    postArtifactPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        appliedRows: rowsToSupersede,
        groups,
        afterRows: afterData || []
      },
      null,
      2
    ) + '\n',
    'utf8'
  );

  console.log(
    JSON.stringify(
      {
        status: 'ok',
        appliedRows: rowsToSupersede,
        groups: groups.length,
        preArtifactPath,
        postArtifactPath
      },
      null,
      2
    )
  );
}

void main();

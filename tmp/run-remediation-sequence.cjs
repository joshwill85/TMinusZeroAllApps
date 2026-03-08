#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asString(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.join(',');
  return '';
}

function pickFirstToken(raw) {
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)[0] || null;
}

async function invokeJob(admin, slug, token, timeoutMs = 120000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const res = await admin.functions.invoke(slug, {
      method: 'POST',
      body: {},
      headers: {
        'x-job-token': token
      },
      signal: controller.signal
    });

    const elapsedMs = Date.now() - startedAt;
    const out = {
      slug,
      elapsedMs,
      httpStatus: res?.response?.status ?? null,
      ok: false,
      error: null,
      payload: null
    };

    if (res.error) {
      out.error = {
        name: res.error.name,
        message: res.error.message,
        context: res.error.context || null
      };
      return out;
    }

    out.payload = res.data ?? null;
    out.ok = Boolean(res.data?.ok === true || res.response?.ok === true);
    return out;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchLatestRun(admin, jobName) {
  const { data, error } = await admin
    .from('ingestion_runs')
    .select('job_name,started_at,ended_at,success,stats,error')
    .eq('job_name', jobName)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`latest run query failed for ${jobName}: ${error.message}`);
  return data || null;
}

async function main() {
  const cwd = process.cwd();
  loadEnvFile(path.join(cwd, '.env.local'));
  loadEnvFile(path.join(cwd, '.env'));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing env: NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const settingUpserts = [
    { key: 'trajectory_products_eligible_limit', value: 8 },
    { key: 'trajectory_products_lookahead_limit', value: 80 },
    { key: 'jep_score_model_version', value: 'jep_v3' },
    { key: 'jep_score_open_meteo_us_models', value: ['best_match', 'gfs_seamless'] }
  ];

  const { error: upsertError } = await admin
    .from('system_settings')
    .upsert(settingUpserts.map((row) => ({ ...row, updated_at: new Date().toISOString() })), { onConflict: 'key' });
  if (upsertError) throw new Error(`settings upsert failed: ${upsertError.message}`);

  const { data: tokenRow, error: tokenError } = await admin
    .from('system_settings')
    .select('value')
    .eq('key', 'jobs_auth_token')
    .maybeSingle();

  if (tokenError) throw new Error(`jobs_auth_token read failed: ${tokenError.message}`);
  const token = pickFirstToken(asString(tokenRow?.value));
  if (!token) throw new Error('jobs_auth_token is empty');

  const sequence = [
    { slug: 'nws-refresh', jobName: 'nws_refresh', settleMs: 2500 },
    { slug: 'trajectory-orbit-ingest', jobName: 'trajectory_orbit_ingest', settleMs: 2500 },
    { slug: 'trajectory-constraints-ingest', jobName: 'trajectory_constraints_ingest', settleMs: 2500 },
    { slug: 'trajectory-products-generate', jobName: 'trajectory_products_generate', settleMs: 2500 },
    { slug: 'jep-score-refresh', jobName: 'jep_score_refresh', settleMs: 2500 }
  ];

  const invokeResults = [];

  for (const step of sequence) {
    const invoke = await invokeJob(admin, step.slug, token);
    await sleep(step.settleMs);
    const latestRun = await fetchLatestRun(admin, step.jobName);
    invokeResults.push({
      step,
      invoke,
      latestRun
    });
  }

  const { data: settingsRows, error: settingsError } = await admin
    .from('system_settings')
    .select('key,value')
    .in('key', [
      'trajectory_products_eligible_limit',
      'trajectory_products_lookahead_limit',
      'trajectory_products_top3_ids',
      'jep_score_model_version',
      'jep_score_open_meteo_us_models'
    ]);
  if (settingsError) throw new Error(`post settings query failed: ${settingsError.message}`);

  const summary = {
    ok: true,
    executedAt: new Date().toISOString(),
    settingUpserts,
    postSettings: Object.fromEntries((settingsRows || []).map((r) => [r.key, r.value])),
    invokeResults
  };

  const outPath = path.join(cwd, 'tmp', 'deploy_inspect', 'remediation-sequence-result.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));

  console.log(JSON.stringify({
    ok: true,
    outPath,
    postSettings: summary.postSettings,
    steps: invokeResults.map((r) => ({
      slug: r.step.slug,
      invokedOk: r.invoke.ok,
      invokeHttpStatus: r.invoke.httpStatus,
      latestRunSuccess: r.latestRun?.success ?? null,
      latestRunStartedAt: r.latestRun?.started_at ?? null,
      latestRunEndedAt: r.latestRun?.ended_at ?? null
    }))
  }, null, 2));
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

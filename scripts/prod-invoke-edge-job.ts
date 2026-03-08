import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { parseArgs } from 'node:util';

type SettingRow = { key: string; value: unknown };

config({ path: '.env.local' });
config();

const { values } = parseArgs({
  options: {
    slug: { type: 'string' },
    projectRef: { type: 'string' },
    timeoutSeconds: { type: 'string', default: '60' },
    help: { type: 'boolean', short: 'h' }
  }
});

const usage = `Usage:
  # Invoke a production Edge Function (job-auth protected) safely:
  SUPABASE_SERVICE_ROLE_KEY=... \\
  ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/prod-invoke-edge-job.ts \\
    --projectRef lixuhtyqprseulhdvynq \\
    --slug trajectory-orbit-ingest

Notes:
  - Requires SUPABASE_SERVICE_ROLE_KEY in env (do NOT print it).
  - Uses system_settings.jobs_auth_token for x-job-token.
`;

if (values.help) {
  console.log(usage);
  process.exit(0);
}

function requireEnv(name: string) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function asString(value: unknown) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function pickFirstToken(raw: string) {
  const token = raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)[0];
  if (!token) throw new Error('system_settings.jobs_auth_token is empty');
  return token;
}

async function main() {
  const slug = String(values.slug || '').trim();
  if (!slug) throw new Error('Missing --slug');

  const projectRef = String(values.projectRef || '').trim() || String(process.env.SUPABASE_PROJECT_REF || '').trim();
  if (!projectRef) throw new Error('Missing --projectRef (or SUPABASE_PROJECT_REF env).');

  const timeoutSeconds = Math.max(5, Math.min(15 * 60, Number(values.timeoutSeconds || 60)));

  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: settings, error: settingsError } = await admin
    .from('system_settings')
    .select('key,value')
    .eq('key', 'jobs_auth_token')
    .maybeSingle();

  if (settingsError) throw new Error(`Failed to read system_settings.jobs_auth_token (${settingsError.message})`);

  const jobsAuthToken = pickFirstToken(asString((settings as SettingRow | null)?.value));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  try {
    const startedAt = Date.now();
    const res = await admin.functions.invoke(slug, {
      method: 'POST',
      body: {},
      headers: {
        'x-job-token': jobsAuthToken
      },
      signal: controller.signal
    });
    const elapsedMs = Date.now() - startedAt;

    const status = res.error ? `ERROR(${res.error.name})` : 'OK';
    const httpStatus = (res as any)?.response?.status ?? null;

    console.log(`Project: ${projectRef}`);
    console.log(`Function: ${slug}`);
    console.log(`HTTP status: ${httpStatus ?? 'unknown'}`);
    console.log(`Result: ${status}`);
    console.log(`Elapsed: ${elapsedMs}ms`);

    if (res.error) {
      console.log(`Message: ${res.error.message}`);
      const context = (res.error as any)?.context;
      if (context && typeof context === 'object') {
        if (typeof context.status === 'number') console.log(`Context status: ${context.status}`);
        const body = context.body;
        if (typeof body === 'string' && body.trim()) {
          const snippet = body.length > 1500 ? `${body.slice(0, 1500)}…` : body;
          console.log(`Body: ${snippet}`);
        }
      }
      return;
    }

    const payload = res.data as any;
    if (payload && typeof payload === 'object') {
      const keys = Object.keys(payload).slice(0, 25);
      console.log(`Response keys: ${keys.join(', ')}`);
      if (typeof payload.ok === 'boolean') console.log(`ok: ${payload.ok}`);
      if (payload.skipped) console.log(`skipped: ${payload.skipped}`);
      if (payload.reason) console.log(`reason: ${payload.reason}`);
      if (payload.error) console.log(`error: ${payload.error}`);
    } else {
      console.log('Response: (non-object)');
    }
  } finally {
    clearTimeout(timeout);
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exitCode = 1;
});

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { parseArgs } from 'node:util';

type CheckResult = {
  label: string;
  ok: boolean;
  detail?: string;
  severity?: 'required' | 'recommended';
  skipped?: boolean;
};

config({ path: '.env.local' });
config();

const { values } = parseArgs({
  options: {
    checkDb: { type: 'boolean', default: true },
    help: { type: 'boolean', short: 'h' }
  }
});

const usage = `Usage:
  npm run check:prod
  ts-node --project tsconfig.scripts.json --transpile-only scripts/prod-readiness.ts [--checkDb=false]

Checks:
  - Required production env vars (Supabase + Stripe)
  - (Optional) Supabase system_settings for scheduled jobs (jobs_* keys)
`;

if (values.help) {
  console.log(usage);
  process.exit(0);
}

async function main() {
  const checks: CheckResult[] = [];

  const siteUrl = getSiteUrl();
  checks.push({
    label: 'NEXT_PUBLIC_SITE_URL (recommended)',
    ok: Boolean(siteUrl),
    severity: 'recommended',
    detail: siteUrl ? 'set' : 'missing (fallbacks to VERCEL_URL / localhost)'
  });

  const supabaseUrl = readEnvAny(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL']);
  const supabaseAnon = readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const supabaseServiceRole = readEnv('SUPABASE_SERVICE_ROLE_KEY');

  checks.push({
    label: 'Supabase URL',
    ok: isNonPlaceholder(supabaseUrl, ['your-supabase-url.supabase.co', 'https://your-supabase-url.supabase.co']),
    detail: supabaseUrl ? 'set' : 'missing'
  });
  checks.push({
    label: 'Supabase anon key',
    ok: isNonPlaceholder(supabaseAnon, ['SUPABASE_ANON_KEY', 'public_anon_key', 'anon_placeholder']),
    detail: supabaseAnon ? 'set' : 'missing'
  });
  checks.push({
    label: 'Supabase service role key',
    ok: isNonPlaceholder(supabaseServiceRole, ['SUPABASE_SERVICE_ROLE_KEY', 'service_role_key', 'service_role_placeholder']),
    detail: supabaseServiceRole ? 'set' : 'missing'
  });

  const stripeSecret = readEnv('STRIPE_SECRET_KEY');
  const stripeWebhook = readEnv('STRIPE_WEBHOOK_SECRET');
  const stripePrice = readEnv('STRIPE_PRICE_PRO_MONTHLY');
  const stripePublishable = readEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY');

  checks.push({
    label: 'Stripe secret key',
    ok: isNonPlaceholder(stripeSecret, ['STRIPE_SECRET_PLACEHOLDER', 'sk_test_placeholder']),
    detail: stripeSecret ? 'set' : 'missing'
  });
  checks.push({
    label: 'Stripe webhook secret',
    ok: isNonPlaceholder(stripeWebhook, ['whsec_placeholder']),
    detail: stripeWebhook ? 'set' : 'missing'
  });
  checks.push({
    label: 'Stripe price id (pro monthly)',
    ok: isNonPlaceholder(stripePrice, ['price_placeholder']),
    detail: stripePrice ? 'set' : 'missing'
  });
  checks.push({
    label: 'Stripe publishable key',
    ok: isNonPlaceholder(stripePublishable, ['pk_test_placeholder', 'pk_live_placeholder', 'STRIPE_PUBLISHABLE_PLACEHOLDER']),
    detail: stripePublishable ? 'set' : 'missing'
  });

  const shouldCheckDb = values.checkDb !== false;
  if (shouldCheckDb && isNonPlaceholder(supabaseUrl, []) && isNonPlaceholder(supabaseServiceRole, [])) {
    const dbChecks = await checkSupabaseJobSettings({
      supabaseUrl: String(supabaseUrl),
      serviceRoleKey: String(supabaseServiceRole),
      anonKey: typeof supabaseAnon === 'string' ? supabaseAnon : null
    });
    checks.push(...dbChecks);
  } else if (shouldCheckDb) {
    checks.push({
      label: 'Supabase system_settings (jobs_*)',
      ok: false,
      skipped: true,
      detail: 'skipped (missing Supabase URL or service role envs)'
    });
  }

  printChecks(checks);

  const hasHardFailures = checks.some((check) => {
    if (check.skipped) return false;
    if (check.severity === 'recommended') return false;
    return !check.ok;
  });
  if (hasHardFailures) {
    process.exitCode = 1;
  }
}

function getSiteUrl() {
  const explicit = String(process.env.NEXT_PUBLIC_SITE_URL || '').trim();
  if (explicit) return explicit;
  const vercelUrl = String(process.env.VERCEL_URL || '').trim();
  if (vercelUrl) return `https://${vercelUrl.replace(/\/+$/, '')}`;
  return '';
}

function readEnv(name: string) {
  const raw = process.env[name];
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

function readEnvAny(names: string[]) {
  for (const name of names) {
    const value = readEnv(name);
    if (value) return value;
  }
  return null;
}

function isNonPlaceholder(value: string | null, placeholders: string[]) {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (placeholders.some((p) => trimmed === p || trimmed.includes(p))) return false;
  return true;
}

function readStringSetting(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
}

function readBooleanSetting(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const cleaned = value.trim().toLowerCase();
    if (cleaned === 'true') return true;
    if (cleaned === 'false') return false;
  }
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

async function checkSupabaseJobSettings({
  supabaseUrl,
  serviceRoleKey,
  anonKey
}: {
  supabaseUrl: string;
  serviceRoleKey: string;
  anonKey: string | null;
}): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const keys = ['jobs_enabled', 'jobs_base_url', 'jobs_apikey', 'jobs_auth_token'] as const;
  const { data, error } = await admin.from('system_settings').select('key,value').in('key', keys as unknown as string[]);

  if (error) {
    return [
      {
        label: 'Supabase system_settings (jobs_*)',
        ok: false,
        detail: `failed to load (${error.message})`
      }
    ];
  }

  const byKey = new Map<string, unknown>();
  for (const row of Array.isArray(data) ? data : []) {
    const key = typeof row?.key === 'string' ? row.key : '';
    if (!key) continue;
    byKey.set(key, (row as any).value);
  }

  const jobsEnabled = readBooleanSetting(byKey.get('jobs_enabled'), true);
  checks.push({
    label: 'system_settings.jobs_enabled',
    ok: jobsEnabled,
    detail: jobsEnabled ? 'true' : 'false (jobs will not run)'
  });

  const jobsBaseUrl = readStringSetting(byKey.get('jobs_base_url'));
  checks.push({
    label: 'system_settings.jobs_base_url',
    ok: Boolean(jobsBaseUrl),
    detail: jobsBaseUrl ? 'set' : 'missing'
  });

  const jobsApiKey = readStringSetting(byKey.get('jobs_apikey')) || anonKey || '';
  checks.push({
    label: 'system_settings.jobs_apikey',
    ok: Boolean(jobsApiKey),
    detail: jobsApiKey ? (byKey.get('jobs_apikey') ? 'set' : 'missing (fallback to NEXT_PUBLIC_SUPABASE_ANON_KEY)') : 'missing'
  });

  const jobsAuthToken = readStringSetting(byKey.get('jobs_auth_token'));
  checks.push({
    label: 'system_settings.jobs_auth_token',
    ok: Boolean(jobsAuthToken),
    detail: jobsAuthToken ? 'set' : 'missing'
  });

  return checks;
}

function printChecks(checks: CheckResult[]) {
  const labelWidth = Math.max(4, ...checks.map((check) => check.label.length));
  const statusWidth = 6;

  console.log(`${pad('Item', labelWidth)}  ${pad('Status', statusWidth)}  Detail`);
  for (const check of checks) {
    const status = check.skipped ? 'SKIP' : check.ok ? 'OK' : check.severity === 'recommended' ? 'WARN' : 'FAIL';
    console.log(`${pad(check.label, labelWidth)}  ${pad(status, statusWidth)}  ${check.detail || ''}`);
  }
}

function pad(value: string, width: number) {
  const raw = String(value);
  if (raw.length >= width) return raw;
  return raw + ' '.repeat(width - raw.length);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

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
    providers: { type: 'string' },
    help: { type: 'boolean', short: 'h' }
  }
});

const usage = `Usage:
  npm run check:billing-readiness
  npm run check:billing-readiness -- --providers=stripe,apple
  ts-node --project tsconfig.scripts.json --transpile-only scripts/billing-readiness.ts [--checkDb=false] [--providers=stripe,apple,google]

Checks:
  - Stripe, Apple, and Google billing env/config prerequisites
  - Apple JWS root certificate assets committed in repo
  - (Optional) Supabase access to provider-neutral billing tables
`;

if (values.help) {
  console.log(usage);
  process.exit(0);
}

async function main() {
  const checks: CheckResult[] = [];
  const selectedProviders = parseProviders(values.providers);
  const includeStripe = selectedProviders.has('stripe');
  const includeApple = selectedProviders.has('apple');
  const includeGoogle = selectedProviders.has('google');

  const siteUrl = readEnvAny(['NEXT_PUBLIC_SITE_URL', 'VERCEL_URL']);
  checks.push({
    label: 'Site URL',
    ok: Boolean(siteUrl),
    severity: 'recommended',
    detail: siteUrl ? normalizeSiteUrl(siteUrl) : 'missing (used for webhook audience/default links)'
  });

  if (includeStripe) {
    checks.push({
      label: 'Stripe secret key',
      ok: isNonPlaceholder(readEnv('STRIPE_SECRET_KEY'), ['STRIPE_SECRET_PLACEHOLDER', 'sk_test_placeholder']),
      detail: envStatus('STRIPE_SECRET_KEY')
    });
    checks.push({
      label: 'Stripe webhook secret',
      ok: isNonPlaceholder(readEnv('STRIPE_WEBHOOK_SECRET'), ['whsec_placeholder']),
      detail: envStatus('STRIPE_WEBHOOK_SECRET')
    });
    checks.push({
      label: 'Stripe price id',
      ok: isNonPlaceholder(readEnv('STRIPE_PRICE_PRO_MONTHLY'), ['price_placeholder']),
      detail: envStatus('STRIPE_PRICE_PRO_MONTHLY')
    });
    checks.push({
      label: 'Stripe publishable key',
      ok: isNonPlaceholder(readEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'), [
        'pk_test_placeholder',
        'pk_live_placeholder',
        'STRIPE_PUBLISHABLE_PLACEHOLDER'
      ]),
      detail: envStatus('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY')
    });
  }

  if (includeApple) {
    checks.push({
      label: 'Apple issuer id',
      ok: isNonPlaceholder(readEnv('APPLE_APP_STORE_ISSUER_ID'), ['APPLE_APP_STORE_ISSUER_ID']),
      detail: envStatus('APPLE_APP_STORE_ISSUER_ID')
    });
    checks.push({
      label: 'Apple key id',
      ok: isNonPlaceholder(readEnv('APPLE_APP_STORE_KEY_ID'), ['APPLE_APP_STORE_KEY_ID']),
      detail: envStatus('APPLE_APP_STORE_KEY_ID')
    });
    checks.push({
      label: 'Apple private key',
      ok: isNonPlaceholder(readEnv('APPLE_APP_STORE_PRIVATE_KEY'), ['APPLE_APP_STORE_PRIVATE_KEY']),
      detail: envStatus('APPLE_APP_STORE_PRIVATE_KEY')
    });
    checks.push({
      label: 'Apple bundle id',
      ok: isNonPlaceholder(readEnv('APPLE_APP_STORE_BUNDLE_ID'), ['APPLE_APP_STORE_BUNDLE_ID']),
      detail: envStatus('APPLE_APP_STORE_BUNDLE_ID')
    });
    checks.push({
      label: 'Apple product id',
      ok: isNonPlaceholder(readEnv('APPLE_IAP_PREMIUM_MONTHLY_PRODUCT_ID'), ['APPLE_IAP_PREMIUM_MONTHLY_PRODUCT_ID']),
      detail: envStatus('APPLE_IAP_PREMIUM_MONTHLY_PRODUCT_ID')
    });
    checks.push({
      label: 'Apple app id',
      ok: isNonPlaceholder(readEnv('APPLE_APP_STORE_APP_ID'), ['APPLE_APP_STORE_APP_ID']),
      detail: envStatus('APPLE_APP_STORE_APP_ID')
    });

    const applePkiDir = resolveApplePkiDirectory();
    for (const fileName of ['AppleRootCA-G2.cer', 'AppleRootCA-G3.cer']) {
      const filePath = path.join(applePkiDir, fileName);
      checks.push({
        label: `Apple PKI ${fileName}`,
        ok: fs.existsSync(filePath),
        detail: fs.existsSync(filePath) ? filePath : 'missing'
      });
    }
  }

  if (includeGoogle) {
    checks.push({
      label: 'Google package name',
      ok: isNonPlaceholder(readEnv('GOOGLE_PLAY_PACKAGE_NAME'), ['GOOGLE_PLAY_PACKAGE_NAME']),
      detail: envStatus('GOOGLE_PLAY_PACKAGE_NAME')
    });
    checks.push({
      label: 'Google service account email',
      ok: isNonPlaceholder(readEnv('GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL'), ['GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL']),
      detail: envStatus('GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL')
    });
    checks.push({
      label: 'Google service account key',
      ok: isNonPlaceholder(readEnv('GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY'), ['GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY']),
      detail: envStatus('GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY')
    });
    checks.push({
      label: 'Google product id',
      ok: isNonPlaceholder(readEnv('GOOGLE_IAP_PREMIUM_MONTHLY_PRODUCT_ID'), ['GOOGLE_IAP_PREMIUM_MONTHLY_PRODUCT_ID']),
      detail: envStatus('GOOGLE_IAP_PREMIUM_MONTHLY_PRODUCT_ID')
    });
    checks.push({
      label: 'Google base plan id',
      ok: isNonPlaceholder(readEnv('GOOGLE_IAP_PREMIUM_MONTHLY_BASE_PLAN_ID'), ['GOOGLE_IAP_PREMIUM_MONTHLY_BASE_PLAN_ID']),
      detail: envStatus('GOOGLE_IAP_PREMIUM_MONTHLY_BASE_PLAN_ID')
    });
    checks.push({
      label: 'Google offer token',
      ok: isNonPlaceholder(readEnv('GOOGLE_IAP_PREMIUM_MONTHLY_OFFER_TOKEN'), ['GOOGLE_IAP_PREMIUM_MONTHLY_OFFER_TOKEN']),
      severity: 'recommended',
      detail: envStatus('GOOGLE_IAP_PREMIUM_MONTHLY_OFFER_TOKEN')
    });
    checks.push({
      label: 'Google RTDN audience',
      ok: Boolean(resolveGooglePushAudience()),
      detail: resolveGooglePushAudience() || 'missing'
    });
    checks.push({
      label: 'Google RTDN push service account',
      ok: isNonPlaceholder(readEnv('GOOGLE_PLAY_RTDN_PUSH_SERVICE_ACCOUNT_EMAIL'), ['GOOGLE_PLAY_RTDN_PUSH_SERVICE_ACCOUNT_EMAIL']),
      detail: envStatus('GOOGLE_PLAY_RTDN_PUSH_SERVICE_ACCOUNT_EMAIL')
    });
  }

  const shouldCheckDb = values.checkDb !== false;
  if (shouldCheckDb) {
    const supabaseUrl = readEnvAny(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL']);
    const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');
    if (isNonPlaceholder(supabaseUrl, ['your-supabase-url.supabase.co', 'https://your-supabase-url.supabase.co']) && isNonPlaceholder(serviceRoleKey, ['SUPABASE_SERVICE_ROLE_KEY', 'service_role_key', 'service_role_placeholder'])) {
      checks.push(...(await checkBillingTables(String(supabaseUrl), String(serviceRoleKey))));
    } else {
      checks.push({
        label: 'Billing tables',
        ok: false,
        skipped: true,
        detail: 'skipped (missing Supabase URL or service role key)'
      });
    }
  }

  printChecks(checks);

  const hasHardFailures = checks.some((check) => !check.ok && !check.skipped && check.severity !== 'recommended');
  if (hasHardFailures) {
    process.exitCode = 1;
  }
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
  if (placeholders.some((placeholder) => trimmed === placeholder || trimmed.includes(placeholder))) return false;
  return true;
}

function envStatus(name: string) {
  return readEnv(name) ? 'set' : 'missing';
}

function parseProviders(raw: string | boolean | undefined) {
  const supported = new Set(['stripe', 'apple', 'google']);
  const selected = new Set<string>();
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  const requested = normalized ? normalized.split(',').map((value) => value.trim()).filter(Boolean) : Array.from(supported);

  for (const provider of requested) {
    if (supported.has(provider)) {
      selected.add(provider);
    }
  }

  if (selected.size === 0) {
    return supported;
  }

  return selected;
}

function normalizeSiteUrl(value: string) {
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value.replace(/\/+$/, '');
  }
  return `https://${value.replace(/\/+$/, '')}`;
}

function resolveGooglePushAudience() {
  const explicit = readEnv('GOOGLE_PLAY_RTDN_PUSH_AUDIENCE');
  if (explicit) return explicit;

  const siteUrl = readEnvAny(['NEXT_PUBLIC_SITE_URL', 'VERCEL_URL']);
  if (!siteUrl) return null;
  return `${normalizeSiteUrl(siteUrl)}/api/webhooks/google-play`;
}

function resolveApplePkiDirectory() {
  const candidates = [
    path.resolve(process.cwd(), 'apps/web/lib/server/apple-pki'),
    path.resolve(process.cwd(), 'lib/server/apple-pki')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

async function checkBillingTables(supabaseUrl: string, serviceRoleKey: string): Promise<CheckResult[]> {
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const tables = [
    { name: 'purchase_provider_customers', label: 'purchase_provider_customers' },
    { name: 'purchase_entitlements', label: 'purchase_entitlements' },
    { name: 'purchase_events', label: 'purchase_events' },
    { name: 'webhook_events', label: 'webhook_events' }
  ] as const;

  return Promise.all(
    tables.map(async (table) => {
      const result = await admin.from(table.name).select('id', { count: 'exact', head: true });
      return {
        label: `Table ${table.label}`,
        ok: !result.error,
        detail: result.error ? result.error.message : `reachable (count=${result.count ?? 0})`
      } satisfies CheckResult;
    })
  );
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

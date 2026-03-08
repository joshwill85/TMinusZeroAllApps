import { config } from 'dotenv';
import Stripe from 'stripe';
import { parseArgs } from 'node:util';

config({ path: '.env.local' });
config();

const REQUIRED_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted'
];

const { values } = parseArgs({
  options: {
    siteUrl: { type: 'string' },
    help: { type: 'boolean', short: 'h' }
  }
});

const usage = `Usage:
  npm run check:stripe-webhook
  npm run check:stripe-webhook -- --site-url=https://tminuszero.app

Checks:
  - Finds Stripe webhook endpoints matching <site-url>/api/webhooks/stripe (or auto-detects any endpoint ending in /api/webhooks/stripe)
  - Verifies required events are enabled:
    - ${REQUIRED_EVENTS.join('\n    - ')}
`;

if (values.help) {
  console.log(usage);
  process.exit(0);
}

async function main() {
  const stripeSecret = readEnv('STRIPE_SECRET_KEY');
  if (!stripeSecret || isPlaceholder(stripeSecret, ['STRIPE_SECRET_PLACEHOLDER', 'sk_test_placeholder'])) {
    console.error('Missing STRIPE_SECRET_KEY.');
    process.exitCode = 1;
    return;
  }

  const stripe = new Stripe(stripeSecret, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient()
  });

  const siteUrl = resolveSiteUrl(values.siteUrl);
  const expectedUrl = siteUrl ? `${siteUrl.replace(/\/+$/, '')}/api/webhooks/stripe` : '';
  const endpoints = await listWebhookEndpoints(stripe);

  const endsWithPath = (url: string) => normalizeUrl(url).endsWith('/api/webhooks/stripe');
  const detected = endpoints.filter((endpoint) => endsWithPath(endpoint.url) || endpoint.url.includes('/api/webhooks/stripe'));

  const matches = expectedUrl ? endpoints.filter((endpoint) => normalizeUrl(endpoint.url) === normalizeUrl(expectedUrl)) : detected;
  if (matches.length === 0) {
    if (expectedUrl) {
      console.error(`No Stripe webhook endpoints found for: ${expectedUrl}`);
      if (detected.length > 0) {
        console.log('');
        console.log('Found other endpoints that include "/api/webhooks/stripe":');
        for (const endpoint of detected) {
          console.log(`- ${endpoint.url} (${endpoint.id})`);
        }
      }
    } else {
      console.error('No Stripe webhook endpoints found ending in /api/webhooks/stripe.');
      console.error('Pass --site-url=https://<your-domain> to check a specific endpoint URL.');
      console.log('');
      console.log(usage);
    }
    process.exitCode = 1;
    return;
  }

  const results = matches.map((endpoint) => analyzeEndpoint(endpoint));
  printResults({ expectedUrl: expectedUrl || 'auto-detected', results });

  const ok = results.some((result) => result.missingEvents.length === 0);
  if (!ok) process.exitCode = 1;
}

function readEnv(name: string) {
  const raw = process.env[name];
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

function resolveSiteUrl(cliSiteUrl: string | undefined) {
  const raw =
    String(cliSiteUrl || '').trim() ||
    String(process.env.NEXT_PUBLIC_SITE_URL || '').trim() ||
    (() => {
      const vercelUrl = String(process.env.VERCEL_URL || '').trim();
      return vercelUrl ? `https://${vercelUrl.replace(/\/+$/, '')}` : '';
    })();

  return raw ? raw.replace(/\/+$/, '') : '';
}

function isPlaceholder(value: string, placeholders: string[]) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return placeholders.some((placeholder) => trimmed === placeholder || trimmed.includes(placeholder));
}

function normalizeUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

async function listWebhookEndpoints(stripe: Stripe) {
  const results: Stripe.WebhookEndpoint[] = [];
  let startingAfter: string | undefined;

  while (true) {
    const page = await stripe.webhookEndpoints.list({ limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    results.push(...page.data);
    if (!page.has_more) break;
    const last = page.data[page.data.length - 1];
    startingAfter = last?.id;
    if (!startingAfter) break;
  }

  return results;
}

function analyzeEndpoint(endpoint: Stripe.WebhookEndpoint) {
  const enabledEvents = Array.isArray(endpoint.enabled_events) ? endpoint.enabled_events : [];
  const hasWildcard = enabledEvents.includes('*');
  const missingEvents = hasWildcard ? [] : REQUIRED_EVENTS.filter((event) => !enabledEvents.includes(event));

  return {
    id: endpoint.id,
    url: endpoint.url,
    apiVersion: endpoint.api_version || null,
    status: (endpoint as any).status ? String((endpoint as any).status) : null,
    missingEvents
  };
}

function printResults({
  expectedUrl,
  results
}: {
  expectedUrl: string;
  results: Array<{ id: string; url: string; apiVersion: string | null; status: string | null; missingEvents: string[] }>;
}) {
  console.log(`Stripe webhook endpoints for: ${expectedUrl}`);
  for (const result of results) {
    const status = result.missingEvents.length === 0 ? 'OK' : 'FAIL';
    const meta = [
      result.status ? `status=${result.status}` : null,
      result.apiVersion ? `api_version=${result.apiVersion}` : null
    ]
      .filter(Boolean)
      .join(' ');

    console.log(`- ${status} ${result.id}${meta ? ` (${meta})` : ''}`);
    if (result.missingEvents.length > 0) {
      console.log(`  Missing events: ${result.missingEvents.join(', ')}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

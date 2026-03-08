import type { Metadata } from 'next';
import Link from 'next/link';
import { BRAND_NAME } from '@/lib/brand';
import { isSupabaseConfigured } from '@/lib/server/env';
import { fetchUsProviderCounts } from '@/lib/server/usProviderCounts';

export const revalidate = 60 * 60 * 6; // 6 hours

export const metadata: Metadata = {
  title: `Launch Providers (US Schedules) | ${BRAND_NAME}`,
  description: `Browse US rocket launch schedules by provider — SpaceX, NASA, ULA, and more.`,
  alternates: { canonical: '/launch-providers' }
};

const FALLBACK_PROVIDERS: Array<{ name: string; slug: string }> = [
  { name: 'SpaceX', slug: 'spacex' },
  { name: 'NASA', slug: 'nasa' },
  { name: 'United Launch Alliance (ULA)', slug: 'united-launch-alliance-ula' },
  { name: 'Rocket Lab', slug: 'rocket-lab' },
  { name: 'Blue Origin', slug: 'blue-origin' }
];

export default async function LaunchProvidersPage() {
  const supabaseReady = isSupabaseConfigured();
  const providers = supabaseReady ? await fetchUsProviderCounts() : [];

  const rows =
    providers.length > 0
      ? providers.map((provider) => ({
          name: provider.name,
          slug: provider.slug,
          badge: `${provider.launchCountYear} launches (1y)`
        }))
      : FALLBACK_PROVIDERS.map((provider) => ({
          name: provider.name,
          slug: provider.slug,
          badge: null as string | null
        }));

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 md:px-8">
      <header className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-text3">Browse</p>
          <h1 className="text-3xl font-semibold text-text1">Launch Providers</h1>
        </div>
        <p className="max-w-3xl text-sm text-text2">
          Provider schedule hubs for US launches. Use these pages to track upcoming missions and recent history by operator.
        </p>
      </header>

      {!supabaseReady && (
        <div className="mt-6 rounded-2xl border border-stroke bg-surface-1 p-5 text-sm text-text2">
          Configure Supabase env vars to load dynamic provider counts. Showing a default list.
        </div>
      )}

      <section className="mt-8 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {rows.map((provider) => (
          <Link
            key={provider.slug}
            href={`/launch-providers/${encodeURIComponent(provider.slug)}`}
            className="group rounded-2xl border border-stroke bg-surface-1/60 p-4 backdrop-blur-xl transition hover:border-primary"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-text1 group-hover:text-primary">{provider.name}</div>
                <div className="mt-1 text-xs text-text3">US launch schedule</div>
              </div>
              {provider.badge && (
                <span className="shrink-0 rounded-full border border-stroke px-3 py-1 text-[11px] uppercase tracking-[0.08em] text-text3">
                  {provider.badge}
                </span>
              )}
            </div>
          </Link>
        ))}
      </section>

      <div className="mt-10 flex flex-wrap items-center gap-3 text-xs text-text3">
        <Link href="/#schedule" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Back to schedule
        </Link>
        <Link href="/news" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          News
        </Link>
      </div>
    </div>
  );
}

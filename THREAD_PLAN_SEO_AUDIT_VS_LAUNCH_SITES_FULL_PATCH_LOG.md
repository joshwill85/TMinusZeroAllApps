# Plan SEO Audit vs Launch Sites - Full Patch Log

This document contains the full commit-level `+/-` code patches from git for the implementation chain associated with this thread.

## Scope

- Artemis rollout commit: `7baa09a`
- AR trajectory precision commit: `cbbe672`
- Starship tracking commit: `a455daa`

## Current Repository State

```text
main
?? SESSION_CODE_CHANGES.md
?? THREAD_PLAN_SEO_AUDIT_VS_LAUNCH_SITES_FULL_PATCH_LOG.md
a455daa (HEAD -> main, origin/main, origin/HEAD) Add Starship program tracking feature
cbbe672 Implement AR trajectory precision v2 (trajectory-only)
bc7f1f3 Merge pull request #8 from joshwill85/feature/artemis-v3
7baa09a Plan Artemis page buildout
a08ef51 social: remove URL followups; monitoring: add job enable checks
01700f3 Merge pull request #7 from joshwill85/fix/home-freshness-inline
1766a82 admin: refactor dashboard + add modular pages & SMS opt-in docs
e93e43c home: remove Data Freshness panel; inline premium checks
4dcbd2b Merge pull request #6 from joshwill85/fix/home-feed-smooth-load
4b4639c home: SSR premium live feed + no-interruption refresh
6bef139 Add debug logging for feed and launch detail
5f8918c Remove premium launch feed views
```

## Commit `7baa09a`

```text
commit 7baa09aa835f48573b44ef94278f79b0006614e0
Author:     joshwill85 <168236617+joshwill85@users.noreply.github.com>
AuthorDate: Thu Feb 5 18:42:01 2026 -0500
Commit:     joshwill85 <168236617+joshwill85@users.noreply.github.com>
CommitDate: Thu Feb 5 18:42:01 2026 -0500

    Plan Artemis page buildout
```

### Files

```text
M	app/api/admin/sync/route.ts
A	app/api/public/artemis/evidence/route.ts
A	app/api/public/artemis/timeline/route.ts
A	app/artemis-2/page.tsx
A	app/artemis-i/page.tsx
A	app/artemis-ii/page.tsx
A	app/artemis-iii/page.tsx
A	app/artemis/page.tsx
M	app/page.tsx
M	app/sitemap.ts
M	components/DockingBay.tsx
M	components/Footer.tsx
M	components/LaunchFeed.tsx
M	components/NavBar.tsx
A	components/artemis/ArtemisChangeLedger.tsx
A	components/artemis/ArtemisEventDrawer.tsx
A	components/artemis/ArtemisEvidenceCenter.tsx
A	components/artemis/ArtemisKpiStrip.tsx
A	components/artemis/ArtemisMissionRail.tsx
A	components/artemis/ArtemisModeSwitch.tsx
A	components/artemis/ArtemisProgramWorkbenchDesktop.tsx
A	components/artemis/ArtemisProgramWorkbenchMobile.tsx
A	components/artemis/ArtemisSystemsGraph.tsx
A	components/artemis/ArtemisTimelineExplorer.tsx
A	lib/server/artemis.ts
A	lib/server/artemisUi.ts
M	lib/server/siteMeta.ts
A	lib/types/artemis.ts
A	lib/utils/artemis.ts
M	lib/utils/launchArtemis.ts
M	next.config.mjs
M	scripts/seo-tests.ts
A	supabase/functions/_shared/artemisIngest.ts
A	supabase/functions/_shared/artemisSources.ts
A	supabase/functions/artemis-bootstrap/index.ts
A	supabase/functions/artemis-budget-ingest/index.ts
A	supabase/functions/artemis-nasa-ingest/index.ts
A	supabase/functions/artemis-oversight-ingest/index.ts
A	supabase/functions/artemis-procurement-ingest/index.ts
A	supabase/functions/artemis-snapshot-build/index.ts
A	supabase/migrations/0148_artemis_core.sql
A	supabase/migrations/0149_artemis_bootstrap_state.sql
```

### Full Patch (+/-)

```diff
diff --git a/app/api/admin/sync/route.ts b/app/api/admin/sync/route.ts
index f92c402..2458e0d 100644
--- a/app/api/admin/sync/route.ts
+++ b/app/api/admin/sync/route.ts
@@ -32,11 +32,18 @@ const JOBS = {
   trajectory_products_generate: { slug: 'trajectory-products-generate' },
   trajectory_templates_generate: { slug: 'trajectory-templates-generate' },
 
+  artemis_bootstrap: { slug: 'artemis-bootstrap' },
+  artemis_nasa_ingest: { slug: 'artemis-nasa-ingest' },
+  artemis_oversight_ingest: { slug: 'artemis-oversight-ingest' },
+  artemis_budget_ingest: { slug: 'artemis-budget-ingest' },
+  artemis_procurement_ingest: { slug: 'artemis-procurement-ingest' },
+  artemis_snapshot_build: { slug: 'artemis-snapshot-build' },
+
   notifications_send: { slug: 'notifications-send' },
   monitoring_check: { slug: 'monitoring-check' }
 } as const;
 
-const FORCE_BODY_JOBS = new Set(['ll2_backfill', 'll2_payload_backfill', 'rocket_media_backfill']);
+const FORCE_BODY_JOBS = new Set(['ll2_backfill', 'll2_payload_backfill', 'rocket_media_backfill', 'artemis_bootstrap']);
 
 const schema = z.object({
   job: z.enum([
@@ -65,6 +72,13 @@ const schema = z.object({
     'trajectory_products_generate',
     'trajectory_templates_generate',
 
+    'artemis_bootstrap',
+    'artemis_nasa_ingest',
+    'artemis_oversight_ingest',
+    'artemis_budget_ingest',
+    'artemis_procurement_ingest',
+    'artemis_snapshot_build',
+
     'notifications_send',
     'monitoring_check'
   ])
diff --git a/app/api/public/artemis/evidence/route.ts b/app/api/public/artemis/evidence/route.ts
new file mode 100644
index 0000000..7cf0b1b
--- /dev/null
+++ b/app/api/public/artemis/evidence/route.ts
@@ -0,0 +1,29 @@
+import { NextResponse } from 'next/server';
+import { fetchArtemisEventEvidence } from '@/lib/server/artemisUi';
+
+export const dynamic = 'force-dynamic';
+
+export async function GET(request: Request) {
+  const { searchParams } = new URL(request.url);
+  const eventId = searchParams.get('eventId')?.trim();
+
+  if (!eventId) {
+    return NextResponse.json({ error: 'event_id_required' }, { status: 400 });
+  }
+
+  try {
+    const evidence = await fetchArtemisEventEvidence(eventId);
+    if (!evidence) {
+      return NextResponse.json({ error: 'event_not_found' }, { status: 404 });
+    }
+
+    return NextResponse.json(evidence, {
+      headers: {
+        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800, stale-if-error=86400'
+      }
+    });
+  } catch (error) {
+    console.error('artemis evidence api error', error);
+    return NextResponse.json({ error: 'evidence_failed' }, { status: 500 });
+  }
+}
diff --git a/app/api/public/artemis/timeline/route.ts b/app/api/public/artemis/timeline/route.ts
new file mode 100644
index 0000000..cf90a11
--- /dev/null
+++ b/app/api/public/artemis/timeline/route.ts
@@ -0,0 +1,72 @@
+import { NextResponse } from 'next/server';
+import type { ArtemisTimelineQuery } from '@/lib/types/artemis';
+import {
+  fetchArtemisTimelineViewModel,
+  parseArtemisAudienceMode,
+  parseArtemisMissionFilter,
+  parseArtemisSourceFilter,
+  parseBooleanParam,
+  parseIsoDateParam,
+  parseTimelineCursor,
+  parseTimelineLimit
+} from '@/lib/server/artemisUi';
+
+export const dynamic = 'force-dynamic';
+
+export async function GET(request: Request) {
+  const { searchParams } = new URL(request.url);
+
+  const mode = parseArtemisAudienceMode(searchParams.get('mode'));
+  if (!mode) return NextResponse.json({ error: 'invalid_mode' }, { status: 400 });
+
+  const mission = parseArtemisMissionFilter(searchParams.get('mission'));
+  if (!mission) return NextResponse.json({ error: 'invalid_mission' }, { status: 400 });
+
+  const sourceType = parseArtemisSourceFilter(searchParams.get('sourceType'));
+  if (!sourceType) return NextResponse.json({ error: 'invalid_source_type' }, { status: 400 });
+
+  const includeSuperseded = parseBooleanParam(searchParams.get('includeSuperseded'), false);
+  if (includeSuperseded == null) return NextResponse.json({ error: 'invalid_include_superseded' }, { status: 400 });
+
+  const from = parseIsoDateParam(searchParams.get('from'));
+  if (from === 'invalid') return NextResponse.json({ error: 'invalid_from' }, { status: 400 });
+
+  const to = parseIsoDateParam(searchParams.get('to'));
+  if (to === 'invalid') return NextResponse.json({ error: 'invalid_to' }, { status: 400 });
+
+  if (from && to && from > to) {
+    return NextResponse.json({ error: 'invalid_date_range' }, { status: 400 });
+  }
+
+  const limit = parseTimelineLimit(searchParams.get('limit'));
+  if (limit == null) return NextResponse.json({ error: 'invalid_limit' }, { status: 400 });
+
+  const cursorRaw = searchParams.get('cursor');
+  if (cursorRaw && !/^\d+$/.test(cursorRaw.trim())) {
+    return NextResponse.json({ error: 'invalid_cursor' }, { status: 400 });
+  }
+
+  const cursor = parseTimelineCursor(cursorRaw);
+  const query: ArtemisTimelineQuery = {
+    mode,
+    mission,
+    sourceType,
+    includeSuperseded,
+    from,
+    to,
+    cursor,
+    limit
+  };
+
+  try {
+    const payload = await fetchArtemisTimelineViewModel(query);
+    return NextResponse.json(payload, {
+      headers: {
+        'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=900, stale-if-error=86400'
+      }
+    });
+  } catch (error) {
+    console.error('artemis timeline api error', error);
+    return NextResponse.json({ error: 'timeline_failed' }, { status: 500 });
+  }
+}
diff --git a/app/artemis-2/page.tsx b/app/artemis-2/page.tsx
new file mode 100644
index 0000000..797cbb4
--- /dev/null
+++ b/app/artemis-2/page.tsx
@@ -0,0 +1,5 @@
+import { permanentRedirect } from 'next/navigation';
+
+export default function ArtemisTwoAliasPage() {
+  permanentRedirect('/artemis-ii');
+}
diff --git a/app/artemis-i/page.tsx b/app/artemis-i/page.tsx
new file mode 100644
index 0000000..5dfa824
--- /dev/null
+++ b/app/artemis-i/page.tsx
@@ -0,0 +1,327 @@
+import type { Metadata } from 'next';
+import Link from 'next/link';
+import { JsonLd } from '@/components/JsonLd';
+import { TimeDisplay } from '@/components/TimeDisplay';
+import { BRAND_NAME } from '@/lib/brand';
+import { getSiteUrl } from '@/lib/server/env';
+import { fetchArtemisProgramSnapshot } from '@/lib/server/artemis';
+import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
+import type { Launch } from '@/lib/types/launch';
+import { buildLaunchHref } from '@/lib/utils/launchLinks';
+
+export const revalidate = 60 * 60; // 1 hour
+
+const ARTEMIS_I_PATTERN = /\bartem[iu]s(?:\s*[-:]?\s*)(?:i|1)\b/i;
+const ARTEMIS_II_PATTERN = /\bartem[iu]s(?:\s*[-:]?\s*)(?:ii|2)\b/i;
+const ARTEMIS_III_PATTERN = /\bartem[iu]s(?:\s*[-:]?\s*)(?:iii|3)\b/i;
+
+const ARTEMIS_I_FAQ = [
+  {
+    question: 'Was Artemis I crewed?',
+    answer:
+      'No. Artemis I was an uncrewed integrated test flight of Orion and SLS, flown to validate mission systems before crewed Artemis missions.'
+  },
+  {
+    question: 'Why keep an Artemis I page if the mission is complete?',
+    answer:
+      'Artemis I remains a major program milestone. This page provides historical context, tracked launch entries, and links back to active Artemis mission coverage.'
+  },
+  {
+    question: 'Where should I track upcoming crewed Artemis launches?',
+    answer:
+      'Use the Artemis II page for current crewed schedule and countdown details, and the Artemis III page for future lunar-landing mission planning updates.'
+  }
+] as const;
+
+export async function generateMetadata(): Promise<Metadata> {
+  const siteMeta = buildSiteMeta();
+  const siteUrl = getSiteUrl().replace(/\/$/, '');
+  const canonical = '/artemis-i';
+  const pageUrl = `${siteUrl}${canonical}`;
+  const title = `Artemis I (Artemis 1) Mission Recap & Timeline | ${BRAND_NAME}`;
+  const description = 'Artemis I mission recap with timeline context, tracked launch entries, and links to ongoing Artemis mission coverage.';
+  const images = [
+    {
+      url: siteMeta.ogImage,
+      width: 1200,
+      height: 630,
+      alt: SITE_META.ogImageAlt,
+      type: 'image/jpeg'
+    }
+  ];
+
+  return {
+    title,
+    description,
+    alternates: { canonical },
+    openGraph: {
+      title,
+      description,
+      url: pageUrl,
+      type: 'website',
+      siteName: SITE_META.siteName,
+      images
+    },
+    twitter: {
+      card: 'summary_large_image',
+      title,
+      description,
+      images: [
+        {
+          url: siteMeta.ogImage,
+          alt: SITE_META.ogImageAlt
+        }
+      ]
+    }
+  };
+}
+
+export default async function ArtemisIMissionPage() {
+  const snapshot = await fetchArtemisProgramSnapshot();
+  const siteUrl = getSiteUrl().replace(/\/$/, '');
+  const pageUrl = `${siteUrl}/artemis-i`;
+  const upcoming = snapshot.upcoming.filter(isArtemisIMissionLaunch);
+  const recent = snapshot.recent.filter(isArtemisIMissionLaunch);
+  const launches = dedupeLaunches([...upcoming, ...recent]);
+  const featuredLaunch = launches[0] || null;
+  const lastUpdatedLabel = formatUpdatedLabel(snapshot.lastUpdated || snapshot.generatedAt);
+
+  const breadcrumbJsonLd = {
+    '@context': 'https://schema.org',
+    '@type': 'BreadcrumbList',
+    itemListElement: [
+      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
+      { '@type': 'ListItem', position: 2, name: 'Artemis', item: `${siteUrl}/artemis` },
+      { '@type': 'ListItem', position: 3, name: 'Artemis I', item: pageUrl }
+    ]
+  };
+
+  const collectionPageJsonLd = {
+    '@context': 'https://schema.org',
+    '@type': 'CollectionPage',
+    '@id': pageUrl,
+    url: pageUrl,
+    name: 'Artemis I (Artemis 1)',
+    description: 'Artemis I mission context and tracked launch timeline.',
+    dateModified: snapshot.lastUpdated || snapshot.generatedAt
+  };
+
+  const eventJsonLd =
+    featuredLaunch != null
+      ? {
+          '@context': 'https://schema.org',
+          '@type': 'Event',
+          '@id': `${pageUrl}#mission-event`,
+          name: featuredLaunch.name,
+          startDate: featuredLaunch.net,
+          eventStatus: mapEventStatus(featuredLaunch),
+          location: {
+            '@type': 'Place',
+            name: featuredLaunch.pad?.name,
+            address: {
+              '@type': 'PostalAddress',
+              addressLocality: featuredLaunch.pad?.locationName || undefined,
+              addressRegion: featuredLaunch.pad?.state || undefined,
+              addressCountry: featuredLaunch.pad?.countryCode || undefined
+            }
+          },
+          organizer: featuredLaunch.provider ? { '@type': 'Organization', name: featuredLaunch.provider } : undefined,
+          url: `${siteUrl}${buildLaunchHref(featuredLaunch)}`
+        }
+      : null;
+
+  const itemListJsonLd =
+    launches.length > 0
+      ? {
+          '@context': 'https://schema.org',
+          '@type': 'ItemList',
+          '@id': `${pageUrl}#tracked-launches`,
+          numberOfItems: Math.min(25, launches.length),
+          itemListElement: launches.slice(0, 25).map((launch, index) => ({
+            '@type': 'ListItem',
+            position: index + 1,
+            item: {
+              '@type': 'Event',
+              name: launch.name,
+              startDate: launch.net,
+              url: `${siteUrl}${buildLaunchHref(launch)}`
+            }
+          }))
+        }
+      : null;
+
+  const faqJsonLd = {
+    '@context': 'https://schema.org',
+    '@type': 'FAQPage',
+    '@id': `${pageUrl}#faq`,
+    mainEntity: ARTEMIS_I_FAQ.map((entry) => ({
+      '@type': 'Question',
+      name: entry.question,
+      acceptedAnswer: { '@type': 'Answer', text: entry.answer }
+    }))
+  };
+
+  return (
+    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
+      <JsonLd data={[breadcrumbJsonLd, collectionPageJsonLd, ...(eventJsonLd ? [eventJsonLd] : []), ...(itemListJsonLd ? [itemListJsonLd] : []), faqJsonLd]} />
+
+      <header className="space-y-4">
+        <p className="text-xs uppercase tracking-[0.14em] text-text3">Mission Hub</p>
+        <h1 className="text-3xl font-semibold text-text1">Artemis I (Artemis 1)</h1>
+        <p className="max-w-3xl text-sm text-text2">
+          Artemis I was the uncrewed lunar test mission that opened NASA&apos;s Artemis era. This route provides mission recap context and launch timeline references while current planning focus shifts to Artemis II and Artemis III.
+        </p>
+        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
+          <span className="rounded-full border border-stroke px-3 py-1">Last updated: {lastUpdatedLabel}</span>
+          <span className="rounded-full border border-stroke px-3 py-1">Mission status: Completed</span>
+        </div>
+      </header>
+
+      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
+        <h2 className="text-xl font-semibold text-text1">Mission snapshot</h2>
+        <p className="mt-2 text-sm text-text2">
+          Artemis I validated the SLS-Orion stack through a lunar flight profile and recovery sequence, providing data used to progress crewed Artemis objectives.
+        </p>
+        {featuredLaunch ? (
+          <div className="mt-3 rounded-xl border border-stroke bg-surface-0 p-3">
+            <p className="text-xs uppercase tracking-[0.14em] text-text3">Tracked launch record</p>
+            <Link href={buildLaunchHref(featuredLaunch)} className="mt-2 inline-block text-sm font-semibold text-text1 hover:text-primary">
+              {featuredLaunch.name}
+            </Link>
+            <p className="mt-1 text-xs text-text3">
+              {featuredLaunch.provider} - {featuredLaunch.vehicle}
+            </p>
+            <div className="mt-2">
+              <TimeDisplay net={featuredLaunch.net} netPrecision={featuredLaunch.netPrecision} />
+            </div>
+          </div>
+        ) : (
+          <p className="mt-3 text-sm text-text2">No Artemis I launch record is currently present in the feed snapshot.</p>
+        )}
+      </section>
+
+      <LaunchList title="Artemis I launch timeline entries" launches={launches} emptyLabel="No Artemis I entries are currently present in the mission feed snapshot." />
+
+      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
+        <h2 className="text-xl font-semibold text-text1">Artemis I FAQ</h2>
+        <dl className="mt-4 space-y-4">
+          {ARTEMIS_I_FAQ.map((entry) => (
+            <div key={entry.question}>
+              <dt className="text-sm font-semibold text-text1">{entry.question}</dt>
+              <dd className="mt-1 text-sm text-text2">{entry.answer}</dd>
+            </div>
+          ))}
+        </dl>
+      </section>
+
+      <div className="flex flex-wrap items-center gap-3 text-xs text-text3">
+        <Link href="/artemis" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
+          Artemis Workbench
+        </Link>
+        <Link href="/artemis-ii" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
+          Artemis II Hub
+        </Link>
+        <Link href="/artemis-iii" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
+          Artemis III Hub
+        </Link>
+      </div>
+    </div>
+  );
+}
+
+function LaunchList({ title, launches, emptyLabel }: { title: string; launches: Launch[]; emptyLabel: string }) {
+  return (
+    <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
+      <div className="flex flex-wrap items-center justify-between gap-2">
+        <h2 className="text-xl font-semibold text-text1">{title}</h2>
+        <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">{launches.length} items</span>
+      </div>
+
+      {launches.length === 0 ? (
+        <p className="mt-3 text-sm text-text3">{emptyLabel}</p>
+      ) : (
+        <ul className="mt-4 grid gap-3 md:grid-cols-2">
+          {launches.map((launch) => (
+            <li key={launch.id} className="rounded-xl border border-stroke bg-surface-0 p-3">
+              <div className="flex items-start justify-between gap-3">
+                <div className="min-w-0">
+                  <Link href={buildLaunchHref(launch)} className="text-sm font-semibold text-text1 hover:text-primary">
+                    {launch.name}
+                  </Link>
+                  <p className="mt-1 text-xs text-text3">
+                    {launch.provider} - {launch.pad.shortCode}
+                  </p>
+                </div>
+                <div className="text-right text-xs text-text3">
+                  <div>{formatLaunchDate(launch)}</div>
+                </div>
+              </div>
+            </li>
+          ))}
+        </ul>
+      )}
+    </section>
+  );
+}
+
+function isArtemisIMissionLaunch(launch: Launch) {
+  const text = collectMissionText(launch);
+  return ARTEMIS_I_PATTERN.test(text) && !ARTEMIS_II_PATTERN.test(text) && !ARTEMIS_III_PATTERN.test(text);
+}
+
+function collectMissionText(launch: Launch) {
+  const values: string[] = [launch.name, launch.mission?.name || ''];
+  for (const program of launch.programs || []) {
+    if (program?.name) values.push(program.name);
+    if (program?.description) values.push(program.description);
+  }
+  return values.join(' ').trim();
+}
+
+function dedupeLaunches(launches: Launch[]) {
+  const seen = new Set<string>();
+  const deduped: Launch[] = [];
+  for (const launch of launches) {
+    if (seen.has(launch.id)) continue;
+    seen.add(launch.id);
+    deduped.push(launch);
+  }
+  return deduped;
+}
+
+function mapEventStatus(launch: Launch) {
+  if (launch.status === 'scrubbed') return 'https://schema.org/EventCancelled';
+  if (launch.status === 'hold') return 'https://schema.org/EventPostponed';
+  const startMs = Date.parse(launch.net);
+  if (Number.isFinite(startMs) && startMs < Date.now()) return 'https://schema.org/EventCompleted';
+  return 'https://schema.org/EventScheduled';
+}
+
+function formatLaunchDate(launch: Launch) {
+  const date = new Date(launch.net);
+  if (Number.isNaN(date.getTime())) return launch.net;
+  const zone = launch.pad?.timezone || 'UTC';
+  const options: Intl.DateTimeFormatOptions = {
+    month: 'short',
+    day: '2-digit',
+    year: 'numeric',
+    hour: 'numeric',
+    minute: '2-digit',
+    timeZone: zone,
+    timeZoneName: 'short'
+  };
+  return new Intl.DateTimeFormat('en-US', options).format(date);
+}
+
+function formatUpdatedLabel(value: string) {
+  const date = new Date(value);
+  if (Number.isNaN(date.getTime())) return value;
+  return new Intl.DateTimeFormat('en-US', {
+    month: 'short',
+    day: '2-digit',
+    year: 'numeric',
+    hour: 'numeric',
+    minute: '2-digit',
+    timeZoneName: 'short'
+  }).format(date);
+}
diff --git a/app/artemis-ii/page.tsx b/app/artemis-ii/page.tsx
new file mode 100644
index 0000000..92c9fe4
--- /dev/null
+++ b/app/artemis-ii/page.tsx
@@ -0,0 +1,400 @@
+import type { Metadata } from 'next';
+import Link from 'next/link';
+import { Countdown } from '@/components/Countdown';
+import { JsonLd } from '@/components/JsonLd';
+import { TimeDisplay } from '@/components/TimeDisplay';
+import { BRAND_NAME } from '@/lib/brand';
+import { isDateOnlyNet } from '@/lib/time';
+import { getSiteUrl } from '@/lib/server/env';
+import { fetchArtemisIISnapshot } from '@/lib/server/artemis';
+import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
+import type { Launch } from '@/lib/types/launch';
+import { buildLaunchHref } from '@/lib/utils/launchLinks';
+
+export const revalidate = 60 * 60; // 1 hour
+
+export async function generateMetadata(): Promise<Metadata> {
+  const siteMeta = buildSiteMeta();
+  const siteUrl = getSiteUrl().replace(/\/$/, '');
+  const canonical = '/artemis-ii';
+  const pageUrl = `${siteUrl}${canonical}`;
+  const title = `Artemis II (Artemis 2) Launch Schedule & Countdown | ${BRAND_NAME}`;
+  const description = 'Artemis II (Artemis 2) launch date, countdown, mission updates, crew details, and watch links.';
+  const images = [
+    {
+      url: siteMeta.ogImage,
+      width: 1200,
+      height: 630,
+      alt: SITE_META.ogImageAlt,
+      type: 'image/jpeg'
+    }
+  ];
+
+  return {
+    title,
+    description,
+    alternates: { canonical },
+    openGraph: {
+      title,
+      description,
+      url: pageUrl,
+      type: 'website',
+      siteName: SITE_META.siteName,
+      images
+    },
+    twitter: {
+      card: 'summary_large_image',
+      title,
+      description,
+      images: [
+        {
+          url: siteMeta.ogImage,
+          alt: SITE_META.ogImageAlt
+        }
+      ]
+    }
+  };
+}
+
+export default async function ArtemisIIMissionPage() {
+  const snapshot = await fetchArtemisIISnapshot();
+  const siteUrl = getSiteUrl().replace(/\/$/, '');
+  const pageUrl = `${siteUrl}/artemis-ii`;
+  const nextLaunch = snapshot.nextLaunch;
+  const watchLinks = resolveWatchLinks(nextLaunch);
+  const lastUpdatedLabel = formatUpdatedLabel(snapshot.lastUpdated || snapshot.generatedAt);
+  const launchHref = nextLaunch ? buildLaunchHref(nextLaunch) : null;
+
+  const breadcrumbJsonLd = {
+    '@context': 'https://schema.org',
+    '@type': 'BreadcrumbList',
+    itemListElement: [
+      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
+      { '@type': 'ListItem', position: 2, name: 'Artemis', item: `${siteUrl}/artemis` },
+      { '@type': 'ListItem', position: 3, name: 'Artemis II', item: pageUrl }
+    ]
+  };
+
+  const collectionPageJsonLd = {
+    '@context': 'https://schema.org',
+    '@type': 'CollectionPage',
+    '@id': pageUrl,
+    url: pageUrl,
+    name: snapshot.missionName,
+    description: 'Artemis II (Artemis 2) mission schedule, countdown, crew overview, and recent updates.',
+    dateModified: snapshot.lastUpdated || snapshot.generatedAt
+  };
+
+  const eventJsonLd =
+    nextLaunch != null
+      ? {
+          '@context': 'https://schema.org',
+          '@type': 'Event',
+          '@id': `${pageUrl}#next-launch`,
+          name: nextLaunch.name,
+          startDate: nextLaunch.net,
+          eventStatus:
+            nextLaunch.status === 'scrubbed'
+              ? 'https://schema.org/EventCancelled'
+              : nextLaunch.status === 'hold'
+                ? 'https://schema.org/EventPostponed'
+                : 'https://schema.org/EventScheduled',
+          location: {
+            '@type': 'Place',
+            name: nextLaunch.pad?.name,
+            address: {
+              '@type': 'PostalAddress',
+              addressLocality: nextLaunch.pad?.locationName || undefined,
+              addressRegion: nextLaunch.pad?.state || undefined,
+              addressCountry: nextLaunch.pad?.countryCode || undefined
+            }
+          },
+          organizer: nextLaunch.provider ? { '@type': 'Organization', name: nextLaunch.provider } : undefined,
+          url: launchHref ? `${siteUrl}${launchHref}` : pageUrl
+        }
+      : null;
+
+  const itemListJsonLd =
+    snapshot.upcoming.length > 0
+      ? {
+          '@context': 'https://schema.org',
+          '@type': 'ItemList',
+          '@id': `${pageUrl}#upcoming-artemis-ii-launches`,
+          numberOfItems: Math.min(25, snapshot.upcoming.length),
+          itemListElement: snapshot.upcoming.slice(0, 25).map((launch, index) => ({
+            '@type': 'ListItem',
+            position: index + 1,
+            item: {
+              '@type': 'Event',
+              name: launch.name,
+              startDate: launch.net,
+              url: `${siteUrl}${buildLaunchHref(launch)}`
+            }
+          }))
+        }
+      : null;
+
+  const faqJsonLd = {
+    '@context': 'https://schema.org',
+    '@type': 'FAQPage',
+    '@id': `${pageUrl}#faq`,
+    mainEntity: snapshot.faq.map((entry) => ({
+      '@type': 'Question',
+      name: entry.question,
+      acceptedAnswer: { '@type': 'Answer', text: entry.answer }
+    }))
+  };
+
+  return (
+    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
+      <JsonLd
+        data={[breadcrumbJsonLd, collectionPageJsonLd, ...(eventJsonLd ? [eventJsonLd] : []), ...(itemListJsonLd ? [itemListJsonLd] : []), faqJsonLd]}
+      />
+
+      <header className="space-y-4">
+        <p className="text-xs uppercase tracking-[0.14em] text-text3">Mission Hub</p>
+        <h1 className="text-3xl font-semibold text-text1">Artemis II (Artemis 2)</h1>
+        <p className="max-w-3xl text-sm text-text2">
+          Mission-focused coverage for Artemis II including launch timing, countdown visibility, crew notes, and schedule changes. For broader context, visit the{' '}
+          <Link href="/artemis" className="text-primary hover:text-primary/80">
+            Artemis program hub
+          </Link>
+          .
+        </p>
+        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
+          <span className="rounded-full border border-stroke px-3 py-1">Last updated: {lastUpdatedLabel}</span>
+          <span className="rounded-full border border-stroke px-3 py-1">Data source: Launch Library 2</span>
+        </div>
+      </header>
+
+      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
+        <h2 className="text-xl font-semibold text-text1">Mission summary</h2>
+        <p className="mt-2 text-sm text-text2">
+          Artemis II is the first planned crewed mission in NASA&apos;s Artemis campaign and is commonly searched as both Artemis II and Artemis 2.
+          This page tracks schedule changes, timing, and mission readiness signals as the launch window evolves.
+        </p>
+      </section>
+
+      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
+        <h2 className="text-xl font-semibold text-text1">Launch date and countdown</h2>
+        {nextLaunch ? (
+          <div className="mt-3 space-y-3 rounded-xl border border-stroke bg-surface-0 p-4">
+            <div className="flex flex-wrap items-start justify-between gap-3">
+              <div>
+                <Link href={buildLaunchHref(nextLaunch)} className="text-sm font-semibold text-text1 hover:text-primary">
+                  {nextLaunch.name}
+                </Link>
+                <p className="mt-1 text-xs text-text3">
+                  {nextLaunch.provider} - {nextLaunch.vehicle} - {nextLaunch.pad.shortCode}
+                </p>
+              </div>
+              <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
+                Status: {nextLaunch.statusText}
+              </span>
+            </div>
+            {!isDateOnlyNet(nextLaunch.net, nextLaunch.netPrecision) ? (
+              <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
+                <p className="text-xs uppercase tracking-[0.14em] text-text3">Countdown</p>
+                <Countdown net={nextLaunch.net} />
+              </div>
+            ) : null}
+            <TimeDisplay net={nextLaunch.net} netPrecision={nextLaunch.netPrecision} />
+          </div>
+        ) : (
+          <p className="mt-3 text-sm text-text2">
+            No Artemis II launch window is currently available in the feed. This page stays updated as timing data changes.
+          </p>
+        )}
+      </section>
+
+      <section className="grid gap-4 md:grid-cols-2">
+        <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
+          <h2 className="text-xl font-semibold text-text1">Crew highlights</h2>
+          {snapshot.crewHighlights.length ? (
+            <ul className="mt-3 space-y-2 text-sm text-text2">
+              {snapshot.crewHighlights.map((entry) => (
+                <li key={entry} className="rounded-lg border border-stroke bg-surface-0 px-3 py-2">
+                  {entry}
+                </li>
+              ))}
+            </ul>
+          ) : (
+            <p className="mt-3 text-sm text-text2">Crew details are not currently present in the mission feed payload.</p>
+          )}
+        </div>
+
+        <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
+          <h2 className="text-xl font-semibold text-text1">How to watch</h2>
+          {watchLinks.length ? (
+            <ul className="mt-3 space-y-2 text-sm">
+              {watchLinks.map((entry) => (
+                <li key={entry.url}>
+                  <a href={entry.url} target="_blank" rel="noreferrer" className="text-primary hover:text-primary/80">
+                    {entry.label}
+                  </a>
+                </li>
+              ))}
+            </ul>
+          ) : (
+            <p className="mt-3 text-sm text-text2">
+              No public stream URLs are listed yet. Watch links will appear automatically when they are available in the mission data.
+            </p>
+          )}
+        </div>
+      </section>
+
+      <LaunchList title="Upcoming Artemis II launches" launches={snapshot.upcoming} emptyLabel="No upcoming Artemis II launches in the feed yet." />
+
+      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
+        <h2 className="text-xl font-semibold text-text1">Recent update log</h2>
+        {snapshot.changes.length ? (
+          <ul className="mt-3 space-y-2 text-sm text-text2">
+            {snapshot.changes.map((change) => (
+              <li key={`${change.title}:${change.date}`} className="rounded-lg border border-stroke bg-surface-0 p-3">
+                <div className="flex flex-wrap items-center justify-between gap-2">
+                  <span className="font-semibold text-text1">{change.title}</span>
+                  <span className="text-xs text-text3">{formatUpdatedLabel(change.date)}</span>
+                </div>
+                <p className="mt-1">{change.summary}</p>
+                {change.href ? (
+                  <Link href={change.href} className="mt-2 inline-block text-xs uppercase tracking-[0.1em] text-primary hover:text-primary/80">
+                    Open launch detail
+                  </Link>
+                ) : null}
+              </li>
+            ))}
+          </ul>
+        ) : (
+          <p className="mt-3 text-sm text-text2">No change-log entries are currently available for Artemis II.</p>
+        )}
+      </section>
+
+      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
+        <h2 className="text-xl font-semibold text-text1">Artemis II FAQ</h2>
+        <dl className="mt-4 space-y-4">
+          {snapshot.faq.map((entry) => (
+            <div key={entry.question}>
+              <dt className="text-sm font-semibold text-text1">{entry.question}</dt>
+              <dd className="mt-1 text-sm text-text2">{entry.answer}</dd>
+            </div>
+          ))}
+        </dl>
+      </section>
+
+      <div className="flex flex-wrap items-center gap-3 text-xs text-text3">
+        <Link href="/artemis" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
+          Artemis Program
+        </Link>
+        <Link href="/artemis-i" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
+          Artemis I Hub
+        </Link>
+        <Link href="/artemis-iii" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
+          Artemis III Hub
+        </Link>
+        <Link href="/#schedule" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
+          Back to launch schedule
+        </Link>
+      </div>
+    </div>
+  );
+}
+
+function LaunchList({ title, launches, emptyLabel }: { title: string; launches: Launch[]; emptyLabel: string }) {
+  return (
+    <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
+      <div className="flex flex-wrap items-center justify-between gap-2">
+        <h2 className="text-xl font-semibold text-text1">{title}</h2>
+        <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">{launches.length} items</span>
+      </div>
+
+      {launches.length === 0 ? (
+        <p className="mt-3 text-sm text-text3">{emptyLabel}</p>
+      ) : (
+        <ul className="mt-4 grid gap-3 md:grid-cols-2">
+          {launches.map((launch) => {
+            const dateOnly = isDateOnlyNet(launch.net, launch.netPrecision);
+            return (
+              <li key={launch.id} className="rounded-xl border border-stroke bg-surface-0 p-3">
+                <div className="flex items-start justify-between gap-3">
+                  <div className="min-w-0">
+                    <Link href={buildLaunchHref(launch)} className="text-sm font-semibold text-text1 hover:text-primary">
+                      {launch.name}
+                    </Link>
+                    <p className="mt-1 text-xs text-text3">
+                      {launch.provider} - {launch.pad.shortCode}
+                    </p>
+                  </div>
+                  <div className="text-right text-xs text-text3">
+                    <div>{formatLaunchDate(launch)}</div>
+                    {dateOnly ? (
+                      <span className="mt-1 inline-flex rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]">
+                        Time TBD
+                      </span>
+                    ) : null}
+                  </div>
+                </div>
+              </li>
+            );
+          })}
+        </ul>
+      )}
+    </section>
+  );
+}
+
+function resolveWatchLinks(launch: Launch | null) {
+  if (!launch) return [] as Array<{ url: string; label: string }>;
+  const links: Array<{ url: string; label: string }> = [];
+  const seen = new Set<string>();
+
+  const push = (url: string | null | undefined, label: string) => {
+    if (!url) return;
+    const normalized = url.trim();
+    if (!normalized) return;
+    if (seen.has(normalized)) return;
+    seen.add(normalized);
+    links.push({ url: normalized, label });
+  };
+
+  push(launch.videoUrl, 'Primary webcast');
+  for (const entry of launch.launchVidUrls || []) {
+    push(entry?.url, entry?.title?.trim() || 'Launch video link');
+  }
+  for (const entry of launch.mission?.vidUrls || []) {
+    push(entry?.url, entry?.title?.trim() || 'Mission video link');
+  }
+
+  return links.slice(0, 8);
+}
+
+function formatLaunchDate(launch: Launch) {
+  const date = new Date(launch.net);
+  if (Number.isNaN(date.getTime())) return launch.net;
+  const zone = launch.pad?.timezone || 'UTC';
+  const dateOnly = isDateOnlyNet(launch.net, launch.netPrecision);
+  const options: Intl.DateTimeFormatOptions = dateOnly
+    ? { month: 'short', day: '2-digit', year: 'numeric', timeZone: zone }
+    : {
+        month: 'short',
+        day: '2-digit',
+        year: 'numeric',
+        hour: 'numeric',
+        minute: '2-digit',
+        timeZone: zone,
+        timeZoneName: 'short'
+      };
+  return new Intl.DateTimeFormat('en-US', options).format(date);
+}
+
+function formatUpdatedLabel(value: string) {
+  const date = new Date(value);
+  if (Number.isNaN(date.getTime())) return value;
+  return new Intl.DateTimeFormat('en-US', {
+    month: 'short',
+    day: '2-digit',
+    year: 'numeric',
+    hour: 'numeric',
+    minute: '2-digit',
+    timeZoneName: 'short'
+  }).format(date);
+}
diff --git a/app/artemis-iii/page.tsx b/app/artemis-iii/page.tsx
new file mode 100644
index 0000000..2af5e0c
--- /dev/null
+++ b/app/artemis-iii/page.tsx
@@ -0,0 +1,341 @@
+import type { Metadata } from 'next';
+import Link from 'next/link';
+import { Countdown } from '@/components/Countdown';
+import { JsonLd } from '@/components/JsonLd';
+import { TimeDisplay } from '@/components/TimeDisplay';
+import { BRAND_NAME } from '@/lib/brand';
+import { isDateOnlyNet } from '@/lib/time';
+import { getSiteUrl } from '@/lib/server/env';
+import { fetchArtemisProgramSnapshot } from '@/lib/server/artemis';
+import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
+import type { Launch } from '@/lib/types/launch';
+import { buildLaunchHref } from '@/lib/utils/launchLinks';
+
+export const revalidate = 60 * 60; // 1 hour
+
+const ARTEMIS_III_PATTERN = /\bartem[iu]s(?:\s*[-:]?\s*)(?:iii|3)\b/i;
+
+const ARTEMIS_III_FAQ = [
+  {
+    question: 'What is Artemis III?',
+    answer:
+      'Artemis III is the planned lunar-landing mission in NASA&apos;s Artemis sequence, following Artemis I and the crewed Artemis II mission.'
+  },
+  {
+    question: 'Is there a confirmed Artemis III launch date?',
+    answer:
+      'Mission timing can shift as hardware readiness and mission planning evolve. This page tracks upcoming schedule signals from the launch feed.'
+  },
+  {
+    question: 'Where can I track near-term Artemis launch timing?',
+    answer:
+      'For currently crewed mission timing and countdown updates, use the Artemis II page. This Artemis III page focuses on forward mission planning status.'
+  }
+] as const;
+
+export async function generateMetadata(): Promise<Metadata> {
+  const siteMeta = buildSiteMeta();
+  const siteUrl = getSiteUrl().replace(/\/$/, '');
+  const canonical = '/artemis-iii';
+  const pageUrl = `${siteUrl}${canonical}`;
+  const title = `Artemis III (Artemis 3) Launch Schedule & Mission Plan | ${BRAND_NAME}`;
+  const description = 'Artemis III mission planning coverage with launch schedule signals, timeline context, and related Artemis mission links.';
+  const images = [
+    {
+      url: siteMeta.ogImage,
+      width: 1200,
+      height: 630,
+      alt: SITE_META.ogImageAlt,
+      type: 'image/jpeg'
+    }
+  ];
+
+  return {
+    title,
+    description,
+    alternates: { canonical },
+    openGraph: {
+      title,
+      description,
+      url: pageUrl,
+      type: 'website',
+      siteName: SITE_META.siteName,
+      images
+    },
+    twitter: {
+      card: 'summary_large_image',
+      title,
+      description,
+      images: [
+        {
+          url: siteMeta.ogImage,
+          alt: SITE_META.ogImageAlt
+        }
+      ]
+    }
+  };
+}
+
+export default async function ArtemisIIIMissionPage() {
+  const snapshot = await fetchArtemisProgramSnapshot();
+  const siteUrl = getSiteUrl().replace(/\/$/, '');
+  const pageUrl = `${siteUrl}/artemis-iii`;
+  const upcoming = snapshot.upcoming.filter(isArtemisIIIMissionLaunch);
+  const recent = snapshot.recent.filter(isArtemisIIIMissionLaunch);
+  const nextLaunch = upcoming[0] || null;
+  const featuredLaunch = nextLaunch || recent[0] || null;
+  const lastUpdatedLabel = formatUpdatedLabel(snapshot.lastUpdated || snapshot.generatedAt);
+  const launchHref = featuredLaunch ? buildLaunchHref(featuredLaunch) : null;
+
+  const breadcrumbJsonLd = {
+    '@context': 'https://schema.org',
+    '@type': 'BreadcrumbList',
+    itemListElement: [
+      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
+      { '@type': 'ListItem', position: 2, name: 'Artemis', item: `${siteUrl}/artemis` },
+      { '@type': 'ListItem', position: 3, name: 'Artemis III', item: pageUrl }
+    ]
+  };
+
+  const collectionPageJsonLd = {
+    '@context': 'https://schema.org',
+    '@type': 'CollectionPage',
+    '@id': pageUrl,
+    url: pageUrl,
+    name: 'Artemis III (Artemis 3)',
+    description: 'Artemis III mission schedule signals, timeline updates, and planning context.',
+    dateModified: snapshot.lastUpdated || snapshot.generatedAt
+  };
+
+  const eventJsonLd =
+    featuredLaunch != null
+      ? {
+          '@context': 'https://schema.org',
+          '@type': 'Event',
+          '@id': `${pageUrl}#tracked-event`,
+          name: featuredLaunch.name,
+          startDate: featuredLaunch.net,
+          eventStatus:
+            featuredLaunch.status === 'scrubbed'
+              ? 'https://schema.org/EventCancelled'
+              : featuredLaunch.status === 'hold'
+                ? 'https://schema.org/EventPostponed'
+                : 'https://schema.org/EventScheduled',
+          location: {
+            '@type': 'Place',
+            name: featuredLaunch.pad?.name,
+            address: {
+              '@type': 'PostalAddress',
+              addressLocality: featuredLaunch.pad?.locationName || undefined,
+              addressRegion: featuredLaunch.pad?.state || undefined,
+              addressCountry: featuredLaunch.pad?.countryCode || undefined
+            }
+          },
+          organizer: featuredLaunch.provider ? { '@type': 'Organization', name: featuredLaunch.provider } : undefined,
+          url: launchHref ? `${siteUrl}${launchHref}` : pageUrl
+        }
+      : null;
+
+  const upcomingJsonLd =
+    upcoming.length > 0
+      ? {
+          '@context': 'https://schema.org',
+          '@type': 'ItemList',
+          '@id': `${pageUrl}#upcoming-artemis-iii-launches`,
+          numberOfItems: Math.min(25, upcoming.length),
+          itemListElement: upcoming.slice(0, 25).map((launch, index) => ({
+            '@type': 'ListItem',
+            position: index + 1,
+            item: {
+              '@type': 'Event',
+              name: launch.name,
+              startDate: launch.net,
+              url: `${siteUrl}${buildLaunchHref(launch)}`
+            }
+          }))
+        }
+      : null;
+
+  const faqJsonLd = {
+    '@context': 'https://schema.org',
+    '@type': 'FAQPage',
+    '@id': `${pageUrl}#faq`,
+    mainEntity: ARTEMIS_III_FAQ.map((entry) => ({
+      '@type': 'Question',
+      name: entry.question,
+      acceptedAnswer: { '@type': 'Answer', text: entry.answer }
+    }))
+  };
+
+  return (
+    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
+      <JsonLd data={[breadcrumbJsonLd, collectionPageJsonLd, ...(eventJsonLd ? [eventJsonLd] : []), ...(upcomingJsonLd ? [upcomingJsonLd] : []), faqJsonLd]} />
+
+      <header className="space-y-4">
+        <p className="text-xs uppercase tracking-[0.14em] text-text3">Mission Hub</p>
+        <h1 className="text-3xl font-semibold text-text1">Artemis III (Artemis 3)</h1>
+        <p className="max-w-3xl text-sm text-text2">
+          Artemis III is the planned lunar landing mission in the Artemis sequence. This route tracks mission-specific scheduling signals while linking back to Artemis workbench and crewed Artemis II timing coverage.
+        </p>
+        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
+          <span className="rounded-full border border-stroke px-3 py-1">Last updated: {lastUpdatedLabel}</span>
+          <span className="rounded-full border border-stroke px-3 py-1">Mission status: Planned</span>
+        </div>
+      </header>
+
+      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
+        <h2 className="text-xl font-semibold text-text1">Mission snapshot</h2>
+        <p className="mt-2 text-sm text-text2">
+          Artemis III planning remains dynamic as architecture, readiness milestones, and launch windows evolve. Use this page for Artemis III-specific feed tracking and follow Artemis II for near-term crewed timing.
+        </p>
+      </section>
+
+      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
+        <h2 className="text-xl font-semibold text-text1">Launch date and countdown</h2>
+        {featuredLaunch ? (
+          <div className="mt-3 space-y-3 rounded-xl border border-stroke bg-surface-0 p-4">
+            <div className="flex flex-wrap items-start justify-between gap-3">
+              <div>
+                <Link href={buildLaunchHref(featuredLaunch)} className="text-sm font-semibold text-text1 hover:text-primary">
+                  {featuredLaunch.name}
+                </Link>
+                <p className="mt-1 text-xs text-text3">
+                  {featuredLaunch.provider} - {featuredLaunch.vehicle} - {featuredLaunch.pad.shortCode}
+                </p>
+              </div>
+              <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
+                Status: {featuredLaunch.statusText}
+              </span>
+            </div>
+            {nextLaunch && !isDateOnlyNet(nextLaunch.net, nextLaunch.netPrecision) ? (
+              <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
+                <p className="text-xs uppercase tracking-[0.14em] text-text3">Countdown</p>
+                <Countdown net={nextLaunch.net} />
+              </div>
+            ) : null}
+            <TimeDisplay net={featuredLaunch.net} netPrecision={featuredLaunch.netPrecision} />
+          </div>
+        ) : (
+          <p className="mt-3 text-sm text-text2">
+            No Artemis III launch window is currently available in the feed. This page updates automatically when mission-specific schedule data appears.
+          </p>
+        )}
+      </section>
+
+      <LaunchList title="Upcoming Artemis III launches" launches={upcoming} emptyLabel="No upcoming Artemis III launches are currently listed." />
+      <LaunchList title="Recent Artemis III launches" launches={recent} emptyLabel="No recent Artemis III launches are currently listed." />
+
+      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
+        <h2 className="text-xl font-semibold text-text1">Artemis III FAQ</h2>
+        <dl className="mt-4 space-y-4">
+          {ARTEMIS_III_FAQ.map((entry) => (
+            <div key={entry.question}>
+              <dt className="text-sm font-semibold text-text1">{entry.question}</dt>
+              <dd className="mt-1 text-sm text-text2">{entry.answer}</dd>
+            </div>
+          ))}
+        </dl>
+      </section>
+
+      <div className="flex flex-wrap items-center gap-3 text-xs text-text3">
+        <Link href="/artemis" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
+          Artemis Workbench
+        </Link>
+        <Link href="/artemis-i" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
+          Artemis I Hub
+        </Link>
+        <Link href="/artemis-ii" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
+          Artemis II Hub
+        </Link>
+      </div>
+    </div>
+  );
+}
+
+function LaunchList({ title, launches, emptyLabel }: { title: string; launches: Launch[]; emptyLabel: string }) {
+  return (
+    <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
+      <div className="flex flex-wrap items-center justify-between gap-2">
+        <h2 className="text-xl font-semibold text-text1">{title}</h2>
+        <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">{launches.length} items</span>
+      </div>
+
+      {launches.length === 0 ? (
+        <p className="mt-3 text-sm text-text3">{emptyLabel}</p>
+      ) : (
+        <ul className="mt-4 grid gap-3 md:grid-cols-2">
+          {launches.map((launch) => {
+            const dateOnly = isDateOnlyNet(launch.net, launch.netPrecision);
+            return (
+              <li key={launch.id} className="rounded-xl border border-stroke bg-surface-0 p-3">
+                <div className="flex items-start justify-between gap-3">
+                  <div className="min-w-0">
+                    <Link href={buildLaunchHref(launch)} className="text-sm font-semibold text-text1 hover:text-primary">
+                      {launch.name}
+                    </Link>
+                    <p className="mt-1 text-xs text-text3">
+                      {launch.provider} - {launch.pad.shortCode}
+                    </p>
+                  </div>
+                  <div className="text-right text-xs text-text3">
+                    <div>{formatLaunchDate(launch)}</div>
+                    {dateOnly ? (
+                      <span className="mt-1 inline-flex rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]">
+                        Time TBD
+                      </span>
+                    ) : null}
+                  </div>
+                </div>
+              </li>
+            );
+          })}
+        </ul>
+      )}
+    </section>
+  );
+}
+
+function isArtemisIIIMissionLaunch(launch: Launch) {
+  return ARTEMIS_III_PATTERN.test(collectMissionText(launch));
+}
+
+function collectMissionText(launch: Launch) {
+  const values: string[] = [launch.name, launch.mission?.name || ''];
+  for (const program of launch.programs || []) {
+    if (program?.name) values.push(program.name);
+    if (program?.description) values.push(program.description);
+  }
+  return values.join(' ').trim();
+}
+
+function formatLaunchDate(launch: Launch) {
+  const date = new Date(launch.net);
+  if (Number.isNaN(date.getTime())) return launch.net;
+  const zone = launch.pad?.timezone || 'UTC';
+  const dateOnly = isDateOnlyNet(launch.net, launch.netPrecision);
+  const options: Intl.DateTimeFormatOptions = dateOnly
+    ? { month: 'short', day: '2-digit', year: 'numeric', timeZone: zone }
+    : {
+        month: 'short',
+        day: '2-digit',
+        year: 'numeric',
+        hour: 'numeric',
+        minute: '2-digit',
+        timeZone: zone,
+        timeZoneName: 'short'
+      };
+  return new Intl.DateTimeFormat('en-US', options).format(date);
+}
+
+function formatUpdatedLabel(value: string) {
+  const date = new Date(value);
+  if (Number.isNaN(date.getTime())) return value;
+  return new Intl.DateTimeFormat('en-US', {
+    month: 'short',
+    day: '2-digit',
+    year: 'numeric',
+    hour: 'numeric',
+    minute: '2-digit',
+    timeZoneName: 'short'
+  }).format(date);
+}
diff --git a/app/artemis/page.tsx b/app/artemis/page.tsx
new file mode 100644
index 0000000..d086950
--- /dev/null
+++ b/app/artemis/page.tsx
@@ -0,0 +1,710 @@
+import type { Metadata } from 'next';
+import Link from 'next/link';
+import { Countdown } from '@/components/Countdown';
+import { JsonLd } from '@/components/JsonLd';
+import { TimeDisplay } from '@/components/TimeDisplay';
+import { ArtemisProgramWorkbenchDesktop, type ArtemisWorkbenchMission } from '@/components/artemis/ArtemisProgramWorkbenchDesktop';
+import { ArtemisProgramWorkbenchMobile } from '@/components/artemis/ArtemisProgramWorkbenchMobile';
+import { isDateOnlyNet } from '@/lib/time';
+import { getSiteUrl } from '@/lib/server/env';
+import { fetchArtemisIISnapshot, fetchArtemisProgramSnapshot } from '@/lib/server/artemis';
+import {
+  fetchArtemisTimelineViewModel,
+  parseArtemisAudienceMode,
+  parseArtemisMissionFilter,
+  parseArtemisSourceFilter,
+  parseBooleanParam,
+  parseIsoDateParam
+} from '@/lib/server/artemisUi';
+import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
+import { BRAND_NAME } from '@/lib/brand';
+import type { Launch } from '@/lib/types/launch';
+import type { ArtemisMissionSnapshot, ArtemisProgramSnapshot, ArtemisTimelineEvent as ArtemisServerTimelineEvent, ArtemisTimelineMissionFilter } from '@/lib/types/artemis';
+import { buildLaunchHref } from '@/lib/utils/launchLinks';
+import type { ArtemisTimelineEvent as ArtemisWorkbenchTimelineEvent, ArtemisTimelineFilters } from '@/components/artemis/ArtemisTimelineExplorer';
+
+export const revalidate = 60 * 60; // 1 hour
+
+type ArtemisMissionKey = 'artemis-i' | 'artemis-ii' | 'artemis-iii';
+
+const ARTEMIS_I_PATTERN = /\bartem[iu]s(?:\s*[-:]?\s*)(?:i|1)\b/i;
+const ARTEMIS_II_PATTERN = /\bartem[iu]s(?:\s*[-:]?\s*)(?:ii|2)\b/i;
+const ARTEMIS_III_PATTERN = /\bartem[iu]s(?:\s*[-:]?\s*)(?:iii|3)\b/i;
+
+const ARTEMIS_I_WORKBENCH_FAQ = [
+  {
+    question: 'Was Artemis I crewed?',
+    answer: 'No. Artemis I was an uncrewed integrated mission test flight.'
+  },
+  {
+    question: 'Why track Artemis I in the workbench?',
+    answer: 'Artemis I is a baseline milestone used to contextualize Artemis II and Artemis III schedule changes.'
+  }
+] as const;
+
+const ARTEMIS_III_WORKBENCH_FAQ = [
+  {
+    question: 'What does Artemis III represent in the timeline?',
+    answer: 'Artemis III is the planned lunar-landing mission in the Artemis sequence.'
+  },
+  {
+    question: 'Is Artemis III timing final?',
+    answer: 'No. Mission windows can shift as readiness, integration, and program planning evolve.'
+  }
+] as const;
+
+const MISSION_WORKBENCH = [
+  {
+    key: 'artemis-i',
+    mission: 'Artemis I (Artemis 1)',
+    href: '/artemis-i',
+    status: 'Completed',
+    summary: 'Uncrewed lunar mission that validated Orion and the Space Launch System stack.',
+    detail: 'Mission recap, timeline context, and tracked launch records.'
+  },
+  {
+    key: 'artemis-ii',
+    mission: 'Artemis II (Artemis 2)',
+    href: '/artemis-ii',
+    status: 'In preparation',
+    summary: 'First crewed Artemis mission planned to fly astronauts around the Moon and return to Earth.',
+    detail: 'Canonical mission page with launch timing, countdown, and change tracking.'
+  },
+  {
+    key: 'artemis-iii',
+    mission: 'Artemis III (Artemis 3)',
+    href: '/artemis-iii',
+    status: 'Planned',
+    summary: 'Targeted lunar landing mission in the Artemis sequence.',
+    detail: 'Mission preview with schedule signals and launch watchlist context.'
+  }
+] as const satisfies ReadonlyArray<{
+  key: ArtemisMissionKey;
+  mission: string;
+  href: string;
+  status: string;
+  summary: string;
+  detail: string;
+}>;
+
+export async function generateMetadata(): Promise<Metadata> {
+  const siteMeta = buildSiteMeta();
+  const siteUrl = getSiteUrl().replace(/\/$/, '');
+  const canonical = '/artemis';
+  const pageUrl = `${siteUrl}${canonical}`;
+  const title = `Artemis Mission Workbench & Launch Schedule | ${BRAND_NAME}`;
+  const description = 'Artemis mission workbench with program timeline context and dedicated hubs for Artemis I, Artemis II, and Artemis III.';
+  const images = [
+    {
+      url: siteMeta.ogImage,
+      width: 1200,
+      height: 630,
+      alt: SITE_META.ogImageAlt,
+      type: 'image/jpeg'
+    }
+  ];
+
+  return {
+    title,
+    description,
+    alternates: { canonical },
+    openGraph: {
+      title,
+      description,
+      url: pageUrl,
+      type: 'website',
+      siteName: SITE_META.siteName,
+      images
+    },
+    twitter: {
+      card: 'summary_large_image',
+      title,
+      description,
+      images: [
+        {
+          url: siteMeta.ogImage,
+          alt: SITE_META.ogImageAlt
+        }
+      ]
+    }
+  };
+}
+
+type SearchParams = Record<string, string | string[] | undefined>;
+
+export default async function ArtemisWorkbenchPage({
+  searchParams
+}: {
+  searchParams?: SearchParams;
+}) {
+  const mode = parseArtemisAudienceMode(readSearchParam(searchParams, 'mode')) ?? 'quick';
+  const parsedMissionFilter = parseArtemisMissionFilter(readSearchParam(searchParams, 'mission'));
+  const missionFilter: ArtemisTimelineMissionFilter = parsedMissionFilter ?? (mode === 'quick' ? 'all' : 'artemis-ii');
+  const sourceType = parseArtemisSourceFilter(readSearchParam(searchParams, 'sourceType')) ?? 'all';
+  const includeSuperseded = parseBooleanParam(readSearchParam(searchParams, 'includeSuperseded'), false) ?? false;
+
+  const parsedFrom = parseIsoDateParam(readSearchParam(searchParams, 'from'));
+  const parsedTo = parseIsoDateParam(readSearchParam(searchParams, 'to'));
+  const from = parsedFrom === 'invalid' ? null : parsedFrom;
+  const to = parsedTo === 'invalid' ? null : parsedTo;
+  const isRangeOrdered = !(from && to && from > to);
+  const effectiveFrom = isRangeOrdered ? from : null;
+  const effectiveTo = isRangeOrdered ? to : null;
+  const requestedEventId = readSearchParam(searchParams, 'event');
+
+  const [snapshot, artemisIISnapshot, timelineViewModel] = await Promise.all([
+    fetchArtemisProgramSnapshot(),
+    fetchArtemisIISnapshot(),
+    fetchArtemisTimelineViewModel({
+      mode,
+      mission: missionFilter,
+      sourceType,
+      includeSuperseded,
+      from: effectiveFrom,
+      to: effectiveTo,
+      cursor: null,
+      limit: 100
+    })
+  ]);
+  const siteUrl = getSiteUrl().replace(/\/$/, '');
+  const pageUrl = `${siteUrl}/artemis`;
+  const missionLaunches = buildMissionLaunchMap(snapshot.upcoming, snapshot.recent);
+  const workbenchMissions = buildWorkbenchMissions(snapshot, artemisIISnapshot);
+  const lastUpdatedLabel = formatUpdatedLabel(snapshot.lastUpdated || snapshot.generatedAt);
+  const timelineEvents = timelineViewModel.events.map(mapTimelineEventToWorkbenchEvent);
+  const defaultMissionId = resolveDefaultMissionId(missionFilter);
+  const defaultSelectedEventId = resolveDefaultSelectedEventId(requestedEventId, timelineEvents);
+  const initialFilters: ArtemisTimelineFilters = {
+    sourceType,
+    includeSuperseded,
+    from: effectiveFrom,
+    to: effectiveTo
+  };
+
+  const breadcrumbJsonLd = {
+    '@context': 'https://schema.org',
+    '@type': 'BreadcrumbList',
+    itemListElement: [
+      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
+      { '@type': 'ListItem', position: 2, name: 'Artemis', item: pageUrl }
+    ]
+  };
+
+  const collectionPageJsonLd = {
+    '@context': 'https://schema.org',
+    '@type': 'CollectionPage',
+    '@id': pageUrl,
+    url: pageUrl,
+    name: 'Artemis mission workbench',
+    description: 'Artemis mission routing hub with schedule context, dedicated mission pages, and launch updates.',
+    dateModified: snapshot.lastUpdated || snapshot.generatedAt
+  };
+
+  const missionWorkbenchJsonLd = {
+    '@context': 'https://schema.org',
+    '@type': 'ItemList',
+    '@id': `${pageUrl}#mission-workbench`,
+    itemListElement: MISSION_WORKBENCH.map((entry, index) => ({
+      '@type': 'ListItem',
+      position: index + 1,
+      url: `${siteUrl}${entry.href}`,
+      name: entry.mission
+    }))
+  };
+
+  const faqJsonLd = {
+    '@context': 'https://schema.org',
+    '@type': 'FAQPage',
+    '@id': `${pageUrl}#faq`,
+    mainEntity: snapshot.faq.map((entry) => ({
+      '@type': 'Question',
+      name: entry.question,
+      acceptedAnswer: { '@type': 'Answer', text: entry.answer }
+    }))
+  };
+
+  const itemListJsonLd =
+    snapshot.upcoming.length > 0
+      ? {
+          '@context': 'https://schema.org',
+          '@type': 'ItemList',
+          '@id': `${pageUrl}#upcoming-artemis-launches`,
+          numberOfItems: Math.min(25, snapshot.upcoming.length),
+          itemListElement: snapshot.upcoming.slice(0, 25).map((launch, index) => ({
+            '@type': 'ListItem',
+            position: index + 1,
+            item: {
+              '@type': 'Event',
+              name: launch.name,
+              startDate: launch.net,
+              url: `${siteUrl}${buildLaunchHref(launch)}`
+            }
+          }))
+        }
+      : null;
+
+  return (
+    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
+      <JsonLd data={[breadcrumbJsonLd, collectionPageJsonLd, missionWorkbenchJsonLd, faqJsonLd, ...(itemListJsonLd ? [itemListJsonLd] : [])]} />
+
+      <header className="space-y-4">
+        <p className="text-xs uppercase tracking-[0.14em] text-text3">Mission Workbench</p>
+        <h1 className="text-3xl font-semibold text-text1">Artemis Program</h1>
+        <p className="max-w-3xl text-sm text-text2">
+          Program-level Artemis routing page for mission-specific hubs and launch context. Artemis II remains the canonical crewed mission page while Artemis I and Artemis III each have dedicated mission views.
+        </p>
+        <p className="max-w-3xl text-sm text-text2">
+          Need crewed mission timing now? Open{' '}
+          <Link href="/artemis-ii" className="text-primary hover:text-primary/80">
+            Artemis II (Artemis 2)
+          </Link>
+          . Need milestone context? Start with{' '}
+          <Link href="/artemis-i" className="text-primary hover:text-primary/80">
+            Artemis I
+          </Link>{' '}
+          or{' '}
+          <Link href="/artemis-iii" className="text-primary hover:text-primary/80">
+            Artemis III
+          </Link>
+          .
+        </p>
+        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
+          <span className="rounded-full border border-stroke px-3 py-1">Last updated: {lastUpdatedLabel}</span>
+          <span className="rounded-full border border-stroke px-3 py-1">Data source: Launch Library 2</span>
+        </div>
+      </header>
+
+      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
+        <h2 className="text-xl font-semibold text-text1">Mission workbench</h2>
+        <p className="mt-2 text-sm text-text2">
+          Each mission route keeps focused context, while this page remains a wrapper for quick navigation and snapshot visibility.
+        </p>
+        <div className="mt-4 grid gap-4 md:grid-cols-3">
+          {MISSION_WORKBENCH.map((mission) => (
+            <MissionWorkbenchCard key={mission.key} mission={mission} launch={missionLaunches[mission.key]} />
+          ))}
+        </div>
+      </section>
+
+      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
+        <h2 className="text-xl font-semibold text-text1">Workbench console</h2>
+        <p className="mt-2 text-sm text-text2">
+          Interactive Artemis workbench modules are composed here from shared mission components and server snapshots.
+        </p>
+        <div className="mt-4 xl:hidden">
+          <ArtemisProgramWorkbenchMobile
+            programSnapshot={snapshot}
+            missions={workbenchMissions}
+            timelineEvents={timelineEvents}
+            defaultMode={mode}
+            defaultMissionId={defaultMissionId}
+            defaultSelectedEventId={defaultSelectedEventId}
+            initialFilters={initialFilters}
+          />
+        </div>
+        <div className="mt-4 hidden xl:block">
+          <ArtemisProgramWorkbenchDesktop
+            programSnapshot={snapshot}
+            missions={workbenchMissions}
+            timelineEvents={timelineEvents}
+            defaultMode={mode}
+            defaultMissionId={defaultMissionId}
+            defaultSelectedEventId={defaultSelectedEventId}
+            initialFilters={initialFilters}
+          />
+        </div>
+      </section>
+
+      <LaunchList title="Upcoming Artemis launches" launches={snapshot.upcoming} emptyLabel="No upcoming Artemis launches in the current feed." />
+      <LaunchList title="Recent Artemis launches" launches={snapshot.recent} emptyLabel="No recent Artemis launches found in the current feed." />
+
+      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
+        <h2 className="text-xl font-semibold text-text1">Artemis FAQ</h2>
+        <dl className="mt-4 space-y-4">
+          {snapshot.faq.map((entry) => (
+            <div key={entry.question}>
+              <dt className="text-sm font-semibold text-text1">{entry.question}</dt>
+              <dd className="mt-1 text-sm text-text2">{entry.answer}</dd>
+            </div>
+          ))}
+        </dl>
+      </section>
+
+      <div className="flex flex-wrap items-center gap-3 text-xs text-text3">
+        <Link href="/artemis-i" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
+          Artemis I Hub
+        </Link>
+        <Link href="/artemis-ii" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
+          Artemis II Hub
+        </Link>
+        <Link href="/artemis-iii" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
+          Artemis III Hub
+        </Link>
+        <Link href="/#schedule" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
+          Back to launch schedule
+        </Link>
+      </div>
+    </div>
+  );
+}
+
+function MissionWorkbenchCard({
+  mission,
+  launch
+}: {
+  mission: (typeof MISSION_WORKBENCH)[number];
+  launch: Launch | null;
+}) {
+  const launchHref = launch ? buildLaunchHref(launch) : null;
+  const launchTimeMs = launch ? Date.parse(launch.net) : NaN;
+  const isUpcoming = Number.isFinite(launchTimeMs) && launchTimeMs >= Date.now();
+  const dateOnly = launch ? isDateOnlyNet(launch.net, launch.netPrecision) : false;
+
+  return (
+    <article className="rounded-xl border border-stroke bg-surface-0 p-4">
+      <div className="flex items-start justify-between gap-2">
+        <div>
+          <h3 className="text-sm font-semibold text-text1">
+            <Link href={mission.href} className="hover:text-primary">
+              {mission.mission}
+            </Link>
+          </h3>
+          <p className="mt-1 text-xs text-text3">{mission.detail}</p>
+        </div>
+        <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">{mission.status}</span>
+      </div>
+      <p className="mt-2 text-sm text-text2">{mission.summary}</p>
+
+      {launch && launchHref ? (
+        <div className="mt-3 space-y-2 rounded-lg border border-stroke bg-surface-1 p-3">
+          <p className="text-[11px] uppercase tracking-[0.1em] text-text3">{isUpcoming ? 'Tracked launch window' : 'Latest tracked launch'}</p>
+          <Link href={launchHref} className="text-sm font-semibold text-text1 hover:text-primary">
+            {launch.name}
+          </Link>
+          <p className="text-xs text-text3">
+            {launch.provider} - {launch.vehicle}
+          </p>
+          {isUpcoming && !dateOnly ? (
+            <div className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] p-2">
+              <Countdown net={launch.net} />
+            </div>
+          ) : null}
+          <TimeDisplay net={launch.net} netPrecision={launch.netPrecision} />
+        </div>
+      ) : (
+        <p className="mt-3 rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-xs text-text3">No mission-specific launch entry is currently available in the feed.</p>
+      )}
+
+      <Link href={mission.href} className="mt-3 inline-flex rounded-full border border-stroke px-3 py-1 text-[11px] uppercase tracking-[0.1em] text-text3 hover:text-text1">
+        Open mission page
+      </Link>
+    </article>
+  );
+}
+
+function LaunchList({ title, launches, emptyLabel }: { title: string; launches: Launch[]; emptyLabel: string }) {
+  return (
+    <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
+      <div className="flex flex-wrap items-center justify-between gap-2">
+        <h2 className="text-xl font-semibold text-text1">{title}</h2>
+        <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">{launches.length} items</span>
+      </div>
+
+      {launches.length === 0 ? (
+        <p className="mt-3 text-sm text-text3">{emptyLabel}</p>
+      ) : (
+        <ul className="mt-4 grid gap-3 md:grid-cols-2">
+          {launches.map((launch) => {
+            const dateOnly = isDateOnlyNet(launch.net, launch.netPrecision);
+            return (
+              <li key={launch.id} className="rounded-xl border border-stroke bg-surface-0 p-3">
+                <div className="flex items-start justify-between gap-3">
+                  <div className="min-w-0">
+                    <Link href={buildLaunchHref(launch)} className="text-sm font-semibold text-text1 hover:text-primary">
+                      {launch.name}
+                    </Link>
+                    <p className="mt-1 text-xs text-text3">
+                      {launch.provider} - {launch.vehicle}
+                    </p>
+                  </div>
+                  <div className="text-right text-xs text-text3">
+                    <div>{formatLaunchDate(launch)}</div>
+                    {dateOnly ? (
+                      <span className="mt-1 inline-flex rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]">
+                        Time TBD
+                      </span>
+                    ) : null}
+                  </div>
+                </div>
+              </li>
+            );
+          })}
+        </ul>
+      )}
+    </section>
+  );
+}
+
+function formatLaunchDate(launch: Launch) {
+  const date = new Date(launch.net);
+  if (Number.isNaN(date.getTime())) return launch.net;
+  const zone = launch.pad?.timezone || 'UTC';
+  const dateOnly = isDateOnlyNet(launch.net, launch.netPrecision);
+  const options: Intl.DateTimeFormatOptions = dateOnly
+    ? { month: 'short', day: '2-digit', year: 'numeric', timeZone: zone }
+    : {
+        month: 'short',
+        day: '2-digit',
+        year: 'numeric',
+        hour: 'numeric',
+        minute: '2-digit',
+        timeZone: zone,
+        timeZoneName: 'short'
+      };
+  return new Intl.DateTimeFormat('en-US', options).format(date);
+}
+
+function formatUpdatedLabel(value: string) {
+  const date = new Date(value);
+  if (Number.isNaN(date.getTime())) return value;
+  return new Intl.DateTimeFormat('en-US', {
+    month: 'short',
+    day: '2-digit',
+    year: 'numeric',
+    hour: 'numeric',
+    minute: '2-digit',
+    timeZoneName: 'short'
+  }).format(date);
+}
+
+function buildMissionLaunchMap(upcoming: Launch[], recent: Launch[]) {
+  const missionMap: Record<ArtemisMissionKey, Launch | null> = {
+    'artemis-i': null,
+    'artemis-ii': null,
+    'artemis-iii': null
+  };
+
+  for (const launch of upcoming) {
+    const key = resolveMissionKey(launch);
+    if (!key || missionMap[key]) continue;
+    missionMap[key] = launch;
+  }
+
+  for (const launch of recent) {
+    const key = resolveMissionKey(launch);
+    if (!key || missionMap[key]) continue;
+    missionMap[key] = launch;
+  }
+
+  return missionMap;
+}
+
+function resolveMissionKey(launch: Launch): ArtemisMissionKey | null {
+  const missionText = collectMissionText(launch);
+  if (ARTEMIS_III_PATTERN.test(missionText)) return 'artemis-iii';
+  if (ARTEMIS_II_PATTERN.test(missionText)) return 'artemis-ii';
+  if (ARTEMIS_I_PATTERN.test(missionText)) return 'artemis-i';
+  return null;
+}
+
+function collectMissionText(launch: Launch) {
+  const values: string[] = [launch.name, launch.mission?.name || ''];
+  for (const program of launch.programs || []) {
+    if (program?.name) values.push(program.name);
+    if (program?.description) values.push(program.description);
+  }
+  return values.join(' ').trim();
+}
+
+function buildWorkbenchMissions(programSnapshot: ArtemisProgramSnapshot, artemisIISnapshot: ArtemisMissionSnapshot): ArtemisWorkbenchMission[] {
+  const artemisISnapshot = buildDerivedMissionSnapshot({
+    programSnapshot,
+    missionName: 'Artemis I (Artemis 1)',
+    matcher: (launch) => resolveMissionKey(launch) === 'artemis-i',
+    faq: ARTEMIS_I_WORKBENCH_FAQ
+  });
+
+  const artemisIIISnapshot = buildDerivedMissionSnapshot({
+    programSnapshot,
+    missionName: 'Artemis III (Artemis 3)',
+    matcher: (launch) => resolveMissionKey(launch) === 'artemis-iii',
+    faq: ARTEMIS_III_WORKBENCH_FAQ
+  });
+
+  return [
+    {
+      id: 'artemis-i',
+      label: 'Artemis I',
+      subtitle: 'Uncrewed lunar qualification mission',
+      status: 'Completed',
+      snapshot: artemisISnapshot
+    },
+    {
+      id: 'artemis-ii',
+      label: 'Artemis II',
+      subtitle: 'Canonical crewed lunar flyby mission',
+      status: 'In preparation',
+      snapshot: artemisIISnapshot
+    },
+    {
+      id: 'artemis-iii',
+      label: 'Artemis III',
+      subtitle: 'Planned lunar landing mission',
+      status: 'Planned',
+      snapshot: artemisIIISnapshot
+    }
+  ];
+}
+
+function buildDerivedMissionSnapshot({
+  programSnapshot,
+  missionName,
+  matcher,
+  faq
+}: {
+  programSnapshot: ArtemisProgramSnapshot;
+  missionName: string;
+  matcher: (launch: Launch) => boolean;
+  faq: ReadonlyArray<{ question: string; answer: string }>;
+}): ArtemisMissionSnapshot {
+  const upcoming = programSnapshot.upcoming.filter(matcher);
+  const recent = programSnapshot.recent.filter(matcher);
+  const all = dedupeLaunches([...upcoming, ...recent]);
+  const nextLaunch = upcoming[0] || null;
+  const latest = resolveLatestIso(all) || programSnapshot.lastUpdated || programSnapshot.generatedAt;
+
+  return {
+    generatedAt: programSnapshot.generatedAt,
+    lastUpdated: latest,
+    missionName,
+    nextLaunch,
+    upcoming,
+    recent,
+    crewHighlights: nextLaunch ? buildCrewHighlights(nextLaunch) : [],
+    changes: buildMissionChanges(all),
+    faq: [...faq]
+  };
+}
+
+function dedupeLaunches(launches: Launch[]) {
+  const seen = new Set<string>();
+  const deduped: Launch[] = [];
+  for (const launch of launches) {
+    if (seen.has(launch.id)) continue;
+    seen.add(launch.id);
+    deduped.push(launch);
+  }
+  return deduped;
+}
+
+function buildCrewHighlights(launch: Launch) {
+  if (!Array.isArray(launch.crew)) return [];
+  return launch.crew
+    .map((entry) => {
+      const astronaut = entry?.astronaut?.trim();
+      const role = entry?.role?.trim();
+      if (!astronaut) return null;
+      return role ? `${astronaut} (${role})` : astronaut;
+    })
+    .filter(Boolean)
+    .slice(0, 6) as string[];
+}
+
+function buildMissionChanges(launches: Launch[]) {
+  const changes = launches
+    .map((launch) => {
+      const date = resolveLaunchIso(launch);
+      if (!date) return null;
+      return {
+        title: launch.name,
+        summary: `Status: ${launch.statusText || launch.status || 'Status pending'}. NET: ${formatLaunchDate(launch)}.`,
+        date,
+        href: buildLaunchHref(launch)
+      };
+    })
+    .filter(Boolean) as ArtemisMissionSnapshot['changes'];
+
+  changes.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
+  return changes.slice(0, 12);
+}
+
+function resolveLatestIso(launches: Launch[]) {
+  const candidates = launches
+    .map((launch) => resolveLaunchIso(launch))
+    .filter(Boolean) as string[];
+  if (!candidates.length) return null;
+  return candidates.reduce((latest, current) => (Date.parse(current) > Date.parse(latest) ? current : latest));
+}
+
+function resolveLaunchIso(launch: Launch) {
+  const values = [launch.cacheGeneratedAt, launch.lastUpdated, launch.net];
+  for (const value of values) {
+    if (!value) continue;
+    const parsed = Date.parse(value);
+    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
+  }
+  return null;
+}
+
+function readSearchParam(searchParams: SearchParams | undefined, key: string) {
+  const raw = searchParams?.[key];
+  if (Array.isArray(raw)) {
+    const first = raw.find((entry) => typeof entry === 'string' && entry.trim().length > 0);
+    return first ? first.trim() : null;
+  }
+  if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
+  return null;
+}
+
+function resolveDefaultMissionId(mission: ArtemisTimelineMissionFilter): ArtemisMissionKey {
+  if (mission === 'artemis-i') return 'artemis-i';
+  if (mission === 'artemis-ii') return 'artemis-ii';
+  if (mission === 'artemis-iii') return 'artemis-iii';
+  return 'artemis-ii';
+}
+
+function resolveDefaultSelectedEventId(
+  requestedEventId: string | null,
+  events: ArtemisWorkbenchTimelineEvent[]
+) {
+  if (requestedEventId && events.some((event) => event.id === requestedEventId)) {
+    return requestedEventId;
+  }
+  return events[0]?.id ?? null;
+}
+
+function mapTimelineEventToWorkbenchEvent(event: ArtemisServerTimelineEvent): ArtemisWorkbenchTimelineEvent {
+  return {
+    id: event.id,
+    title: event.title,
+    when: event.date,
+    summary: event.summary,
+    mission: formatTimelineMission(event.mission),
+    tone: toneFromTimelineStatus(event.status),
+    launch: event.launch || null,
+    status: event.status,
+    eventTime: event.date,
+    announcedTime: event.source.lastVerifiedAt || event.date,
+    sourceType: event.source.type,
+    sourceLabel: event.source.label,
+    sourceHref: event.source.href,
+    confidence: event.confidence,
+    supersedes: event.supersedes.map((entry) => ({ eventId: entry.eventId, reason: entry.reason })),
+    supersededBy: event.supersededBy ? { eventId: event.supersededBy.eventId, reason: event.supersededBy.reason } : null
+  };
+}
+
+function toneFromTimelineStatus(status: ArtemisServerTimelineEvent['status']): ArtemisWorkbenchTimelineEvent['tone'] {
+  if (status === 'completed') return 'success';
+  if (status === 'upcoming') return 'info';
+  if (status === 'tentative') return 'warning';
+  if (status === 'superseded') return 'danger';
+  return 'default';
+}
+
+function formatTimelineMission(mission: ArtemisServerTimelineEvent['mission']) {
+  if (mission === 'artemis-i') return 'Artemis I';
+  if (mission === 'artemis-ii') return 'Artemis II';
+  if (mission === 'artemis-iii') return 'Artemis III';
+  return 'Artemis Program';
+}
diff --git a/app/page.tsx b/app/page.tsx
index 0219890..11916cb 100644
--- a/app/page.tsx
+++ b/app/page.tsx
@@ -223,6 +223,17 @@ export default async function HomePage({ searchParams }: { searchParams: SearchP
             Track upcoming US rocket launches with NET windows, countdowns, and coverage links across Cape Canaveral and Vandenberg.
             This schedule focuses on US pads and includes missions from SpaceX, NASA, ULA, and more.
           </p>
+          <p className="max-w-3xl text-xs text-text3">
+            Looking for Artemis-specific coverage? Visit{' '}
+            <Link href="/artemis-ii" className="text-primary hover:text-primary/80">
+              Artemis II (Artemis 2)
+            </Link>{' '}
+            and the{' '}
+            <Link href="/artemis" className="text-primary hover:text-primary/80">
+              Artemis program hub
+            </Link>
+            .
+          </p>
         </header>
         <div id="schedule" className="scroll-mt-16">
           <Suspense
diff --git a/app/sitemap.ts b/app/sitemap.ts
index ac081b1..b918118 100644
--- a/app/sitemap.ts
+++ b/app/sitemap.ts
@@ -18,6 +18,10 @@ const STATIC_PATHS: Array<{
   { path: '/news', changeFrequency: 'hourly', priority: 0.8 },
   { path: '/info', changeFrequency: 'daily', priority: 0.7 },
   { path: '/starship', changeFrequency: 'daily', priority: 0.7 },
+  { path: '/artemis', changeFrequency: 'daily', priority: 0.78 },
+  { path: '/artemis-i', changeFrequency: 'daily', priority: 0.74 },
+  { path: '/artemis-ii', changeFrequency: 'daily', priority: 0.8 },
+  { path: '/artemis-iii', changeFrequency: 'daily', priority: 0.74 },
   { path: '/catalog', changeFrequency: 'daily', priority: 0.7 },
   { path: '/launch-providers', changeFrequency: 'weekly', priority: 0.6 },
   { path: '/about', changeFrequency: 'monthly', priority: 0.6 },
diff --git a/components/DockingBay.tsx b/components/DockingBay.tsx
index 7ee9c1c..15d5e49 100644
--- a/components/DockingBay.tsx
+++ b/components/DockingBay.tsx
@@ -35,6 +35,8 @@ export function DockingBay({ profile, isAdmin, viewerTier, onOpenCalendar, onOpe
       [
         { label: 'Launches', href: '/#schedule' },
         { label: 'Providers', href: '/launch-providers' },
+        { label: 'Artemis', href: '/artemis' },
+        { label: 'Artemis II', href: '/artemis-ii' },
         { label: 'News', href: '/news' },
         { label: 'About', href: '/about' },
         { label: 'FAQ', href: '/docs/faq' },
diff --git a/components/Footer.tsx b/components/Footer.tsx
index 102b564..a43f4b0 100644
--- a/components/Footer.tsx
+++ b/components/Footer.tsx
@@ -37,6 +37,12 @@ export function Footer() {
           <a className="hover:text-text1" href="/docs/faq">
             FAQ
           </a>
+          <a className="hover:text-text1" href="/artemis">
+            Artemis
+          </a>
+          <a className="hover:text-text1" href="/artemis-ii">
+            Artemis II
+          </a>
           {(facebookUrl || xUrl) && (
             <div className="flex items-center gap-2">
               {xUrl && (
diff --git a/components/LaunchFeed.tsx b/components/LaunchFeed.tsx
index d73160d..ff41262 100644
--- a/components/LaunchFeed.tsx
+++ b/components/LaunchFeed.tsx
@@ -14,6 +14,7 @@ import { getNextAlignedRefreshMs, getTierRefreshSeconds, tierToMode, type Viewer
 import { formatDateOnly, formatNetLabel, isDateOnlyNet } from '@/lib/time';
 import { buildLaunchHref } from '@/lib/utils/launchLinks';
 import { isArtemisLaunch } from '@/lib/utils/launchArtemis';
+import { getArtemisVariantLabel } from '@/lib/utils/artemis';
 import { LaunchCard } from './LaunchCard';
 import { SkeletonLaunchCard } from './SkeletonLaunchCard';
 import { BulkCalendarExport } from './BulkCalendarExport';
@@ -996,7 +997,13 @@ export function LaunchFeed({
     return next;
   }, [launches, nowMs]);
 
-  const nextArtemisHref = useMemo(() => (nextArtemis ? buildLaunchHref(nextArtemis) : null), [nextArtemis]);
+  const nextArtemisHref = useMemo(() => {
+    if (!nextArtemis) return null;
+    const variant = getArtemisVariantLabel(nextArtemis);
+    if (variant === 'artemis-ii') return '/artemis-ii';
+    if (variant === 'artemis') return '/artemis';
+    return buildLaunchHref(nextArtemis);
+  }, [nextArtemis]);
 
   const artemisTicker = useMemo(() => {
     if (!nextArtemis) return null;
diff --git a/components/NavBar.tsx b/components/NavBar.tsx
index 4ec228c..349b359 100644
--- a/components/NavBar.tsx
+++ b/components/NavBar.tsx
@@ -105,6 +105,12 @@ export function NavBar() {
             <Link href="/docs/faq" className="hover:text-text1">
               FAQ
             </Link>
+            <Link href="/artemis" className="hover:text-text1">
+              Artemis
+            </Link>
+            <Link href="/artemis-ii" className="hover:text-text1">
+              Artemis II
+            </Link>
             <Link href="/catalog" className="hover:text-text1">
               Catalog
             </Link>
@@ -137,6 +143,12 @@ export function NavBar() {
             <Link href="/docs/faq" className="hover:text-text1" onClick={() => setMenuOpen(false)}>
               FAQ
             </Link>
+            <Link href="/artemis" className="hover:text-text1" onClick={() => setMenuOpen(false)}>
+              Artemis
+            </Link>
+            <Link href="/artemis-ii" className="hover:text-text1" onClick={() => setMenuOpen(false)}>
+              Artemis II
+            </Link>
             <Link href="/catalog" className="hover:text-text1" onClick={() => setMenuOpen(false)}>
               Catalog
             </Link>
diff --git a/components/artemis/ArtemisChangeLedger.tsx b/components/artemis/ArtemisChangeLedger.tsx
new file mode 100644
index 0000000..c94d656
--- /dev/null
+++ b/components/artemis/ArtemisChangeLedger.tsx
@@ -0,0 +1,102 @@
+import Link from 'next/link';
+import clsx from 'clsx';
+import type { ArtemisChangeItem } from '@/lib/types/artemis';
+
+export type ArtemisChangeLedgerProps = {
+  changes: readonly ArtemisChangeItem[];
+  title?: string;
+  emptyLabel?: string;
+  maxItems?: number;
+  className?: string;
+};
+
+export function ArtemisChangeLedger({
+  changes,
+  title = 'Change ledger',
+  emptyLabel = 'No mission change entries are available yet.',
+  maxItems = 12,
+  className
+}: ArtemisChangeLedgerProps) {
+  const sortedChanges = [...changes]
+    .sort((a, b) => parseDateOrZero(b.date) - parseDateOrZero(a.date))
+    .slice(0, Math.max(0, maxItems));
+
+  return (
+    <section className={clsx('rounded-2xl border border-stroke bg-surface-1 p-4', className)} aria-label={title}>
+      <div className="flex items-center justify-between gap-2">
+        <h3 className="text-base font-semibold text-text1">{title}</h3>
+        <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
+          {sortedChanges.length}
+        </span>
+      </div>
+
+      {sortedChanges.length === 0 ? (
+        <p className="mt-3 text-sm text-text3">{emptyLabel}</p>
+      ) : (
+        <ol className="mt-3 space-y-2">
+          {sortedChanges.map((change) => {
+            const isExternal = isExternalUrl(change.href);
+            return (
+              <li key={`${change.title}:${change.date}`} className="rounded-xl border border-stroke bg-surface-0 p-3">
+                <div className="flex items-start justify-between gap-3">
+                  <div className="min-w-0">
+                    <div className="truncate text-sm font-semibold text-text1">{change.title}</div>
+                    <p className="mt-1 text-xs text-text2">{change.summary}</p>
+                  </div>
+                  <time dateTime={toDateTimeAttr(change.date)} className="shrink-0 text-[11px] text-text3">
+                    {formatChangeDate(change.date)}
+                  </time>
+                </div>
+                {change.href ? (
+                  isExternal ? (
+                    <a
+                      href={change.href}
+                      className="mt-2 inline-flex text-xs uppercase tracking-[0.08em] text-primary hover:text-primary/80"
+                      target="_blank"
+                      rel="noreferrer"
+                    >
+                      Open source
+                    </a>
+                  ) : (
+                    <Link href={change.href} className="mt-2 inline-flex text-xs uppercase tracking-[0.08em] text-primary hover:text-primary/80">
+                      Open source
+                    </Link>
+                  )
+                ) : null}
+              </li>
+            );
+          })}
+        </ol>
+      )}
+    </section>
+  );
+}
+
+function parseDateOrZero(value: string) {
+  const parsed = Date.parse(value);
+  return Number.isNaN(parsed) ? 0 : parsed;
+}
+
+function toDateTimeAttr(value: string) {
+  const parsed = Date.parse(value);
+  if (Number.isNaN(parsed)) return value;
+  return new Date(parsed).toISOString();
+}
+
+function formatChangeDate(value: string) {
+  const parsed = Date.parse(value);
+  if (Number.isNaN(parsed)) return value;
+  return new Intl.DateTimeFormat('en-US', {
+    month: 'short',
+    day: '2-digit',
+    year: 'numeric',
+    hour: 'numeric',
+    minute: '2-digit',
+    timeZoneName: 'short'
+  }).format(new Date(parsed));
+}
+
+function isExternalUrl(value: string | undefined) {
+  if (!value) return false;
+  return /^https?:\/\//i.test(value);
+}
diff --git a/components/artemis/ArtemisEventDrawer.tsx b/components/artemis/ArtemisEventDrawer.tsx
new file mode 100644
index 0000000..b1a9afc
--- /dev/null
+++ b/components/artemis/ArtemisEventDrawer.tsx
@@ -0,0 +1,199 @@
+'use client';
+
+import { useCallback, useEffect, useId, useState } from 'react';
+import clsx from 'clsx';
+import type { ArtemisFaqItem } from '@/lib/types/artemis';
+import { ArtemisEvidenceCenter, type ArtemisEvidenceItem } from './ArtemisEvidenceCenter';
+import type { ArtemisTimelineEvent } from './ArtemisTimelineExplorer';
+
+export type ArtemisEventDrawerProps = {
+  event: ArtemisTimelineEvent | null;
+  open?: boolean;
+  defaultOpen?: boolean;
+  onOpenChange?: (open: boolean) => void;
+  variant?: 'panel' | 'sheet';
+  title?: string;
+  evidenceItems?: readonly ArtemisEvidenceItem[];
+  faq?: readonly ArtemisFaqItem[];
+  className?: string;
+};
+
+export function ArtemisEventDrawer({
+  event,
+  open,
+  defaultOpen = false,
+  onOpenChange,
+  variant = 'panel',
+  title = 'Event drawer',
+  evidenceItems,
+  faq,
+  className
+}: ArtemisEventDrawerProps) {
+  const [internalOpen, setInternalOpen] = useState(defaultOpen);
+  const dialogId = useId();
+  const isControlled = typeof open === 'boolean';
+  const isOpen = isControlled ? Boolean(open) : internalOpen;
+
+  const setOpen = useCallback(
+    (nextOpen: boolean) => {
+      if (!isControlled) {
+        setInternalOpen(nextOpen);
+      }
+      onOpenChange?.(nextOpen);
+    },
+    [isControlled, onOpenChange]
+  );
+
+  useEffect(() => {
+    if (variant !== 'sheet' || !isOpen) return;
+    const onKeyDown = (eventKey: KeyboardEvent) => {
+      if (eventKey.key === 'Escape') {
+        setOpen(false);
+      }
+    };
+    window.addEventListener('keydown', onKeyDown);
+    return () => window.removeEventListener('keydown', onKeyDown);
+  }, [isOpen, setOpen, variant]);
+
+  useEffect(() => {
+    if (variant !== 'sheet' || !isOpen) return;
+    const previousOverflow = document.body.style.overflow;
+    document.body.style.overflow = 'hidden';
+    return () => {
+      document.body.style.overflow = previousOverflow;
+    };
+  }, [isOpen, variant]);
+
+  if (variant === 'sheet') {
+    return (
+      <>
+        <div
+          className={clsx(
+            'fixed inset-0 z-40 bg-[rgba(0,0,0,0.62)] transition-opacity duration-200 motion-reduce:transition-none',
+            isOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
+          )}
+          aria-hidden={!isOpen}
+          onClick={() => setOpen(false)}
+        />
+        <section
+          role="dialog"
+          aria-modal="true"
+          aria-labelledby={dialogId}
+          className={clsx(
+            'fixed inset-x-0 bottom-0 z-50 max-h-[86vh] rounded-t-2xl border border-stroke bg-surface-1 p-4 shadow-surface transition-transform duration-300 motion-reduce:transition-none',
+            isOpen ? 'translate-y-0' : 'translate-y-full',
+            className
+          )}
+        >
+          <div className="mx-auto h-1.5 w-16 rounded-full bg-text4/50" aria-hidden="true" />
+          <DrawerHeader headingId={dialogId} title={title} onClose={() => setOpen(false)} />
+          <DrawerBody event={event} evidenceItems={evidenceItems} faq={faq} compact />
+        </section>
+      </>
+    );
+  }
+
+  return (
+    <section className={clsx('rounded-2xl border border-stroke bg-surface-1 p-4', className)} aria-labelledby={dialogId}>
+      <DrawerHeader headingId={dialogId} title={title} />
+      <DrawerBody event={event} evidenceItems={evidenceItems} faq={faq} />
+    </section>
+  );
+}
+
+function DrawerHeader({
+  headingId,
+  title,
+  onClose
+}: {
+  headingId: string;
+  title: string;
+  onClose?: () => void;
+}) {
+  return (
+    <div className="mt-3 flex items-start justify-between gap-3">
+      <h3 id={headingId} className="text-base font-semibold text-text1">
+        {title}
+      </h3>
+      {onClose ? (
+        <button
+          type="button"
+          onClick={onClose}
+          className="rounded-lg border border-stroke px-3 py-1.5 text-xs uppercase tracking-[0.08em] text-text3 transition hover:border-primary hover:text-text1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
+        >
+          Close
+        </button>
+      ) : null}
+    </div>
+  );
+}
+
+function DrawerBody({
+  event,
+  evidenceItems,
+  faq,
+  compact = false
+}: {
+  event: ArtemisTimelineEvent | null;
+  evidenceItems?: readonly ArtemisEvidenceItem[];
+  faq?: readonly ArtemisFaqItem[];
+  compact?: boolean;
+}) {
+  if (!event) {
+    return (
+      <div className={clsx('mt-3 rounded-xl border border-stroke bg-surface-0 p-3', compact ? 'text-xs' : 'text-sm')}>
+        <div className="font-semibold text-text1">No event selected</div>
+        <p className="mt-1 text-text3">Select a timeline item to inspect mission evidence and related references.</p>
+      </div>
+    );
+  }
+
+  return (
+    <div className={clsx('mt-3 space-y-3', compact ? 'max-h-[72vh] overflow-y-auto pr-1' : undefined)}>
+      <article className="rounded-xl border border-stroke bg-surface-0 p-3">
+        <div className="text-[11px] uppercase tracking-[0.08em] text-text3">Selected event</div>
+        <h4 className="mt-1 text-sm font-semibold text-text1">{event.title}</h4>
+        <p className="mt-1 text-xs text-text3">{formatDateLabel(event.eventTime || event.when)}</p>
+        {event.summary ? <p className="mt-2 text-sm text-text2">{event.summary}</p> : null}
+
+        <dl className="mt-3 grid gap-x-3 gap-y-1 text-xs text-text3 md:grid-cols-2">
+          <DetailRow label="event_time" value={formatDateLabel(event.eventTime || event.when)} />
+          <DetailRow label="announced_time" value={formatDateLabel(event.announcedTime || event.when)} />
+          <DetailRow label="source_type" value={event.sourceType || 'curated-fallback'} />
+          <DetailRow label="confidence" value={event.confidence || 'low'} />
+          <DetailRow label="supersedes" value={formatSupersedes(event.supersedes)} />
+          <DetailRow label="superseded_by" value={event.supersededBy?.eventId || 'none'} />
+        </dl>
+      </article>
+
+      <ArtemisEvidenceCenter launch={event.launch || null} items={evidenceItems} faq={faq} compact={compact} />
+    </div>
+  );
+}
+
+function DetailRow({ label, value }: { label: string; value: string }) {
+  return (
+    <div className="rounded-md border border-stroke bg-surface-1 px-2 py-1">
+      <dt className="uppercase tracking-[0.08em]">{label}</dt>
+      <dd className="mt-0.5 text-text2">{value}</dd>
+    </div>
+  );
+}
+
+function formatDateLabel(value: string) {
+  const parsed = Date.parse(value);
+  if (Number.isNaN(parsed)) return value;
+  return new Intl.DateTimeFormat('en-US', {
+    month: 'short',
+    day: '2-digit',
+    year: 'numeric',
+    hour: 'numeric',
+    minute: '2-digit',
+    timeZoneName: 'short'
+  }).format(new Date(parsed));
+}
+
+function formatSupersedes(value: ArtemisTimelineEvent['supersedes']) {
+  if (!value || value.length === 0) return 'none';
+  return value.map((entry) => (entry.reason ? `${entry.eventId} (${entry.reason})` : entry.eventId)).join(', ');
+}
diff --git a/components/artemis/ArtemisEvidenceCenter.tsx b/components/artemis/ArtemisEvidenceCenter.tsx
new file mode 100644
index 0000000..bf6a29b
--- /dev/null
+++ b/components/artemis/ArtemisEvidenceCenter.tsx
@@ -0,0 +1,270 @@
+import Link from 'next/link';
+import clsx from 'clsx';
+import type { ArtemisFaqItem } from '@/lib/types/artemis';
+import type { Launch } from '@/lib/types/launch';
+
+export type ArtemisEvidenceKind = 'stream' | 'report' | 'status' | 'reference' | 'note';
+
+export type ArtemisEvidenceItem = {
+  id: string;
+  label: string;
+  href?: string;
+  detail?: string;
+  source?: string;
+  capturedAt?: string;
+  kind?: ArtemisEvidenceKind;
+};
+
+export type ArtemisEvidenceCenterProps = {
+  launch?: Launch | null;
+  items?: readonly ArtemisEvidenceItem[];
+  faq?: readonly ArtemisFaqItem[];
+  title?: string;
+  className?: string;
+  compact?: boolean;
+  emptyLabel?: string;
+  maxItems?: number;
+};
+
+export function ArtemisEvidenceCenter({
+  launch,
+  items,
+  faq,
+  title = 'Evidence center',
+  className,
+  compact = false,
+  emptyLabel = 'No mission evidence links are available for the selected event.',
+  maxItems = 14
+}: ArtemisEvidenceCenterProps) {
+  const resolvedItems = (items && items.length > 0 ? items : buildEvidenceItemsFromLaunch(launch)).slice(0, Math.max(0, maxItems));
+
+  return (
+    <section className={clsx('rounded-2xl border border-stroke bg-surface-1 p-4', className)} aria-label={title}>
+      <h3 className={clsx('font-semibold text-text1', compact ? 'text-sm' : 'text-base')}>{title}</h3>
+
+      {resolvedItems.length === 0 ? (
+        <p className={clsx('text-text3', compact ? 'mt-2 text-xs' : 'mt-3 text-sm')}>{emptyLabel}</p>
+      ) : (
+        <ul className={clsx(compact ? 'mt-2 space-y-2' : 'mt-3 space-y-2')}>
+          {resolvedItems.map((item) => {
+            const external = isExternalUrl(item.href);
+            return (
+              <li key={item.id} className="rounded-lg border border-stroke bg-surface-0 px-3 py-2">
+                {item.href ? (
+                  external ? (
+                    <a
+                      href={item.href}
+                      target="_blank"
+                      rel="noreferrer"
+                      className="block transition hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
+                    >
+                      <div className="flex items-center justify-between gap-2">
+                        <span className="text-sm font-semibold text-text1">{item.label}</span>
+                        {item.kind ? (
+                          <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
+                            {item.kind}
+                          </span>
+                        ) : null}
+                      </div>
+                      <EvidenceItemMeta item={item} />
+                    </a>
+                  ) : (
+                    <Link href={item.href} className="block transition hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
+                      <div className="flex items-center justify-between gap-2">
+                        <span className="text-sm font-semibold text-text1">{item.label}</span>
+                        {item.kind ? (
+                          <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
+                            {item.kind}
+                          </span>
+                        ) : null}
+                      </div>
+                      <EvidenceItemMeta item={item} />
+                    </Link>
+                  )
+                ) : (
+                  <div>
+                    <div className="flex items-center justify-between gap-2">
+                      <span className="text-sm font-semibold text-text1">{item.label}</span>
+                      {item.kind ? (
+                        <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
+                          {item.kind}
+                        </span>
+                      ) : null}
+                    </div>
+                    <EvidenceItemMeta item={item} />
+                  </div>
+                )}
+              </li>
+            );
+          })}
+        </ul>
+      )}
+
+      {!compact && faq && faq.length > 0 ? (
+        <details className="mt-3 rounded-xl border border-stroke bg-surface-0 p-3">
+          <summary className="cursor-pointer text-xs uppercase tracking-[0.08em] text-text3">Reference FAQ</summary>
+          <dl className="mt-2 space-y-2">
+            {faq.slice(0, 4).map((entry) => (
+              <div key={entry.question}>
+                <dt className="text-sm font-semibold text-text1">{entry.question}</dt>
+                <dd className="mt-1 text-xs text-text2">{entry.answer}</dd>
+              </div>
+            ))}
+          </dl>
+        </details>
+      ) : null}
+    </section>
+  );
+}
+
+function EvidenceItemMeta({ item }: { item: ArtemisEvidenceItem }) {
+  return (
+    <div className="mt-1 space-y-1 text-xs text-text3">
+      {item.detail ? <p>{item.detail}</p> : null}
+      <div className="flex flex-wrap items-center gap-2">
+        {item.source ? <span>{item.source}</span> : null}
+        {item.capturedAt ? <time dateTime={toDateTimeAttr(item.capturedAt)}>{formatDate(item.capturedAt)}</time> : null}
+      </div>
+    </div>
+  );
+}
+
+function buildEvidenceItemsFromLaunch(launch: Launch | null | undefined): ArtemisEvidenceItem[] {
+  if (!launch) return [];
+  const evidence: ArtemisEvidenceItem[] = [];
+  const seen = new Set<string>();
+
+  const push = (entry: Omit<ArtemisEvidenceItem, 'id'>) => {
+    const key = `${entry.href || entry.label}::${entry.kind || 'reference'}`;
+    if (seen.has(key)) return;
+    seen.add(key);
+    evidence.push({ ...entry, id: key });
+  };
+
+  push({
+    label: 'Status signal',
+    detail: launch.statusText || launch.status || 'Status pending',
+    capturedAt: launch.lastUpdated || launch.cacheGeneratedAt || launch.net,
+    source: 'Launch feed',
+    kind: 'status'
+  });
+
+  pushIfHref(
+    push,
+    launch.videoUrl,
+    launch.videoUrl,
+    {
+      label: 'Primary webcast',
+      detail: launch.name,
+      source: launch.provider,
+      capturedAt: launch.net,
+      kind: 'stream'
+    }
+  );
+
+  for (const link of launch.launchVidUrls || []) {
+    pushIfHref(push, link?.url, link?.url, {
+      label: link?.title?.trim() || 'Launch stream',
+      detail: link?.description?.trim() || undefined,
+      source: link?.source || link?.publisher || launch.provider,
+      kind: 'stream'
+    });
+  }
+
+  for (const link of launch.launchInfoUrls || []) {
+    pushIfHref(push, link?.url, link?.url, {
+      label: link?.title?.trim() || 'Mission report',
+      detail: link?.description?.trim() || undefined,
+      source: link?.source || 'Launch feed',
+      kind: 'report'
+    });
+  }
+
+  for (const link of launch.mission?.infoUrls || []) {
+    pushIfHref(push, link?.url, link?.url, {
+      label: link?.title?.trim() || 'Mission reference',
+      detail: link?.description?.trim() || launch.mission?.name,
+      source: link?.source || 'Mission feed',
+      kind: 'reference'
+    });
+  }
+
+  for (const link of launch.mission?.vidUrls || []) {
+    pushIfHref(push, link?.url, link?.url, {
+      label: link?.title?.trim() || 'Mission stream',
+      detail: link?.description?.trim() || launch.mission?.name,
+      source: link?.source || link?.publisher || 'Mission feed',
+      kind: 'stream'
+    });
+  }
+
+  pushIfHref(push, launch.currentEvent?.url, launch.currentEvent?.url, {
+    label: launch.currentEvent?.name || 'Current related event',
+    detail: launch.currentEvent?.typeName || undefined,
+    capturedAt: launch.currentEvent?.date || undefined,
+    source: 'Related events',
+    kind: 'reference'
+  });
+
+  pushIfHref(push, launch.nextEvent?.url, launch.nextEvent?.url, {
+    label: launch.nextEvent?.name || 'Next related event',
+    detail: launch.nextEvent?.typeName || undefined,
+    capturedAt: launch.nextEvent?.date || undefined,
+    source: 'Related events',
+    kind: 'reference'
+  });
+
+  pushIfHref(push, launch.flightclubUrl, launch.flightclubUrl, {
+    label: 'Trajectory profile',
+    source: 'FlightClub',
+    kind: 'reference'
+  });
+
+  pushIfHref(push, launch.spacexXPostUrl, launch.spacexXPostUrl, {
+    label: 'Mission social update',
+    source: 'X',
+    capturedAt: launch.spacexXPostCapturedAt || undefined,
+    kind: 'report'
+  });
+
+  return evidence;
+}
+
+function pushIfHref(
+  push: (entry: Omit<ArtemisEvidenceItem, 'id'>) => void,
+  rawHref: string | undefined | null,
+  fallbackDetail: string | undefined | null,
+  entry: Omit<ArtemisEvidenceItem, 'id' | 'href'>
+) {
+  const href = typeof rawHref === 'string' ? rawHref.trim() : '';
+  if (!href) return;
+  push({
+    ...entry,
+    href,
+    detail: entry.detail || (entry.source ? `${entry.source} • ${fallbackDetail || href}` : fallbackDetail || href)
+  });
+}
+
+function formatDate(value: string) {
+  const parsed = Date.parse(value);
+  if (Number.isNaN(parsed)) return value;
+  return new Intl.DateTimeFormat('en-US', {
+    month: 'short',
+    day: '2-digit',
+    year: 'numeric',
+    hour: 'numeric',
+    minute: '2-digit',
+    timeZoneName: 'short'
+  }).format(new Date(parsed));
+}
+
+function toDateTimeAttr(value: string) {
+  const parsed = Date.parse(value);
+  if (Number.isNaN(parsed)) return value;
+  return new Date(parsed).toISOString();
+}
+
+function isExternalUrl(value: string | undefined) {
+  if (!value) return false;
+  return /^https?:\/\//i.test(value);
+}
diff --git a/components/artemis/ArtemisKpiStrip.tsx b/components/artemis/ArtemisKpiStrip.tsx
new file mode 100644
index 0000000..0633a10
--- /dev/null
+++ b/components/artemis/ArtemisKpiStrip.tsx
@@ -0,0 +1,120 @@
+import clsx from 'clsx';
+import type { ArtemisMissionSnapshot, ArtemisProgramSnapshot } from '@/lib/types/artemis';
+
+type ArtemisSnapshot = ArtemisProgramSnapshot | ArtemisMissionSnapshot;
+
+export type ArtemisKpiTone = 'default' | 'success' | 'warning' | 'danger' | 'info';
+
+export type ArtemisKpiMetric = {
+  id: string;
+  label: string;
+  value: string;
+  detail?: string;
+  tone?: ArtemisKpiTone;
+};
+
+export type ArtemisKpiStripProps = {
+  snapshot: ArtemisSnapshot;
+  metrics?: readonly ArtemisKpiMetric[];
+  title?: string;
+  className?: string;
+};
+
+const TONE_CLASS: Record<ArtemisKpiTone, string> = {
+  default: 'border-stroke',
+  success: 'border-success/40',
+  warning: 'border-warning/40',
+  danger: 'border-danger/40',
+  info: 'border-info/40'
+};
+
+export function ArtemisKpiStrip({ snapshot, metrics, title = 'Program metrics', className }: ArtemisKpiStripProps) {
+  const resolvedMetrics = metrics && metrics.length > 0 ? metrics : buildDefaultMetrics(snapshot);
+
+  return (
+    <section className={clsx('rounded-2xl border border-stroke bg-surface-1 p-4', className)} aria-label={title}>
+      <div className="text-xs uppercase tracking-[0.1em] text-text3">{title}</div>
+      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
+        {resolvedMetrics.map((metric) => (
+          <article key={metric.id} className={clsx('rounded-xl border bg-surface-0 px-3 py-2', TONE_CLASS[metric.tone || 'default'])}>
+            <div className="text-[11px] uppercase tracking-[0.08em] text-text3">{metric.label}</div>
+            <div className="mt-1 text-lg font-semibold text-text1">{metric.value}</div>
+            {metric.detail ? <div className="mt-1 text-xs text-text3">{metric.detail}</div> : null}
+          </article>
+        ))}
+      </div>
+    </section>
+  );
+}
+
+function buildDefaultMetrics(snapshot: ArtemisSnapshot): ArtemisKpiMetric[] {
+  const nextLaunchLabel = formatDate(snapshot.nextLaunch?.net || null);
+  const updatedLabel = formatDate(snapshot.lastUpdated || snapshot.generatedAt);
+
+  const metrics: ArtemisKpiMetric[] = [
+    {
+      id: 'upcoming',
+      label: 'Upcoming',
+      value: String(snapshot.upcoming.length),
+      tone: 'info'
+    },
+    {
+      id: 'recent',
+      label: 'Recent',
+      value: String(snapshot.recent.length)
+    },
+    {
+      id: 'next-launch',
+      label: 'Next launch',
+      value: nextLaunchLabel || 'Awaiting feed',
+      tone: snapshot.nextLaunch ? 'success' : 'warning'
+    },
+    {
+      id: 'last-updated',
+      label: 'Last updated',
+      value: updatedLabel || 'Unknown'
+    }
+  ];
+
+  if (isMissionSnapshot(snapshot)) {
+    metrics.push(
+      {
+        id: 'crew',
+        label: 'Crew highlights',
+        value: String(snapshot.crewHighlights.length),
+        tone: snapshot.crewHighlights.length > 0 ? 'success' : 'default'
+      },
+      {
+        id: 'changes',
+        label: 'Change entries',
+        value: String(snapshot.changes.length)
+      }
+    );
+  } else {
+    metrics.push({
+      id: 'faq',
+      label: 'FAQ entries',
+      value: String(snapshot.faq.length)
+    });
+  }
+
+  return metrics;
+}
+
+function isMissionSnapshot(snapshot: ArtemisSnapshot): snapshot is ArtemisMissionSnapshot {
+  return 'missionName' in snapshot;
+}
+
+function formatDate(value: string | null) {
+  if (!value) return null;
+  const date = new Date(value);
+  if (Number.isNaN(date.getTime())) return value;
+  return new Intl.DateTimeFormat('en-US', {
+    month: 'short',
+    day: '2-digit',
+    year: 'numeric',
+    hour: 'numeric',
+    minute: '2-digit',
+    timeZoneName: 'short'
+  }).format(date);
+}
diff --git a/components/artemis/ArtemisMissionRail.tsx b/components/artemis/ArtemisMissionRail.tsx
new file mode 100644
index 0000000..905d184
--- /dev/null
+++ b/components/artemis/ArtemisMissionRail.tsx
@@ -0,0 +1,150 @@
+'use client';
+
+import { useId, useMemo } from 'react';
+import type { KeyboardEvent } from 'react';
+import clsx from 'clsx';
+
+export type ArtemisMissionRailItem = {
+  id: string;
+  label: string;
+  subtitle?: string;
+  status?: string;
+  nextNet?: string | null;
+  launchCount?: number;
+  disabled?: boolean;
+  panelId?: string;
+};
+
+export type ArtemisMissionRailProps = {
+  missions: readonly ArtemisMissionRailItem[];
+  value: string | null;
+  onChange?: (missionId: string) => void;
+  ariaLabel?: string;
+  className?: string;
+  orientation?: 'horizontal' | 'vertical';
+};
+
+export function ArtemisMissionRail({
+  missions,
+  value,
+  onChange,
+  ariaLabel = 'Mission selection',
+  className,
+  orientation = 'vertical'
+}: ArtemisMissionRailProps) {
+  const tablistId = useId();
+  const missionList = useMemo(() => missions.filter(Boolean), [missions]);
+  const activeIndex = missionList.findIndex((mission) => mission.id === value);
+
+  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
+    if (!missionList.length) return;
+    const currentIndex = activeIndex >= 0 ? activeIndex : 0;
+    let nextIndex = -1;
+    const isHorizontal = orientation === 'horizontal';
+
+    if (event.key === 'Home') {
+      event.preventDefault();
+      nextIndex = findNextEnabledMissionIndex(missionList, -1, 1);
+    }
+    if (event.key === 'End') {
+      event.preventDefault();
+      nextIndex = findNextEnabledMissionIndex(missionList, 0, -1);
+    }
+    if (event.key === (isHorizontal ? 'ArrowRight' : 'ArrowDown')) {
+      event.preventDefault();
+      nextIndex = findNextEnabledMissionIndex(missionList, currentIndex, 1);
+    }
+    if (event.key === (isHorizontal ? 'ArrowLeft' : 'ArrowUp')) {
+      event.preventDefault();
+      nextIndex = findNextEnabledMissionIndex(missionList, currentIndex, -1);
+    }
+
+    if (nextIndex < 0) return;
+    const nextMission = missionList[nextIndex];
+    if (!nextMission || nextMission.disabled) return;
+    onChange?.(nextMission.id);
+    const element = document.getElementById(getMissionTabId(tablistId, nextMission.id));
+    element?.focus();
+  };
+
+  return (
+    <section className={clsx('rounded-2xl border border-stroke bg-surface-1 p-2', className)}>
+      <div
+        role="tablist"
+        aria-label={ariaLabel}
+        aria-orientation={orientation}
+        onKeyDown={handleKeyDown}
+        className={clsx('gap-2', orientation === 'horizontal' ? 'grid grid-cols-1 sm:grid-cols-2' : 'flex flex-col')}
+      >
+        {missionList.map((mission) => {
+          const isSelected = mission.id === value;
+          const nextNetLabel = formatMissionNetLabel(mission.nextNet || null);
+          return (
+            <button
+              key={mission.id}
+              id={getMissionTabId(tablistId, mission.id)}
+              type="button"
+              role="tab"
+              aria-selected={isSelected}
+              aria-controls={mission.panelId}
+              tabIndex={isSelected ? 0 : -1}
+              disabled={mission.disabled}
+              onClick={() => {
+                if (mission.disabled) return;
+                onChange?.(mission.id);
+              }}
+              className={clsx(
+                'rounded-xl border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none',
+                mission.disabled && 'cursor-not-allowed opacity-60',
+                isSelected
+                  ? 'border-primary bg-[rgba(34,211,238,0.1)] text-text1 shadow-glow'
+                  : 'border-stroke bg-surface-0 text-text2 hover:border-primary/60 hover:text-text1'
+              )}
+            >
+              <div className="flex items-center justify-between gap-2">
+                <div className="truncate text-sm font-semibold">{mission.label}</div>
+                {typeof mission.launchCount === 'number' ? (
+                  <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
+                    {mission.launchCount}
+                  </span>
+                ) : null}
+              </div>
+              {mission.subtitle ? <div className="mt-1 truncate text-xs text-text3">{mission.subtitle}</div> : null}
+              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
+                {mission.status ? (
+                  <span className="rounded-full border border-stroke px-2 py-0.5 uppercase tracking-[0.08em] text-text3">{mission.status}</span>
+                ) : null}
+                {nextNetLabel ? <span className="text-text3">Next: {nextNetLabel}</span> : null}
+              </div>
+            </button>
+          );
+        })}
+      </div>
+    </section>
+  );
+}
+
+function findNextEnabledMissionIndex(items: readonly ArtemisMissionRailItem[], start: number, direction: 1 | -1) {
+  if (!items.length) return -1;
+  for (let step = 1; step <= items.length; step += 1) {
+    const index = (start + direction * step + items.length) % items.length;
+    const item = items[index];
+    if (item && !item.disabled) return index;
+  }
+  return -1;
+}
+
+function getMissionTabId(tablistId: string, missionId: string) {
+  return `${tablistId}-${missionId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
+}
+
+function formatMissionNetLabel(value: string | null) {
+  if (!value) return null;
+  const date = new Date(value);
+  if (Number.isNaN(date.getTime())) return value;
+  return new Intl.DateTimeFormat('en-US', {
+    month: 'short',
+    day: '2-digit',
+    year: 'numeric'
+  }).format(date);
+}
diff --git a/components/artemis/ArtemisModeSwitch.tsx b/components/artemis/ArtemisModeSwitch.tsx
new file mode 100644
index 0000000..ec5335b
--- /dev/null
+++ b/components/artemis/ArtemisModeSwitch.tsx
@@ -0,0 +1,134 @@
+'use client';
+
+import { useId, useMemo } from 'react';
+import type { KeyboardEvent } from 'react';
+import clsx from 'clsx';
+
+export type ArtemisWorkbenchMode = 'quick' | 'explorer' | 'technical';
+
+export type ArtemisModeSwitchOption<TMode extends string = ArtemisWorkbenchMode> = {
+  id: TMode;
+  label: string;
+  description?: string;
+  badge?: string;
+  disabled?: boolean;
+  panelId?: string;
+};
+
+export type ArtemisModeSwitchProps<TMode extends string = ArtemisWorkbenchMode> = {
+  options: readonly ArtemisModeSwitchOption<TMode>[];
+  value: TMode;
+  onChange?: (next: TMode) => void;
+  ariaLabel?: string;
+  className?: string;
+};
+
+export function ArtemisModeSwitch<TMode extends string = ArtemisWorkbenchMode>({
+  options,
+  value,
+  onChange,
+  ariaLabel = 'Workbench mode',
+  className
+}: ArtemisModeSwitchProps<TMode>) {
+  const tablistId = useId();
+  const normalizedOptions = useMemo(() => options.filter(Boolean), [options]);
+
+  const activeIndex = normalizedOptions.findIndex((option) => option.id === value);
+
+  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
+    if (!normalizedOptions.length) return;
+    const currentIndex = activeIndex >= 0 ? activeIndex : 0;
+    let nextIndex = -1;
+
+    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
+      event.preventDefault();
+      nextIndex = findNextEnabledIndex(normalizedOptions, currentIndex, 1);
+    }
+    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
+      event.preventDefault();
+      nextIndex = findNextEnabledIndex(normalizedOptions, currentIndex, -1);
+    }
+    if (event.key === 'Home') {
+      event.preventDefault();
+      nextIndex = findNextEnabledIndex(normalizedOptions, -1, 1);
+    }
+    if (event.key === 'End') {
+      event.preventDefault();
+      nextIndex = findNextEnabledIndex(normalizedOptions, 0, -1);
+    }
+
+    if (nextIndex < 0) return;
+    const nextOption = normalizedOptions[nextIndex];
+    if (!nextOption || nextOption.disabled) return;
+    onChange?.(nextOption.id);
+    const element = document.getElementById(getTabId(tablistId, nextOption.id));
+    element?.focus();
+  };
+
+  return (
+    <div
+      className={clsx('rounded-2xl border border-stroke bg-surface-1 p-2', className)}
+      role="tablist"
+      aria-label={ariaLabel}
+      aria-orientation="horizontal"
+      onKeyDown={handleKeyDown}
+    >
+      <div className="grid gap-2 sm:grid-cols-3">
+        {normalizedOptions.map((option) => {
+          const isSelected = option.id === value;
+          return (
+            <button
+              key={option.id}
+              id={getTabId(tablistId, option.id)}
+              role="tab"
+              type="button"
+              aria-selected={isSelected}
+              aria-controls={option.panelId}
+              disabled={option.disabled}
+              tabIndex={isSelected ? 0 : -1}
+              onClick={() => {
+                if (option.disabled) return;
+                onChange?.(option.id);
+              }}
+              className={clsx(
+                'rounded-xl border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none',
+                option.disabled && 'cursor-not-allowed opacity-60',
+                isSelected
+                  ? 'border-primary bg-[rgba(34,211,238,0.12)] text-text1 shadow-glow'
+                  : 'border-stroke bg-surface-0 text-text2 hover:border-primary/60 hover:text-text1'
+              )}
+            >
+              <div className="flex items-center justify-between gap-2">
+                <span className="text-sm font-semibold">{option.label}</span>
+                {option.badge ? (
+                  <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
+                    {option.badge}
+                  </span>
+                ) : null}
+              </div>
+              {option.description ? <p className="mt-1 text-xs text-text3">{option.description}</p> : null}
+            </button>
+          );
+        })}
+      </div>
+    </div>
+  );
+}
+
+function findNextEnabledIndex<TMode extends string>(
+  options: readonly ArtemisModeSwitchOption<TMode>[],
+  start: number,
+  direction: 1 | -1
+) {
+  if (!options.length) return -1;
+  for (let step = 1; step <= options.length; step += 1) {
+    const index = (start + direction * step + options.length) % options.length;
+    const option = options[index];
+    if (option && !option.disabled) return index;
+  }
+  return -1;
+}
+
+function getTabId(tablistId: string, optionId: string) {
+  return `${tablistId}-${optionId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
+}
diff --git a/components/artemis/ArtemisProgramWorkbenchDesktop.tsx b/components/artemis/ArtemisProgramWorkbenchDesktop.tsx
new file mode 100644
index 0000000..084f2c1
--- /dev/null
+++ b/components/artemis/ArtemisProgramWorkbenchDesktop.tsx
@@ -0,0 +1,244 @@
+'use client';
+
+import { useEffect, useMemo, useState } from 'react';
+import clsx from 'clsx';
+import type { ArtemisChangeItem, ArtemisMissionSnapshot, ArtemisProgramSnapshot } from '@/lib/types/artemis';
+import { buildLaunchHref } from '@/lib/utils/launchLinks';
+import { ArtemisChangeLedger } from './ArtemisChangeLedger';
+import { ArtemisEventDrawer } from './ArtemisEventDrawer';
+import { ArtemisKpiStrip } from './ArtemisKpiStrip';
+import { ArtemisMissionRail } from './ArtemisMissionRail';
+import { ArtemisModeSwitch, type ArtemisWorkbenchMode } from './ArtemisModeSwitch';
+import { ArtemisSystemsGraph } from './ArtemisSystemsGraph';
+import { ArtemisTimelineExplorer, type ArtemisTimelineEvent, type ArtemisTimelineFilters } from './ArtemisTimelineExplorer';
+
+export type ArtemisWorkbenchMission = {
+  id: string;
+  label: string;
+  snapshot: ArtemisMissionSnapshot;
+  subtitle?: string;
+  status?: string;
+};
+
+export type ArtemisProgramWorkbenchDesktopProps = {
+  programSnapshot: ArtemisProgramSnapshot;
+  missions: readonly ArtemisWorkbenchMission[];
+  timelineEvents?: readonly ArtemisTimelineEvent[];
+  mode?: ArtemisWorkbenchMode;
+  defaultMode?: ArtemisWorkbenchMode;
+  onModeChange?: (mode: ArtemisWorkbenchMode) => void;
+  missionId?: string | null;
+  defaultMissionId?: string | null;
+  onMissionChange?: (missionId: string) => void;
+  selectedEventId?: string | null;
+  defaultSelectedEventId?: string | null;
+  onSelectedEventChange?: (event: ArtemisTimelineEvent | null) => void;
+  initialFilters?: ArtemisTimelineFilters;
+  onFiltersChange?: (filters: ArtemisTimelineFilters) => void;
+  className?: string;
+};
+
+const DEFAULT_FILTERS: ArtemisTimelineFilters = {
+  sourceType: 'all',
+  includeSuperseded: false,
+  from: null,
+  to: null
+};
+
+export function ArtemisProgramWorkbenchDesktop({
+  programSnapshot,
+  missions,
+  timelineEvents,
+  mode,
+  defaultMode = 'quick',
+  onModeChange,
+  missionId,
+  defaultMissionId,
+  onMissionChange,
+  selectedEventId,
+  defaultSelectedEventId = null,
+  onSelectedEventChange,
+  initialFilters,
+  onFiltersChange,
+  className
+}: ArtemisProgramWorkbenchDesktopProps) {
+  const [internalMode, setInternalMode] = useState<ArtemisWorkbenchMode>(defaultMode);
+  const [internalMissionId, setInternalMissionId] = useState<string | null>(defaultMissionId || missions[0]?.id || null);
+  const [activeEvent, setActiveEvent] = useState<ArtemisTimelineEvent | null>(null);
+  const [filters, setFilters] = useState<ArtemisTimelineFilters>(initialFilters || DEFAULT_FILTERS);
+
+  const activeMode = mode || internalMode;
+  const activeMissionId = missionId ?? internalMissionId ?? missions[0]?.id ?? null;
+  const activeMission = missions.find((entry) => entry.id === activeMissionId) || missions[0] || null;
+  const activeSnapshot = activeMode === 'quick' || !activeMission ? programSnapshot : activeMission.snapshot;
+  const timelineById = useMemo(() => {
+    const map = new Map<string, ArtemisTimelineEvent>();
+    for (const event of timelineEvents || []) {
+      map.set(event.id, event);
+    }
+    return map;
+  }, [timelineEvents]);
+
+  useEffect(() => {
+    setActiveEvent(null);
+    onSelectedEventChange?.(null);
+  }, [activeMode, activeMissionId, activeSnapshot.generatedAt, onSelectedEventChange]);
+
+  useEffect(() => {
+    const preferredId = selectedEventId || defaultSelectedEventId || null;
+    if (!preferredId) return;
+    const nextEvent = timelineById.get(preferredId) || null;
+    if (!nextEvent) return;
+    setActiveEvent(nextEvent);
+    onSelectedEventChange?.(nextEvent);
+  }, [defaultSelectedEventId, onSelectedEventChange, selectedEventId, timelineById]);
+
+  useEffect(() => {
+    if (typeof window === 'undefined') return;
+    const params = new URLSearchParams(window.location.search);
+    params.set('mode', activeMode);
+    if (activeMissionId) params.set('mission', activeMissionId);
+    else params.delete('mission');
+
+    const eventId = activeEvent?.id || selectedEventId || defaultSelectedEventId || null;
+    if (eventId) params.set('event', eventId);
+    else params.delete('event');
+
+    params.set('sourceType', filters.sourceType);
+    if (filters.includeSuperseded) params.set('includeSuperseded', 'true');
+    else params.delete('includeSuperseded');
+    if (filters.from) params.set('from', filters.from);
+    else params.delete('from');
+    if (filters.to) params.set('to', filters.to);
+    else params.delete('to');
+
+    const nextQuery = params.toString();
+    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`;
+    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
+    if (nextUrl !== currentUrl) {
+      window.history.replaceState(null, '', nextUrl);
+    }
+  }, [activeEvent?.id, activeMissionId, activeMode, defaultSelectedEventId, filters, selectedEventId]);
+
+  const missionRailItems = useMemo(
+    () =>
+      missions.map((entry) => ({
+        id: entry.id,
+        label: entry.label,
+        subtitle: entry.subtitle || entry.snapshot.missionName,
+        status: entry.status || entry.snapshot.nextLaunch?.statusText || 'Tracking',
+        nextNet: entry.snapshot.nextLaunch?.net || null,
+        launchCount: entry.snapshot.upcoming.length
+      })),
+    [missions]
+  );
+
+  const modeOptions = useMemo(
+    () => [
+      {
+        id: 'quick' as const,
+        label: 'Quick',
+        description: 'Fast signal overview',
+        badge: `${programSnapshot.upcoming.length}`
+      },
+      {
+        id: 'explorer' as const,
+        label: 'Explorer',
+        description: activeMission ? activeMission.label : 'Mission timeline view',
+        badge: activeMission ? `${activeMission.snapshot.upcoming.length}` : '0',
+        disabled: missions.length === 0
+      },
+      {
+        id: 'technical' as const,
+        label: 'Technical',
+        description: 'Deep evidence and supersession',
+        badge: String((timelineEvents || []).length)
+      }
+    ],
+    [activeMission, missions.length, programSnapshot.upcoming.length, timelineEvents]
+  );
+
+  const ledgerChanges: ArtemisChangeItem[] = useMemo(() => {
+    if (isMissionSnapshot(activeSnapshot)) return [...activeSnapshot.changes];
+    return buildProgramChanges(activeSnapshot);
+  }, [activeSnapshot]);
+
+  return (
+    <section className={clsx('grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_340px]', className)}>
+      <aside className="self-start space-y-4 xl:sticky xl:top-24">
+        <ArtemisModeSwitch
+          options={modeOptions}
+          value={activeMode}
+          onChange={(nextMode) => {
+            if (!mode) setInternalMode(nextMode);
+            onModeChange?.(nextMode);
+          }}
+        />
+
+        <ArtemisMissionRail
+          missions={missionRailItems}
+          value={activeMissionId}
+          onChange={(nextMissionId) => {
+            if (!missionId) setInternalMissionId(nextMissionId);
+            onMissionChange?.(nextMissionId);
+          }}
+        />
+
+        <ArtemisKpiStrip snapshot={activeSnapshot} />
+      </aside>
+
+      <main className="min-w-0 space-y-4">
+        <ArtemisTimelineExplorer
+          snapshot={activeSnapshot}
+          events={timelineEvents}
+          selectedEventId={selectedEventId}
+          defaultSelectedEventId={defaultSelectedEventId}
+          initialSourceType={filters.sourceType}
+          initialIncludeSuperseded={filters.includeSuperseded}
+          initialFrom={filters.from}
+          initialTo={filters.to}
+          onFiltersChange={(nextFilters) => {
+            setFilters(nextFilters);
+            onFiltersChange?.(nextFilters);
+          }}
+          onSelectEvent={(event) => {
+            setActiveEvent(event);
+            onSelectedEventChange?.(event);
+          }}
+        />
+
+        {activeMode !== 'quick' ? <ArtemisSystemsGraph snapshot={activeSnapshot} /> : null}
+        {activeMode !== 'quick' ? <ArtemisChangeLedger changes={ledgerChanges} /> : null}
+      </main>
+
+      <aside className="self-start xl:sticky xl:top-24">
+        <ArtemisEventDrawer
+          variant="panel"
+          title="Event evidence drawer"
+          event={activeEvent}
+          faq={activeSnapshot.faq}
+        />
+      </aside>
+    </section>
+  );
+}
+
+function buildProgramChanges(snapshot: ArtemisProgramSnapshot): ArtemisChangeItem[] {
+  const changes = [...snapshot.upcoming, ...snapshot.recent].map((launch) => ({
+    title: launch.name,
+    summary: `${launch.statusText || launch.status || 'Status pending'} • ${launch.provider} • ${launch.pad?.shortCode || 'Pad TBD'}`,
+    date: launch.lastUpdated || launch.cacheGeneratedAt || launch.net,
+    href: buildLaunchHref(launch)
+  }));
+  changes.sort((a, b) => parseDateOrZero(b.date) - parseDateOrZero(a.date));
+  return changes.slice(0, 12);
+}
+
+function parseDateOrZero(value: string) {
+  const parsed = Date.parse(value);
+  return Number.isNaN(parsed) ? 0 : parsed;
+}
+
+function isMissionSnapshot(snapshot: ArtemisProgramSnapshot | ArtemisMissionSnapshot): snapshot is ArtemisMissionSnapshot {
+  return 'missionName' in snapshot;
+}
diff --git a/components/artemis/ArtemisProgramWorkbenchMobile.tsx b/components/artemis/ArtemisProgramWorkbenchMobile.tsx
new file mode 100644
index 0000000..be74843
--- /dev/null
+++ b/components/artemis/ArtemisProgramWorkbenchMobile.tsx
@@ -0,0 +1,246 @@
+'use client';
+
+import { useEffect, useMemo, useState } from 'react';
+import clsx from 'clsx';
+import type { ArtemisChangeItem, ArtemisMissionSnapshot, ArtemisProgramSnapshot } from '@/lib/types/artemis';
+import { buildLaunchHref } from '@/lib/utils/launchLinks';
+import { ArtemisChangeLedger } from './ArtemisChangeLedger';
+import { ArtemisEventDrawer } from './ArtemisEventDrawer';
+import { ArtemisKpiStrip } from './ArtemisKpiStrip';
+import { ArtemisMissionRail } from './ArtemisMissionRail';
+import { ArtemisModeSwitch, type ArtemisWorkbenchMode } from './ArtemisModeSwitch';
+import { ArtemisSystemsGraph } from './ArtemisSystemsGraph';
+import { ArtemisTimelineExplorer, type ArtemisTimelineEvent, type ArtemisTimelineFilters } from './ArtemisTimelineExplorer';
+import type { ArtemisWorkbenchMission } from './ArtemisProgramWorkbenchDesktop';
+
+export type ArtemisProgramWorkbenchMobileProps = {
+  programSnapshot: ArtemisProgramSnapshot;
+  missions: readonly ArtemisWorkbenchMission[];
+  timelineEvents?: readonly ArtemisTimelineEvent[];
+  mode?: ArtemisWorkbenchMode;
+  defaultMode?: ArtemisWorkbenchMode;
+  onModeChange?: (mode: ArtemisWorkbenchMode) => void;
+  missionId?: string | null;
+  defaultMissionId?: string | null;
+  onMissionChange?: (missionId: string) => void;
+  selectedEventId?: string | null;
+  defaultSelectedEventId?: string | null;
+  onSelectedEventChange?: (event: ArtemisTimelineEvent | null) => void;
+  initialFilters?: ArtemisTimelineFilters;
+  onFiltersChange?: (filters: ArtemisTimelineFilters) => void;
+  className?: string;
+};
+
+const DEFAULT_FILTERS: ArtemisTimelineFilters = {
+  sourceType: 'all',
+  includeSuperseded: false,
+  from: null,
+  to: null
+};
+
+export function ArtemisProgramWorkbenchMobile({
+  programSnapshot,
+  missions,
+  timelineEvents,
+  mode,
+  defaultMode = 'quick',
+  onModeChange,
+  missionId,
+  defaultMissionId,
+  onMissionChange,
+  selectedEventId,
+  defaultSelectedEventId = null,
+  onSelectedEventChange,
+  initialFilters,
+  onFiltersChange,
+  className
+}: ArtemisProgramWorkbenchMobileProps) {
+  const [internalMode, setInternalMode] = useState<ArtemisWorkbenchMode>(defaultMode);
+  const [internalMissionId, setInternalMissionId] = useState<string | null>(defaultMissionId || missions[0]?.id || null);
+  const [activeEvent, setActiveEvent] = useState<ArtemisTimelineEvent | null>(null);
+  const [sheetOpen, setSheetOpen] = useState(false);
+  const [filters, setFilters] = useState<ArtemisTimelineFilters>(initialFilters || DEFAULT_FILTERS);
+
+  const activeMode = mode || internalMode;
+  const activeMissionId = missionId ?? internalMissionId ?? missions[0]?.id ?? null;
+  const activeMission = missions.find((entry) => entry.id === activeMissionId) || missions[0] || null;
+  const activeSnapshot = activeMode === 'quick' || !activeMission ? programSnapshot : activeMission.snapshot;
+  const timelineById = useMemo(() => {
+    const map = new Map<string, ArtemisTimelineEvent>();
+    for (const event of timelineEvents || []) {
+      map.set(event.id, event);
+    }
+    return map;
+  }, [timelineEvents]);
+
+  useEffect(() => {
+    setActiveEvent(null);
+    setSheetOpen(false);
+    onSelectedEventChange?.(null);
+  }, [activeMode, activeMissionId, activeSnapshot.generatedAt, onSelectedEventChange]);
+
+  useEffect(() => {
+    const preferredId = selectedEventId || defaultSelectedEventId || null;
+    if (!preferredId) return;
+    const nextEvent = timelineById.get(preferredId) || null;
+    if (!nextEvent) return;
+    setActiveEvent(nextEvent);
+    onSelectedEventChange?.(nextEvent);
+  }, [defaultSelectedEventId, onSelectedEventChange, selectedEventId, timelineById]);
+
+  useEffect(() => {
+    if (typeof window === 'undefined') return;
+    const params = new URLSearchParams(window.location.search);
+    params.set('mode', activeMode);
+    if (activeMissionId) params.set('mission', activeMissionId);
+    else params.delete('mission');
+
+    const eventId = activeEvent?.id || selectedEventId || defaultSelectedEventId || null;
+    if (eventId) params.set('event', eventId);
+    else params.delete('event');
+
+    params.set('sourceType', filters.sourceType);
+    if (filters.includeSuperseded) params.set('includeSuperseded', 'true');
+    else params.delete('includeSuperseded');
+    if (filters.from) params.set('from', filters.from);
+    else params.delete('from');
+    if (filters.to) params.set('to', filters.to);
+    else params.delete('to');
+
+    const nextQuery = params.toString();
+    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`;
+    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
+    if (nextUrl !== currentUrl) {
+      window.history.replaceState(null, '', nextUrl);
+    }
+  }, [activeEvent?.id, activeMissionId, activeMode, defaultSelectedEventId, filters, selectedEventId]);
+
+  const modeOptions = useMemo(
+    () => [
+      {
+        id: 'quick' as const,
+        label: 'Quick',
+        description: 'Fast signal overview',
+        badge: `${programSnapshot.upcoming.length}`
+      },
+      {
+        id: 'explorer' as const,
+        label: 'Explorer',
+        description: activeMission ? activeMission.label : 'Mission timeline view',
+        badge: activeMission ? `${activeMission.snapshot.upcoming.length}` : '0',
+        disabled: missions.length === 0
+      },
+      {
+        id: 'technical' as const,
+        label: 'Technical',
+        description: 'Deep evidence and supersession',
+        badge: String((timelineEvents || []).length)
+      }
+    ],
+    [activeMission, missions.length, programSnapshot.upcoming.length, timelineEvents]
+  );
+
+  const missionRailItems = useMemo(
+    () =>
+      missions.map((entry) => ({
+        id: entry.id,
+        label: entry.label,
+        subtitle: entry.subtitle || entry.snapshot.missionName,
+        status: entry.status || entry.snapshot.nextLaunch?.statusText || 'Tracking',
+        nextNet: entry.snapshot.nextLaunch?.net || null,
+        launchCount: entry.snapshot.upcoming.length
+      })),
+    [missions]
+  );
+
+  const ledgerChanges: ArtemisChangeItem[] = useMemo(() => {
+    if (isMissionSnapshot(activeSnapshot)) return [...activeSnapshot.changes];
+    return buildProgramChanges(activeSnapshot);
+  }, [activeSnapshot]);
+
+  return (
+    <section className={clsx('space-y-4', className)}>
+      <ArtemisModeSwitch
+        options={modeOptions}
+        value={activeMode}
+        onChange={(nextMode) => {
+          if (!mode) setInternalMode(nextMode);
+          onModeChange?.(nextMode);
+        }}
+      />
+
+      <ArtemisMissionRail
+        missions={missionRailItems}
+        value={activeMissionId}
+        orientation="horizontal"
+        onChange={(nextMissionId) => {
+          if (!missionId) setInternalMissionId(nextMissionId);
+          onMissionChange?.(nextMissionId);
+        }}
+      />
+
+      <ArtemisKpiStrip snapshot={activeSnapshot} />
+      <ArtemisTimelineExplorer
+        snapshot={activeSnapshot}
+        events={timelineEvents}
+        selectedEventId={selectedEventId}
+        defaultSelectedEventId={defaultSelectedEventId}
+        initialSourceType={filters.sourceType}
+        initialIncludeSuperseded={filters.includeSuperseded}
+        initialFrom={filters.from}
+        initialTo={filters.to}
+        onFiltersChange={(nextFilters) => {
+          setFilters(nextFilters);
+          onFiltersChange?.(nextFilters);
+        }}
+        onSelectEvent={(event) => {
+          setActiveEvent(event);
+          setSheetOpen(true);
+          onSelectedEventChange?.(event);
+        }}
+      />
+
+      {activeMode !== 'quick' ? <ArtemisSystemsGraph snapshot={activeSnapshot} /> : null}
+      {activeMode !== 'quick' ? <ArtemisChangeLedger changes={ledgerChanges} /> : null}
+
+      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+12px)] z-30">
+        <button
+          type="button"
+          onClick={() => setSheetOpen(true)}
+          className="w-full rounded-xl border border-stroke bg-[rgba(5,6,10,0.88)] px-4 py-3 text-sm font-semibold text-text1 shadow-surface backdrop-blur-xl transition hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none"
+        >
+          {activeEvent ? 'Open evidence drawer' : 'Select timeline event for evidence'}
+        </button>
+      </div>
+
+      <ArtemisEventDrawer
+        variant="sheet"
+        open={sheetOpen}
+        onOpenChange={setSheetOpen}
+        title="Event evidence drawer"
+        event={activeEvent}
+        faq={activeSnapshot.faq}
+      />
+    </section>
+  );
+}
+
+function buildProgramChanges(snapshot: ArtemisProgramSnapshot): ArtemisChangeItem[] {
+  const changes = [...snapshot.upcoming, ...snapshot.recent].map((launch) => ({
+    title: launch.name,
+    summary: `${launch.statusText || launch.status || 'Status pending'} • ${launch.provider} • ${launch.pad?.shortCode || 'Pad TBD'}`,
+    date: launch.lastUpdated || launch.cacheGeneratedAt || launch.net,
+    href: buildLaunchHref(launch)
+  }));
+  changes.sort((a, b) => parseDateOrZero(b.date) - parseDateOrZero(a.date));
+  return changes.slice(0, 12);
+}
+
+function parseDateOrZero(value: string) {
+  const parsed = Date.parse(value);
+  return Number.isNaN(parsed) ? 0 : parsed;
+}
+
+function isMissionSnapshot(snapshot: ArtemisProgramSnapshot | ArtemisMissionSnapshot): snapshot is ArtemisMissionSnapshot {
+  return 'missionName' in snapshot;
+}
diff --git a/components/artemis/ArtemisSystemsGraph.tsx b/components/artemis/ArtemisSystemsGraph.tsx
new file mode 100644
index 0000000..f2bf65b
--- /dev/null
+++ b/components/artemis/ArtemisSystemsGraph.tsx
@@ -0,0 +1,333 @@
+'use client';
+
+import { useMemo, useRef, useState } from 'react';
+import type { KeyboardEvent } from 'react';
+import clsx from 'clsx';
+import type { ArtemisMissionSnapshot, ArtemisProgramSnapshot } from '@/lib/types/artemis';
+import type { Launch } from '@/lib/types/launch';
+
+type ArtemisSnapshot = ArtemisProgramSnapshot | ArtemisMissionSnapshot;
+
+export type ArtemisSystemsGraphNodeStatus = 'nominal' | 'watch' | 'risk' | 'inactive';
+
+export type ArtemisSystemsGraphNode = {
+  id: string;
+  label: string;
+  summary?: string;
+  status?: ArtemisSystemsGraphNodeStatus;
+  value?: string;
+};
+
+export type ArtemisSystemsGraphEdge = {
+  id?: string;
+  from: string;
+  to: string;
+  label?: string;
+};
+
+export type ArtemisSystemsGraphProps = {
+  snapshot?: ArtemisSnapshot;
+  nodes?: readonly ArtemisSystemsGraphNode[];
+  edges?: readonly ArtemisSystemsGraphEdge[];
+  selectedNodeId?: string | null;
+  defaultSelectedNodeId?: string | null;
+  onSelectNode?: (node: ArtemisSystemsGraphNode) => void;
+  title?: string;
+  className?: string;
+};
+
+const STATUS_CLASS: Record<ArtemisSystemsGraphNodeStatus, string> = {
+  nominal: 'border-success/40 bg-[rgba(52,211,153,0.08)]',
+  watch: 'border-warning/40 bg-[rgba(251,191,36,0.08)]',
+  risk: 'border-danger/40 bg-[rgba(251,113,133,0.08)]',
+  inactive: 'border-stroke bg-surface-0'
+};
+
+export function ArtemisSystemsGraph({
+  snapshot,
+  nodes,
+  edges,
+  selectedNodeId,
+  defaultSelectedNodeId = null,
+  onSelectNode,
+  title = 'Systems graph',
+  className
+}: ArtemisSystemsGraphProps) {
+  const derivedGraph = useMemo(() => buildGraphFromSnapshot(snapshot), [snapshot]);
+  const resolvedNodes = useMemo(
+    () => (nodes && nodes.length > 0 ? [...nodes] : derivedGraph.nodes),
+    [derivedGraph.nodes, nodes]
+  );
+  const resolvedEdges = useMemo(
+    () => (edges && edges.length > 0 ? [...edges] : derivedGraph.edges),
+    [derivedGraph.edges, edges]
+  );
+  const [internalSelectedNodeId, setInternalSelectedNodeId] = useState<string | null>(defaultSelectedNodeId);
+  const activeNodeId = selectedNodeId ?? internalSelectedNodeId ?? resolvedNodes[0]?.id ?? null;
+  const activeIndex = resolvedNodes.findIndex((node) => node.id === activeNodeId);
+  const activeNode = activeIndex >= 0 ? resolvedNodes[activeIndex] : resolvedNodes[0] || null;
+  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
+  const gridColumns = Math.max(1, Math.min(4, resolvedNodes.length));
+  const positionMap = useMemo(() => buildNodePositionMap(resolvedNodes, gridColumns), [resolvedNodes, gridColumns]);
+
+  const selectNode = (index: number, shouldFocus: boolean) => {
+    const next = resolvedNodes[index];
+    if (!next) return;
+    if (selectedNodeId == null) {
+      setInternalSelectedNodeId(next.id);
+    }
+    onSelectNode?.(next);
+    if (shouldFocus) {
+      buttonRefs.current[index]?.focus();
+    }
+  };
+
+  const handleNodeKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
+    if (!resolvedNodes.length) return;
+    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
+      event.preventDefault();
+      selectNode((index + 1) % resolvedNodes.length, true);
+      return;
+    }
+    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
+      event.preventDefault();
+      selectNode((index - 1 + resolvedNodes.length) % resolvedNodes.length, true);
+      return;
+    }
+    if (event.key === 'Home') {
+      event.preventDefault();
+      selectNode(0, true);
+      return;
+    }
+    if (event.key === 'End') {
+      event.preventDefault();
+      selectNode(resolvedNodes.length - 1, true);
+    }
+  };
+
+  const relatedEdges = activeNode
+    ? resolvedEdges.filter((edge) => edge.from === activeNode.id || edge.to === activeNode.id)
+    : [];
+
+  return (
+    <section className={clsx('rounded-2xl border border-stroke bg-surface-1 p-4', className)}>
+      <h3 className="text-base font-semibold text-text1">{title}</h3>
+
+      {resolvedNodes.length === 0 ? (
+        <p className="mt-3 text-sm text-text3">No systems data is available for this scope.</p>
+      ) : (
+        <>
+          <div className="relative mt-3 h-[240px] overflow-hidden rounded-xl border border-stroke bg-[rgba(255,255,255,0.01)]">
+            <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
+              {resolvedEdges.map((edge) => {
+                const from = positionMap[edge.from];
+                const to = positionMap[edge.to];
+                if (!from || !to) return null;
+                return (
+                  <line
+                    key={edge.id || `${edge.from}:${edge.to}:${edge.label || ''}`}
+                    x1={`${from.x}%`}
+                    y1={`${from.y}%`}
+                    x2={`${to.x}%`}
+                    y2={`${to.y}%`}
+                    stroke="rgba(234,240,255,0.24)"
+                    strokeWidth="1.2"
+                    strokeLinecap="round"
+                    strokeDasharray="4 5"
+                  />
+                );
+              })}
+            </svg>
+
+            {resolvedNodes.map((node, index) => {
+              const isSelected = (activeNode?.id || '') === node.id;
+              const point = positionMap[node.id];
+              if (!point) return null;
+              return (
+                <button
+                  key={node.id}
+                  ref={(button) => {
+                    buttonRefs.current[index] = button;
+                  }}
+                  type="button"
+                  onClick={() => selectNode(index, false)}
+                  onKeyDown={(event) => handleNodeKeyDown(event, index)}
+                  aria-pressed={isSelected}
+                  tabIndex={isSelected ? 0 : -1}
+                  className={clsx(
+                    'absolute min-w-[122px] -translate-x-1/2 -translate-y-1/2 rounded-xl border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none',
+                    STATUS_CLASS[node.status || 'inactive'],
+                    isSelected && 'border-primary shadow-glow'
+                  )}
+                  style={{ left: `${point.x}%`, top: `${point.y}%` }}
+                >
+                  <div className="text-xs font-semibold text-text1">{node.label}</div>
+                  {node.value ? <div className="mt-1 text-[11px] text-text3">{node.value}</div> : null}
+                </button>
+              );
+            })}
+          </div>
+
+          {activeNode ? (
+            <article className="mt-3 rounded-xl border border-stroke bg-surface-0 p-3" aria-live="polite">
+              <div className="text-[11px] uppercase tracking-[0.08em] text-text3">Focused system</div>
+              <div className="mt-1 text-sm font-semibold text-text1">{activeNode.label}</div>
+              {activeNode.summary ? <p className="mt-2 text-sm text-text2">{activeNode.summary}</p> : null}
+              {relatedEdges.length > 0 ? (
+                <ul className="mt-2 space-y-1 text-xs text-text3">
+                  {relatedEdges.map((edge) => (
+                    <li key={edge.id || `${edge.from}:${edge.to}:${edge.label || ''}`}>{formatEdgeLabel(edge, resolvedNodes)}</li>
+                  ))}
+                </ul>
+              ) : null}
+            </article>
+          ) : null}
+        </>
+      )}
+    </section>
+  );
+}
+
+function buildGraphFromSnapshot(snapshot: ArtemisSnapshot | undefined) {
+  if (!snapshot) {
+    return { nodes: [] as ArtemisSystemsGraphNode[], edges: [] as ArtemisSystemsGraphEdge[] };
+  }
+
+  const nextLaunch = snapshot.nextLaunch;
+  const rootId = isMissionSnapshot(snapshot) ? 'mission-core' : 'program-core';
+  const rootLabel = isMissionSnapshot(snapshot) ? snapshot.missionName : 'Artemis Program';
+  const rootSummary = isMissionSnapshot(snapshot)
+    ? `${snapshot.upcoming.length} upcoming, ${snapshot.recent.length} recent mission launches`
+    : `${snapshot.upcoming.length} upcoming Artemis launches`;
+
+  const nodes: ArtemisSystemsGraphNode[] = [
+    {
+      id: rootId,
+      label: rootLabel,
+      summary: rootSummary,
+      value: snapshot.lastUpdated ? `Updated ${formatShortDate(snapshot.lastUpdated)}` : undefined,
+      status: statusFromLaunch(nextLaunch)
+    }
+  ];
+
+  const edges: ArtemisSystemsGraphEdge[] = [];
+
+  if (nextLaunch) {
+    pushNode(nodes, edges, rootId, {
+      id: 'vehicle',
+      label: nextLaunch.vehicle || 'Vehicle',
+      summary: nextLaunch.rocket?.description || 'Launch vehicle profile',
+      value: nextLaunch.rocket?.family || undefined,
+      status: statusFromLaunch(nextLaunch)
+    }, 'vehicle');
+
+    pushNode(nodes, edges, rootId, {
+      id: 'provider',
+      label: nextLaunch.provider || 'Provider',
+      summary: nextLaunch.providerDescription || 'Mission provider',
+      value: nextLaunch.providerCountryCode || undefined,
+      status: 'nominal'
+    }, 'provider');
+
+    pushNode(nodes, edges, rootId, {
+      id: 'pad',
+      label: nextLaunch.pad?.shortCode || nextLaunch.pad?.name || 'Launch pad',
+      summary: nextLaunch.pad?.locationName || nextLaunch.pad?.state || 'Pad location',
+      value: nextLaunch.pad?.timezone || undefined,
+      status: 'nominal'
+    }, 'pad');
+
+    if (nextLaunch.mission?.name) {
+      pushNode(nodes, edges, rootId, {
+        id: 'mission',
+        label: nextLaunch.mission.name,
+        summary: nextLaunch.mission.description || 'Mission profile',
+        value: nextLaunch.mission.type || undefined,
+        status: statusFromLaunch(nextLaunch)
+      }, 'mission');
+    }
+
+    if ((nextLaunch.crew || []).length > 0) {
+      pushNode(nodes, edges, 'mission', {
+        id: 'crew',
+        label: 'Crew',
+        summary: `${nextLaunch.crew?.length || 0} listed crew roles`,
+        value: `${nextLaunch.crew?.length || 0} crew`,
+        status: 'nominal'
+      }, 'crew');
+    }
+
+    if ((nextLaunch.payloads || []).length > 0) {
+      pushNode(nodes, edges, 'mission', {
+        id: 'payloads',
+        label: 'Payloads',
+        summary: `${nextLaunch.payloads?.length || 0} payload records`,
+        value: `${nextLaunch.payloads?.length || 0} payloads`,
+        status: 'nominal'
+      }, 'payloads');
+    }
+  }
+
+  return { nodes, edges: edges.filter((edge) => nodes.some((node) => node.id === edge.from) && nodes.some((node) => node.id === edge.to)) };
+}
+
+function pushNode(
+  nodes: ArtemisSystemsGraphNode[],
+  edges: ArtemisSystemsGraphEdge[],
+  fromId: string,
+  node: ArtemisSystemsGraphNode,
+  edgeLabel: string
+) {
+  if (!nodes.some((entry) => entry.id === node.id)) {
+    nodes.push(node);
+  }
+  edges.push({
+    id: `${fromId}:${node.id}`,
+    from: fromId,
+    to: node.id,
+    label: edgeLabel
+  });
+}
+
+function buildNodePositionMap(nodes: ArtemisSystemsGraphNode[], columns: number) {
+  const rows = Math.max(1, Math.ceil(nodes.length / columns));
+  const map: Record<string, { x: number; y: number }> = {};
+
+  nodes.forEach((node, index) => {
+    const row = Math.floor(index / columns);
+    const col = index % columns;
+    const x = ((col + 0.5) / columns) * 100;
+    const y = ((row + 0.5) / rows) * 100;
+    map[node.id] = { x, y };
+  });
+
+  return map;
+}
+
+function formatEdgeLabel(edge: ArtemisSystemsGraphEdge, nodes: ArtemisSystemsGraphNode[]) {
+  const from = nodes.find((node) => node.id === edge.from)?.label || edge.from;
+  const to = nodes.find((node) => node.id === edge.to)?.label || edge.to;
+  if (edge.label) return `${from} -> ${edge.label} -> ${to}`;
+  return `${from} -> ${to}`;
+}
+
+function statusFromLaunch(launch: Launch | null | undefined): ArtemisSystemsGraphNodeStatus {
+  if (!launch) return 'inactive';
+  if (launch.status === 'scrubbed') return 'risk';
+  if (launch.status === 'hold') return 'watch';
+  if (launch.status === 'go') return 'nominal';
+  return 'inactive';
+}
+
+function isMissionSnapshot(snapshot: ArtemisSnapshot): snapshot is ArtemisMissionSnapshot {
+  return 'missionName' in snapshot;
+}
+
+function formatShortDate(value: string) {
+  const parsed = Date.parse(value);
+  if (Number.isNaN(parsed)) return value;
+  return new Intl.DateTimeFormat('en-US', {
+    month: 'short',
+    day: '2-digit'
+  }).format(new Date(parsed));
+}
diff --git a/components/artemis/ArtemisTimelineExplorer.tsx b/components/artemis/ArtemisTimelineExplorer.tsx
new file mode 100644
index 0000000..796bf86
--- /dev/null
+++ b/components/artemis/ArtemisTimelineExplorer.tsx
@@ -0,0 +1,467 @@
+'use client';
+
+import { useEffect, useMemo, useRef, useState } from 'react';
+import type { KeyboardEvent } from 'react';
+import clsx from 'clsx';
+import type { ArtemisMissionSnapshot, ArtemisProgramSnapshot } from '@/lib/types/artemis';
+import type { Launch } from '@/lib/types/launch';
+
+type ArtemisSnapshot = ArtemisProgramSnapshot | ArtemisMissionSnapshot;
+
+export type ArtemisTimelineEventTone = 'default' | 'success' | 'warning' | 'danger' | 'info';
+
+export type ArtemisTimelineLink = {
+  eventId: string;
+  reason?: string;
+};
+
+export type ArtemisTimelineEvent = {
+  id: string;
+  title: string;
+  when: string;
+  summary?: string;
+  mission?: string;
+  tone?: ArtemisTimelineEventTone;
+  launch?: Launch | null;
+  status?: 'completed' | 'upcoming' | 'tentative' | 'superseded' | string;
+  eventTime?: string | null;
+  announcedTime?: string | null;
+  sourceType?: string;
+  sourceLabel?: string;
+  sourceHref?: string;
+  confidence?: string;
+  supersedes?: ArtemisTimelineLink[];
+  supersededBy?: ArtemisTimelineLink | null;
+};
+
+export type ArtemisTimelineSourceFilter = 'all' | 'll2-cache' | 'nasa-official' | 'curated-fallback';
+
+export type ArtemisTimelineFilters = {
+  sourceType: ArtemisTimelineSourceFilter;
+  includeSuperseded: boolean;
+  from: string | null;
+  to: string | null;
+};
+
+export type ArtemisTimelineExplorerProps = {
+  snapshot?: ArtemisSnapshot;
+  events?: readonly ArtemisTimelineEvent[];
+  selectedEventId?: string | null;
+  defaultSelectedEventId?: string | null;
+  onSelectEvent?: (event: ArtemisTimelineEvent) => void;
+  title?: string;
+  emptyLabel?: string;
+  listAriaLabel?: string;
+  className?: string;
+  initialSourceType?: ArtemisTimelineSourceFilter;
+  initialIncludeSuperseded?: boolean;
+  initialFrom?: string | null;
+  initialTo?: string | null;
+  onFiltersChange?: (filters: ArtemisTimelineFilters) => void;
+};
+
+const TONE_CLASS: Record<ArtemisTimelineEventTone, string> = {
+  default: 'border-stroke bg-surface-0',
+  success: 'border-success/35 bg-[rgba(52,211,153,0.08)]',
+  warning: 'border-warning/35 bg-[rgba(251,191,36,0.08)]',
+  danger: 'border-danger/35 bg-[rgba(251,113,133,0.08)]',
+  info: 'border-info/35 bg-[rgba(96,165,250,0.08)]'
+};
+
+const SOURCE_LABELS: Record<Exclude<ArtemisTimelineSourceFilter, 'all'>, string> = {
+  'll2-cache': 'Launch Library cache',
+  'nasa-official': 'NASA official',
+  'curated-fallback': 'Curated fallback'
+};
+
+export function ArtemisTimelineExplorer({
+  snapshot,
+  events,
+  selectedEventId,
+  defaultSelectedEventId = null,
+  onSelectEvent,
+  title = 'Timeline explorer',
+  emptyLabel = 'No timeline events are available for the selected scope.',
+  listAriaLabel = 'Timeline events',
+  className,
+  initialSourceType = 'all',
+  initialIncludeSuperseded = false,
+  initialFrom = null,
+  initialTo = null,
+  onFiltersChange
+}: ArtemisTimelineExplorerProps) {
+  const prefersReducedMotion = usePrefersReducedMotion();
+
+  const resolvedEvents = useMemo(() => {
+    const source = events && events.length > 0 ? [...events] : buildTimelineEvents(snapshot);
+    source.sort((a, b) => parseDateOrFallback(a.when) - parseDateOrFallback(b.when));
+    return source;
+  }, [events, snapshot]);
+
+  const [sourceType, setSourceType] = useState<ArtemisTimelineSourceFilter>(initialSourceType);
+  const [includeSuperseded, setIncludeSuperseded] = useState(initialIncludeSuperseded);
+  const [fromValue, setFromValue] = useState(initialFrom ? initialFrom.slice(0, 10) : '');
+  const [toValue, setToValue] = useState(initialTo ? initialTo.slice(0, 10) : '');
+  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(defaultSelectedEventId);
+
+  const filteredEvents = useMemo(() => {
+    return resolvedEvents.filter((event) => {
+      if (!includeSuperseded && (event.status === 'superseded' || event.supersededBy)) return false;
+      if (sourceType !== 'all' && event.sourceType !== sourceType) return false;
+
+      const eventMs = Date.parse(event.when);
+      if (!Number.isNaN(eventMs) && fromValue) {
+        const fromMs = Date.parse(`${fromValue}T00:00:00Z`);
+        if (!Number.isNaN(fromMs) && eventMs < fromMs) return false;
+      }
+      if (!Number.isNaN(eventMs) && toValue) {
+        const toMs = Date.parse(`${toValue}T23:59:59Z`);
+        if (!Number.isNaN(toMs) && eventMs > toMs) return false;
+      }
+      return true;
+    });
+  }, [fromValue, includeSuperseded, resolvedEvents, sourceType, toValue]);
+
+  const selectedId = selectedEventId ?? internalSelectedId ?? filteredEvents[0]?.id ?? null;
+  const activeIndex = Math.max(0, filteredEvents.length > 0 ? filteredEvents.findIndex((event) => event.id === selectedId) : -1);
+  const activeEvent = filteredEvents[activeIndex] || null;
+  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
+
+  useEffect(() => {
+    const nextFilters: ArtemisTimelineFilters = {
+      sourceType,
+      includeSuperseded,
+      from: fromValue ? `${fromValue}T00:00:00.000Z` : null,
+      to: toValue ? `${toValue}T23:59:59.999Z` : null
+    };
+    onFiltersChange?.(nextFilters);
+  }, [fromValue, includeSuperseded, onFiltersChange, sourceType, toValue]);
+
+  useEffect(() => {
+    if (!filteredEvents.length) return;
+    const selectedStillExists = selectedId ? filteredEvents.some((event) => event.id === selectedId) : false;
+    if (selectedStillExists) return;
+    const next = filteredEvents[0];
+    if (!next) return;
+    setInternalSelectedId(next.id);
+    onSelectEvent?.(next);
+  }, [filteredEvents, onSelectEvent, selectedId]);
+
+  useEffect(() => {
+    const activeNode = optionRefs.current[activeIndex];
+    if (!activeNode) return;
+    activeNode.scrollIntoView({
+      block: 'nearest',
+      behavior: prefersReducedMotion ? 'auto' : 'smooth'
+    });
+  }, [activeIndex, prefersReducedMotion]);
+
+  const sourceTypeOptions = useMemo(() => {
+    const counts = new Map<string, number>();
+    for (const event of resolvedEvents) {
+      const key = event.sourceType || 'curated-fallback';
+      counts.set(key, (counts.get(key) || 0) + 1);
+    }
+
+    const options: Array<{ value: ArtemisTimelineSourceFilter; label: string }> = [
+      { value: 'all', label: `All sources (${resolvedEvents.length})` }
+    ];
+
+    for (const key of ['ll2-cache', 'nasa-official', 'curated-fallback'] as const) {
+      if (!counts.has(key) && key !== sourceType) continue;
+      options.push({ value: key, label: `${SOURCE_LABELS[key]} (${counts.get(key) || 0})` });
+    }
+
+    return options;
+  }, [resolvedEvents, sourceType]);
+
+  const selectEvent = (index: number, shouldFocus: boolean) => {
+    const next = filteredEvents[index];
+    if (!next) return;
+    if (selectedEventId == null) {
+      setInternalSelectedId(next.id);
+    }
+    onSelectEvent?.(next);
+    if (shouldFocus) {
+      optionRefs.current[index]?.focus();
+    }
+  };
+
+  const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
+    if (!filteredEvents.length) return;
+
+    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
+      event.preventDefault();
+      const nextIndex = (index + 1) % filteredEvents.length;
+      selectEvent(nextIndex, true);
+      return;
+    }
+
+    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
+      event.preventDefault();
+      const nextIndex = (index - 1 + filteredEvents.length) % filteredEvents.length;
+      selectEvent(nextIndex, true);
+      return;
+    }
+
+    if (event.key === 'Home') {
+      event.preventDefault();
+      selectEvent(0, true);
+      return;
+    }
+
+    if (event.key === 'End') {
+      event.preventDefault();
+      selectEvent(filteredEvents.length - 1, true);
+      return;
+    }
+
+    if (event.key === 'Enter' || event.key === ' ') {
+      event.preventDefault();
+      selectEvent(index, false);
+    }
+  };
+
+  return (
+    <section className={clsx('rounded-2xl border border-stroke bg-surface-1 p-4', className)}>
+      <div className="flex flex-wrap items-center justify-between gap-2">
+        <h3 className="text-base font-semibold text-text1">{title}</h3>
+        <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
+          {filteredEvents.length} events
+        </span>
+      </div>
+
+      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
+        <label className="rounded-lg border border-stroke bg-surface-0 px-2 py-1.5 text-xs text-text3">
+          <span className="mb-1 block uppercase tracking-[0.08em]">Source type</span>
+          <select
+            value={sourceType}
+            onChange={(event) => setSourceType(event.target.value as ArtemisTimelineSourceFilter)}
+            className="w-full rounded-md border border-stroke bg-surface-1 px-2 py-1 text-xs text-text1"
+          >
+            {sourceTypeOptions.map((option) => (
+              <option key={option.value} value={option.value}>
+                {option.label}
+              </option>
+            ))}
+          </select>
+        </label>
+
+        <label className="rounded-lg border border-stroke bg-surface-0 px-2 py-1.5 text-xs text-text3">
+          <span className="mb-1 block uppercase tracking-[0.08em]">From</span>
+          <input
+            type="date"
+            value={fromValue}
+            onChange={(event) => setFromValue(event.target.value)}
+            className="w-full rounded-md border border-stroke bg-surface-1 px-2 py-1 text-xs text-text1"
+          />
+        </label>
+
+        <label className="rounded-lg border border-stroke bg-surface-0 px-2 py-1.5 text-xs text-text3">
+          <span className="mb-1 block uppercase tracking-[0.08em]">To</span>
+          <input
+            type="date"
+            value={toValue}
+            onChange={(event) => setToValue(event.target.value)}
+            className="w-full rounded-md border border-stroke bg-surface-1 px-2 py-1 text-xs text-text1"
+          />
+        </label>
+
+        <label className="flex items-center gap-2 rounded-lg border border-stroke bg-surface-0 px-2 py-2 text-xs text-text2">
+          <input
+            type="checkbox"
+            checked={includeSuperseded}
+            onChange={(event) => setIncludeSuperseded(event.target.checked)}
+            className="h-4 w-4 rounded border-stroke bg-surface-1"
+          />
+          Show superseded milestones
+        </label>
+      </div>
+
+      {filteredEvents.length === 0 ? (
+        <p className="mt-3 text-sm text-text3">{emptyLabel}</p>
+      ) : (
+        <>
+          <div
+            role="listbox"
+            aria-label={listAriaLabel}
+            aria-activedescendant={activeEvent ? getTimelineOptionId(activeEvent.id) : undefined}
+            className="mt-3 max-h-[300px] space-y-2 overflow-y-auto pr-1"
+          >
+            {filteredEvents.map((event, index) => {
+              const isSelected = index === activeIndex;
+              return (
+                <button
+                  key={event.id}
+                  ref={(node) => {
+                    optionRefs.current[index] = node;
+                  }}
+                  id={getTimelineOptionId(event.id)}
+                  role="option"
+                  type="button"
+                  aria-selected={isSelected}
+                  tabIndex={isSelected ? 0 : -1}
+                  onClick={() => selectEvent(index, false)}
+                  onKeyDown={(keyEvent) => handleOptionKeyDown(keyEvent, index)}
+                  className={clsx(
+                    'w-full rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none',
+                    TONE_CLASS[event.tone || 'default'],
+                    isSelected && 'border-primary bg-[rgba(34,211,238,0.12)] shadow-glow'
+                  )}
+                >
+                  <div className="flex items-start justify-between gap-3">
+                    <div className="min-w-0">
+                      <div className="truncate text-sm font-semibold text-text1">{event.title}</div>
+                      <div className="mt-1 text-xs text-text3">{formatTimelineDate(event.when)}</div>
+                    </div>
+                    {event.mission ? (
+                      <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
+                        {event.mission}
+                      </span>
+                    ) : null}
+                  </div>
+                  {event.summary ? <p className="mt-2 text-xs text-text2">{event.summary}</p> : null}
+                </button>
+              );
+            })}
+          </div>
+
+          {activeEvent ? (
+            <article className="mt-3 rounded-xl border border-stroke bg-surface-0 p-3" aria-live="polite">
+              <div className="text-[11px] uppercase tracking-[0.08em] text-text3">Focused event</div>
+              <h4 className="mt-1 text-sm font-semibold text-text1">{activeEvent.title}</h4>
+              {activeEvent.summary ? <p className="mt-1 text-sm text-text2">{activeEvent.summary}</p> : null}
+
+              <dl className="mt-2 grid gap-x-3 gap-y-1 text-xs text-text3 md:grid-cols-2">
+                <DetailRow label="event_time" value={formatTimelineDate(activeEvent.eventTime || activeEvent.when)} />
+                <DetailRow label="announced_time" value={formatTimelineDate(activeEvent.announcedTime || activeEvent.when)} />
+                <DetailRow label="source_type" value={activeEvent.sourceType || 'curated-fallback'} />
+                <DetailRow label="confidence" value={activeEvent.confidence || 'low'} />
+                <DetailRow label="supersedes" value={formatSupersedes(activeEvent.supersedes)} />
+                <DetailRow label="superseded_by" value={activeEvent.supersededBy?.eventId || 'none'} />
+              </dl>
+            </article>
+          ) : null}
+        </>
+      )}
+    </section>
+  );
+}
+
+function DetailRow({ label, value }: { label: string; value: string }) {
+  return (
+    <div className="rounded-md border border-stroke bg-surface-1 px-2 py-1">
+      <dt className="uppercase tracking-[0.08em]">{label}</dt>
+      <dd className="mt-0.5 text-text2">{value}</dd>
+    </div>
+  );
+}
+
+function buildTimelineEvents(snapshot: ArtemisSnapshot | undefined): ArtemisTimelineEvent[] {
+  if (!snapshot) return [];
+  const events: ArtemisTimelineEvent[] = [];
+  const seen = new Set<string>();
+
+  for (const launch of [...snapshot.recent, ...snapshot.upcoming]) {
+    const id = launch.id || `${launch.name}:${launch.net}`;
+    if (seen.has(id)) continue;
+    seen.add(id);
+    events.push({
+      id,
+      title: launch.name,
+      when: launch.net,
+      summary: `${launch.statusText || launch.status || 'Status pending'} • ${launch.provider} • ${launch.pad?.shortCode || 'Pad TBD'}`,
+      mission: launch.mission?.name || undefined,
+      tone: toneFromLaunchStatus(launch.status),
+      launch,
+      status: launch.status,
+      eventTime: launch.net,
+      announcedTime: launch.lastUpdated || launch.cacheGeneratedAt || launch.net,
+      sourceType: 'll2-cache',
+      sourceLabel: 'Launch Library 2 cache',
+      confidence: launch.netPrecision === 'minute' || launch.netPrecision === 'hour' ? 'high' : 'medium',
+      supersedes: [],
+      supersededBy: null
+    });
+  }
+
+  if (isMissionSnapshot(snapshot)) {
+    snapshot.changes.forEach((change, index) => {
+      const id = `change-${index}-${change.date}-${change.title}`;
+      if (seen.has(id)) return;
+      seen.add(id);
+      events.push({
+        id,
+        title: change.title,
+        when: change.date,
+        summary: change.summary,
+        mission: snapshot.missionName,
+        tone: 'info',
+        launch: null,
+        status: 'tentative',
+        eventTime: change.date,
+        announcedTime: change.date,
+        sourceType: 'curated-fallback',
+        sourceLabel: 'Mission change log',
+        confidence: 'medium',
+        supersedes: [],
+        supersededBy: null
+      });
+    });
+  }
+
+  return events;
+}
+
+function toneFromLaunchStatus(status: Launch['status'] | undefined): ArtemisTimelineEventTone {
+  if (status === 'go') return 'success';
+  if (status === 'hold') return 'warning';
+  if (status === 'scrubbed') return 'danger';
+  if (status === 'tbd') return 'info';
+  return 'default';
+}
+
+function isMissionSnapshot(snapshot: ArtemisSnapshot): snapshot is ArtemisMissionSnapshot {
+  return 'missionName' in snapshot;
+}
+
+function formatTimelineDate(value: string) {
+  const parsed = Date.parse(value);
+  if (Number.isNaN(parsed)) return value;
+  return new Intl.DateTimeFormat('en-US', {
+    month: 'short',
+    day: '2-digit',
+    year: 'numeric',
+    hour: 'numeric',
+    minute: '2-digit',
+    timeZoneName: 'short'
+  }).format(new Date(parsed));
+}
+
+function parseDateOrFallback(value: string) {
+  const parsed = Date.parse(value);
+  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
+}
+
+function getTimelineOptionId(eventId: string) {
+  return `timeline-event-${eventId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
+}
+
+function formatSupersedes(value: ArtemisTimelineLink[] | undefined) {
+  if (!value || value.length === 0) return 'none';
+  return value.map((entry) => (entry.reason ? `${entry.eventId} (${entry.reason})` : entry.eventId)).join(', ');
+}
+
+function usePrefersReducedMotion() {
+  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
+
+  useEffect(() => {
+    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
+    const update = () => setPrefersReducedMotion(media.matches);
+    update();
+    media.addEventListener('change', update);
+    return () => media.removeEventListener('change', update);
+  }, []);
+
+  return prefersReducedMotion;
+}
diff --git a/lib/server/artemis.ts b/lib/server/artemis.ts
new file mode 100644
index 0000000..e871164
--- /dev/null
+++ b/lib/server/artemis.ts
@@ -0,0 +1,209 @@
+import { cache } from 'react';
+import { buildLaunchHref } from '@/lib/utils/launchLinks';
+import { isArtemisIILaunch, isArtemisProgramLaunch } from '@/lib/utils/artemis';
+import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
+import { isSupabaseConfigured } from '@/lib/server/env';
+import { mapPublicCacheRow } from '@/lib/server/transformers';
+import type { Launch } from '@/lib/types/launch';
+import type { ArtemisChangeItem, ArtemisFaqItem, ArtemisMissionSnapshot, ArtemisProgramSnapshot } from '@/lib/types/artemis';
+
+const ARTEMIS_OR_FILTER = 'name.ilike.%Artemis%,mission_name.ilike.%Artemis%';
+const ARTEMIS_UPCOMING_LIMIT = 120;
+const ARTEMIS_RECENT_LIMIT = 120;
+const MAX_LIST_ITEMS = 32;
+const MAX_CHANGES = 8;
+
+export type ArtemisLaunchBuckets = {
+  generatedAt: string;
+  upcoming: Launch[];
+  recent: Launch[];
+};
+
+const PROGRAM_FAQ: ArtemisFaqItem[] = [
+  {
+    question: 'What is Artemis?',
+    answer:
+      "Artemis is NASA's lunar exploration program. It includes a sequence of missions designed to return humans to the Moon and build toward sustained deep-space operations."
+  },
+  {
+    question: 'How is Artemis different from Apollo?',
+    answer:
+      'Artemis combines modern launch systems, broader international participation, and longer-term lunar goals, including sustained operations and preparation for future Mars missions.'
+  },
+  {
+    question: 'Where can I track the latest Artemis launch schedule?',
+    answer:
+      'Use this Artemis hub for program-level updates and open the Artemis II mission page for the most current countdown, timing, and status details.'
+  }
+];
+
+const MISSION_FAQ: ArtemisFaqItem[] = [
+  {
+    question: 'Is Artemis II the same as Artemis 2?',
+    answer:
+      'Yes. Artemis II and Artemis 2 refer to the same crewed mission. This page uses Artemis II as the canonical naming format while covering both search variants.'
+  },
+  {
+    question: 'When is the Artemis II launch date?',
+    answer:
+      'Artemis II timing can shift based on mission readiness, range constraints, and weather. The launch date and countdown on this page are updated as source data changes.'
+  },
+  {
+    question: 'Where can I watch Artemis II live?',
+    answer:
+      'When official streams are published, this page lists watch links and mission details alongside the current status and launch window.'
+  },
+  {
+    question: 'Who is on the Artemis II crew?',
+    answer:
+      'Crew highlights are shown here when available in the feed data for the mission.'
+  }
+];
+
+export const fetchArtemisLaunchBuckets = cache(async (): Promise<ArtemisLaunchBuckets> => {
+  const generatedAt = new Date().toISOString();
+  if (!isSupabaseConfigured()) {
+    return { generatedAt, upcoming: [], recent: [] };
+  }
+
+  const supabase = createSupabasePublicClient();
+  const nowIso = new Date().toISOString();
+
+  const [upcomingRes, recentRes] = await Promise.all([
+    supabase
+      .from('launches_public_cache')
+      .select('*')
+      .or(ARTEMIS_OR_FILTER)
+      .gte('net', nowIso)
+      .order('net', { ascending: true })
+      .limit(ARTEMIS_UPCOMING_LIMIT),
+    supabase
+      .from('launches_public_cache')
+      .select('*')
+      .or(ARTEMIS_OR_FILTER)
+      .lt('net', nowIso)
+      .order('net', { ascending: false })
+      .limit(ARTEMIS_RECENT_LIMIT)
+  ]);
+
+  if (upcomingRes.error || recentRes.error) {
+    console.error('artemis snapshot query error', { upcoming: upcomingRes.error, recent: recentRes.error });
+    return { generatedAt, upcoming: [], recent: [] };
+  }
+
+  const upcoming = dedupeLaunches((upcomingRes.data || []).map(mapPublicCacheRow).filter(isArtemisProgramLaunch)).slice(0, MAX_LIST_ITEMS);
+  const recent = dedupeLaunches((recentRes.data || []).map(mapPublicCacheRow).filter(isArtemisProgramLaunch)).slice(0, MAX_LIST_ITEMS);
+
+  return { generatedAt, upcoming, recent };
+});
+
+export function buildArtemisFaq(scope: 'program' | 'mission') {
+  return scope === 'mission' ? MISSION_FAQ : PROGRAM_FAQ;
+}
+
+export const fetchArtemisProgramSnapshot = cache(async (): Promise<ArtemisProgramSnapshot> => {
+  const buckets = await fetchArtemisLaunchBuckets();
+  const combined = [...buckets.upcoming, ...buckets.recent];
+  return {
+    generatedAt: buckets.generatedAt,
+    lastUpdated: resolveLastUpdated(combined, buckets.generatedAt),
+    nextLaunch: buckets.upcoming[0] || null,
+    upcoming: buckets.upcoming,
+    recent: buckets.recent,
+    faq: buildArtemisFaq('program')
+  };
+});
+
+export const fetchArtemisIISnapshot = cache(async (): Promise<ArtemisMissionSnapshot> => {
+  const buckets = await fetchArtemisLaunchBuckets();
+  const upcoming = buckets.upcoming.filter((launch) => isArtemisIILaunch(launch)).slice(0, MAX_LIST_ITEMS);
+  const recent = buckets.recent.filter((launch) => isArtemisIILaunch(launch)).slice(0, MAX_LIST_ITEMS);
+  const combined = [...upcoming, ...recent];
+  const nextLaunch = upcoming[0] || null;
+  const fallbackTimestamp = buckets.generatedAt;
+
+  return {
+    generatedAt: buckets.generatedAt,
+    lastUpdated: resolveLastUpdated(combined.length ? combined : [...buckets.upcoming, ...buckets.recent], fallbackTimestamp),
+    missionName: 'Artemis II (Artemis 2)',
+    nextLaunch,
+    upcoming,
+    recent,
+    crewHighlights: buildCrewHighlights(nextLaunch),
+    changes: buildArtemisChanges(combined),
+    faq: buildArtemisFaq('mission')
+  };
+});
+
+function buildCrewHighlights(launch: Launch | null) {
+  if (!launch || !Array.isArray(launch.crew)) return [];
+  return launch.crew
+    .map((entry) => {
+      const astronaut = entry?.astronaut?.trim();
+      const role = entry?.role?.trim();
+      if (!astronaut) return null;
+      return role ? `${astronaut} (${role})` : astronaut;
+    })
+    .filter(Boolean)
+    .slice(0, 6) as string[];
+}
+
+function buildArtemisChanges(launches: Launch[]) {
+  const mapped = launches
+    .map((launch): ArtemisChangeItem | null => {
+      const date = toIsoOrNull(launch.cacheGeneratedAt) || toIsoOrNull(launch.lastUpdated) || toIsoOrNull(launch.net);
+      if (!date) return null;
+      const status = launch.statusText?.trim() || launch.status || 'Status pending';
+      const when = formatDateLabel(launch.net);
+      return {
+        title: launch.name,
+        summary: `Status: ${status}. NET: ${when}.`,
+        date,
+        href: buildLaunchHref(launch)
+      };
+    })
+    .filter((entry): entry is ArtemisChangeItem => Boolean(entry));
+
+  mapped.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
+  return mapped.slice(0, MAX_CHANGES);
+}
+
+function dedupeLaunches(launches: Launch[]) {
+  const seen = new Set<string>();
+  const deduped: Launch[] = [];
+  for (const launch of launches) {
+    if (seen.has(launch.id)) continue;
+    seen.add(launch.id);
+    deduped.push(launch);
+  }
+  return deduped;
+}
+
+function resolveLastUpdated(launches: Launch[], fallbackIso: string) {
+  const candidates = launches
+    .flatMap((launch) => [launch.cacheGeneratedAt, launch.lastUpdated, launch.net])
+    .map((value) => toIsoOrNull(value))
+    .filter(Boolean) as string[];
+  if (!candidates.length) return toIsoOrNull(fallbackIso) || null;
+  return candidates.reduce((latest, current) => (Date.parse(current) > Date.parse(latest) ? current : latest));
+}
+
+function toIsoOrNull(value: string | null | undefined) {
+  if (!value) return null;
+  const date = new Date(value);
+  if (Number.isNaN(date.getTime())) return null;
+  return date.toISOString();
+}
+
+function formatDateLabel(value: string) {
+  const date = new Date(value);
+  if (Number.isNaN(date.getTime())) return value;
+  return new Intl.DateTimeFormat('en-US', {
+    month: 'short',
+    day: '2-digit',
+    year: 'numeric',
+    hour: 'numeric',
+    minute: '2-digit',
+    timeZoneName: 'short'
+  }).format(date);
+}
diff --git a/lib/server/artemisUi.ts b/lib/server/artemisUi.ts
new file mode 100644
index 0000000..09cec85
--- /dev/null
+++ b/lib/server/artemisUi.ts
@@ -0,0 +1,770 @@
+import { cache } from 'react';
+import { fetchArtemisLaunchBuckets } from '@/lib/server/artemis';
+import { buildLaunchHref } from '@/lib/utils/launchLinks';
+import type { Launch } from '@/lib/types/launch';
+import type {
+  ArtemisAudienceMode,
+  ArtemisEventEvidence,
+  ArtemisEvidenceSource,
+  ArtemisMissionProgressCard,
+  ArtemisTimelineConfidence,
+  ArtemisTimelineEvent,
+  ArtemisTimelineFacet,
+  ArtemisTimelineKpis,
+  ArtemisTimelineMission,
+  ArtemisTimelineMissionFilter,
+  ArtemisTimelineQuery,
+  ArtemisTimelineResponse,
+  ArtemisTimelineSourceFilter,
+  ArtemisTimelineSourceType,
+  ArtemisTimelineSupersedeReason,
+  ArtemisTimelineSupersedesLink
+} from '@/lib/types/artemis';
+
+export const ARTEMIS_TIMELINE_DEFAULT_LIMIT = 25;
+export const ARTEMIS_TIMELINE_MAX_LIMIT = 100;
+
+const NASA_ARTEMIS_URL = 'https://www.nasa.gov/humans-in-space/artemis/';
+const NASA_ARTEMIS_I_URL = 'https://www.nasa.gov/mission/artemis-i/';
+const NASA_ARTEMIS_II_URL = 'https://www.nasa.gov/mission/artemis-ii/';
+const NASA_ARTEMIS_III_URL = 'https://www.nasa.gov/mission/artemis-iii/';
+
+const MISSION_LABELS: Record<Extract<ArtemisTimelineMission, 'artemis-i' | 'artemis-ii' | 'artemis-iii'>, string> = {
+  'artemis-i': 'Artemis I',
+  'artemis-ii': 'Artemis II',
+  'artemis-iii': 'Artemis III'
+};
+
+const MISSION_SEQUENCE: Array<Extract<ArtemisTimelineMission, 'artemis-i' | 'artemis-ii' | 'artemis-iii'>> = [
+  'artemis-i',
+  'artemis-ii',
+  'artemis-iii'
+];
+
+const FALLBACK_PRIMARY_EVENT_BY_MISSION: Record<Extract<ArtemisTimelineMission, 'artemis-i' | 'artemis-ii' | 'artemis-iii'>, string> = {
+  'artemis-i': 'fallback:artemis-i-launch',
+  'artemis-ii': 'fallback:artemis-ii-target-2026',
+  'artemis-iii': 'fallback:artemis-iii-target'
+};
+
+const ARTEMIS_III_PATTERN = /\bartem[iu]s(?:\s*[-:]?\s*)(?:iii|3)\b/i;
+const ARTEMIS_II_PATTERN = /\bartem[iu]s(?:\s*[-:]?\s*)(?:ii|2)\b/i;
+const ARTEMIS_I_PATTERN = /\bartem[iu]s(?:\s*[-:]?\s*)(?:i|1)\b/i;
+
+type TimelineDataset = {
+  generatedAt: string;
+  events: ArtemisTimelineEvent[];
+  evidenceById: Record<string, ArtemisEventEvidence>;
+  missionProgress: ArtemisMissionProgressCard[];
+};
+
+type TimelineRecord = {
+  event: ArtemisTimelineEvent;
+  evidence: ArtemisEventEvidence;
+};
+
+type FallbackDefinition = {
+  id: string;
+  mission: ArtemisTimelineMission;
+  title: string;
+  summary: string;
+  date: string;
+  kind: ArtemisTimelineEvent['kind'];
+  status: ArtemisTimelineEvent['status'];
+  sourceType: ArtemisTimelineSourceType;
+  sourceLabel: string;
+  sourceHref?: string;
+  confidence: ArtemisTimelineConfidence;
+  supersedes?: ArtemisTimelineSupersedesLink[];
+  supersededBy?: ArtemisTimelineSupersedesLink | null;
+  evidenceSources: ArtemisEvidenceSource[];
+  payload: Record<string, unknown>;
+};
+
+const FALLBACK_TIMELINE_EVENTS: FallbackDefinition[] = [
+  {
+    id: 'fallback:artemis-i-launch',
+    mission: 'artemis-i',
+    title: 'Artemis I launch',
+    summary: 'Orion launched on an uncrewed lunar mission to validate the SLS-Orion stack.',
+    date: '2022-11-16T06:47:00Z',
+    kind: 'launch',
+    status: 'completed',
+    sourceType: 'nasa-official',
+    sourceLabel: 'NASA mission archive',
+    sourceHref: NASA_ARTEMIS_I_URL,
+    confidence: 'high',
+    evidenceSources: [
+      { label: 'NASA Artemis I mission page', href: NASA_ARTEMIS_I_URL, note: 'Historical launch milestone.' }
+    ],
+    payload: {
+      category: 'fallback-milestone',
+      mission: 'Artemis I',
+      milestone: 'launch'
+    }
+  },
+  {
+    id: 'fallback:artemis-i-splashdown',
+    mission: 'artemis-i',
+    title: 'Artemis I splashdown',
+    summary: 'Orion completed the Artemis I mission with Pacific Ocean splashdown.',
+    date: '2022-12-11T17:40:00Z',
+    kind: 'mission-milestone',
+    status: 'completed',
+    sourceType: 'nasa-official',
+    sourceLabel: 'NASA mission archive',
+    sourceHref: NASA_ARTEMIS_I_URL,
+    confidence: 'high',
+    evidenceSources: [
+      { label: 'NASA Artemis I mission page', href: NASA_ARTEMIS_I_URL, note: 'Mission completion milestone.' }
+    ],
+    payload: {
+      category: 'fallback-milestone',
+      mission: 'Artemis I',
+      milestone: 'splashdown'
+    }
+  },
+  {
+    id: 'fallback:artemis-ii-target-2025',
+    mission: 'artemis-ii',
+    title: 'Artemis II target window (legacy)',
+    summary: 'Earlier public planning windows placed Artemis II in 2025 before subsequent schedule updates.',
+    date: '2025-09-01T00:00:00Z',
+    kind: 'update',
+    status: 'superseded',
+    sourceType: 'curated-fallback',
+    sourceLabel: 'Program planning fallback',
+    sourceHref: NASA_ARTEMIS_II_URL,
+    confidence: 'low',
+    supersededBy: { eventId: 'fallback:artemis-ii-target-2026', reason: 'rescheduled' },
+    evidenceSources: [
+      { label: 'NASA Artemis II mission page', href: NASA_ARTEMIS_II_URL, note: 'Used as stable fallback when cache is sparse.' }
+    ],
+    payload: {
+      category: 'fallback-window',
+      mission: 'Artemis II',
+      window: 'legacy-2025'
+    }
+  },
+  {
+    id: 'fallback:artemis-ii-target-2026',
+    mission: 'artemis-ii',
+    title: 'Artemis II target window',
+    summary: 'Fallback planning window used until launch-level cache updates provide a newer mission window.',
+    date: '2026-04-01T00:00:00Z',
+    kind: 'update',
+    status: 'tentative',
+    sourceType: 'curated-fallback',
+    sourceLabel: 'Program planning fallback',
+    sourceHref: NASA_ARTEMIS_II_URL,
+    confidence: 'medium',
+    supersedes: [{ eventId: 'fallback:artemis-ii-target-2025', reason: 'rescheduled' }],
+    evidenceSources: [
+      { label: 'NASA Artemis II mission page', href: NASA_ARTEMIS_II_URL, note: 'Fallback target until LL2 cache confirms date precision.' }
+    ],
+    payload: {
+      category: 'fallback-window',
+      mission: 'Artemis II',
+      window: 'target-2026'
+    }
+  },
+  {
+    id: 'fallback:artemis-iii-target',
+    mission: 'artemis-iii',
+    title: 'Artemis III planning target',
+    summary: 'Fallback Artemis III timeline placeholder for first crewed lunar landing mission planning.',
+    date: '2027-09-01T00:00:00Z',
+    kind: 'update',
+    status: 'tentative',
+    sourceType: 'curated-fallback',
+    sourceLabel: 'Program planning fallback',
+    sourceHref: NASA_ARTEMIS_III_URL,
+    confidence: 'low',
+    evidenceSources: [
+      { label: 'NASA Artemis III mission page', href: NASA_ARTEMIS_III_URL, note: 'Planning-level reference.' }
+    ],
+    payload: {
+      category: 'fallback-window',
+      mission: 'Artemis III',
+      window: 'planning-target'
+    }
+  }
+];
+
+const buildTimelineDataset = cache(async (): Promise<TimelineDataset> => {
+  const buckets = await fetchArtemisLaunchBuckets();
+  const nowMs = Date.now();
+  const dedupedLaunches = dedupeById([...buckets.upcoming, ...buckets.recent]);
+  const launchRecords = dedupedLaunches.map((launch) => buildLaunchRecord({ launch, generatedAt: buckets.generatedAt, nowMs }));
+  const fallbackRecords = FALLBACK_TIMELINE_EVENTS.map((definition) => buildFallbackRecord({ definition, generatedAt: buckets.generatedAt }));
+  const allRecords = [...fallbackRecords, ...launchRecords];
+
+  // Promote launch-backed records over fallback placeholders when mission data is present.
+  for (const mission of MISSION_SEQUENCE) {
+    const fallbackId = FALLBACK_PRIMARY_EVENT_BY_MISSION[mission];
+    const primaryLaunchRecord = pickPrimaryLaunchRecord({
+      records: launchRecords,
+      mission,
+      nowMs
+    });
+    if (!primaryLaunchRecord) continue;
+    linkSupersession({
+      records: allRecords,
+      supersedingId: primaryLaunchRecord.event.id,
+      supersededId: fallbackId,
+      reason: 'refined'
+    });
+  }
+
+  const events = allRecords.map((record) => normalizeEvent(record.event)).sort(compareEventsAscending);
+  const evidenceById = Object.fromEntries(allRecords.map((record) => [record.event.id, record.evidence]));
+  const missionProgress = buildMissionProgressCards(events, nowMs);
+
+  return {
+    generatedAt: buckets.generatedAt,
+    events,
+    evidenceById,
+    missionProgress
+  };
+});
+
+export async function fetchArtemisTimelineViewModel(query: ArtemisTimelineQuery): Promise<ArtemisTimelineResponse> {
+  const dataset = await buildTimelineDataset();
+  const effectiveMission = resolveEffectiveMissionFilter(query.mode, query.mission);
+  const cursorOffset = decodeCursor(query.cursor);
+  const limit = clampInt(query.limit, ARTEMIS_TIMELINE_DEFAULT_LIMIT, 1, ARTEMIS_TIMELINE_MAX_LIMIT);
+
+  const baseFiltered = dataset.events
+    .filter((event) => (query.includeSuperseded ? true : event.status !== 'superseded'))
+    .filter((event) => (query.from ? event.date >= query.from : true))
+    .filter((event) => (query.to ? event.date <= query.to : true));
+
+  const facets = buildTimelineFacets({
+    events: baseFiltered,
+    missionFilter: effectiveMission,
+    sourceTypeFilter: query.sourceType
+  });
+
+  const fullyFiltered = baseFiltered
+    .filter((event) => (effectiveMission === 'all' ? true : event.mission === effectiveMission))
+    .filter((event) => (query.sourceType === 'all' ? true : event.source.type === query.sourceType))
+    .sort(compareEventsAscending);
+
+  const pagedEvents = fullyFiltered.slice(cursorOffset, cursorOffset + limit);
+  const nextCursor = cursorOffset + pagedEvents.length < fullyFiltered.length ? encodeCursor(cursorOffset + pagedEvents.length) : null;
+  const kpis = buildKpis(fullyFiltered);
+  const missionProgress =
+    effectiveMission === 'all'
+      ? dataset.missionProgress
+      : dataset.missionProgress.filter((card) => card.mission === effectiveMission);
+
+  return {
+    generatedAt: dataset.generatedAt,
+    mode: query.mode,
+    mission: effectiveMission,
+    sourceType: query.sourceType,
+    includeSuperseded: query.includeSuperseded,
+    from: query.from,
+    to: query.to,
+    events: pagedEvents,
+    facets,
+    kpis,
+    missionProgress,
+    nextCursor
+  };
+}
+
+export async function fetchArtemisEventEvidence(eventId: string) {
+  const dataset = await buildTimelineDataset();
+  return dataset.evidenceById[eventId] || null;
+}
+
+export function parseArtemisAudienceMode(value: string | null): ArtemisAudienceMode | null {
+  if (!value) return 'quick';
+  const normalized = value.trim().toLowerCase();
+  if (normalized === 'quick' || normalized === 'summary' || normalized === 'overview') return 'quick';
+  if (normalized === 'explorer' || normalized === 'explore' || normalized === 'mission') return 'explorer';
+  if (normalized === 'technical' || normalized === 'detail' || normalized === 'deep') return 'technical';
+  return null;
+}
+
+export function parseArtemisMissionFilter(value: string | null): ArtemisTimelineMissionFilter | null {
+  if (!value) return 'all';
+  const normalized = value.trim().toLowerCase().replace(/\s+/g, '').replace(/_/g, '-');
+  if (normalized === 'all') return 'all';
+  if (normalized === 'artemis-i' || normalized === 'artemisi' || normalized === 'artemis1' || normalized === 'i' || normalized === '1') {
+    return 'artemis-i';
+  }
+  if (normalized === 'artemis-ii' || normalized === 'artemisii' || normalized === 'artemis2' || normalized === 'ii' || normalized === '2') {
+    return 'artemis-ii';
+  }
+  if (normalized === 'artemis-iii' || normalized === 'artemisiii' || normalized === 'artemis3' || normalized === 'iii' || normalized === '3') {
+    return 'artemis-iii';
+  }
+  if (normalized === 'artemis-program' || normalized === 'program') return 'artemis-program';
+  return null;
+}
+
+export function parseArtemisSourceFilter(value: string | null): ArtemisTimelineSourceFilter | null {
+  if (!value) return 'all';
+  const normalized = value.trim().toLowerCase();
+  if (normalized === 'all') return 'all';
+  if (normalized === 'll2-cache' || normalized === 'll2' || normalized === 'launch-library-2') return 'll2-cache';
+  if (normalized === 'nasa-official' || normalized === 'nasa') return 'nasa-official';
+  if (normalized === 'curated-fallback' || normalized === 'fallback') return 'curated-fallback';
+  return null;
+}
+
+export function parseBooleanParam(value: string | null, fallback: boolean): boolean | null {
+  if (value == null || value === '') return fallback;
+  const normalized = value.trim().toLowerCase();
+  if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
+  if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
+  return null;
+}
+
+export function parseIsoDateParam(value: string | null): string | null | 'invalid' {
+  if (!value) return null;
+  const date = new Date(value);
+  if (Number.isNaN(date.getTime())) return 'invalid';
+  return date.toISOString();
+}
+
+export function parseTimelineLimit(value: string | null) {
+  if (value == null || value === '') return ARTEMIS_TIMELINE_DEFAULT_LIMIT;
+  const parsed = Number(value);
+  if (!Number.isFinite(parsed)) return null;
+  return clampInt(parsed, ARTEMIS_TIMELINE_DEFAULT_LIMIT, 1, ARTEMIS_TIMELINE_MAX_LIMIT);
+}
+
+export function parseTimelineCursor(value: string | null) {
+  if (!value) return null;
+  if (!/^\d+$/.test(value)) return null;
+  return value;
+}
+
+function buildFallbackRecord({ definition, generatedAt }: { definition: FallbackDefinition; generatedAt: string }): TimelineRecord {
+  const event: ArtemisTimelineEvent = {
+    id: definition.id,
+    mission: definition.mission,
+    title: definition.title,
+    summary: definition.summary,
+    date: definition.date,
+    kind: definition.kind,
+    status: definition.status,
+    source: {
+      type: definition.sourceType,
+      label: definition.sourceLabel,
+      href: definition.sourceHref,
+      lastVerifiedAt: generatedAt
+    },
+    confidence: definition.confidence,
+    supersedes: definition.supersedes ? [...definition.supersedes] : [],
+    supersededBy: definition.supersededBy ?? null,
+    evidenceId: definition.id
+  };
+
+  const evidence: ArtemisEventEvidence = {
+    eventId: definition.id,
+    mission: definition.mission,
+    title: definition.title,
+    summary: definition.summary,
+    sourceType: definition.sourceType,
+    confidence: definition.confidence,
+    generatedAt,
+    sources: definition.evidenceSources,
+    payload: {
+      ...definition.payload,
+      source: {
+        label: definition.sourceLabel,
+        href: definition.sourceHref || NASA_ARTEMIS_URL
+      }
+    }
+  };
+
+  return { event, evidence };
+}
+
+function buildLaunchRecord({ launch, generatedAt, nowMs }: { launch: Launch; generatedAt: string; nowMs: number }): TimelineRecord {
+  const mission = inferMissionFromLaunch(launch);
+  const sourceHref = launch.ll2Id ? `https://ll.thespacedevs.com/2.3.0/launch/${encodeURIComponent(launch.ll2Id)}/` : undefined;
+  const status = deriveLaunchStatus(launch, nowMs);
+  const confidence = deriveLaunchConfidence(launch);
+  const summary = buildLaunchSummary(launch);
+  const eventId = `launch:${launch.id}`;
+  const sourceCapturedAt = toIsoOrNull(launch.cacheGeneratedAt) || toIsoOrNull(launch.lastUpdated) || generatedAt;
+  const launchHref = buildLaunchHref(launch);
+  const sources = buildLaunchEvidenceSources({ launch, sourceHref, sourceCapturedAt });
+
+  const event: ArtemisTimelineEvent = {
+    id: eventId,
+    mission,
+    title: launch.name,
+    summary,
+    date: launch.net,
+    endDate: launch.windowEnd || null,
+    kind: 'launch',
+    status,
+    source: {
+      type: 'll2-cache',
+      label: 'Launch Library 2 cache',
+      href: sourceHref,
+      lastVerifiedAt: sourceCapturedAt
+    },
+    confidence,
+    supersedes: [],
+    supersededBy: null,
+    evidenceId: eventId,
+    launch
+  };
+
+  const evidence: ArtemisEventEvidence = {
+    eventId,
+    mission,
+    title: launch.name,
+    summary,
+    sourceType: 'll2-cache',
+    confidence,
+    generatedAt,
+    sources,
+    payload: {
+      launch,
+      launchHref,
+      derived: {
+        mission,
+        status,
+        confidence
+      }
+    }
+  };
+
+  return { event, evidence };
+}
+
+function buildLaunchEvidenceSources({
+  launch,
+  sourceHref,
+  sourceCapturedAt
+}: {
+  launch: Launch;
+  sourceHref?: string;
+  sourceCapturedAt: string;
+}) {
+  const sources: ArtemisEvidenceSource[] = [
+    {
+      label: 'Launch Library 2 launch record',
+      href: sourceHref,
+      capturedAt: sourceCapturedAt
+    }
+  ];
+
+  for (const info of launch.launchInfoUrls || []) {
+    const href = normalizeUrlCandidate(info?.url);
+    if (!href) continue;
+    sources.push({
+      label: info?.title?.trim() || 'Launch information link',
+      href,
+      note: info?.source?.trim() || undefined
+    });
+    if (sources.length >= 6) break;
+  }
+
+  if (sources.length < 6) {
+    for (const video of launch.launchVidUrls || []) {
+      const href = normalizeUrlCandidate(video?.url);
+      if (!href) continue;
+      sources.push({
+        label: video?.title?.trim() || 'Launch video link',
+        href,
+        note: video?.publisher?.trim() || video?.source?.trim() || undefined
+      });
+      if (sources.length >= 6) break;
+    }
+  }
+
+  return sources;
+}
+
+function normalizeUrlCandidate(value: unknown) {
+  if (typeof value !== 'string') return null;
+  const trimmed = value.trim();
+  if (!trimmed) return null;
+  return trimmed;
+}
+
+function inferMissionFromLaunch(launch: Launch): ArtemisTimelineMission {
+  const candidates = [launch.name, launch.mission?.name, ...(launch.programs || []).map((program) => program?.name || '')]
+    .map((value) => value?.trim())
+    .filter(Boolean) as string[];
+  const joined = candidates.join(' ');
+  if (ARTEMIS_III_PATTERN.test(joined)) return 'artemis-iii';
+  if (ARTEMIS_II_PATTERN.test(joined)) return 'artemis-ii';
+  if (ARTEMIS_I_PATTERN.test(joined)) return 'artemis-i';
+  return 'artemis-program';
+}
+
+function deriveLaunchStatus(launch: Launch, nowMs: number): ArtemisTimelineEvent['status'] {
+  const netMs = Date.parse(launch.net);
+  if (launch.status === 'scrubbed') return 'superseded';
+  if (!Number.isNaN(netMs) && netMs < nowMs) return 'completed';
+  if (launch.status === 'hold' || launch.netPrecision === 'tbd' || launch.netPrecision === 'day' || launch.netPrecision === 'month') {
+    return 'tentative';
+  }
+  return 'upcoming';
+}
+
+function deriveLaunchConfidence(launch: Launch): ArtemisTimelineConfidence {
+  if (launch.netPrecision === 'tbd') return 'low';
+  if (launch.netPrecision === 'day' || launch.netPrecision === 'month') return 'medium';
+  if (launch.status === 'hold' || launch.status === 'scrubbed') return 'medium';
+  return 'high';
+}
+
+function buildLaunchSummary(launch: Launch) {
+  const status = launch.statusText?.trim() || launch.status || 'Unknown';
+  return `${launch.provider} • ${launch.vehicle} • Status: ${status}`;
+}
+
+function pickPrimaryLaunchRecord({
+  records,
+  mission,
+  nowMs
+}: {
+  records: TimelineRecord[];
+  mission: Extract<ArtemisTimelineMission, 'artemis-i' | 'artemis-ii' | 'artemis-iii'>;
+  nowMs: number;
+}) {
+  const missionRecords = records.filter((record) => record.event.mission === mission);
+  if (!missionRecords.length) return null;
+
+  const upcoming = missionRecords
+    .filter((record) => {
+      const ms = Date.parse(record.event.date);
+      return !Number.isNaN(ms) && ms >= nowMs;
+    })
+    .sort((a, b) => Date.parse(a.event.date) - Date.parse(b.event.date));
+  if (upcoming.length) return upcoming[0];
+
+  const latestCompleted = missionRecords
+    .slice()
+    .sort((a, b) => Date.parse(b.event.date) - Date.parse(a.event.date));
+  return latestCompleted[0];
+}
+
+function linkSupersession({
+  records,
+  supersedingId,
+  supersededId,
+  reason
+}: {
+  records: TimelineRecord[];
+  supersedingId: string;
+  supersededId: string;
+  reason: ArtemisTimelineSupersedeReason;
+}) {
+  if (supersedingId === supersededId) return;
+  const superseding = records.find((record) => record.event.id === supersedingId);
+  const superseded = records.find((record) => record.event.id === supersededId);
+  if (!superseding || !superseded) return;
+
+  if (!superseding.event.supersedes.some((entry) => entry.eventId === supersededId)) {
+    superseding.event.supersedes.push({ eventId: supersededId, reason });
+  }
+  superseded.event.supersededBy = { eventId: supersedingId, reason };
+  if (superseded.event.status !== 'completed') superseded.event.status = 'superseded';
+
+  superseding.evidence.payload = {
+    ...superseding.evidence.payload,
+    supersedes: superseding.event.supersedes
+  };
+  superseded.evidence.payload = {
+    ...superseded.evidence.payload,
+    supersededBy: superseded.event.supersededBy
+  };
+}
+
+function normalizeEvent(event: ArtemisTimelineEvent): ArtemisTimelineEvent {
+  return {
+    ...event,
+    supersedes: event.supersedes || [],
+    supersededBy: event.supersededBy ?? null
+  };
+}
+
+function buildMissionProgressCards(events: ArtemisTimelineEvent[], nowMs: number) {
+  return MISSION_SEQUENCE.map((mission) => {
+    const missionEvents = events
+      .filter((event) => event.mission === mission && event.status !== 'superseded')
+      .sort(compareEventsAscending);
+    const completedCount = missionEvents.filter((event) => event.status === 'completed').length;
+    const nextUpcoming = missionEvents.find((event) => {
+      const ms = Date.parse(event.date);
+      return !Number.isNaN(ms) && ms >= nowMs;
+    });
+    const latestKnown = nextUpcoming || missionEvents[missionEvents.length - 1] || null;
+
+    const state =
+      mission === 'artemis-i'
+        ? 'completed'
+        : mission === 'artemis-ii'
+          ? 'in-preparation'
+          : completedCount > 0
+            ? 'in-preparation'
+            : 'planned';
+
+    return {
+      mission,
+      label: MISSION_LABELS[mission],
+      state,
+      summary: latestKnown?.summary || `${MISSION_LABELS[mission]} milestone timeline is currently sourced from fallback planning data.`,
+      targetDate: latestKnown?.date || null,
+      sourceType: latestKnown?.source.type || 'curated-fallback',
+      confidence: latestKnown?.confidence || 'low',
+      eventId: latestKnown?.id || null
+    } satisfies ArtemisMissionProgressCard;
+  });
+}
+
+function buildTimelineFacets({
+  events,
+  missionFilter,
+  sourceTypeFilter
+}: {
+  events: ArtemisTimelineEvent[];
+  missionFilter: ArtemisTimelineMissionFilter;
+  sourceTypeFilter: ArtemisTimelineSourceFilter;
+}): ArtemisTimelineFacet[] {
+  const missionCounts = countBy(events, (event) => event.mission);
+  const sourceTypeCounts = countBy(events, (event) => event.source.type);
+
+  const missionOptions = [
+    { value: 'all', label: 'All missions', count: events.length, selected: missionFilter === 'all' },
+    ...(['artemis-i', 'artemis-ii', 'artemis-iii', 'artemis-program'] as const).map((value) => ({
+      value,
+      label:
+        value === 'artemis-program'
+          ? 'Program-level'
+          : value === 'artemis-i'
+            ? 'Artemis I'
+            : value === 'artemis-ii'
+              ? 'Artemis II'
+              : 'Artemis III',
+      count: missionCounts[value] || 0,
+      selected: missionFilter === value
+    }))
+  ];
+
+  const sourceTypeOptions = [
+    { value: 'all', label: 'All sources', count: events.length, selected: sourceTypeFilter === 'all' },
+    ...(['ll2-cache', 'nasa-official', 'curated-fallback'] as const).map((value) => ({
+      value,
+      label:
+        value === 'll2-cache'
+          ? 'Launch Library 2 cache'
+          : value === 'nasa-official'
+            ? 'NASA official'
+            : 'Curated fallback',
+      count: sourceTypeCounts[value] || 0,
+      selected: sourceTypeFilter === value
+    }))
+  ];
+
+  return [
+    {
+      key: 'mission',
+      label: 'Mission',
+      options: missionOptions
+    },
+    {
+      key: 'sourceType',
+      label: 'Source',
+      options: sourceTypeOptions
+    }
+  ];
+}
+
+function buildKpis(events: ArtemisTimelineEvent[]): ArtemisTimelineKpis {
+  const completedEvents = events.filter((event) => event.status === 'completed').length;
+  const upcomingEvents = events.filter((event) => event.status === 'upcoming').length;
+  const tentativeEvents = events.filter((event) => event.status === 'tentative').length;
+  const supersededEvents = events.filter((event) => event.status === 'superseded').length;
+  const highConfidenceEvents = events.filter((event) => event.confidence === 'high').length;
+  const lastUpdated = resolveLastUpdated(events);
+
+  return {
+    totalEvents: events.length,
+    completedEvents,
+    upcomingEvents,
+    tentativeEvents,
+    supersededEvents,
+    highConfidenceEvents,
+    lastUpdated
+  };
+}
+
+function resolveEffectiveMissionFilter(mode: ArtemisAudienceMode, mission: ArtemisTimelineMissionFilter): ArtemisTimelineMissionFilter {
+  if (mission !== 'all') return mission;
+  return mode === 'quick' ? 'all' : 'artemis-ii';
+}
+
+function resolveLastUpdated(events: ArtemisTimelineEvent[]) {
+  const candidates = events
+    .map((event) => event.source.lastVerifiedAt || event.date)
+    .map((value) => toIsoOrNull(value))
+    .filter(Boolean) as string[];
+  if (!candidates.length) return null;
+  return candidates.reduce((latest, current) => (Date.parse(current) > Date.parse(latest) ? current : latest));
+}
+
+function compareEventsAscending(a: ArtemisTimelineEvent, b: ArtemisTimelineEvent) {
+  const aMs = Date.parse(a.date);
+  const bMs = Date.parse(b.date);
+  const safeAMs = Number.isNaN(aMs) ? Number.MAX_SAFE_INTEGER : aMs;
+  const safeBMs = Number.isNaN(bMs) ? Number.MAX_SAFE_INTEGER : bMs;
+  if (safeAMs !== safeBMs) return safeAMs - safeBMs;
+  return a.id.localeCompare(b.id);
+}
+
+function countBy<T, K extends string>(items: T[], resolver: (value: T) => K) {
+  const out = {} as Record<K, number>;
+  for (const item of items) {
+    const key = resolver(item);
+    out[key] = (out[key] || 0) + 1;
+  }
+  return out;
+}
+
+function dedupeById(launches: Launch[]) {
+  const seen = new Set<string>();
+  const deduped: Launch[] = [];
+  for (const launch of launches) {
+    if (seen.has(launch.id)) continue;
+    seen.add(launch.id);
+    deduped.push(launch);
+  }
+  return deduped;
+}
+
+function toIsoOrNull(value: string | null | undefined) {
+  if (!value) return null;
+  const date = new Date(value);
+  if (Number.isNaN(date.getTime())) return null;
+  return date.toISOString();
+}
+
+function clampInt(value: number, fallback: number, min: number, max: number) {
+  if (!Number.isFinite(value)) return fallback;
+  const truncated = Math.trunc(value);
+  return Math.max(min, Math.min(max, truncated));
+}
+
+function decodeCursor(cursor: string | null) {
+  if (!cursor) return 0;
+  const parsed = Number(cursor);
+  if (!Number.isFinite(parsed)) return 0;
+  return Math.max(0, Math.trunc(parsed));
+}
+
+function encodeCursor(value: number) {
+  return String(Math.max(0, Math.trunc(value)));
+}
diff --git a/lib/server/siteMeta.ts b/lib/server/siteMeta.ts
index 86b4e06..af300e2 100644
--- a/lib/server/siteMeta.ts
+++ b/lib/server/siteMeta.ts
@@ -15,7 +15,13 @@ export const SITE_META = {
     'SpaceX launches',
     'NASA launches',
     'ULA launches',
-    'rocket launch alerts'
+    'rocket launch alerts',
+    'artemis',
+    'artemis ii',
+    'artemis 2',
+    'artemis ii launch date',
+    'artemis 2 countdown',
+    'artemis launch schedule'
   ],
   ogTitle: 'US Rocket Launch Schedule',
   ogDescription: 'Upcoming US rocket launches with countdowns, launch windows, and live coverage links.',
diff --git a/lib/types/artemis.ts b/lib/types/artemis.ts
new file mode 100644
index 0000000..07ebdac
--- /dev/null
+++ b/lib/types/artemis.ts
@@ -0,0 +1,162 @@
+import type { Launch } from '@/lib/types/launch';
+
+export type ArtemisFaqItem = {
+  question: string;
+  answer: string;
+};
+
+export type ArtemisChangeItem = {
+  title: string;
+  summary: string;
+  date: string;
+  href?: string;
+};
+
+export type ArtemisProgramSnapshot = {
+  generatedAt: string;
+  lastUpdated: string | null;
+  nextLaunch: Launch | null;
+  upcoming: Launch[];
+  recent: Launch[];
+  faq: ArtemisFaqItem[];
+};
+
+export type ArtemisMissionSnapshot = {
+  generatedAt: string;
+  lastUpdated: string | null;
+  missionName: string;
+  nextLaunch: Launch | null;
+  upcoming: Launch[];
+  recent: Launch[];
+  crewHighlights: string[];
+  changes: ArtemisChangeItem[];
+  faq: ArtemisFaqItem[];
+};
+
+export type ArtemisAudienceMode = 'quick' | 'explorer' | 'technical';
+
+export type ArtemisTimelineMission = 'artemis-i' | 'artemis-ii' | 'artemis-iii' | 'artemis-program';
+
+export type ArtemisTimelineSourceType = 'll2-cache' | 'nasa-official' | 'curated-fallback';
+
+export type ArtemisTimelineConfidence = 'high' | 'medium' | 'low';
+
+export type ArtemisTimelineEventKind = 'mission-milestone' | 'launch' | 'update';
+
+export type ArtemisTimelineEventStatus = 'completed' | 'upcoming' | 'tentative' | 'superseded';
+
+export type ArtemisTimelineSupersedeReason = 'rescheduled' | 'refined' | 'replaced';
+
+export type ArtemisTimelineSupersedesLink = {
+  eventId: string;
+  reason: ArtemisTimelineSupersedeReason;
+};
+
+export type ArtemisTimelineSource = {
+  type: ArtemisTimelineSourceType;
+  label: string;
+  href?: string;
+  lastVerifiedAt?: string | null;
+};
+
+export type ArtemisTimelineEvent = {
+  id: string;
+  mission: ArtemisTimelineMission;
+  title: string;
+  summary: string;
+  date: string;
+  endDate?: string | null;
+  kind: ArtemisTimelineEventKind;
+  status: ArtemisTimelineEventStatus;
+  source: ArtemisTimelineSource;
+  confidence: ArtemisTimelineConfidence;
+  supersedes: ArtemisTimelineSupersedesLink[];
+  supersededBy?: ArtemisTimelineSupersedesLink | null;
+  evidenceId: string;
+  launch?: Launch | null;
+};
+
+export type ArtemisTimelineFacetOption = {
+  value: string;
+  label: string;
+  count: number;
+  selected: boolean;
+};
+
+export type ArtemisTimelineFacet = {
+  key: 'mission' | 'sourceType';
+  label: string;
+  options: ArtemisTimelineFacetOption[];
+};
+
+export type ArtemisTimelineKpis = {
+  totalEvents: number;
+  completedEvents: number;
+  upcomingEvents: number;
+  tentativeEvents: number;
+  supersededEvents: number;
+  highConfidenceEvents: number;
+  lastUpdated: string | null;
+};
+
+export type ArtemisMissionProgressState = 'completed' | 'in-preparation' | 'planned';
+
+export type ArtemisMissionProgressCard = {
+  mission: Extract<ArtemisTimelineMission, 'artemis-i' | 'artemis-ii' | 'artemis-iii'>;
+  label: string;
+  state: ArtemisMissionProgressState;
+  summary: string;
+  targetDate: string | null;
+  sourceType: ArtemisTimelineSourceType;
+  confidence: ArtemisTimelineConfidence;
+  eventId: string | null;
+};
+
+export type ArtemisEvidenceSource = {
+  label: string;
+  href?: string;
+  note?: string;
+  capturedAt?: string | null;
+};
+
+export type ArtemisEventEvidence = {
+  eventId: string;
+  mission: ArtemisTimelineMission;
+  title: string;
+  summary: string;
+  sourceType: ArtemisTimelineSourceType;
+  confidence: ArtemisTimelineConfidence;
+  generatedAt: string;
+  sources: ArtemisEvidenceSource[];
+  payload: Record<string, unknown>;
+};
+
+export type ArtemisTimelineMissionFilter = ArtemisTimelineMission | 'all';
+
+export type ArtemisTimelineSourceFilter = ArtemisTimelineSourceType | 'all';
+
+export type ArtemisTimelineQuery = {
+  mode: ArtemisAudienceMode;
+  mission: ArtemisTimelineMissionFilter;
+  sourceType: ArtemisTimelineSourceFilter;
+  includeSuperseded: boolean;
+  from: string | null;
+  to: string | null;
+  cursor: string | null;
+  limit: number;
+};
+
+export type ArtemisTimelineResponse = {
+  generatedAt: string;
+  mode: ArtemisAudienceMode;
+  mission: ArtemisTimelineMissionFilter;
+  sourceType: ArtemisTimelineSourceFilter;
+  includeSuperseded: boolean;
+  from: string | null;
+  to: string | null;
+  events: ArtemisTimelineEvent[];
+  facets: ArtemisTimelineFacet[];
+  kpis: ArtemisTimelineKpis;
+  missionProgress: ArtemisMissionProgressCard[];
+  nextCursor: string | null;
+};
diff --git a/lib/utils/artemis.ts b/lib/utils/artemis.ts
new file mode 100644
index 0000000..ea1971b
--- /dev/null
+++ b/lib/utils/artemis.ts
@@ -0,0 +1,39 @@
+import type { Launch } from '@/lib/types/launch';
+
+type ArtemisLaunchLike = Pick<Launch, 'name' | 'mission' | 'programs'>;
+
+const ARTEMIS_PROGRAM_PATTERN = /\bartem[iu]s\b/i;
+const ARTEMIS_II_PATTERN = /\bartem[iu]s(?:\s*[-:]?\s*)(?:ii|2)\b/i;
+
+function normalizeText(value: string | null | undefined) {
+  return typeof value === 'string' ? value.trim() : '';
+}
+
+function collectLaunchTextCandidates(launch: ArtemisLaunchLike) {
+  const candidates = [launch.name, launch.mission?.name];
+  for (const program of launch.programs || []) {
+    if (program?.name) candidates.push(program.name);
+    if (program?.description) candidates.push(program.description);
+  }
+  return candidates.map(normalizeText).filter(Boolean);
+}
+
+export function isArtemisProgramText(value: string | null | undefined) {
+  const normalized = normalizeText(value);
+  if (!normalized) return false;
+  return ARTEMIS_PROGRAM_PATTERN.test(normalized);
+}
+
+export function isArtemisProgramLaunch(launch: ArtemisLaunchLike) {
+  return collectLaunchTextCandidates(launch).some((candidate) => isArtemisProgramText(candidate));
+}
+
+export function isArtemisIILaunch(launch: ArtemisLaunchLike) {
+  return collectLaunchTextCandidates(launch).some((candidate) => ARTEMIS_II_PATTERN.test(candidate));
+}
+
+export function getArtemisVariantLabel(launch: ArtemisLaunchLike): 'artemis-ii' | 'artemis' | null {
+  if (isArtemisIILaunch(launch)) return 'artemis-ii';
+  if (isArtemisProgramLaunch(launch)) return 'artemis';
+  return null;
+}
diff --git a/lib/utils/launchArtemis.ts b/lib/utils/launchArtemis.ts
index e43af40..fd83cf2 100644
--- a/lib/utils/launchArtemis.ts
+++ b/lib/utils/launchArtemis.ts
@@ -1,10 +1,6 @@
 import type { Launch } from '@/lib/types/launch';
+import { isArtemisProgramLaunch } from '@/lib/utils/artemis';
 
-const ARTEMIS_PATTERN = /\bartem[iu]s\b/i;
-
-export function isArtemisLaunch(launch: Pick<Launch, 'name' | 'mission'>) {
-  if (ARTEMIS_PATTERN.test(launch.name)) return true;
-  const missionName = launch.mission?.name;
-  if (missionName && ARTEMIS_PATTERN.test(missionName)) return true;
-  return false;
+export function isArtemisLaunch(launch: Pick<Launch, 'name' | 'mission'> & { programs?: Launch['programs'] }) {
+  return isArtemisProgramLaunch(launch);
 }
diff --git a/next.config.mjs b/next.config.mjs
index 5046043..26bce3e 100644
--- a/next.config.mjs
+++ b/next.config.mjs
@@ -64,6 +64,20 @@ const nextConfig = {
       }
     ]
   },
+  async redirects() {
+    return [
+      {
+        source: '/artemis-2',
+        destination: '/artemis-ii',
+        permanent: true
+      },
+      {
+        source: '/artemis-2/',
+        destination: '/artemis-ii',
+        permanent: true
+      }
+    ];
+  },
   async headers() {
     if (process.env.NODE_ENV !== 'production') {
       return [];
diff --git a/scripts/seo-tests.ts b/scripts/seo-tests.ts
index b3a0d66..016bc92 100644
--- a/scripts/seo-tests.ts
+++ b/scripts/seo-tests.ts
@@ -26,7 +26,18 @@ const REQUIRED_META_KEYS = [
   'twitter:image:alt'
 ];
 
-const ROUTES_TO_VALIDATE = ['/', '/launch-providers/spacex', '/docs/about', '/starship', '/about', '/legal/privacy'];
+const ROUTES_TO_VALIDATE = [
+  '/',
+  '/artemis',
+  '/artemis-i',
+  '/artemis-ii',
+  '/artemis-iii',
+  '/launch-providers/spacex',
+  '/docs/about',
+  '/starship',
+  '/about',
+  '/legal/privacy'
+];
 
 const SNIPPET_BANNED_TEXT = ['loading telemetry', 'comm link', 'manifest'];
 
@@ -69,6 +80,8 @@ async function main() {
         assert.ok(/type=\"application\/ld\+json\"/i.test(html), `[${route}] missing JSON-LD`);
       }
     }
+
+    await assertRedirect({ port, route: '/artemis-2', expectedLocationPath: '/artemis-ii', expectedStatus: 308 });
   } finally {
     await stopServer(server);
   }
@@ -133,6 +146,31 @@ async function fetchHtml(url: string) {
   return response.text();
 }
 
+async function assertRedirect({
+  port,
+  route,
+  expectedLocationPath,
+  expectedStatus
+}: {
+  port: number;
+  route: string;
+  expectedLocationPath: string;
+  expectedStatus: number;
+}) {
+  const response = await fetch(`http://localhost:${port}${route}`, {
+    headers: { 'x-forwarded-proto': 'https' },
+    redirect: 'manual'
+  });
+
+  assert.equal(response.status, expectedStatus, `[${route}] expected redirect status ${expectedStatus}, got ${response.status}`);
+
+  const location = response.headers.get('location');
+  assert.ok(location, `[${route}] missing redirect location`);
+
+  const resolvedPath = location?.startsWith('http') ? new URL(location).pathname : location;
+  assert.equal(resolvedPath, expectedLocationPath, `[${route}] expected redirect location ${expectedLocationPath}, got ${location}`);
+}
+
 function parseHead(html: string): ParsedHead {
   const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
   const head = headMatch ? headMatch[1] : html;
diff --git a/supabase/functions/_shared/artemisIngest.ts b/supabase/functions/_shared/artemisIngest.ts
new file mode 100644
index 0000000..9286e03
--- /dev/null
+++ b/supabase/functions/_shared/artemisIngest.ts
@@ -0,0 +1,232 @@
+import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
+
+export type ArtemisSourceType = 'nasa_primary' | 'oversight' | 'budget' | 'procurement' | 'technical' | 'media';
+
+export type ArtemisMissionKey = 'program' | 'artemis-i' | 'artemis-ii' | 'artemis-iii';
+
+export const ARTEMIS_SOURCE_KEYS = [
+  'nasa_campaign_pages',
+  'nasa_blog_posts',
+  'nasa_reference_timelines',
+  'nasa_rss',
+  'oig_reports',
+  'gao_reports',
+  'moon_to_mars_docs',
+  'ntrs_api',
+  'techport_api',
+  'nasa_budget_docs',
+  'usaspending_awards',
+  'nasa_media_assets'
+] as const;
+
+export function jsonResponse(payload: unknown, status = 200) {
+  return new Response(JSON.stringify(payload), {
+    status,
+    headers: { 'Content-Type': 'application/json' }
+  });
+}
+
+export function stringifyError(err: unknown) {
+  if (err instanceof Error) return err.message;
+  return String(err);
+}
+
+export function toIsoOrNull(value: unknown) {
+  if (typeof value !== 'string') return null;
+  const date = new Date(value);
+  if (Number.isNaN(date.getTime())) return null;
+  return date.toISOString();
+}
+
+export function classifyMission(nameLike: string | null | undefined): ArtemisMissionKey {
+  const value = (nameLike || '').toLowerCase();
+  if (/\bartemis\s*(ii|2)\b/.test(value)) return 'artemis-ii';
+  if (/\bartemis\s*(iii|3)\b/.test(value)) return 'artemis-iii';
+  if (/\bartemis\s*(i|1)\b/.test(value)) return 'artemis-i';
+  return 'program';
+}
+
+export async function startIngestionRun(supabase: SupabaseClient, jobName: string) {
+  const { data, error } = await supabase
+    .from('ingestion_runs')
+    .insert({ job_name: jobName, started_at: new Date().toISOString(), success: false })
+    .select('id')
+    .single();
+
+  if (error || !data?.id) throw error || new Error(`Failed to start ingestion run for ${jobName}`);
+  return { runId: data.id as string };
+}
+
+export async function finishIngestionRun(
+  supabase: SupabaseClient,
+  runId: string,
+  success: boolean,
+  stats?: Record<string, unknown>,
+  errorMessage?: string
+) {
+  await supabase
+    .from('ingestion_runs')
+    .update({
+      success,
+      ended_at: new Date().toISOString(),
+      stats: stats || null,
+      error: errorMessage || null
+    })
+    .eq('id', runId);
+}
+
+export async function updateCheckpoint(
+  supabase: SupabaseClient,
+  sourceKey: string,
+  patch: {
+    sourceType?: ArtemisSourceType;
+    status?: 'pending' | 'running' | 'complete' | 'error';
+    cursor?: string | null;
+    recordsIngested?: number;
+    lastAnnouncedTime?: string | null;
+    lastEventTime?: string | null;
+    startedAt?: string | null;
+    endedAt?: string | null;
+    lastError?: string | null;
+    metadata?: Record<string, unknown>;
+  }
+) {
+  const payload: Record<string, unknown> = {
+    source_key: sourceKey,
+    source_type: patch.sourceType || 'nasa_primary',
+    updated_at: new Date().toISOString()
+  };
+
+  if (patch.status) payload.status = patch.status;
+  if ('cursor' in patch) payload.cursor = patch.cursor;
+  if (typeof patch.recordsIngested === 'number') payload.records_ingested = patch.recordsIngested;
+  if ('lastAnnouncedTime' in patch) payload.last_announced_time = patch.lastAnnouncedTime;
+  if ('lastEventTime' in patch) payload.last_event_time = patch.lastEventTime;
+  if ('startedAt' in patch) payload.started_at = patch.startedAt;
+  if ('endedAt' in patch) payload.ended_at = patch.endedAt;
+  if ('lastError' in patch) payload.last_error = patch.lastError;
+  if (patch.metadata) payload.metadata = patch.metadata;
+
+  const { error } = await supabase.from('artemis_ingest_checkpoints').upsert(payload, { onConflict: 'source_key' });
+  if (error) throw error;
+}
+
+export async function loadCheckpoints(supabase: SupabaseClient) {
+  const { data, error } = await supabase
+    .from('artemis_ingest_checkpoints')
+    .select('source_key, source_type, status, cursor, records_ingested, last_announced_time, last_event_time, last_error, updated_at')
+    .order('source_key', { ascending: true });
+  if (error) throw error;
+  return data || [];
+}
+
+export async function isBootstrapComplete(supabase: SupabaseClient) {
+  const { data, error } = await supabase
+    .from('artemis_ingest_checkpoints')
+    .select('status')
+    .neq('status', 'complete')
+    .limit(1);
+  if (error) throw error;
+  return !data || data.length === 0;
+}
+
+export async function setSystemSetting(supabase: SupabaseClient, key: string, value: unknown) {
+  const { error } = await supabase
+    .from('system_settings')
+    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
+  if (error) throw error;
+}
+
+export async function readBooleanSetting(supabase: SupabaseClient, key: string, fallback: boolean) {
+  const { data, error } = await supabase.from('system_settings').select('value').eq('key', key).maybeSingle();
+  if (error) throw error;
+  const value = data?.value;
+  if (typeof value === 'boolean') return value;
+  if (typeof value === 'string') return value.toLowerCase() === 'true';
+  return fallback;
+}
+
+export async function insertSourceDocument(
+  supabase: SupabaseClient,
+  input: {
+    sourceKey: string;
+    sourceType: ArtemisSourceType;
+    url: string;
+    title?: string;
+    summary?: string;
+    publishedAt?: string | null;
+    announcedTime?: string | null;
+    httpStatus?: number;
+    contentType?: string | null;
+    parseVersion?: string;
+    raw?: Record<string, unknown>;
+    error?: string | null;
+  }
+) {
+  const payload = {
+    source_key: input.sourceKey,
+    source_type: input.sourceType,
+    url: input.url,
+    title: input.title || null,
+    summary: input.summary || null,
+    published_at: input.publishedAt || null,
+    announced_time: input.announcedTime || null,
+    fetched_at: new Date().toISOString(),
+    http_status: input.httpStatus || null,
+    content_type: input.contentType || null,
+    parse_version: input.parseVersion || 'v1',
+    raw: input.raw || null,
+    error: input.error || null,
+    updated_at: new Date().toISOString()
+  };
+
+  const { data, error } = await supabase
+    .from('artemis_source_documents')
+    .insert(payload)
+    .select('id')
+    .single();
+  if (error || !data?.id) throw error || new Error('failed_to_insert_artemis_source_document');
+  return data.id as string;
+}
+
+export async function upsertTimelineEvent(
+  supabase: SupabaseClient,
+  input: {
+    fingerprint: string;
+    missionKey: ArtemisMissionKey;
+    title: string;
+    summary?: string;
+    eventTime?: string | null;
+    eventTimePrecision?: 'minute' | 'hour' | 'day' | 'month' | 'unknown';
+    announcedTime: string;
+    sourceType: ArtemisSourceType;
+    confidence: 'primary' | 'oversight' | 'secondary';
+    sourceDocumentId: string;
+    sourceUrl?: string | null;
+    supersedesEventId?: string | null;
+    tags?: string[];
+    metadata?: Record<string, unknown>;
+  }
+) {
+  const row = {
+    fingerprint: input.fingerprint,
+    mission_key: input.missionKey,
+    title: input.title,
+    summary: input.summary || null,
+    event_time: input.eventTime || null,
+    event_time_precision: input.eventTimePrecision || 'unknown',
+    announced_time: input.announcedTime,
+    source_type: input.sourceType,
+    confidence: input.confidence,
+    source_document_id: input.sourceDocumentId,
+    source_url: input.sourceUrl || null,
+    supersedes_event_id: input.supersedesEventId || null,
+    tags: input.tags || [],
+    metadata: input.metadata || {},
+    updated_at: new Date().toISOString()
+  };
+
+  const { data, error } = await supabase.from('artemis_timeline_events').upsert(row, { onConflict: 'fingerprint' }).select('id').single();
+  if (error || !data?.id) throw error || new Error('failed_to_upsert_artemis_timeline_event');
+  return data.id as string;
+}
diff --git a/supabase/functions/_shared/artemisSources.ts b/supabase/functions/_shared/artemisSources.ts
new file mode 100644
index 0000000..91d7ff6
--- /dev/null
+++ b/supabase/functions/_shared/artemisSources.ts
@@ -0,0 +1,101 @@
+export const ARTEMIS_SOURCE_URLS = {
+  nasaCampaign: 'https://www.nasa.gov/humans-in-space/artemis/',
+  nasaBlog: 'https://www.nasa.gov/blogs/artemis/',
+  nasaTimeline: 'https://www.nasa.gov/reference/artemis-i-mission-timeline/',
+  nasaMissionsFeed: 'https://www.nasa.gov/missions/artemis/feed/',
+  nasaBlogFeed: 'https://www.nasa.gov/blogs/artemis/feed/',
+  oigAudits: 'https://oig.nasa.gov/audits/',
+  oigFeed: 'https://oig.nasa.gov/feed/',
+  gaoArtemisQuery: 'https://www.gao.gov/search?search_api_fulltext=artemis',
+  nasaBudgetSummaryFy25: 'https://www.nasa.gov/wp-content/uploads/2024/03/fy25-budget-summary.pdf',
+  nasaBudgetRequestFy26: 'https://www.nasa.gov/news-release/nasa-releases-fiscal-year-2026-budget-request/',
+  ntrsSearch: 'https://ntrs.nasa.gov/api/citations/search?q=artemis&size=25',
+  usaspendingTopTier: 'https://api.usaspending.gov/api/v2/references/toptier_agencies/',
+  nasaImagesSearch: 'https://images-api.nasa.gov/search?q=Artemis&media_type=image&page=1',
+  techportRoot: 'https://techport.nasa.gov'
+} as const;
+
+const USER_AGENT = 'TMinusZero/0.1 (+https://tminusnow.app)';
+
+export async function fetchTextWithMeta(url: string) {
+  const response = await fetch(url, {
+    headers: {
+      'User-Agent': USER_AGENT,
+      Accept: 'text/html,application/xhtml+xml,application/xml,text/xml,*/*'
+    }
+  });
+
+  const text = await response.text();
+  return {
+    ok: response.ok,
+    status: response.status,
+    contentType: response.headers.get('content-type'),
+    etag: response.headers.get('etag'),
+    lastModified: response.headers.get('last-modified'),
+    text
+  };
+}
+
+export async function fetchJsonWithMeta(url: string) {
+  const response = await fetch(url, {
+    headers: {
+      'User-Agent': USER_AGENT,
+      Accept: 'application/json,*/*'
+    }
+  });
+
+  const body = await response.text();
+  let json: unknown = null;
+  try {
+    json = body ? JSON.parse(body) : null;
+  } catch {
+    json = null;
+  }
+
+  return {
+    ok: response.ok,
+    status: response.status,
+    contentType: response.headers.get('content-type'),
+    etag: response.headers.get('etag'),
+    lastModified: response.headers.get('last-modified'),
+    json,
+    text: body
+  };
+}
+
+export function stripHtml(text: string) {
+  return text
+    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
+    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
+    .replace(/<[^>]+>/g, ' ')
+    .replace(/&nbsp;/g, ' ')
+    .replace(/\s+/g, ' ')
+    .trim();
+}
+
+export function extractRssItems(xml: string) {
+  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
+  return items.map((item) => ({
+    title: decodeXml(findTag(item, 'title') || ''),
+    link: decodeXml(findTag(item, 'link') || ''),
+    pubDate: decodeXml(findTag(item, 'pubDate') || ''),
+    description: decodeXml(findTag(item, 'description') || '')
+  }));
+}
+
+function findTag(xml: string, tag: string) {
+  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
+  if (!match) return null;
+  return match[1];
+}
+
+function decodeXml(value: string) {
+  return value
+    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
+    .replace(/&amp;/g, '&')
+    .replace(/&lt;/g, '<')
+    .replace(/&gt;/g, '>')
+    .replace(/&quot;/g, '"')
+    .replace(/&#39;/g, "'")
+    .trim();
+}
diff --git a/supabase/functions/artemis-bootstrap/index.ts b/supabase/functions/artemis-bootstrap/index.ts
new file mode 100644
index 0000000..8afb023
--- /dev/null
+++ b/supabase/functions/artemis-bootstrap/index.ts
@@ -0,0 +1,222 @@
+import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
+import { createSupabaseAdminClient } from '../_shared/supabase.ts';
+import { requireJobAuth } from '../_shared/jobAuth.ts';
+import {
+  ARTEMIS_SOURCE_KEYS,
+  finishIngestionRun,
+  insertSourceDocument,
+  isBootstrapComplete,
+  jsonResponse,
+  loadCheckpoints,
+  readBooleanSetting,
+  setSystemSetting,
+  startIngestionRun,
+  stringifyError,
+  toIsoOrNull,
+  updateCheckpoint
+} from '../_shared/artemisIngest.ts';
+import { ARTEMIS_SOURCE_URLS, fetchJsonWithMeta, fetchTextWithMeta, stripHtml } from '../_shared/artemisSources.ts';
+
+type SourceSpec = {
+  sourceType: 'nasa_primary' | 'oversight' | 'budget' | 'procurement' | 'technical' | 'media';
+  url: string;
+  title: string;
+  kind: 'text' | 'json';
+};
+
+const SOURCE_SPECS: Record<(typeof ARTEMIS_SOURCE_KEYS)[number], SourceSpec> = {
+  nasa_campaign_pages: {
+    sourceType: 'nasa_primary',
+    url: ARTEMIS_SOURCE_URLS.nasaCampaign,
+    title: 'NASA Artemis Campaign',
+    kind: 'text'
+  },
+  nasa_blog_posts: {
+    sourceType: 'nasa_primary',
+    url: ARTEMIS_SOURCE_URLS.nasaBlog,
+    title: 'NASA Artemis Blog',
+    kind: 'text'
+  },
+  nasa_reference_timelines: {
+    sourceType: 'nasa_primary',
+    url: ARTEMIS_SOURCE_URLS.nasaTimeline,
+    title: 'NASA Artemis Timeline',
+    kind: 'text'
+  },
+  nasa_rss: {
+    sourceType: 'nasa_primary',
+    url: ARTEMIS_SOURCE_URLS.nasaMissionsFeed,
+    title: 'NASA Artemis Missions RSS',
+    kind: 'text'
+  },
+  oig_reports: {
+    sourceType: 'oversight',
+    url: ARTEMIS_SOURCE_URLS.oigAudits,
+    title: 'NASA OIG Audits',
+    kind: 'text'
+  },
+  gao_reports: {
+    sourceType: 'oversight',
+    url: ARTEMIS_SOURCE_URLS.gaoArtemisQuery,
+    title: 'GAO Artemis Search',
+    kind: 'text'
+  },
+  moon_to_mars_docs: {
+    sourceType: 'technical',
+    url: 'https://www.nasa.gov/wp-json/wp/v2/search?search=Moon%20to%20Mars',
+    title: 'Moon to Mars Architecture Search',
+    kind: 'json'
+  },
+  ntrs_api: {
+    sourceType: 'technical',
+    url: ARTEMIS_SOURCE_URLS.ntrsSearch,
+    title: 'NASA NTRS Artemis Search',
+    kind: 'json'
+  },
+  techport_api: {
+    sourceType: 'technical',
+    url: ARTEMIS_SOURCE_URLS.techportRoot,
+    title: 'NASA TechPort Root',
+    kind: 'text'
+  },
+  nasa_budget_docs: {
+    sourceType: 'budget',
+    url: ARTEMIS_SOURCE_URLS.nasaBudgetRequestFy26,
+    title: 'NASA Budget Request FY26',
+    kind: 'text'
+  },
+  usaspending_awards: {
+    sourceType: 'procurement',
+    url: ARTEMIS_SOURCE_URLS.usaspendingTopTier,
+    title: 'USASpending Top Tier Agencies',
+    kind: 'json'
+  },
+  nasa_media_assets: {
+    sourceType: 'media',
+    url: ARTEMIS_SOURCE_URLS.nasaImagesSearch,
+    title: 'NASA Images API Artemis Search',
+    kind: 'json'
+  }
+};
+
+serve(async (req) => {
+  const supabase = createSupabaseAdminClient();
+  const authorized = await requireJobAuth(req, supabase);
+  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);
+
+  const startedAt = Date.now();
+  const { runId } = await startIngestionRun(supabase, 'artemis_bootstrap');
+  const stats: Record<string, unknown> = {
+    checkpointsProcessed: 0,
+    checkpointsCompleted: 0,
+    sourceDocumentsInserted: 0,
+    skipped: false,
+    errors: [] as Array<{ step: string; error: string; sourceKey?: string }>
+  };
+
+  try {
+    const enabled = await readBooleanSetting(supabase, 'artemis_bootstrap_job_enabled', true);
+    if (!enabled) {
+      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
+      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
+    }
+
+    const alreadyComplete = await isBootstrapComplete(supabase);
+    if (alreadyComplete) {
+      await setSystemSetting(supabase, 'artemis_bootstrap_complete', true);
+      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'already_complete' });
+      return jsonResponse({ ok: true, skipped: true, reason: 'already_complete', elapsedMs: Date.now() - startedAt });
+    }
+
+    const checkpoints = await loadCheckpoints(supabase);
+
+    for (const checkpoint of checkpoints) {
+      if (checkpoint.status === 'complete') continue;
+      const sourceKey = checkpoint.source_key as keyof typeof SOURCE_SPECS;
+      const spec = SOURCE_SPECS[sourceKey];
+      if (!spec) continue;
+
+      stats.checkpointsProcessed = Number(stats.checkpointsProcessed || 0) + 1;
+
+      await updateCheckpoint(supabase, sourceKey, {
+        sourceType: spec.sourceType,
+        status: 'running',
+        startedAt: new Date().toISOString(),
+        lastError: null
+      });
+
+      try {
+        if (spec.kind === 'json') {
+          const response = await fetchJsonWithMeta(spec.url);
+          await insertSourceDocument(supabase, {
+            sourceKey,
+            sourceType: spec.sourceType,
+            url: spec.url,
+            title: spec.title,
+            summary: JSON.stringify(response.json).slice(0, 2400),
+            announcedTime: toIsoOrNull(response.lastModified) || new Date().toISOString(),
+            httpStatus: response.status,
+            contentType: response.contentType,
+            raw: {
+              etag: response.etag,
+              lastModified: response.lastModified,
+              ok: response.ok
+            },
+            error: response.ok ? null : `http_${response.status}`
+          });
+        } else {
+          const response = await fetchTextWithMeta(spec.url);
+          await insertSourceDocument(supabase, {
+            sourceKey,
+            sourceType: spec.sourceType,
+            url: spec.url,
+            title: spec.title,
+            summary: stripHtml(response.text).slice(0, 2400),
+            announcedTime: toIsoOrNull(response.lastModified) || new Date().toISOString(),
+            httpStatus: response.status,
+            contentType: response.contentType,
+            raw: {
+              etag: response.etag,
+              lastModified: response.lastModified,
+              ok: response.ok
+            },
+            error: response.ok ? null : `http_${response.status}`
+          });
+        }
+
+        await updateCheckpoint(supabase, sourceKey, {
+          sourceType: spec.sourceType,
+          status: 'complete',
+          recordsIngested: Number(checkpoint.records_ingested || 0) + 1,
+          endedAt: new Date().toISOString(),
+          lastAnnouncedTime: new Date().toISOString(),
+          lastError: null
+        });
+
+        stats.checkpointsCompleted = Number(stats.checkpointsCompleted || 0) + 1;
+        stats.sourceDocumentsInserted = Number(stats.sourceDocumentsInserted || 0) + 1;
+      } catch (err) {
+        const message = stringifyError(err);
+        (stats.errors as Array<any>).push({ step: 'source', error: message, sourceKey });
+        await updateCheckpoint(supabase, sourceKey, {
+          sourceType: spec.sourceType,
+          status: 'error',
+          endedAt: new Date().toISOString(),
+          lastError: message
+        }).catch(() => undefined);
+      }
+    }
+
+    const completeNow = await isBootstrapComplete(supabase);
+    await setSystemSetting(supabase, 'artemis_bootstrap_complete', completeNow);
+
+    const ok = (stats.errors as Array<any>).length === 0;
+    await finishIngestionRun(supabase, runId, ok, { ...stats, bootstrapComplete: completeNow }, ok ? undefined : 'partial_failure');
+    return jsonResponse({ ok, elapsedMs: Date.now() - startedAt, stats: { ...stats, bootstrapComplete: completeNow } });
+  } catch (err) {
+    const message = stringifyError(err);
+    (stats.errors as Array<any>).push({ step: 'fatal', error: message });
+    await finishIngestionRun(supabase, runId, false, stats, message);
+    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
+  }
+});
diff --git a/supabase/functions/artemis-budget-ingest/index.ts b/supabase/functions/artemis-budget-ingest/index.ts
new file mode 100644
index 0000000..889cc9b
--- /dev/null
+++ b/supabase/functions/artemis-budget-ingest/index.ts
@@ -0,0 +1,185 @@
+import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
+import { createSupabaseAdminClient } from '../_shared/supabase.ts';
+import { requireJobAuth } from '../_shared/jobAuth.ts';
+import {
+  finishIngestionRun,
+  insertSourceDocument,
+  jsonResponse,
+  readBooleanSetting,
+  startIngestionRun,
+  stringifyError,
+  toIsoOrNull,
+  updateCheckpoint,
+  upsertTimelineEvent
+} from '../_shared/artemisIngest.ts';
+import { ARTEMIS_SOURCE_URLS, fetchTextWithMeta, stripHtml } from '../_shared/artemisSources.ts';
+
+serve(async (req) => {
+  const supabase = createSupabaseAdminClient();
+  const authorized = await requireJobAuth(req, supabase);
+  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);
+
+  const startedAt = Date.now();
+  const { runId } = await startIngestionRun(supabase, 'artemis_budget_ingest');
+
+  const stats: Record<string, unknown> = {
+    sourceDocumentsInserted: 0,
+    budgetLinesUpserted: 0,
+    timelineEventsUpserted: 0,
+    errors: [] as Array<{ step: string; error: string }>
+  };
+
+  try {
+    const enabled = await readBooleanSetting(supabase, 'artemis_budget_job_enabled', true);
+    if (!enabled) {
+      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
+      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
+    }
+
+    await updateCheckpoint(supabase, 'nasa_budget_docs', {
+      sourceType: 'budget',
+      status: 'running',
+      startedAt: new Date().toISOString(),
+      lastError: null
+    });
+
+    const [fy25, fy26] = await Promise.all([
+      fetchTextWithMeta(ARTEMIS_SOURCE_URLS.nasaBudgetSummaryFy25),
+      fetchTextWithMeta(ARTEMIS_SOURCE_URLS.nasaBudgetRequestFy26)
+    ]);
+
+    const fy25DocId = await insertSourceDocument(supabase, {
+      sourceKey: 'nasa_budget_docs',
+      sourceType: 'budget',
+      url: ARTEMIS_SOURCE_URLS.nasaBudgetSummaryFy25,
+      title: 'NASA FY25 Budget Summary',
+      summary: stripHtml(fy25.text).slice(0, 2400),
+      announcedTime: toIsoOrNull(fy25.lastModified) || new Date().toISOString(),
+      httpStatus: fy25.status,
+      contentType: fy25.contentType,
+      raw: { etag: fy25.etag, lastModified: fy25.lastModified }
+    });
+
+    const fy26DocId = await insertSourceDocument(supabase, {
+      sourceKey: 'nasa_budget_docs',
+      sourceType: 'budget',
+      url: ARTEMIS_SOURCE_URLS.nasaBudgetRequestFy26,
+      title: 'NASA FY26 Budget Request',
+      summary: stripHtml(fy26.text).slice(0, 2400),
+      announcedTime: toIsoOrNull(fy26.lastModified) || new Date().toISOString(),
+      httpStatus: fy26.status,
+      contentType: fy26.contentType,
+      raw: { etag: fy26.etag, lastModified: fy26.lastModified }
+    });
+
+    stats.sourceDocumentsInserted = 2;
+
+    const extracted = [
+      ...extractBudgetLines(stripHtml(fy25.text), 2025, fy25DocId),
+      ...extractBudgetLines(stripHtml(fy26.text), 2026, fy26DocId)
+    ];
+
+    if (extracted.length > 0) {
+      const rows = extracted.map((line) => ({
+        fiscal_year: line.fiscalYear,
+        agency: 'NASA',
+        program: line.program,
+        line_item: line.lineItem,
+        amount_requested: line.amount,
+        announced_time: line.announcedTime,
+        source_document_id: line.sourceDocumentId,
+        metadata: line.metadata,
+        updated_at: new Date().toISOString()
+      }));
+
+      const { error } = await supabase.from('artemis_budget_lines').insert(rows);
+      if (error) throw error;
+      stats.budgetLinesUpserted = rows.length;
+    }
+
+    const eventFingerprint = ['budget-refresh', new Date().toISOString().slice(0, 13)].join('|');
+    await upsertTimelineEvent(supabase, {
+      fingerprint: eventFingerprint,
+      missionKey: 'program',
+      title: 'Artemis budget context refreshed',
+      summary: 'Budget source documents and extracted funding lines were refreshed.',
+      eventTime: null,
+      eventTimePrecision: 'unknown',
+      announcedTime: new Date().toISOString(),
+      sourceType: 'budget',
+      confidence: 'secondary',
+      sourceDocumentId: fy26DocId,
+      sourceUrl: ARTEMIS_SOURCE_URLS.nasaBudgetRequestFy26,
+      tags: ['budget']
+    });
+    stats.timelineEventsUpserted = 1;
+
+    await updateCheckpoint(supabase, 'nasa_budget_docs', {
+      sourceType: 'budget',
+      status: 'complete',
+      recordsIngested: Number(stats.budgetLinesUpserted || 0),
+      endedAt: new Date().toISOString(),
+      lastAnnouncedTime: new Date().toISOString(),
+      lastError: null
+    });
+
+    await finishIngestionRun(supabase, runId, true, stats);
+    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAt, stats });
+  } catch (err) {
+    const message = stringifyError(err);
+    (stats.errors as Array<any>).push({ step: 'fatal', error: message });
+
+    await updateCheckpoint(supabase, 'nasa_budget_docs', {
+      sourceType: 'budget',
+      status: 'error',
+      endedAt: new Date().toISOString(),
+      lastError: message
+    }).catch(() => undefined);
+
+    await finishIngestionRun(supabase, runId, false, stats, message);
+    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
+  }
+});
+
+type ParsedBudgetLine = {
+  fiscalYear: number;
+  program: string;
+  lineItem: string;
+  amount: number | null;
+  announcedTime: string;
+  sourceDocumentId: string;
+  metadata: Record<string, unknown>;
+};
+
+function extractBudgetLines(text: string, fiscalYear: number, sourceDocumentId: string): ParsedBudgetLine[] {
+  const rows: ParsedBudgetLine[] = [];
+  const terms = ['Artemis', 'Orion', 'SLS', 'Gateway', 'Exploration Ground Systems', 'Human Landing System'];
+
+  for (const term of terms) {
+    const match = text.match(new RegExp(`([^\\.]{0,180}${term}[^\\.]{0,180})`, 'i'));
+    const snippet = match ? match[1].trim() : `${term} funding line`;
+    const amountMatch = snippet.match(/\$\s?([0-9]+(?:\.[0-9]+)?)\s?(billion|million)/i);
+    const amount = amountMatch ? normalizeMoney(amountMatch[1], amountMatch[2]) : null;
+
+    rows.push({
+      fiscalYear,
+      program: 'Artemis',
+      lineItem: term,
+      amount,
+      announcedTime: new Date().toISOString(),
+      sourceDocumentId,
+      metadata: { snippet }
+    });
+  }
+
+  return rows;
+}
+
+function normalizeMoney(valueRaw: string, unitRaw: string | undefined) {
+  const value = Number(valueRaw);
+  if (!Number.isFinite(value)) return null;
+  const unit = (unitRaw || '').toLowerCase();
+  if (unit === 'billion') return value * 1_000_000_000;
+  if (unit === 'million') return value * 1_000_000;
+  return value;
+}
diff --git a/supabase/functions/artemis-nasa-ingest/index.ts b/supabase/functions/artemis-nasa-ingest/index.ts
new file mode 100644
index 0000000..4386743
--- /dev/null
+++ b/supabase/functions/artemis-nasa-ingest/index.ts
@@ -0,0 +1,227 @@
+import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
+import { createSupabaseAdminClient } from '../_shared/supabase.ts';
+import { requireJobAuth } from '../_shared/jobAuth.ts';
+import {
+  classifyMission,
+  finishIngestionRun,
+  insertSourceDocument,
+  jsonResponse,
+  readBooleanSetting,
+  startIngestionRun,
+  stringifyError,
+  toIsoOrNull,
+  updateCheckpoint,
+  upsertTimelineEvent
+} from '../_shared/artemisIngest.ts';
+import { ARTEMIS_SOURCE_URLS, extractRssItems, fetchTextWithMeta, stripHtml } from '../_shared/artemisSources.ts';
+
+type ArtemisLaunchRow = {
+  launch_id: string;
+  name: string | null;
+  mission_name: string | null;
+  net: string | null;
+  cache_generated_at: string | null;
+  status_name: string | null;
+  status_abbrev: string | null;
+};
+
+serve(async (req) => {
+  const supabase = createSupabaseAdminClient();
+  const authorized = await requireJobAuth(req, supabase);
+  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);
+
+  const startedAt = Date.now();
+  const { runId } = await startIngestionRun(supabase, 'artemis_nasa_ingest');
+
+  const stats: Record<string, unknown> = {
+    sourcesFetched: 0,
+    sourcesFailed: 0,
+    sourceDocumentsInserted: 0,
+    timelineEventsUpserted: 0,
+    launchesConsidered: 0,
+    errors: [] as Array<{ step: string; error: string; context?: Record<string, unknown> }>
+  };
+
+  const sourceKeys = ['nasa_campaign_pages', 'nasa_blog_posts', 'nasa_reference_timelines', 'nasa_rss'] as const;
+
+  try {
+    const enabled = await readBooleanSetting(supabase, 'artemis_nasa_job_enabled', true);
+    if (!enabled) {
+      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
+      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
+    }
+
+    for (const key of sourceKeys) {
+      await updateCheckpoint(supabase, key, {
+        sourceType: 'nasa_primary',
+        status: 'running',
+        startedAt: new Date().toISOString(),
+        lastError: null
+      });
+    }
+
+    const campaign = await fetchTextWithMeta(ARTEMIS_SOURCE_URLS.nasaCampaign);
+    const blog = await fetchTextWithMeta(ARTEMIS_SOURCE_URLS.nasaBlog);
+    const timeline = await fetchTextWithMeta(ARTEMIS_SOURCE_URLS.nasaTimeline);
+    const missionsFeed = await fetchTextWithMeta(ARTEMIS_SOURCE_URLS.nasaMissionsFeed);
+    const blogFeed = await fetchTextWithMeta(ARTEMIS_SOURCE_URLS.nasaBlogFeed);
+
+    const docs: Array<{ id: string; sourceKey: (typeof sourceKeys)[number] }> = [];
+
+    const campaignDocId = await insertSourceDocument(supabase, {
+      sourceKey: 'nasa_campaign_pages',
+      sourceType: 'nasa_primary',
+      url: ARTEMIS_SOURCE_URLS.nasaCampaign,
+      title: 'NASA Artemis Campaign',
+      summary: stripHtml(campaign.text).slice(0, 2400),
+      announcedTime: toIsoOrNull(campaign.lastModified) || new Date().toISOString(),
+      httpStatus: campaign.status,
+      contentType: campaign.contentType,
+      raw: { etag: campaign.etag, lastModified: campaign.lastModified }
+    });
+    docs.push({ id: campaignDocId, sourceKey: 'nasa_campaign_pages' });
+
+    const blogDocId = await insertSourceDocument(supabase, {
+      sourceKey: 'nasa_blog_posts',
+      sourceType: 'nasa_primary',
+      url: ARTEMIS_SOURCE_URLS.nasaBlog,
+      title: 'NASA Artemis Blog',
+      summary: stripHtml(blog.text).slice(0, 2400),
+      announcedTime: toIsoOrNull(blog.lastModified) || new Date().toISOString(),
+      httpStatus: blog.status,
+      contentType: blog.contentType,
+      raw: { etag: blog.etag, lastModified: blog.lastModified }
+    });
+    docs.push({ id: blogDocId, sourceKey: 'nasa_blog_posts' });
+
+    const timelineDocId = await insertSourceDocument(supabase, {
+      sourceKey: 'nasa_reference_timelines',
+      sourceType: 'nasa_primary',
+      url: ARTEMIS_SOURCE_URLS.nasaTimeline,
+      title: 'NASA Artemis I Mission Timeline',
+      summary: stripHtml(timeline.text).slice(0, 2400),
+      announcedTime: toIsoOrNull(timeline.lastModified) || new Date().toISOString(),
+      httpStatus: timeline.status,
+      contentType: timeline.contentType,
+      raw: { etag: timeline.etag, lastModified: timeline.lastModified }
+    });
+    docs.push({ id: timelineDocId, sourceKey: 'nasa_reference_timelines' });
+
+    const mergedRss = [...extractRssItems(missionsFeed.text), ...extractRssItems(blogFeed.text)];
+    const rssDocId = await insertSourceDocument(supabase, {
+      sourceKey: 'nasa_rss',
+      sourceType: 'nasa_primary',
+      url: ARTEMIS_SOURCE_URLS.nasaMissionsFeed,
+      title: 'NASA Artemis RSS Feed Bundle',
+      summary: JSON.stringify(mergedRss.slice(0, 40)).slice(0, 2400),
+      announcedTime: toIsoOrNull(missionsFeed.lastModified) || new Date().toISOString(),
+      httpStatus: missionsFeed.status,
+      contentType: missionsFeed.contentType,
+      raw: {
+        missionsFeedStatus: missionsFeed.status,
+        blogFeedStatus: blogFeed.status,
+        missionsFeedEtag: missionsFeed.etag,
+        blogFeedEtag: blogFeed.etag,
+        itemCount: mergedRss.length
+      }
+    });
+    docs.push({ id: rssDocId, sourceKey: 'nasa_rss' });
+
+    stats.sourcesFetched = 5;
+    stats.sourceDocumentsInserted = docs.length;
+
+    const { data: launches, error: launchesError } = await supabase
+      .from('launches_public_cache')
+      .select('launch_id,name,mission_name,net,cache_generated_at,status_name,status_abbrev')
+      .or('name.ilike.%Artemis%,mission_name.ilike.%Artemis%')
+      .order('net', { ascending: true })
+      .limit(200);
+
+    if (launchesError) throw launchesError;
+
+    const rows = (launches || []) as ArtemisLaunchRow[];
+    stats.launchesConsidered = rows.length;
+
+    let timelineUpserts = 0;
+    for (const launch of rows) {
+      const mission = classifyMission(`${launch.name || ''} ${launch.mission_name || ''}`);
+      const eventTime = toIsoOrNull(launch.net);
+      const announcedTime = toIsoOrNull(launch.cache_generated_at) || new Date().toISOString();
+      const title = launch.name || launch.mission_name || 'Artemis milestone';
+      const summary = `Status: ${launch.status_abbrev || launch.status_name || 'unknown'}.`;
+      const fingerprint = ['nasa', launch.launch_id, eventTime || 'no-time', launch.status_name || 'unknown'].join('|');
+
+      await upsertTimelineEvent(supabase, {
+        fingerprint,
+        missionKey: mission,
+        title,
+        summary,
+        eventTime,
+        eventTimePrecision: eventTime ? 'minute' : 'unknown',
+        announcedTime,
+        sourceType: 'nasa_primary',
+        confidence: 'secondary',
+        sourceDocumentId: campaignDocId,
+        sourceUrl: ARTEMIS_SOURCE_URLS.nasaCampaign,
+        tags: ['launch-feed']
+      });
+      timelineUpserts += 1;
+    }
+
+    for (const item of mergedRss.slice(0, 80)) {
+      const mission = classifyMission(`${item.title} ${item.description}`);
+      const announcedTime = toIsoOrNull(item.pubDate) || new Date().toISOString();
+      if (!item.title) continue;
+      const fingerprint = ['nasa-rss', item.link || item.title, announcedTime].join('|');
+      await upsertTimelineEvent(supabase, {
+        fingerprint,
+        missionKey: mission,
+        title: item.title,
+        summary: item.description || 'NASA Artemis update',
+        eventTime: null,
+        eventTimePrecision: 'unknown',
+        announcedTime,
+        sourceType: 'nasa_primary',
+        confidence: 'primary',
+        sourceDocumentId: rssDocId,
+        sourceUrl: item.link || ARTEMIS_SOURCE_URLS.nasaMissionsFeed,
+        tags: ['rss-update']
+      });
+      timelineUpserts += 1;
+    }
+
+    stats.timelineEventsUpserted = timelineUpserts;
+
+    for (const key of sourceKeys) {
+      const recordCount = key === 'nasa_rss' ? mergedRss.length : rows.length;
+      await updateCheckpoint(supabase, key, {
+        sourceType: 'nasa_primary',
+        status: 'complete',
+        recordsIngested: recordCount,
+        endedAt: new Date().toISOString(),
+        lastAnnouncedTime: new Date().toISOString(),
+        lastEventTime: rows[rows.length - 1]?.net || null,
+        lastError: null
+      });
+    }
+
+    await finishIngestionRun(supabase, runId, true, stats);
+    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAt, stats });
+  } catch (err) {
+    const message = stringifyError(err);
+    (stats.errors as Array<any>).push({ step: 'fatal', error: message });
+    stats.sourcesFailed = Number(stats.sourcesFailed || 0) + 1;
+
+    for (const key of sourceKeys) {
+      await updateCheckpoint(supabase, key, {
+        sourceType: 'nasa_primary',
+        status: 'error',
+        endedAt: new Date().toISOString(),
+        lastError: message
+      }).catch(() => undefined);
+    }
+
+    await finishIngestionRun(supabase, runId, false, stats, message);
+    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
+  }
+});
diff --git a/supabase/functions/artemis-oversight-ingest/index.ts b/supabase/functions/artemis-oversight-ingest/index.ts
new file mode 100644
index 0000000..a3fb8cf
--- /dev/null
+++ b/supabase/functions/artemis-oversight-ingest/index.ts
@@ -0,0 +1,170 @@
+import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
+import { createSupabaseAdminClient } from '../_shared/supabase.ts';
+import { requireJobAuth } from '../_shared/jobAuth.ts';
+import {
+  classifyMission,
+  finishIngestionRun,
+  insertSourceDocument,
+  jsonResponse,
+  readBooleanSetting,
+  startIngestionRun,
+  stringifyError,
+  toIsoOrNull,
+  updateCheckpoint,
+  upsertTimelineEvent
+} from '../_shared/artemisIngest.ts';
+import { ARTEMIS_SOURCE_URLS, extractRssItems, fetchTextWithMeta, stripHtml } from '../_shared/artemisSources.ts';
+
+serve(async (req) => {
+  const supabase = createSupabaseAdminClient();
+  const authorized = await requireJobAuth(req, supabase);
+  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);
+
+  const startedAt = Date.now();
+  const { runId } = await startIngestionRun(supabase, 'artemis_oversight_ingest');
+  const stats: Record<string, unknown> = {
+    sourcesFetched: 0,
+    sourceDocumentsInserted: 0,
+    timelineEventsUpserted: 0,
+    blockedSources: 0,
+    errors: [] as Array<{ step: string; error: string }>
+  };
+
+  const checkpoints = [
+    { key: 'oig_reports', type: 'oversight' as const },
+    { key: 'gao_reports', type: 'oversight' as const }
+  ];
+
+  try {
+    const enabled = await readBooleanSetting(supabase, 'artemis_oversight_job_enabled', true);
+    if (!enabled) {
+      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
+      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
+    }
+
+    for (const entry of checkpoints) {
+      await updateCheckpoint(supabase, entry.key, {
+        sourceType: entry.type,
+        status: 'running',
+        startedAt: new Date().toISOString(),
+        lastError: null
+      });
+    }
+
+    const oigAudits = await fetchTextWithMeta(ARTEMIS_SOURCE_URLS.oigAudits);
+    const oigFeed = await fetchTextWithMeta(ARTEMIS_SOURCE_URLS.oigFeed);
+    const gaoSearch = await fetchTextWithMeta(ARTEMIS_SOURCE_URLS.gaoArtemisQuery);
+
+    const oigDocId = await insertSourceDocument(supabase, {
+      sourceKey: 'oig_reports',
+      sourceType: 'oversight',
+      url: ARTEMIS_SOURCE_URLS.oigAudits,
+      title: 'NASA OIG Audits',
+      summary: stripHtml(oigAudits.text).slice(0, 2400),
+      announcedTime: toIsoOrNull(oigAudits.lastModified) || new Date().toISOString(),
+      httpStatus: oigAudits.status,
+      contentType: oigAudits.contentType,
+      raw: { etag: oigAudits.etag, lastModified: oigAudits.lastModified }
+    });
+
+    const oigFeedItems = extractRssItems(oigFeed.text).filter((item) => /artemis|orion|sls|gateway|lunar/i.test(`${item.title} ${item.description}`));
+    let upsertCount = 0;
+    for (const item of oigFeedItems.slice(0, 60)) {
+      if (!item.title) continue;
+      const fingerprint = ['oig', item.link || item.title, item.pubDate || 'no-date'].join('|');
+      await upsertTimelineEvent(supabase, {
+        fingerprint,
+        missionKey: classifyMission(`${item.title} ${item.description}`),
+        title: item.title,
+        summary: item.description || 'NASA OIG update',
+        eventTime: null,
+        eventTimePrecision: 'unknown',
+        announcedTime: toIsoOrNull(item.pubDate) || new Date().toISOString(),
+        sourceType: 'oversight',
+        confidence: 'oversight',
+        sourceDocumentId: oigDocId,
+        sourceUrl: item.link || ARTEMIS_SOURCE_URLS.oigFeed,
+        tags: ['oig']
+      });
+      upsertCount += 1;
+    }
+
+    let gaoError: string | null = null;
+    if (!gaoSearch.ok) {
+      gaoError = `gao_http_${gaoSearch.status}`;
+      stats.blockedSources = Number(stats.blockedSources || 0) + 1;
+    }
+
+    const gaoDocId = await insertSourceDocument(supabase, {
+      sourceKey: 'gao_reports',
+      sourceType: 'oversight',
+      url: ARTEMIS_SOURCE_URLS.gaoArtemisQuery,
+      title: 'GAO Artemis Search',
+      summary: stripHtml(gaoSearch.text).slice(0, 2400),
+      announcedTime: toIsoOrNull(gaoSearch.lastModified) || new Date().toISOString(),
+      httpStatus: gaoSearch.status,
+      contentType: gaoSearch.contentType,
+      raw: { etag: gaoSearch.etag, lastModified: gaoSearch.lastModified },
+      error: gaoError
+    });
+
+    if (!gaoError) {
+      const fingerprint = ['gao', gaoDocId, new Date().toISOString().slice(0, 13)].join('|');
+      await upsertTimelineEvent(supabase, {
+        fingerprint,
+        missionKey: 'program',
+        title: 'GAO Artemis oversight update',
+        summary: 'GAO coverage refreshed for Artemis-related reports.',
+        eventTime: null,
+        eventTimePrecision: 'unknown',
+        announcedTime: new Date().toISOString(),
+        sourceType: 'oversight',
+        confidence: 'oversight',
+        sourceDocumentId: gaoDocId,
+        sourceUrl: ARTEMIS_SOURCE_URLS.gaoArtemisQuery,
+        tags: ['gao']
+      });
+      upsertCount += 1;
+    }
+
+    stats.sourcesFetched = 3;
+    stats.sourceDocumentsInserted = 2;
+    stats.timelineEventsUpserted = upsertCount;
+
+    await updateCheckpoint(supabase, 'oig_reports', {
+      sourceType: 'oversight',
+      status: 'complete',
+      recordsIngested: oigFeedItems.length,
+      endedAt: new Date().toISOString(),
+      lastAnnouncedTime: oigFeedItems[0]?.pubDate ? toIsoOrNull(oigFeedItems[0].pubDate) : new Date().toISOString(),
+      lastError: null
+    });
+
+    await updateCheckpoint(supabase, 'gao_reports', {
+      sourceType: 'oversight',
+      status: gaoError ? 'error' : 'complete',
+      recordsIngested: gaoError ? 0 : 1,
+      endedAt: new Date().toISOString(),
+      lastError: gaoError
+    });
+
+    const ok = !gaoError;
+    await finishIngestionRun(supabase, runId, ok, stats, gaoError || undefined);
+    return jsonResponse({ ok, elapsedMs: Date.now() - startedAt, stats, gaoError });
+  } catch (err) {
+    const message = stringifyError(err);
+    (stats.errors as Array<any>).push({ step: 'fatal', error: message });
+
+    for (const entry of checkpoints) {
+      await updateCheckpoint(supabase, entry.key, {
+        sourceType: entry.type,
+        status: 'error',
+        endedAt: new Date().toISOString(),
+        lastError: message
+      }).catch(() => undefined);
+    }
+
+    await finishIngestionRun(supabase, runId, false, stats, message);
+    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
+  }
+});
diff --git a/supabase/functions/artemis-procurement-ingest/index.ts b/supabase/functions/artemis-procurement-ingest/index.ts
new file mode 100644
index 0000000..b71b8bc
--- /dev/null
+++ b/supabase/functions/artemis-procurement-ingest/index.ts
@@ -0,0 +1,209 @@
+import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
+import { createSupabaseAdminClient } from '../_shared/supabase.ts';
+import { requireJobAuth } from '../_shared/jobAuth.ts';
+import {
+  finishIngestionRun,
+  insertSourceDocument,
+  jsonResponse,
+  readBooleanSetting,
+  startIngestionRun,
+  stringifyError,
+  toIsoOrNull,
+  updateCheckpoint,
+  upsertTimelineEvent
+} from '../_shared/artemisIngest.ts';
+import { ARTEMIS_SOURCE_URLS, fetchJsonWithMeta } from '../_shared/artemisSources.ts';
+
+serve(async (req) => {
+  const supabase = createSupabaseAdminClient();
+  const authorized = await requireJobAuth(req, supabase);
+  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);
+
+  const startedAt = Date.now();
+  const { runId } = await startIngestionRun(supabase, 'artemis_procurement_ingest');
+  const stats: Record<string, unknown> = {
+    sourceDocumentsInserted: 0,
+    awardsInserted: 0,
+    timelineEventsUpserted: 0,
+    errors: [] as Array<{ step: string; error: string }>
+  };
+
+  try {
+    const enabled = await readBooleanSetting(supabase, 'artemis_procurement_job_enabled', true);
+    if (!enabled) {
+      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
+      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
+    }
+
+    await updateCheckpoint(supabase, 'usaspending_awards', {
+      sourceType: 'procurement',
+      status: 'running',
+      startedAt: new Date().toISOString(),
+      lastError: null
+    });
+
+    const [agencies, awardsSearch] = await Promise.all([
+      fetchJsonWithMeta(ARTEMIS_SOURCE_URLS.usaspendingTopTier),
+      fetchUsaSpendingAwards()
+    ]);
+
+    const sourceDocId = await insertSourceDocument(supabase, {
+      sourceKey: 'usaspending_awards',
+      sourceType: 'procurement',
+      url: 'https://api.usaspending.gov/api/v2/search/spending_by_award/',
+      title: 'USASpending Artemis Award Search',
+      summary: JSON.stringify({ agenciesStatus: agencies.status, awardsStatus: awardsSearch.status }).slice(0, 2400),
+      announcedTime: new Date().toISOString(),
+      httpStatus: awardsSearch.status,
+      contentType: awardsSearch.contentType,
+      raw: {
+        agencies: agencies.json,
+        awards: awardsSearch.json
+      }
+    });
+
+    stats.sourceDocumentsInserted = 1;
+
+    const awards = extractAwards(awardsSearch.json);
+    if (awards.length > 0) {
+      const rows = awards.map((award) => ({
+        usaspending_award_id: award.id,
+        award_title: award.title,
+        recipient: award.recipient,
+        obligated_amount: award.amount,
+        awarded_on: award.date,
+        mission_key: award.missionKey,
+        source_document_id: sourceDocId,
+        metadata: award.metadata,
+        updated_at: new Date().toISOString()
+      }));
+
+      const { error } = await supabase.from('artemis_procurement_awards').upsert(rows, { onConflict: 'usaspending_award_id,mission_key' });
+      if (error) throw error;
+      stats.awardsInserted = rows.length;
+    }
+
+    await upsertTimelineEvent(supabase, {
+      fingerprint: ['procurement-refresh', new Date().toISOString().slice(0, 13)].join('|'),
+      missionKey: 'program',
+      title: 'Artemis procurement data refreshed',
+      summary: 'USASpending award and obligation data was refreshed for Artemis context.',
+      eventTime: null,
+      eventTimePrecision: 'unknown',
+      announcedTime: new Date().toISOString(),
+      sourceType: 'procurement',
+      confidence: 'secondary',
+      sourceDocumentId: sourceDocId,
+      sourceUrl: 'https://api.usaspending.gov/docs/',
+      tags: ['procurement']
+    });
+    stats.timelineEventsUpserted = 1;
+
+    await updateCheckpoint(supabase, 'usaspending_awards', {
+      sourceType: 'procurement',
+      status: 'complete',
+      recordsIngested: Number(stats.awardsInserted || 0),
+      endedAt: new Date().toISOString(),
+      lastAnnouncedTime: new Date().toISOString(),
+      lastError: null
+    });
+
+    await finishIngestionRun(supabase, runId, true, stats);
+    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAt, stats });
+  } catch (err) {
+    const message = stringifyError(err);
+    (stats.errors as Array<any>).push({ step: 'fatal', error: message });
+
+    await updateCheckpoint(supabase, 'usaspending_awards', {
+      sourceType: 'procurement',
+      status: 'error',
+      endedAt: new Date().toISOString(),
+      lastError: message
+    }).catch(() => undefined);
+
+    await finishIngestionRun(supabase, runId, false, stats, message);
+    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
+  }
+});
+
+async function fetchUsaSpendingAwards() {
+  const url = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';
+  const response = await fetch(url, {
+    method: 'POST',
+    headers: {
+      'Content-Type': 'application/json'
+    },
+    body: JSON.stringify({
+      filters: {
+        agencies: [{ type: 'awarding', tier: 'toptier', name: 'National Aeronautics and Space Administration' }],
+        keyword: 'Artemis'
+      },
+      fields: ['Award ID', 'Recipient Name', 'Award Amount', 'Start Date', 'Description'],
+      page: 1,
+      limit: 25,
+      sort: 'Award Amount',
+      order: 'desc'
+    })
+  });
+
+  const text = await response.text();
+  let json: unknown = null;
+  try {
+    json = text ? JSON.parse(text) : null;
+  } catch {
+    json = null;
+  }
+
+  return {
+    ok: response.ok,
+    status: response.status,
+    contentType: response.headers.get('content-type'),
+    etag: response.headers.get('etag'),
+    lastModified: toIsoOrNull(response.headers.get('last-modified')),
+    json,
+    text
+  };
+}
+
+type AwardRecord = {
+  id: string;
+  title: string;
+  recipient: string;
+  amount: number | null;
+  date: string | null;
+  missionKey: 'program' | 'artemis-i' | 'artemis-ii' | 'artemis-iii';
+  metadata: Record<string, unknown>;
+};
+
+function extractAwards(payload: unknown): AwardRecord[] {
+  if (!payload || typeof payload !== 'object') return [];
+  const rows = Array.isArray((payload as any).results) ? (payload as any).results : [];
+
+  return rows.slice(0, 25).map((row: any, index: number) => {
+    const title = String(row?.Description || row?.['Description'] || row?.['Award ID'] || `Artemis award ${index + 1}`).trim();
+    const recipient = String(row?.['Recipient Name'] || row?.recipient || 'Unknown recipient').trim();
+    const id = String(row?.['Award ID'] || row?.generated_unique_award_id || `${recipient}-${index + 1}`).trim();
+    const amountRaw = row?.['Award Amount'] ?? row?.award_amount;
+    const amount = Number.isFinite(Number(amountRaw)) ? Number(amountRaw) : null;
+    const dateRaw = row?.['Start Date'] || row?.period_of_performance_start_date || null;
+    const date = typeof dateRaw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateRaw) ? dateRaw.slice(0, 10) : null;
+
+    return {
+      id,
+      title,
+      recipient,
+      amount,
+      date,
+      missionKey: classifyMissionKey(title),
+      metadata: row || {}
+    };
+  });
+}
+
+function classifyMissionKey(text: string): 'program' | 'artemis-i' | 'artemis-ii' | 'artemis-iii' {
+  const value = text.toLowerCase();
+  if (/\bartemis\s*(ii|2)\b/.test(value)) return 'artemis-ii';
+  if (/\bartemis\s*(iii|3)\b/.test(value)) return 'artemis-iii';
+  if (/\bartemis\s*(i|1)\b/.test(value)) return 'artemis-i';
+  return 'program';
+}
diff --git a/supabase/functions/artemis-snapshot-build/index.ts b/supabase/functions/artemis-snapshot-build/index.ts
new file mode 100644
index 0000000..146d9d5
--- /dev/null
+++ b/supabase/functions/artemis-snapshot-build/index.ts
@@ -0,0 +1,142 @@
+import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
+import { createSupabaseAdminClient } from '../_shared/supabase.ts';
+import { requireJobAuth } from '../_shared/jobAuth.ts';
+import {
+  finishIngestionRun,
+  jsonResponse,
+  readBooleanSetting,
+  setSystemSetting,
+  startIngestionRun,
+  stringifyError,
+  toIsoOrNull,
+  updateCheckpoint
+} from '../_shared/artemisIngest.ts';
+
+type MissionKey = 'program' | 'artemis-i' | 'artemis-ii' | 'artemis-iii';
+
+serve(async (req) => {
+  const supabase = createSupabaseAdminClient();
+  const authorized = await requireJobAuth(req, supabase);
+  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);
+
+  const startedAt = Date.now();
+  const { runId } = await startIngestionRun(supabase, 'artemis_snapshot_build');
+  const stats: Record<string, unknown> = {
+    snapshotsUpserted: 0,
+    timelineEventsUsed: 0,
+    launchesUsed: 0,
+    bootstrapComplete: false,
+    errors: [] as Array<{ step: string; error: string }>
+  };
+
+  try {
+    const enabled = await readBooleanSetting(supabase, 'artemis_snapshot_job_enabled', true);
+    if (!enabled) {
+      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
+      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
+    }
+
+    const { data: timelineRows, error: timelineError } = await supabase
+      .from('artemis_timeline_events')
+      .select('id, mission_key, title, summary, event_time, announced_time, source_type, confidence, supersedes_event_id, source_url, tags, metadata')
+      .order('announced_time', { ascending: false })
+      .limit(1200);
+    if (timelineError) throw timelineError;
+
+    const { data: launchRows, error: launchError } = await supabase
+      .from('launches_public_cache')
+      .select('launch_id, name, mission_name, net, status_name, status_abbrev, provider, vehicle, pad_name, pad_location_name')
+      .or('name.ilike.%Artemis%,mission_name.ilike.%Artemis%')
+      .order('net', { ascending: true })
+      .limit(240);
+    if (launchError) throw launchError;
+
+    const allTimeline = Array.isArray(timelineRows) ? timelineRows : [];
+    const allLaunches = Array.isArray(launchRows) ? launchRows : [];
+
+    stats.timelineEventsUsed = allTimeline.length;
+    stats.launchesUsed = allLaunches.length;
+
+    const missionKeys: MissionKey[] = ['program', 'artemis-i', 'artemis-ii', 'artemis-iii'];
+    const nowIso = new Date().toISOString();
+
+    for (const missionKey of missionKeys) {
+      const missionEvents = allTimeline.filter((row) => row.mission_key === missionKey || (missionKey === 'program' && row.mission_key !== null));
+      const missionLaunches = allLaunches.filter((row) => classifyMissionKey(`${row.name || ''} ${row.mission_name || ''}`) === missionKey || missionKey === 'program');
+
+      const nextLaunch = missionLaunches.find((row) => {
+        const netMs = Date.parse(String(row.net || ''));
+        return Number.isFinite(netMs) && netMs >= Date.now();
+      }) || null;
+
+      const lastUpdated = missionEvents.reduce<string | null>((latest, row) => {
+        const current = toIsoOrNull(row.announced_time);
+        if (!current) return latest;
+        if (!latest) return current;
+        return Date.parse(current) > Date.parse(latest) ? current : latest;
+      }, null);
+
+      const snapshot = {
+        missionKey,
+        generatedAt: nowIso,
+        lastUpdated,
+        eventCount: missionEvents.length,
+        launchCount: missionLaunches.length,
+        nextLaunch,
+        recentEvents: missionEvents.slice(0, 40)
+      };
+
+      const { error } = await supabase.from('artemis_mission_snapshots').upsert(
+        {
+          mission_key: missionKey,
+          generated_at: nowIso,
+          last_updated: lastUpdated,
+          snapshot,
+          updated_at: nowIso
+        },
+        { onConflict: 'mission_key' }
+      );
+      if (error) throw error;
+      stats.snapshotsUpserted = Number(stats.snapshotsUpserted || 0) + 1;
+    }
+
+    const bootstrapComplete = await evaluateBootstrapComplete(supabase);
+    stats.bootstrapComplete = bootstrapComplete;
+    await setSystemSetting(supabase, 'artemis_bootstrap_complete', bootstrapComplete);
+
+    await updateCheckpoint(supabase, 'nasa_campaign_pages', {
+      sourceType: 'nasa_primary',
+      status: bootstrapComplete ? 'complete' : 'running',
+      metadata: {
+        snapshotBuildAt: nowIso,
+        bootstrapComplete
+      }
+    }).catch(() => undefined);
+
+    await finishIngestionRun(supabase, runId, true, stats);
+    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAt, stats });
+  } catch (err) {
+    const message = stringifyError(err);
+    (stats.errors as Array<any>).push({ step: 'fatal', error: message });
+    await finishIngestionRun(supabase, runId, false, stats, message);
+    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
+  }
+});
+
+async function evaluateBootstrapComplete(supabase: ReturnType<typeof createSupabaseAdminClient>) {
+  const { data, error } = await supabase
+    .from('artemis_ingest_checkpoints')
+    .select('status')
+    .neq('status', 'complete')
+    .limit(1);
+  if (error) throw error;
+  return !data || data.length === 0;
+}
+
+function classifyMissionKey(text: string): MissionKey {
+  const value = text.toLowerCase();
+  if (/\bartemis\s*(ii|2)\b/.test(value)) return 'artemis-ii';
+  if (/\bartemis\s*(iii|3)\b/.test(value)) return 'artemis-iii';
+  if (/\bartemis\s*(i|1)\b/.test(value)) return 'artemis-i';
+  return 'program';
+}
diff --git a/supabase/migrations/0148_artemis_core.sql b/supabase/migrations/0148_artemis_core.sql
new file mode 100644
index 0000000..e76d623
--- /dev/null
+++ b/supabase/migrations/0148_artemis_core.sql
@@ -0,0 +1,211 @@
+-- Artemis program data model for timeline/evidence UI and ingestion jobs.
+
+create table if not exists public.artemis_source_documents (
+  id uuid primary key default gen_random_uuid(),
+  source_key text not null,
+  source_type text not null,
+  url text not null,
+  title text,
+  published_at timestamptz,
+  announced_time timestamptz,
+  fetched_at timestamptz not null default now(),
+  http_status int,
+  etag text,
+  last_modified timestamptz,
+  sha256 text,
+  bytes int,
+  content_type text,
+  summary text,
+  raw jsonb,
+  parse_version text not null default 'v1',
+  error text,
+  created_at timestamptz not null default now(),
+  updated_at timestamptz not null default now(),
+  unique (url, sha256)
+);
+
+create index if not exists artemis_source_documents_source_key_idx on public.artemis_source_documents(source_key);
+create index if not exists artemis_source_documents_source_type_idx on public.artemis_source_documents(source_type);
+create index if not exists artemis_source_documents_fetched_at_idx on public.artemis_source_documents(fetched_at desc);
+
+create table if not exists public.artemis_entities (
+  id uuid primary key default gen_random_uuid(),
+  entity_key text not null unique,
+  name text not null,
+  entity_type text not null,
+  description text,
+  related_missions text[] not null default '{}'::text[],
+  metadata jsonb not null default '{}'::jsonb,
+  created_at timestamptz not null default now(),
+  updated_at timestamptz not null default now()
+);
+
+create index if not exists artemis_entities_type_idx on public.artemis_entities(entity_type);
+
+create table if not exists public.artemis_timeline_events (
+  id uuid primary key default gen_random_uuid(),
+  mission_key text not null,
+  title text not null,
+  summary text,
+  event_time timestamptz,
+  event_time_precision text not null default 'unknown',
+  announced_time timestamptz not null,
+  source_type text not null,
+  confidence text not null,
+  source_document_id uuid not null references public.artemis_source_documents(id) on delete cascade,
+  source_url text,
+  supersedes_event_id uuid references public.artemis_timeline_events(id) on delete set null,
+  is_superseded boolean not null default false,
+  fingerprint text not null unique,
+  tags text[] not null default '{}'::text[],
+  metadata jsonb not null default '{}'::jsonb,
+  created_at timestamptz not null default now(),
+  updated_at timestamptz not null default now(),
+  constraint artemis_timeline_events_mission_key_check check (mission_key in ('program', 'artemis-i', 'artemis-ii', 'artemis-iii')),
+  constraint artemis_timeline_events_source_type_check check (source_type in ('nasa_primary', 'oversight', 'budget', 'procurement', 'technical', 'media')),
+  constraint artemis_timeline_events_confidence_check check (confidence in ('primary', 'oversight', 'secondary'))
+);
+
+create index if not exists artemis_timeline_events_mission_time_idx on public.artemis_timeline_events(mission_key, event_time desc nulls last);
+create index if not exists artemis_timeline_events_announced_time_idx on public.artemis_timeline_events(announced_time desc);
+create index if not exists artemis_timeline_events_source_type_idx on public.artemis_timeline_events(source_type);
+create index if not exists artemis_timeline_events_supersedes_idx on public.artemis_timeline_events(supersedes_event_id);
+
+create table if not exists public.artemis_budget_lines (
+  id uuid primary key default gen_random_uuid(),
+  fiscal_year int,
+  agency text,
+  program text,
+  line_item text,
+  amount_requested numeric,
+  amount_enacted numeric,
+  announced_time timestamptz,
+  source_document_id uuid references public.artemis_source_documents(id) on delete set null,
+  metadata jsonb not null default '{}'::jsonb,
+  created_at timestamptz not null default now(),
+  updated_at timestamptz not null default now()
+);
+
+create index if not exists artemis_budget_lines_fiscal_year_idx on public.artemis_budget_lines(fiscal_year desc);
+create index if not exists artemis_budget_lines_program_idx on public.artemis_budget_lines(program);
+
+create table if not exists public.artemis_procurement_awards (
+  id uuid primary key default gen_random_uuid(),
+  usaspending_award_id text,
+  award_title text,
+  recipient text,
+  obligated_amount numeric,
+  awarded_on date,
+  mission_key text,
+  source_document_id uuid references public.artemis_source_documents(id) on delete set null,
+  metadata jsonb not null default '{}'::jsonb,
+  created_at timestamptz not null default now(),
+  updated_at timestamptz not null default now(),
+  unique (usaspending_award_id, mission_key),
+  constraint artemis_procurement_awards_mission_key_check check (mission_key in ('program', 'artemis-i', 'artemis-ii', 'artemis-iii'))
+);
+
+create index if not exists artemis_procurement_awards_awarded_on_idx on public.artemis_procurement_awards(awarded_on desc);
+
+create table if not exists public.artemis_mission_snapshots (
+  mission_key text primary key,
+  generated_at timestamptz not null default now(),
+  last_updated timestamptz,
+  snapshot jsonb not null,
+  updated_at timestamptz not null default now(),
+  constraint artemis_mission_snapshots_mission_key_check check (mission_key in ('program', 'artemis-i', 'artemis-ii', 'artemis-iii'))
+);
+
+alter table public.artemis_source_documents enable row level security;
+alter table public.artemis_entities enable row level security;
+alter table public.artemis_timeline_events enable row level security;
+alter table public.artemis_budget_lines enable row level security;
+alter table public.artemis_procurement_awards enable row level security;
+alter table public.artemis_mission_snapshots enable row level security;
+
+do $$
+begin
+  if not exists (
+    select 1 from pg_policies where schemaname = 'public' and tablename = 'artemis_source_documents' and policyname = 'admin read artemis source documents'
+  ) then
+    create policy "admin read artemis source documents" on public.artemis_source_documents
+      for select using (public.is_admin());
+  end if;
+
+  if not exists (
+    select 1 from pg_policies where schemaname = 'public' and tablename = 'artemis_source_documents' and policyname = 'service role manage artemis source documents'
+  ) then
+    create policy "service role manage artemis source documents" on public.artemis_source_documents
+      for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
+  end if;
+
+  if not exists (
+    select 1 from pg_policies where schemaname = 'public' and tablename = 'artemis_entities' and policyname = 'public read artemis entities'
+  ) then
+    create policy "public read artemis entities" on public.artemis_entities
+      for select using (true);
+  end if;
+
+  if not exists (
+    select 1 from pg_policies where schemaname = 'public' and tablename = 'artemis_entities' and policyname = 'service role manage artemis entities'
+  ) then
+    create policy "service role manage artemis entities" on public.artemis_entities
+      for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
+  end if;
+
+  if not exists (
+    select 1 from pg_policies where schemaname = 'public' and tablename = 'artemis_timeline_events' and policyname = 'public read artemis timeline events'
+  ) then
+    create policy "public read artemis timeline events" on public.artemis_timeline_events
+      for select using (true);
+  end if;
+
+  if not exists (
+    select 1 from pg_policies where schemaname = 'public' and tablename = 'artemis_timeline_events' and policyname = 'service role manage artemis timeline events'
+  ) then
+    create policy "service role manage artemis timeline events" on public.artemis_timeline_events
+      for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
+  end if;
+
+  if not exists (
+    select 1 from pg_policies where schemaname = 'public' and tablename = 'artemis_budget_lines' and policyname = 'public read artemis budget lines'
+  ) then
+    create policy "public read artemis budget lines" on public.artemis_budget_lines
+      for select using (true);
+  end if;
+
+  if not exists (
+    select 1 from pg_policies where schemaname = 'public' and tablename = 'artemis_budget_lines' and policyname = 'service role manage artemis budget lines'
+  ) then
+    create policy "service role manage artemis budget lines" on public.artemis_budget_lines
+      for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
+  end if;
+
+  if not exists (
+    select 1 from pg_policies where schemaname = 'public' and tablename = 'artemis_procurement_awards' and policyname = 'public read artemis procurement awards'
+  ) then
+    create policy "public read artemis procurement awards" on public.artemis_procurement_awards
+      for select using (true);
+  end if;
+
+  if not exists (
+    select 1 from pg_policies where schemaname = 'public' and tablename = 'artemis_procurement_awards' and policyname = 'service role manage artemis procurement awards'
+  ) then
+    create policy "service role manage artemis procurement awards" on public.artemis_procurement_awards
+      for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
+  end if;
+
+  if not exists (
+    select 1 from pg_policies where schemaname = 'public' and tablename = 'artemis_mission_snapshots' and policyname = 'public read artemis mission snapshots'
+  ) then
+    create policy "public read artemis mission snapshots" on public.artemis_mission_snapshots
+      for select using (true);
+  end if;
+
+  if not exists (
+    select 1 from pg_policies where schemaname = 'public' and tablename = 'artemis_mission_snapshots' and policyname = 'service role manage artemis mission snapshots'
+  ) then
+    create policy "service role manage artemis mission snapshots" on public.artemis_mission_snapshots
+      for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
+  end if;
+end $$;
diff --git a/supabase/migrations/0149_artemis_bootstrap_state.sql b/supabase/migrations/0149_artemis_bootstrap_state.sql
new file mode 100644
index 0000000..0995252
--- /dev/null
+++ b/supabase/migrations/0149_artemis_bootstrap_state.sql
@@ -0,0 +1,94 @@
+-- Artemis bootstrap checkpointing and job schedules.
+
+create table if not exists public.artemis_ingest_checkpoints (
+  source_key text primary key,
+  source_type text not null,
+  status text not null default 'pending',
+  cursor text,
+  records_ingested bigint not null default 0,
+  last_announced_time timestamptz,
+  last_event_time timestamptz,
+  started_at timestamptz,
+  ended_at timestamptz,
+  last_error text,
+  metadata jsonb not null default '{}'::jsonb,
+  updated_at timestamptz not null default now(),
+  constraint artemis_ingest_checkpoints_status_check check (status in ('pending', 'running', 'complete', 'error'))
+);
+
+alter table public.artemis_ingest_checkpoints enable row level security;
+
+do $$
+begin
+  if not exists (
+    select 1 from pg_policies where schemaname = 'public' and tablename = 'artemis_ingest_checkpoints' and policyname = 'admin read artemis ingest checkpoints'
+  ) then
+    create policy "admin read artemis ingest checkpoints" on public.artemis_ingest_checkpoints
+      for select using (public.is_admin());
+  end if;
+
+  if not exists (
+    select 1 from pg_policies where schemaname = 'public' and tablename = 'artemis_ingest_checkpoints' and policyname = 'service role manage artemis ingest checkpoints'
+  ) then
+    create policy "service role manage artemis ingest checkpoints" on public.artemis_ingest_checkpoints
+      for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
+  end if;
+end $$;
+
+insert into public.artemis_ingest_checkpoints (source_key, source_type)
+values
+  ('nasa_campaign_pages', 'nasa_primary'),
+  ('nasa_blog_posts', 'nasa_primary'),
+  ('nasa_reference_timelines', 'nasa_primary'),
+  ('nasa_rss', 'nasa_primary'),
+  ('oig_reports', 'oversight'),
+  ('gao_reports', 'oversight'),
+  ('moon_to_mars_docs', 'technical'),
+  ('ntrs_api', 'technical'),
+  ('techport_api', 'technical'),
+  ('nasa_budget_docs', 'budget'),
+  ('usaspending_awards', 'procurement'),
+  ('nasa_media_assets', 'media')
+on conflict (source_key) do nothing;
+
+insert into public.system_settings (key, value)
+values
+  ('artemis_bootstrap_required', 'true'::jsonb),
+  ('artemis_bootstrap_complete', 'false'::jsonb),
+  ('artemis_bootstrap_job_enabled', 'true'::jsonb),
+  ('artemis_nasa_job_enabled', 'true'::jsonb),
+  ('artemis_nasa_poll_interval_minutes', '60'::jsonb),
+  ('artemis_oversight_job_enabled', 'true'::jsonb),
+  ('artemis_budget_job_enabled', 'true'::jsonb),
+  ('artemis_procurement_job_enabled', 'true'::jsonb),
+  ('artemis_snapshot_job_enabled', 'true'::jsonb)
+on conflict (key) do nothing;
+
+do $$
+begin
+  if exists (select 1 from cron.job where jobname = 'artemis_bootstrap') then
+    perform cron.unschedule('artemis_bootstrap');
+  end if;
+  if exists (select 1 from cron.job where jobname = 'artemis_nasa_ingest') then
+    perform cron.unschedule('artemis_nasa_ingest');
+  end if;
+  if exists (select 1 from cron.job where jobname = 'artemis_oversight_ingest') then
+    perform cron.unschedule('artemis_oversight_ingest');
+  end if;
+  if exists (select 1 from cron.job where jobname = 'artemis_budget_ingest') then
+    perform cron.unschedule('artemis_budget_ingest');
+  end if;
+  if exists (select 1 from cron.job where jobname = 'artemis_procurement_ingest') then
+    perform cron.unschedule('artemis_procurement_ingest');
+  end if;
+  if exists (select 1 from cron.job where jobname = 'artemis_snapshot_build') then
+    perform cron.unschedule('artemis_snapshot_build');
+  end if;
+
+  perform cron.schedule('artemis_bootstrap', '*/15 * * * *', $job$select public.invoke_edge_job('artemis-bootstrap');$job$);
+  perform cron.schedule('artemis_nasa_ingest', '7 * * * *', $job$select public.invoke_edge_job('artemis-nasa-ingest');$job$);
+  perform cron.schedule('artemis_oversight_ingest', '35 */12 * * *', $job$select public.invoke_edge_job('artemis-oversight-ingest');$job$);
+  perform cron.schedule('artemis_budget_ingest', '50 2 * * *', $job$select public.invoke_edge_job('artemis-budget-ingest');$job$);
+  perform cron.schedule('artemis_procurement_ingest', '15 3 * * *', $job$select public.invoke_edge_job('artemis-procurement-ingest');$job$);
+  perform cron.schedule('artemis_snapshot_build', '20 * * * *', $job$select public.invoke_edge_job('artemis-snapshot-build');$job$);
+end $$;
```

## Commit `cbbe672`

```text
commit cbbe672f26069cd35a34eda409649b91f2fff627
Author:     joshwill85 <168236617+joshwill85@users.noreply.github.com>
AuthorDate: Thu Feb 5 20:13:45 2026 -0500
Commit:     joshwill85 <168236617+joshwill85@users.noreply.github.com>
CommitDate: Thu Feb 5 20:13:45 2026 -0500

    Implement AR trajectory precision v2 (trajectory-only)
```

### Files

```text
A	app/api/admin/trajectory/contract/[id]/route.ts
M	app/api/public/ar/telemetry/session/route.ts
A	app/api/public/launches/[id]/trajectory/v2/route.ts
M	app/launches/[id]/ar/page.tsx
M	components/ar/ArSession.tsx
M	lib/ar/telemetryClient.ts
M	supabase/functions/navcen-bnm-ingest/index.ts
M	supabase/functions/trajectory-constraints-ingest/index.ts
M	supabase/functions/trajectory-orbit-ingest/index.ts
M	supabase/functions/trajectory-products-generate/index.ts
A	supabase/migrations/0150_trajectory_source_contracts_lineage.sql
A	supabase/migrations/0151_trajectory_adaptive_job_cadence.sql
```

### Full Patch (+/-)

```diff
diff --git a/app/api/admin/trajectory/contract/[id]/route.ts b/app/api/admin/trajectory/contract/[id]/route.ts
new file mode 100644
index 0000000..46389af
--- /dev/null
+++ b/app/api/admin/trajectory/contract/[id]/route.ts
@@ -0,0 +1,415 @@
+import { NextResponse } from 'next/server';
+import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
+import { isSupabaseConfigured } from '@/lib/server/env';
+import { parseLaunchParam } from '@/lib/utils/launchParams';
+
+export const dynamic = 'force-dynamic';
+
+type ContractRow = {
+  id: number;
+  launch_id: string;
+  product_version: string;
+  contract_version: string;
+  confidence_tier: 'A' | 'B' | 'C' | 'D';
+  status: 'pass' | 'fail';
+  source_sufficiency: unknown;
+  required_fields: unknown;
+  missing_fields: string[];
+  blocking_reasons: string[];
+  freshness_state: 'fresh' | 'stale' | 'unknown';
+  lineage_complete: boolean;
+  evaluated_at: string;
+  ingestion_run_id: number | null;
+  created_at: string;
+  updated_at: string;
+};
+
+type LineageRow = {
+  source_ref_id: string;
+  source: string;
+  source_id: string | null;
+  source_kind: string | null;
+  source_url: string | null;
+  confidence: number | null;
+  fetched_at: string | null;
+  generated_at: string;
+  extracted_field_map: unknown;
+};
+
+type FieldDiagnostic = {
+  field: string;
+  pass: boolean;
+  missing: boolean;
+  sufficiency: boolean | null;
+  reason: 'ok' | 'missing_field' | 'source_sufficiency_fail';
+};
+
+const SUFFICIENCY_BOOL_KEYS = ['pass', 'ok', 'available', 'present', 'sufficient', 'met', 'complete'] as const;
+
+function asObject(value: unknown): Record<string, unknown> | null {
+  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
+  return value as Record<string, unknown>;
+}
+
+function normalizeFieldPath(path: string): string {
+  return path
+    .trim()
+    .replace(/\[(\d+)\]/g, '.$1')
+    .replace(/\.{2,}/g, '.')
+    .replace(/^\./, '')
+    .replace(/\.$/, '')
+    .toLowerCase();
+}
+
+function flattenRequiredFieldPaths(value: unknown): string[] {
+  const out = new Set<string>();
+
+  const visit = (node: unknown, prefix: string) => {
+    if (typeof node === 'boolean') {
+      if (node && prefix) out.add(prefix);
+      return;
+    }
+
+    if (Array.isArray(node)) {
+      node.forEach((item, index) => {
+        const next = prefix ? `${prefix}[${index}]` : `[${index}]`;
+        visit(item, next);
+      });
+      return;
+    }
+
+    const obj = asObject(node);
+    if (!obj) return;
+
+    if (typeof obj.required === 'boolean' && obj.required && prefix) {
+      out.add(prefix);
+    }
+
+    for (const [key, child] of Object.entries(obj)) {
+      if (key === 'required') continue;
+      const next = prefix ? `${prefix}.${key}` : key;
+      visit(child, next);
+    }
+  };
+
+  visit(value, '');
+  return Array.from(out);
+}
+
+function collectSufficiencySignals(value: unknown): Array<{ path: string; pass: boolean }> {
+  const out = new Map<string, boolean>();
+
+  const mergeSignal = (path: string, pass: boolean) => {
+    const prev = out.get(path);
+    if (prev == null) {
+      out.set(path, pass);
+      return;
+    }
+    out.set(path, prev && pass);
+  };
+
+  const visit = (node: unknown, prefix: string) => {
+    if (typeof node === 'boolean') {
+      if (prefix) mergeSignal(prefix, node);
+      return;
+    }
+
+    if (Array.isArray(node)) {
+      node.forEach((item, index) => {
+        const next = prefix ? `${prefix}[${index}]` : `[${index}]`;
+        visit(item, next);
+      });
+      return;
+    }
+
+    const obj = asObject(node);
+    if (!obj) return;
+
+    const boolValues = SUFFICIENCY_BOOL_KEYS
+      .map((key) => (typeof obj[key] === 'boolean' ? (obj[key] as boolean) : null))
+      .filter((value): value is boolean => value != null);
+
+    if (prefix && boolValues.length) {
+      mergeSignal(prefix, boolValues.every(Boolean));
+    }
+
+    for (const [key, child] of Object.entries(obj)) {
+      if (SUFFICIENCY_BOOL_KEYS.includes(key as (typeof SUFFICIENCY_BOOL_KEYS)[number])) continue;
+      const next = prefix ? `${prefix}.${key}` : key;
+      visit(child, next);
+    }
+  };
+
+  visit(value, '');
+  return Array.from(out.entries()).map(([path, pass]) => ({ path, pass }));
+}
+
+function flattenExtractedFieldPaths(value: unknown): string[] {
+  const out = new Set<string>();
+
+  const visit = (node: unknown, prefix: string) => {
+    if (node == null) return;
+
+    if (Array.isArray(node)) {
+      node.forEach((item, index) => {
+        const next = prefix ? `${prefix}[${index}]` : `[${index}]`;
+        visit(item, next);
+      });
+      return;
+    }
+
+    const obj = asObject(node);
+    if (obj) {
+      for (const [key, child] of Object.entries(obj)) {
+        const next = prefix ? `${prefix}.${key}` : key;
+        visit(child, next);
+      }
+      return;
+    }
+
+    if (prefix) out.add(prefix);
+  };
+
+  visit(value, '');
+  return Array.from(out);
+}
+
+function fieldMatchesExtractedPaths(normalizedField: string, extracted: Set<string>): boolean {
+  if (!normalizedField) return false;
+  if (extracted.has(normalizedField)) return true;
+
+  for (const path of extracted) {
+    if (path.endsWith(`.${normalizedField}`)) return true;
+    if (normalizedField.endsWith(`.${path}`)) return true;
+  }
+
+  const tail = normalizedField.split('.').filter(Boolean).pop();
+  if (!tail) return false;
+  for (const path of extracted) {
+    if (path === tail || path.endsWith(`.${tail}`)) return true;
+  }
+
+  return false;
+}
+
+export async function GET(_: Request, { params }: { params: { id: string } }) {
+  const parsed = parseLaunchParam(params.id);
+  if (!parsed) return NextResponse.json({ error: 'invalid_launch_id' }, { status: 400 });
+
+  if (!isSupabaseConfigured()) {
+    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 501 });
+  }
+
+  const supabase = createSupabaseServerClient();
+  const {
+    data: { user }
+  } = await supabase.auth.getUser();
+
+  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
+
+  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).maybeSingle();
+  if (profile?.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
+
+  const { data: contract, error: contractError } = await supabase
+    .from('trajectory_source_contracts')
+    .select(
+      'id, launch_id, product_version, contract_version, confidence_tier, status, source_sufficiency, required_fields, missing_fields, blocking_reasons, freshness_state, lineage_complete, evaluated_at, ingestion_run_id, created_at, updated_at'
+    )
+    .eq('launch_id', parsed.launchId)
+    .order('evaluated_at', { ascending: false })
+    .limit(1)
+    .maybeSingle();
+
+  if (contractError) {
+    console.error('trajectory contract fetch failed', contractError);
+    return NextResponse.json({ error: 'contract_fetch_failed' }, { status: 500 });
+  }
+
+  if (!contract) {
+    return NextResponse.json({ error: 'contract_not_found' }, { status: 404 });
+  }
+
+  const { data: lineageRows, error: lineageError } = await supabase
+    .from('trajectory_product_lineage')
+    .select(
+      'source_ref_id, source, source_id, source_kind, source_url, confidence, fetched_at, generated_at, extracted_field_map'
+    )
+    .eq('launch_id', parsed.launchId)
+    .eq('product_version', contract.product_version)
+    .lte('generated_at', contract.evaluated_at)
+    .order('generated_at', { ascending: false })
+    .limit(200);
+
+  if (lineageError) {
+    console.error('trajectory lineage fetch failed', lineageError);
+    return NextResponse.json({ error: 'lineage_fetch_failed' }, { status: 500 });
+  }
+
+  const contractRow = contract as ContractRow;
+  const lineage = ((lineageRows ?? []) as LineageRow[]).map((row) => ({
+    row,
+    extractedFieldPaths: new Set(flattenExtractedFieldPaths(row.extracted_field_map).map((path) => normalizeFieldPath(path)).filter(Boolean))
+  }));
+
+  const requiredRaw = flattenRequiredFieldPaths(contractRow.required_fields);
+  const missingRaw = Array.isArray(contractRow.missing_fields)
+    ? contractRow.missing_fields.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
+    : [];
+  const sufficiencySignalsRaw = collectSufficiencySignals(contractRow.source_sufficiency);
+
+  const displayByNorm = new Map<string, string>();
+  const requiredNorm = new Set<string>();
+  const missingNorm = new Set<string>();
+  const sufficiencyByNorm = new Map<string, boolean>();
+
+  for (const field of requiredRaw) {
+    const normalized = normalizeFieldPath(field);
+    if (!normalized) continue;
+    requiredNorm.add(normalized);
+    if (!displayByNorm.has(normalized)) displayByNorm.set(normalized, field);
+  }
+
+  for (const field of missingRaw) {
+    const normalized = normalizeFieldPath(field);
+    if (!normalized) continue;
+    missingNorm.add(normalized);
+    requiredNorm.add(normalized);
+    if (!displayByNorm.has(normalized)) displayByNorm.set(normalized, field);
+  }
+
+  for (const signal of sufficiencySignalsRaw) {
+    const normalized = normalizeFieldPath(signal.path);
+    if (!normalized) continue;
+    const prev = sufficiencyByNorm.get(normalized);
+    const next = prev == null ? signal.pass : prev && signal.pass;
+    sufficiencyByNorm.set(normalized, next);
+    if (!displayByNorm.has(normalized)) displayByNorm.set(normalized, signal.path);
+    if (!next) requiredNorm.add(normalized);
+  }
+
+  const allFieldNorm = Array.from(requiredNorm).sort((a, b) => {
+    const left = displayByNorm.get(a) ?? a;
+    const right = displayByNorm.get(b) ?? b;
+    return left.localeCompare(right);
+  });
+
+  const fieldDiagnostics: FieldDiagnostic[] = allFieldNorm.map((fieldNorm) => {
+    const missing = missingNorm.has(fieldNorm);
+    const sufficiency = sufficiencyByNorm.get(fieldNorm);
+    const pass = !missing && sufficiency !== false;
+
+    return {
+      field: displayByNorm.get(fieldNorm) ?? fieldNorm,
+      pass,
+      missing,
+      sufficiency: sufficiency ?? null,
+      reason: missing ? 'missing_field' : sufficiency === false ? 'source_sufficiency_fail' : 'ok'
+    };
+  });
+
+  const failingFieldNorm = allFieldNorm.filter((fieldNorm) => {
+    const missing = missingNorm.has(fieldNorm);
+    const sufficiency = sufficiencyByNorm.get(fieldNorm);
+    return missing || sufficiency === false;
+  });
+
+  const missingSourceDetails = failingFieldNorm.map((fieldNorm) => {
+    const matchingLineage = lineage.filter((entry) => fieldMatchesExtractedPaths(fieldNorm, entry.extractedFieldPaths));
+
+    const sourceRefIds = Array.from(
+      new Set(
+        matchingLineage
+          .map((entry) => entry.row.source_ref_id)
+          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
+      )
+    ).slice(0, 8);
+
+    const sourceHints = Array.from(
+      new Set(
+        matchingLineage
+          .map((entry) => {
+            const source = typeof entry.row.source === 'string' ? entry.row.source.trim() : '';
+            const sourceId = typeof entry.row.source_id === 'string' ? entry.row.source_id.trim() : '';
+            if (source && sourceId) return `${source}:${sourceId}`;
+            return source || sourceId;
+          })
+          .filter((value) => value.length > 0)
+      )
+    ).slice(0, 8);
+
+    const sourceUrls = Array.from(
+      new Set(
+        matchingLineage
+          .map((entry) => entry.row.source_url)
+          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
+      )
+    ).slice(0, 4);
+
+    return {
+      field: displayByNorm.get(fieldNorm) ?? fieldNorm,
+      sourceRefIds,
+      sourceHints,
+      sourceUrls,
+      detail: sourceRefIds.length > 0 ? 'candidate_sources_found' : 'no_candidate_sources_found'
+    };
+  });
+
+  const passCount = fieldDiagnostics.filter((field) => field.pass).length;
+  const failCount = fieldDiagnostics.length - passCount;
+
+  return NextResponse.json(
+    {
+      launchId: parsed.launchId,
+      generatedAt: new Date().toISOString(),
+      contract: {
+        id: contractRow.id,
+        launchId: contractRow.launch_id,
+        productVersion: contractRow.product_version,
+        contractVersion: contractRow.contract_version,
+        confidenceTier: contractRow.confidence_tier,
+        status: contractRow.status,
+        sourceSufficiency: contractRow.source_sufficiency,
+        requiredFields: contractRow.required_fields,
+        missingFields: missingRaw,
+        blockingReasons: Array.isArray(contractRow.blocking_reasons) ? contractRow.blocking_reasons : [],
+        freshnessState: contractRow.freshness_state,
+        lineageComplete: Boolean(contractRow.lineage_complete),
+        evaluatedAt: contractRow.evaluated_at,
+        ingestionRunId: contractRow.ingestion_run_id,
+        createdAt: contractRow.created_at,
+        updatedAt: contractRow.updated_at
+      },
+      diagnostics: {
+        summary: {
+          status: contractRow.status,
+          confidenceTier: contractRow.confidence_tier,
+          freshnessState: contractRow.freshness_state,
+          lineageComplete: Boolean(contractRow.lineage_complete),
+          requiredFieldCount: fieldDiagnostics.length,
+          passCount,
+          failCount,
+          missingFieldCount: missingRaw.length,
+          blockingReasonCount: Array.isArray(contractRow.blocking_reasons) ? contractRow.blocking_reasons.length : 0
+        },
+        fields: fieldDiagnostics,
+        missingSources: missingSourceDetails
+      },
+      lineage: {
+        sourceCount: lineage.length,
+        sourceRefIds: Array.from(
+          new Set(
+            lineage
+              .map((entry) => entry.row.source_ref_id)
+              .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
+          )
+        ).slice(0, 40),
+        latestGeneratedAt: lineage.length ? lineage[0].row.generated_at : null
+      }
+    },
+    {
+      headers: {
+        'Cache-Control': 'private, no-store'
+      }
+    }
+  );
+}
diff --git a/app/api/public/ar/telemetry/session/route.ts b/app/api/public/ar/telemetry/session/route.ts
index 3f1261f..90f2fc0 100644
--- a/app/api/public/ar/telemetry/session/route.ts
+++ b/app/api/public/ar/telemetry/session/route.ts
@@ -87,7 +87,11 @@ const bodySchema = z.object({
     trajectoryVersion: z.string().max(64).optional(),
     durationS: z.number().int().min(0).max(7200).optional(),
     stepS: z.number().int().min(0).max(120).optional(),
-    avgSigmaDeg: z.number().min(0).max(90).optional()
+    avgSigmaDeg: z.number().min(0).max(90).optional(),
+    confidenceTierSeen: z.enum(['A', 'B', 'C', 'D']).optional(),
+    contractTier: z.enum(['A', 'B', 'C', 'D']).optional(),
+    renderTier: z.enum(['high', 'medium', 'low', 'unknown']).optional(),
+    droppedFrameBucket: z.string().max(32).optional()
   })
 });
 
@@ -209,7 +213,11 @@ export async function POST(request: Request) {
     trajectory_version: p.trajectoryVersion,
     trajectory_duration_s: p.durationS,
     trajectory_step_s: p.stepS,
-    avg_sigma_deg: p.avgSigmaDeg
+    avg_sigma_deg: p.avgSigmaDeg,
+    confidence_tier_seen: p.confidenceTierSeen,
+    contract_tier: p.contractTier,
+    render_tier: p.renderTier,
+    dropped_frame_bucket: p.droppedFrameBucket
   };
 
   if (p.endedAt) row.ended_at = p.endedAt;
diff --git a/app/api/public/launches/[id]/trajectory/v2/route.ts b/app/api/public/launches/[id]/trajectory/v2/route.ts
new file mode 100644
index 0000000..bed4e54
--- /dev/null
+++ b/app/api/public/launches/[id]/trajectory/v2/route.ts
@@ -0,0 +1,237 @@
+import { NextResponse } from 'next/server';
+import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
+import { parseLaunchParam } from '@/lib/utils/launchParams';
+import { fetchArEligibleLaunches } from '@/lib/server/arEligibility';
+import { getViewerTier } from '@/lib/server/viewerTier';
+
+export const dynamic = 'force-dynamic';
+
+type ConfidenceTier = 'A' | 'B' | 'C' | 'D';
+type FreshnessState = 'fresh' | 'stale' | 'unknown';
+type TrackKind = 'core_up' | 'booster_down';
+type MilestoneConfidence = 'low' | 'med' | 'high';
+
+type TrackSample = {
+  tPlusSec: number;
+  ecef: [number, number, number];
+  sigmaDeg?: number;
+};
+
+type TrackPayload = {
+  trackKind: TrackKind;
+  samples: TrackSample[];
+};
+
+type MilestonePayload = {
+  key: string;
+  tPlusSec: number;
+  label: string;
+  sourceRefIds: string[];
+  confidence?: MilestoneConfidence;
+};
+
+function asObject(value: unknown): Record<string, unknown> | null {
+  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
+  return value as Record<string, unknown>;
+}
+
+function asConfidenceTier(value: unknown): ConfidenceTier | null {
+  if (value === 'A' || value === 'B' || value === 'C' || value === 'D') return value;
+  return null;
+}
+
+function asFreshnessState(value: unknown): FreshnessState | null {
+  if (value === 'fresh' || value === 'stale' || value === 'unknown') return value;
+  return null;
+}
+
+function asMilestoneConfidence(value: unknown): MilestoneConfidence | undefined {
+  if (value === 'low' || value === 'med' || value === 'high') return value;
+  if (typeof value === 'number' && Number.isFinite(value)) {
+    if (value >= 0.85) return 'high';
+    if (value >= 0.45) return 'med';
+    if (value >= 0) return 'low';
+  }
+  return undefined;
+}
+
+function normalizeTrackKind(raw: unknown): TrackKind {
+  if (typeof raw === 'string') {
+    const value = raw.trim().toLowerCase();
+    if (value === 'booster_down' || value === 'booster-down' || value === 'boosterdown') return 'booster_down';
+    if (value === 'core_up' || value === 'core-up' || value === 'coreup') return 'core_up';
+    if (value.includes('booster') && value.includes('down')) return 'booster_down';
+  }
+  return 'core_up';
+}
+
+function normalizeEcef(value: unknown): [number, number, number] | null {
+  if (!Array.isArray(value) || value.length < 3) return null;
+  const x = Number(value[0]);
+  const y = Number(value[1]);
+  const z = Number(value[2]);
+  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
+  return [x, y, z];
+}
+
+function normalizeSample(raw: unknown): TrackSample | null {
+  const sample = asObject(raw);
+  if (!sample) return null;
+  const tPlusSec = Number(sample.tPlusSec);
+  const ecef = normalizeEcef(sample.ecef);
+  if (!Number.isFinite(tPlusSec) || tPlusSec < 0 || !ecef) return null;
+
+  const sigmaRaw = sample.sigmaDeg;
+  const sigmaDeg = typeof sigmaRaw === 'number' && Number.isFinite(sigmaRaw) ? sigmaRaw : undefined;
+
+  return {
+    tPlusSec,
+    ecef,
+    sigmaDeg
+  };
+}
+
+function normalizeSamples(rawSamples: unknown): TrackSample[] {
+  if (!Array.isArray(rawSamples)) return [];
+  return rawSamples
+    .map((sample) => normalizeSample(sample))
+    .filter((sample): sample is TrackSample => sample != null)
+    .sort((a, b) => a.tPlusSec - b.tPlusSec);
+}
+
+function normalizeSourceRefIds(raw: unknown): string[] {
+  if (!Array.isArray(raw)) return [];
+  const refs = raw
+    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
+    .filter((entry) => entry.length > 0);
+  return Array.from(new Set(refs));
+}
+
+function normalizeTracks(product: Record<string, unknown> | null): TrackPayload[] {
+  if (!product) return [];
+
+  const rawTracks = product.tracks;
+  if (Array.isArray(rawTracks)) {
+    const tracks = rawTracks
+      .map((rawTrack) => {
+        const track = asObject(rawTrack);
+        if (!track) return null;
+        const samples = normalizeSamples(track.samples);
+        if (samples.length === 0) return null;
+        return {
+          trackKind: normalizeTrackKind(track.trackKind ?? track.track_kind),
+          samples
+        } satisfies TrackPayload;
+      })
+      .filter((track): track is TrackPayload => track != null);
+
+    if (tracks.length > 0) return tracks;
+  }
+
+  const fallbackSamples = normalizeSamples(product.samples);
+  if (fallbackSamples.length === 0) return [];
+  return [{ trackKind: 'core_up', samples: fallbackSamples }];
+}
+
+function normalizeMilestones(product: Record<string, unknown> | null): MilestonePayload[] {
+  if (!product) return [];
+
+  const milestoneSource = Array.isArray(product.milestones) ? product.milestones : product.events;
+  if (!Array.isArray(milestoneSource)) return [];
+
+  const milestones: MilestonePayload[] = [];
+  for (let index = 0; index < milestoneSource.length; index += 1) {
+    const rawMilestone = milestoneSource[index];
+    const milestone = asObject(rawMilestone);
+    if (!milestone) continue;
+    const tPlusSec = Number(milestone.tPlusSec);
+    if (!Number.isFinite(tPlusSec) || tPlusSec < 0) continue;
+
+    const keyRaw = typeof milestone.key === 'string' ? milestone.key.trim() : '';
+    const labelRaw = typeof milestone.label === 'string' ? milestone.label.trim() : '';
+    const key = keyRaw || labelRaw || `milestone_${index}`;
+    const label = labelRaw || key;
+
+    milestones.push({
+      key,
+      tPlusSec,
+      label,
+      sourceRefIds: normalizeSourceRefIds(milestone.sourceRefIds ?? milestone.source_ref_ids),
+      confidence: asMilestoneConfidence(milestone.confidence)
+    });
+  }
+
+  milestones.sort((a, b) => a.tPlusSec - b.tPlusSec);
+
+  const seen = new Set<string>();
+  return milestones.filter((milestone) => {
+    const key = `${milestone.key}:${milestone.tPlusSec}`;
+    if (seen.has(key)) return false;
+    seen.add(key);
+    return true;
+  });
+}
+
+export async function GET(_: Request, { params }: { params: { id: string } }) {
+  const parsed = parseLaunchParam(params.id);
+  if (!parsed) return NextResponse.json({ error: 'invalid_launch_id' }, { status: 400 });
+
+  const viewer = await getViewerTier();
+  if (!viewer.isAuthed) {
+    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
+  }
+  if (viewer.tier !== 'premium') {
+    return NextResponse.json({ error: 'payment_required' }, { status: 402 });
+  }
+
+  const nowMs = Date.now();
+  const eligible = await fetchArEligibleLaunches({ nowMs });
+  if (!eligible.some((entry) => entry.launchId === parsed.launchId)) {
+    return NextResponse.json({ error: 'not_eligible' }, { status: 404 });
+  }
+
+  const supabase = createSupabaseServerClient();
+  const { data, error } = await supabase
+    .from('launch_trajectory_products')
+    .select(
+      'launch_id, version, quality, generated_at, product, confidence_tier, source_sufficiency, freshness_state, lineage_complete'
+    )
+    .eq('launch_id', parsed.launchId)
+    .maybeSingle();
+
+  if (error) {
+    console.error('trajectory v2 product fetch error', error);
+    return NextResponse.json({ error: 'trajectory_fetch_failed' }, { status: 500 });
+  }
+
+  if (!data) {
+    return NextResponse.json({ error: 'trajectory_not_found' }, { status: 404 });
+  }
+
+  const product = asObject(data.product);
+  const tracks = normalizeTracks(product);
+  const milestones = normalizeMilestones(product);
+
+  return NextResponse.json(
+    {
+      launchId: data.launch_id,
+      version: data.version,
+      quality: data.quality,
+      generatedAt: data.generated_at,
+      confidenceTier: asConfidenceTier(data.confidence_tier),
+      sourceSufficiency: asObject(data.source_sufficiency),
+      freshnessState: asFreshnessState(data.freshness_state),
+      lineageComplete: Boolean(data.lineage_complete),
+      tracks,
+      milestones,
+      // Keep legacy payload available for clients still reading product directly.
+      product: data.product
+    },
+    {
+      headers: {
+        // Premium-gated data; do not allow shared caching.
+        'Cache-Control': 'no-store'
+      }
+    }
+  );
+}
diff --git a/app/launches/[id]/ar/page.tsx b/app/launches/[id]/ar/page.tsx
index 2697e4c..2fd309b 100644
--- a/app/launches/[id]/ar/page.tsx
+++ b/app/launches/[id]/ar/page.tsx
@@ -10,6 +10,19 @@ import { ArSession } from '@/components/ar/ArSession';
 
 export const dynamic = 'force-dynamic';
 
+type ConfidenceTier = 'A' | 'B' | 'C' | 'D';
+type FreshnessState = 'fresh' | 'stale' | 'unknown';
+
+function asConfidenceTier(value: unknown): ConfidenceTier | null {
+  if (value === 'A' || value === 'B' || value === 'C' || value === 'D') return value;
+  return null;
+}
+
+function asFreshnessState(value: unknown): FreshnessState | null {
+  if (value === 'fresh' || value === 'stale' || value === 'unknown') return value;
+  return null;
+}
+
 export default async function LaunchArPage({ params }: { params: { id: string } }) {
   const parsed = parseLaunchParam(params.id);
   if (!parsed) return notFound();
@@ -36,7 +49,7 @@ export default async function LaunchArPage({ params }: { params: { id: string }
 
   const { data: trajectory } = await supabase
     .from('launch_trajectory_products')
-    .select('version, quality, generated_at, product')
+    .select('version, quality, generated_at, product, confidence_tier, source_sufficiency, freshness_state, lineage_complete')
     .eq('launch_id', launch.id)
     .maybeSingle();
 
@@ -55,6 +68,16 @@ export default async function LaunchArPage({ params }: { params: { id: string }
               version: trajectory.version,
               quality: trajectory.quality,
               generatedAt: trajectory.generated_at,
+              confidenceTier: asConfidenceTier(trajectory.confidence_tier),
+              sourceSufficiency:
+                trajectory.source_sufficiency &&
+                typeof trajectory.source_sufficiency === 'object' &&
+                !Array.isArray(trajectory.source_sufficiency)
+                  ? trajectory.source_sufficiency
+                  : null,
+              freshnessState: asFreshnessState(trajectory.freshness_state),
+              lineageComplete: Boolean(trajectory.lineage_complete),
+              contractTier: asConfidenceTier(trajectory.confidence_tier),
               product: trajectory.product
             }
           : null
diff --git a/components/ar/ArSession.tsx b/components/ar/ArSession.tsx
index 2541378..7f350e0 100644
--- a/components/ar/ArSession.tsx
+++ b/components/ar/ArSession.tsx
@@ -26,6 +26,11 @@ type ArSessionProps = {
     version: string;
     quality: number;
     generatedAt: string;
+    confidenceTier?: 'A' | 'B' | 'C' | 'D' | null;
+    sourceSufficiency?: Record<string, unknown> | null;
+    freshnessState?: 'fresh' | 'stale' | 'unknown' | null;
+    lineageComplete?: boolean | null;
+    contractTier?: 'A' | 'B' | 'C' | 'D' | null;
     product: {
       qualityLabel?: 'pad_only' | 'landing_constrained' | 'estimate_corridor';
       assumptions?: string[];
@@ -47,6 +52,13 @@ type HeadingSource =
 type FovSource = 'xr' | 'preset' | 'saved' | 'inferred' | 'default' | 'unknown';
 type XrErrorBucket = 'not_available' | 'unsupported' | 'webgl' | 'permission' | 'session_error' | 'unknown';
 type FusionFallbackReason = 'disabled' | 'no_gyro' | 'no_gravity' | 'gravity_unreliable' | 'not_initialized';
+type TrajectoryConfidenceTier = 'A' | 'B' | 'C' | 'D';
+type RenderTier = 'high' | 'medium' | 'low' | 'unknown';
+type FrameStats = {
+  lastFrameAtMs: number | null;
+  frames: number;
+  dropped: number;
+};
 
 const AR_MOTION_PERMISSION_SESSION_KEY = 'ar:motionPermission';
 
@@ -66,6 +78,51 @@ function bucketPoseUpdateHz(hz: number) {
   return '60+';
 }
 
+function bucketDroppedFrameRatio(ratio: number) {
+  if (!Number.isFinite(ratio) || ratio < 0) return 'unknown';
+  if (ratio < 0.01) return '0..1';
+  if (ratio < 0.05) return '1..5';
+  if (ratio < 0.15) return '5..15';
+  if (ratio < 0.3) return '15..30';
+  return '30+';
+}
+
+function droppedFrameRatioFromStats(stats: FrameStats) {
+  const total = stats.frames + stats.dropped;
+  if (total <= 0) return Number.NaN;
+  return stats.dropped / total;
+}
+
+function inferRenderTier({
+  poseSource,
+  cameraStatus,
+  motionStatus,
+  headingStatus,
+  renderLoopRunning,
+  droppedFrameRatio
+}: {
+  poseSource: PoseSource;
+  cameraStatus: 'granted' | 'denied' | 'prompt' | 'error';
+  motionStatus: 'granted' | 'denied' | 'prompt' | 'error';
+  headingStatus: 'ok' | 'unavailable' | 'noisy' | 'unknown';
+  renderLoopRunning: boolean;
+  droppedFrameRatio: number;
+}): RenderTier {
+  if (!renderLoopRunning) return 'unknown';
+  if (poseSource === 'sky_compass') return 'low';
+  if (poseSource === 'webxr') {
+    if (!Number.isFinite(droppedFrameRatio) || droppedFrameRatio <= 0.05) return 'high';
+    if (droppedFrameRatio <= 0.2) return 'medium';
+    return 'low';
+  }
+
+  if (cameraStatus !== 'granted' || motionStatus !== 'granted') return 'low';
+  if (headingStatus === 'noisy' || headingStatus === 'unavailable') return 'low';
+  if (!Number.isFinite(droppedFrameRatio)) return headingStatus === 'ok' ? 'medium' : 'unknown';
+  if (droppedFrameRatio <= 0.1) return 'medium';
+  return 'low';
+}
+
 function bucketXrError(message: string | null): XrErrorBucket | undefined {
   if (!message) return undefined;
   const m = message.toLowerCase();
@@ -361,6 +418,11 @@ export function ArSession({ launchId, launchName, pad, net, backHref, trajectory
   const lastNonSkyPoseSourceRef = useRef<Exclude<PoseSource, 'sky_compass' | 'webxr'>>('deviceorientation');
   const telemetryRenderLoopRunningRef = useRef(false);
   const telemetryCanvasHiddenRef = useRef(false);
+  const telemetryFrameStatsRef = useRef<FrameStats>({
+    lastFrameAtMs: null,
+    frames: 0,
+    dropped: 0
+  });
   const poseUpdateStatsRef = useRef({
     count: 0,
     firstAtMs: null as number | null,
@@ -394,7 +456,11 @@ export function ArSession({ launchId, launchName, pad, net, backHref, trajectory
     trajectoryVersion: undefined as string | undefined,
     durationSec: 0,
     stepS: undefined as number | undefined,
-    avgSigmaDeg: undefined as number | undefined
+    avgSigmaDeg: undefined as number | undefined,
+    confidenceTierSeen: undefined as TrajectoryConfidenceTier | undefined,
+    contractTier: undefined as TrajectoryConfidenceTier | undefined,
+    renderTier: 'unknown' as RenderTier,
+    droppedFrameBucket: undefined as string | undefined
   });
 
 	  const clientEnvForUi = useMemo(() => detectClientEnv(typeof navigator !== 'undefined' ? navigator.userAgent : ''), []);
@@ -2042,6 +2108,17 @@ export function ArSession({ launchId, launchName, pad, net, backHref, trajectory
   }, [trajectory]);
 
   useEffect(() => {
+    const droppedFrameRatio = droppedFrameRatioFromStats(telemetryFrameStatsRef.current);
+    const droppedFrameBucket = bucketDroppedFrameRatio(droppedFrameRatio);
+    const renderTier = inferRenderTier({
+      poseSource,
+      cameraStatus,
+      motionStatus,
+      headingStatus,
+      renderLoopRunning: telemetryRenderLoopRunningRef.current,
+      droppedFrameRatio
+    });
+
     telemetrySnapshotRef.current.cameraError = cameraError;
     telemetrySnapshotRef.current.motionPermission = motionPermission;
     telemetrySnapshotRef.current.adjustedHeading = adjustedHeading;
@@ -2077,6 +2154,10 @@ export function ArSession({ launchId, launchName, pad, net, backHref, trajectory
     telemetrySnapshotRef.current.durationSec = durationSec;
     telemetrySnapshotRef.current.stepS = trajectoryStepS ?? undefined;
     telemetrySnapshotRef.current.avgSigmaDeg = avgSigmaDeg ?? undefined;
+    telemetrySnapshotRef.current.confidenceTierSeen = trajectory?.confidenceTier ?? undefined;
+    telemetrySnapshotRef.current.contractTier = trajectory?.contractTier ?? trajectory?.confidenceTier ?? undefined;
+    telemetrySnapshotRef.current.renderTier = renderTier;
+    telemetrySnapshotRef.current.droppedFrameBucket = droppedFrameBucket;
   }, [
     adjustedHeading,
     avgSigmaDeg,
@@ -2094,6 +2175,8 @@ export function ArSession({ launchId, launchName, pad, net, backHref, trajectory
     poseSource,
     retryCount,
     trajectory?.quality,
+    trajectory?.confidenceTier,
+    trajectory?.contractTier,
     trajectory?.version,
     trajectoryStepS,
     xrActive,
@@ -2129,6 +2212,16 @@ export function ArSession({ launchId, launchName, pad, net, backHref, trajectory
               const hz = stats.count / (elapsedMs / 1000);
               return bucketPoseUpdateHz(hz);
             })();
+    const droppedFrameRatio = droppedFrameRatioFromStats(telemetryFrameStatsRef.current);
+    const droppedFrameBucket = bucketDroppedFrameRatio(droppedFrameRatio);
+    const renderTier = inferRenderTier({
+      poseSource,
+      cameraStatus,
+      motionStatus,
+      headingStatus,
+      renderLoopRunning: telemetryRenderLoopRunningRef.current,
+      droppedFrameRatio
+    });
 
     telemetryPost('start', {
       sessionId,
@@ -2172,7 +2265,11 @@ export function ArSession({ launchId, launchName, pad, net, backHref, trajectory
       trajectoryVersion: trajectory?.version,
       durationS: durationSec,
       stepS: trajectoryStepS ?? undefined,
-      avgSigmaDeg: avgSigmaDeg ?? undefined
+      avgSigmaDeg: avgSigmaDeg ?? undefined,
+      confidenceTierSeen: telemetrySnapshotRef.current.confidenceTierSeen,
+      contractTier: telemetrySnapshotRef.current.contractTier,
+      renderTier,
+      droppedFrameBucket
     });
   }, [
     avgSigmaDeg,
@@ -2250,6 +2347,16 @@ export function ArSession({ launchId, launchName, pad, net, backHref, trajectory
                 const hz = stats.count / (elapsedMs / 1000);
                 return bucketPoseUpdateHz(hz);
               })();
+      const droppedFrameRatio = droppedFrameRatioFromStats(telemetryFrameStatsRef.current);
+      const droppedFrameBucket = bucketDroppedFrameRatio(droppedFrameRatio);
+      const renderTier = inferRenderTier({
+        poseSource: snapshot.poseSource,
+        cameraStatus: snapshot.cameraStatus,
+        motionStatus: snapshot.motionStatus,
+        headingStatus: snapshot.headingStatus,
+        renderLoopRunning: telemetryRenderLoopRunningRef.current,
+        droppedFrameRatio
+      });
 
       telemetryPostBeacon('end', {
         sessionId,
@@ -2292,7 +2399,11 @@ export function ArSession({ launchId, launchName, pad, net, backHref, trajectory
         trajectoryVersion: snapshot.trajectoryVersion,
         durationS: snapshot.durationSec,
         stepS: snapshot.stepS,
-        avgSigmaDeg: snapshot.avgSigmaDeg
+        avgSigmaDeg: snapshot.avgSigmaDeg,
+        confidenceTierSeen: snapshot.confidenceTierSeen,
+        contractTier: snapshot.contractTier,
+        renderTier,
+        droppedFrameBucket
       });
     };
 
@@ -2526,6 +2637,21 @@ export function ArSession({ launchId, launchName, pad, net, backHref, trajectory
       const adjustedPitchTarget =
         typeof rawPitchDeg === 'number' && Number.isFinite(rawPitchDeg) ? rawPitchDeg - state.pitchOffset : null;
       const tNowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
+      const frameStats = telemetryFrameStatsRef.current;
+      if (frameStats.lastFrameAtMs != null) {
+        const frameDtMs = tNowMs - frameStats.lastFrameAtMs;
+        // Ignore large resume gaps so background tabs do not overcount dropped frames.
+        if (frameDtMs > 4 && frameDtMs < 250) {
+          const estimatedDropped = Math.max(0, Math.round(frameDtMs / 16.67) - 1);
+          frameStats.dropped += estimatedDropped;
+          frameStats.frames += 1;
+        } else if (frameDtMs >= 250) {
+          frameStats.frames += 1;
+        }
+      } else {
+        frameStats.frames += 1;
+      }
+      frameStats.lastFrameAtMs = tNowMs;
       const dtSecRaw =
         stabilizedPose.lastAtMs != null ? (tNowMs - stabilizedPose.lastAtMs) / 1000 : 0.016;
       const dtSec = clamp(dtSecRaw, 0.004, 0.08);
@@ -3205,6 +3331,13 @@ export function ArSession({ launchId, launchName, pad, net, backHref, trajectory
                         (Tier {trajectory.quality} • {trajectory.version})
                       </span>
                     </div>
+                    {(trajectory.confidenceTier || trajectory.freshnessState || trajectory.lineageComplete != null) && (
+                      <div className="mt-1 text-[11px] text-white/70">
+                        {trajectory.confidenceTier ? `Confidence ${trajectory.confidenceTier}` : 'Confidence unknown'}
+                        {trajectory.freshnessState ? ` • ${trajectory.freshnessState}` : ''}
+                        {trajectory.lineageComplete != null ? ` • lineage ${trajectory.lineageComplete ? 'complete' : 'partial'}` : ''}
+                      </div>
+                    )}
                   </div>
                   <button
                     type="button"
diff --git a/lib/ar/telemetryClient.ts b/lib/ar/telemetryClient.ts
index c675be4..fbe5529 100644
--- a/lib/ar/telemetryClient.ts
+++ b/lib/ar/telemetryClient.ts
@@ -60,6 +60,10 @@ export type CameraGuideTelemetryPayload = {
   durationS?: number;
   stepS?: number;
   avgSigmaDeg?: number;
+  confidenceTierSeen?: 'A' | 'B' | 'C' | 'D';
+  contractTier?: 'A' | 'B' | 'C' | 'D';
+  renderTier?: 'high' | 'medium' | 'low' | 'unknown';
+  droppedFrameBucket?: string;
 };
 
 export function newSessionId() {
diff --git a/supabase/functions/navcen-bnm-ingest/index.ts b/supabase/functions/navcen-bnm-ingest/index.ts
index 4dffb79..ec7da59 100644
--- a/supabase/functions/navcen-bnm-ingest/index.ts
+++ b/supabase/functions/navcen-bnm-ingest/index.ts
@@ -4,6 +4,7 @@ import { requireJobAuth } from '../_shared/jobAuth.ts';
 import { getSettings, readBooleanSetting, readNumberSetting, readStringSetting } from '../_shared/settings.ts';
 
 const USER_AGENT = 'TMinusZero/0.1 (+https://tminusnow.app)';
+const PARSER_VERSION = 'v1';
 
 const GOVDELIVERY_TOPIC_ID = 'USDHSCG_422';
 const DEFAULT_FEED_URL = 'https://public.govdelivery.com/topics/USDHSCG_422/feed.rss';
@@ -203,6 +204,7 @@ serve(async (req) => {
       const context = bulletinByGuid.get(guid) ?? null;
       await ingestNavcenGuid({
         supabase,
+        runId,
         guid,
         context,
         feedUrl,
@@ -237,6 +239,7 @@ serve(async (req) => {
 
 async function ingestNavcenGuid({
   supabase,
+  runId,
   guid,
   context,
   feedUrl,
@@ -244,6 +247,7 @@ async function ingestNavcenGuid({
   stats
 }: {
   supabase: ReturnType<typeof createSupabaseAdminClient>;
+  runId: number | null;
   guid: string;
   context: { bulletinUrl: string | null; item: RssItem } | null;
   feedUrl: string;
@@ -361,6 +365,18 @@ async function ingestNavcenGuid({
         source: 'navcen_bnm',
         source_id: sourceId,
         constraint_type: 'hazard_area',
+        ingestion_run_id: runId,
+        source_hash: sha256,
+        extracted_field_map: {
+          geometry: Boolean(area.geometry),
+          valid_window: Boolean(area.validStartUtc || area.validEndUtc),
+          windows: Array.isArray(area.windows) && area.windows.length > 0,
+          area_name: Boolean(area.areaName),
+          navcen_guid: Boolean(guid)
+        },
+        parse_rule_id: 'navcen_bnm_hazard_extract_v1',
+        parser_version: PARSER_VERSION,
+        license_class: 'public_navcen',
         data: {
           navcenGuid: guid,
           title: parsedTitle,
@@ -370,7 +386,8 @@ async function ingestNavcenGuid({
           validEndUtc: area.validEndUtc,
           windows: area.windows,
           sourceUrl: messageUrl,
-          rawTextSnippet: area.rawTextSnippet
+          rawTextSnippet: area.rawTextSnippet,
+          sourceHash: sha256
         },
         geometry: area.geometry,
         confidence: typeof match.confidence === 'number' ? match.confidence / 100 : null,
@@ -502,7 +519,7 @@ async function insertMessage(args: {
     raw_text: args.rawText,
     raw_html: args.rawHtml,
     raw: { windows: parseTimeWindows(args.rawText) },
-    parse_version: 'v1',
+    parse_version: PARSER_VERSION,
     updated_at: new Date().toISOString()
   };
 
@@ -1327,7 +1344,7 @@ async function upsertHazardArea(args: {
       ...args.area.data,
       windows: args.area.windows
     },
-    parse_version: 'v1',
+    parse_version: PARSER_VERSION,
     match_status: args.match.status,
     matched_launch_id: args.match.launchId,
     match_confidence: args.match.confidence,
diff --git a/supabase/functions/trajectory-constraints-ingest/index.ts b/supabase/functions/trajectory-constraints-ingest/index.ts
index 135cb1b..2bc54f1 100644
--- a/supabase/functions/trajectory-constraints-ingest/index.ts
+++ b/supabase/functions/trajectory-constraints-ingest/index.ts
@@ -6,6 +6,7 @@ import { getSettings, readBooleanSetting, readNumberSetting } from '../_shared/s
 const LL2_BASE = 'https://ll.thespacedevs.com/2.3.0';
 const LL2_USER_AGENT = Deno.env.get('LL2_USER_AGENT') || 'TMinusZero/0.1 (support@tminuszero.app)';
 const LL2_API_KEY = Deno.env.get('LL2_API_KEY') || '';
+const PARSER_VERSION = 'v1';
 
 const DEFAULTS = {
   enabled: true,
@@ -172,6 +173,20 @@ serve(async (req) => {
           source_id: String(landing.id),
           constraint_type: 'landing',
           confidence,
+          ingestion_run_id: runId,
+          source_hash: `ll2:${launch.ll2_launch_uuid}:landing:${landing.id}`,
+          extracted_field_map: {
+            landing_role: landing.landing_role != null,
+            attempt: typeof landing.attempt === 'boolean',
+            success: typeof landing.success === 'boolean',
+            downrange_distance_km:
+              typeof landing.downrange_distance === 'number' && Number.isFinite(landing.downrange_distance),
+            landing_location_name: Boolean(landing?.landing_location?.name),
+            landing_location_coords: hasCoords
+          },
+          parse_rule_id: 'll2_landings_extract_v1',
+          parser_version: PARSER_VERSION,
+          license_class: 'public_api_ll2',
           data: {
             id: landing.id,
             landing_role: landing.landing_role ?? null,
@@ -180,7 +195,8 @@ serve(async (req) => {
             description: landing.description ?? null,
             downrange_distance_km: landing.downrange_distance ?? null,
             landing_location: landing.landing_location ?? null,
-            landing_type: landing.type ?? null
+            landing_type: landing.type ?? null,
+            sourceUrl: `${LL2_BASE}/landings/?format=json&mode=detailed&limit=100`
           },
           fetched_at: nowIso
         });
diff --git a/supabase/functions/trajectory-orbit-ingest/index.ts b/supabase/functions/trajectory-orbit-ingest/index.ts
index aebfefd..d04be6f 100644
--- a/supabase/functions/trajectory-orbit-ingest/index.ts
+++ b/supabase/functions/trajectory-orbit-ingest/index.ts
@@ -44,6 +44,9 @@ function ensurePdfWorkerSrc(pdfjs: PdfJsModule) {
 
 const USER_AGENT = 'TMinusZero/0.1 (+https://tminusnow.app)';
 const PARSE_VERSION = 'v1';
+const DOC_FETCH_TIMEOUT_MS = 15_000;
+const DOC_FETCH_MAX_BYTES = 12_000_000;
+const DOC_FETCH_RETRIES = 3;
 
 const DEFAULTS = {
   enabled: true,
@@ -123,6 +126,7 @@ serve(async (req) => {
     docsInserted: 0,
     docsAlreadyStored: 0,
     constraintsDerived: 0,
+    constraintsSupgpDerived: 0,
     constraintsHazardDerived: 0,
     constraintsUpserted: 0,
     constraintsSkippedNoData: 0,
@@ -194,6 +198,7 @@ serve(async (req) => {
       const tierNotes = selectedTierOrder.length ? `tiers=${selectedTierOrder.join(',')}` : null;
 
       let hasDocDirection = false;
+      let hasDocAzimuth = false;
 
       for (const candidate of selected) {
         const cached = docCache.get(candidate.url);
@@ -269,8 +274,15 @@ serve(async (req) => {
 
           const hasDirection = orbit.inclination_deg != null || orbit.flight_azimuth_deg != null;
           if (hasDirection) hasDocDirection = true;
-
-          const confidence = estimateConfidence({ candidateTier: candidate.tier, orbit, derived: false });
+          if (orbit.flight_azimuth_deg != null) hasDocAzimuth = true;
+
+          const fieldConfidence = estimateFieldConfidence(orbit);
+          const confidence = estimateConfidence({
+            candidateTier: candidate.tier,
+            orbit,
+            derived: false,
+            fieldConfidence
+          });
 
           constraintRows.push({
             launch_id: launchId,
@@ -278,8 +290,15 @@ serve(async (req) => {
             source_id: doc.id,
             constraint_type: 'target_orbit',
             confidence,
+            ingestion_run_id: runId,
+            source_hash: doc.sha256,
+            extracted_field_map: buildExtractedFieldMap(orbit),
+            parse_rule_id: 'orbit_numeric_extract_v1',
+            parser_version: PARSE_VERSION,
+            license_class: candidate.tier === 'truth' ? 'public_official' : 'public_fallback',
             data: {
               ...orbit,
+              fieldConfidence,
               sourceUrl: doc.url,
               documentId: doc.id,
               documentHash: doc.sha256,
@@ -310,6 +329,35 @@ serve(async (req) => {
       }
 
       if (!hasDocDirection) {
+        const supgpDerived = await deriveOrbitFromSupgp({ supabase, launch });
+        if (supgpDerived) {
+          (stats.constraintsSupgpDerived as number) = (stats.constraintsSupgpDerived as number) + 1;
+          constraintRows.push({
+            launch_id: launchId,
+            source: supgpDerived.source,
+            source_id: supgpDerived.sourceId,
+            constraint_type: 'target_orbit',
+            confidence: supgpDerived.confidence,
+            ingestion_run_id: runId,
+            source_hash: supgpDerived.sourceHash,
+            extracted_field_map: buildExtractedFieldMap(supgpDerived.orbit),
+            parse_rule_id: 'supgp_prelaunch_match_v1',
+            parser_version: PARSE_VERSION,
+            license_class: 'public_celestrak',
+            data: {
+              ...supgpDerived.orbit,
+              orbitType: supgpDerived.orbitType,
+              derived: true,
+              derivedNotes: supgpDerived.notes,
+              parserVersion: PARSE_VERSION
+            },
+            fetched_at: new Date().toISOString()
+          });
+          hasDocDirection = true;
+        }
+      }
+
+      if (!hasDocAzimuth) {
         const hazardDerived = deriveOrbitFromHazards(launch, hazardsByLaunchId.get(launchId) ?? []);
         if (hazardDerived) {
           (stats.constraintsHazardDerived as number) = (stats.constraintsHazardDerived as number) + 1;
@@ -319,6 +367,12 @@ serve(async (req) => {
             source_id: hazardDerived.sourceId,
             constraint_type: 'target_orbit',
             confidence: hazardDerived.confidence,
+            ingestion_run_id: runId,
+            source_hash: hazardDerived.sourceHash,
+            extracted_field_map: buildExtractedFieldMap(hazardDerived.orbit),
+            parse_rule_id: 'hazard_azimuth_derive_v1',
+            parser_version: PARSE_VERSION,
+            license_class: 'public_derived',
             data: {
               ...hazardDerived.orbit,
               orbitType: hazardDerived.orbitType,
@@ -328,9 +382,11 @@ serve(async (req) => {
             },
             fetched_at: new Date().toISOString()
           });
-          continue;
+          hasDocAzimuth = true;
         }
+      }
 
+      if (!hasDocDirection) {
         const derived = deriveOrbitFromLaunch(launch);
         if (derived) {
           (stats.constraintsDerived as number) = (stats.constraintsDerived as number) + 1;
@@ -340,6 +396,12 @@ serve(async (req) => {
             source_id: derived.sourceId,
             constraint_type: 'target_orbit',
             confidence: derived.confidence,
+            ingestion_run_id: runId,
+            source_hash: derived.sourceHash,
+            extracted_field_map: buildExtractedFieldMap(derived.orbit),
+            parse_rule_id: 'launch_family_heuristic_v1',
+            parser_version: PARSE_VERSION,
+            license_class: 'derived_internal',
             data: {
               ...derived.orbit,
               orbitType: derived.orbitType,
@@ -419,20 +481,61 @@ function buildUrlCandidates({
 
 function buildDerivedUrlsForLaunch(launch: CandidateLaunch): Array<{ url: string; title: string | null; from: 'derived' }> {
   const provider = (launch.provider || '').toLowerCase();
-  if (!provider.includes('spacex')) return [];
-
   const mission = (launch.mission_name || launch.name || '').toLowerCase();
   const out: Array<{ url: string; title: string | null; from: 'derived' }> = [];
 
-  if (mission.includes('starlink')) {
+  if (provider.includes('spacex')) {
+    if (mission.includes('starlink')) {
+      out.push({
+        url: 'https://starlink.com/public-files/space_station_conjunction_avoidance.pdf',
+        title: 'Starlink conjunction avoidance (public file)',
+        from: 'derived'
+      });
+      out.push({
+        url: 'https://starlink.com/public-files/Gen2StarlinkSatellites.pdf',
+        title: 'Gen2 Starlink Satellites (public file)',
+        from: 'derived'
+      });
+    }
+    return out;
+  }
+
+  if (provider.includes('united launch alliance') || provider.includes('ula')) {
+    out.push({
+      url: 'https://www.ulalaunch.com/missions',
+      title: 'ULA mission index',
+      from: 'derived'
+    });
+  }
+
+  if (provider.includes('arianespace')) {
+    out.push({
+      url: 'https://newsroom.arianespace.com/',
+      title: 'Arianespace newsroom',
+      from: 'derived'
+    });
+  }
+
+  if (provider.includes('arianegroup') || provider.includes('ariane group')) {
+    out.push({
+      url: 'https://ariane.group/en/',
+      title: 'ArianeGroup mission index',
+      from: 'derived'
+    });
+  }
+
+  if (provider.includes('isro')) {
     out.push({
-      url: 'https://starlink.com/public-files/space_station_conjunction_avoidance.pdf',
-      title: 'Starlink conjunction avoidance (public file)',
+      url: 'https://www.isro.gov.in/missions',
+      title: 'ISRO missions',
       from: 'derived'
     });
+  }
+
+  if (provider.includes('rocket lab')) {
     out.push({
-      url: 'https://starlink.com/public-files/Gen2StarlinkSatellites.pdf',
-      title: 'Gen2 Starlink Satellites (public file)',
+      url: 'https://rocketlabcorp.com/missions/',
+      title: 'Rocket Lab missions',
       from: 'derived'
     });
   }
@@ -683,28 +786,65 @@ async function fetchDocument(url: string, latest: LatestDocMeta): Promise<FetchR
     }
   }
 
-  const res = await fetch(url, { headers });
-  if (res.status === 304) {
-    return { notModified: true, bytes: new Uint8Array(), etag: latest?.etag ?? null, lastModified: latest?.lastModified ?? null, contentType: null, httpStatus: 304 };
-  }
-  if (!res.ok) {
-    throw new Error(`doc_fetch_${res.status}`);
+  let lastError: string | null = null;
+
+  for (let attempt = 0; attempt < DOC_FETCH_RETRIES; attempt += 1) {
+    const controller = new AbortController();
+    const timeout = setTimeout(() => controller.abort('timeout'), DOC_FETCH_TIMEOUT_MS);
+    try {
+      const res = await fetch(url, { headers, signal: controller.signal });
+      if (res.status === 304) {
+        return {
+          notModified: true,
+          bytes: new Uint8Array(),
+          etag: latest?.etag ?? null,
+          lastModified: latest?.lastModified ?? null,
+          contentType: null,
+          httpStatus: 304
+        };
+      }
+      if (!res.ok) {
+        throw new Error(`doc_fetch_${res.status}`);
+      }
+
+      const contentLength = Number(res.headers.get('content-length') || NaN);
+      if (Number.isFinite(contentLength) && contentLength > DOC_FETCH_MAX_BYTES) {
+        throw new Error('doc_fetch_too_large');
+      }
+
+      const arr = new Uint8Array(await res.arrayBuffer());
+      if (arr.length > DOC_FETCH_MAX_BYTES) {
+        throw new Error('doc_fetch_too_large');
+      }
+
+      const etag = res.headers.get('etag');
+      const lastModifiedHeader = res.headers.get('last-modified');
+      const parsedLastModified = lastModifiedHeader ? new Date(lastModifiedHeader) : null;
+      const lastModified =
+        parsedLastModified && !Number.isNaN(parsedLastModified.getTime()) ? parsedLastModified.toISOString() : null;
+      const contentType = res.headers.get('content-type');
+      return {
+        notModified: false,
+        bytes: arr,
+        etag: etag ? etag.trim() : null,
+        lastModified: lastModified ? lastModified.trim() : null,
+        contentType: contentType ? contentType.trim() : null,
+        httpStatus: res.status
+      };
+    } catch (err) {
+      const msg = stringifyError(err);
+      const timeoutAbort = msg.includes('abort') || msg.includes('timed') || msg.includes('timeout');
+      lastError = timeoutAbort ? 'doc_fetch_timeout' : msg;
+      if (attempt + 1 < DOC_FETCH_RETRIES) {
+        await sleep(200 * Math.pow(2, attempt));
+        continue;
+      }
+    } finally {
+      clearTimeout(timeout);
+    }
   }
-  const arr = new Uint8Array(await res.arrayBuffer());
-  const etag = res.headers.get('etag');
-  const lastModifiedHeader = res.headers.get('last-modified');
-  const parsedLastModified = lastModifiedHeader ? new Date(lastModifiedHeader) : null;
-  const lastModified =
-    parsedLastModified && !Number.isNaN(parsedLastModified.getTime()) ? parsedLastModified.toISOString() : null;
-  const contentType = res.headers.get('content-type');
-  return {
-    notModified: false,
-    bytes: arr,
-    etag: etag ? etag.trim() : null,
-    lastModified: lastModified ? lastModified.trim() : null,
-    contentType: contentType ? contentType.trim() : null,
-    httpStatus: res.status
-  };
+
+  throw new Error(lastError || 'doc_fetch_failed');
 }
 
 async function insertDocVersion(
@@ -966,24 +1106,78 @@ function parseOrbitData(text: string) {
 function estimateConfidence({
   candidateTier,
   orbit,
-  derived
+  derived,
+  fieldConfidence
 }: {
   candidateTier: 'truth' | 'fallback';
   orbit: { inclination_deg: number | null; flight_azimuth_deg: number | null; orbit_class: string | null };
   derived: boolean;
+  fieldConfidence?: ReturnType<typeof estimateFieldConfidence>;
 }) {
   let c = derived ? 0.62 : candidateTier === 'truth' ? 0.9 : 0.75;
   if (orbit.flight_azimuth_deg != null) c += 0.07;
   if (orbit.inclination_deg != null) c += 0.03;
   if (orbit.inclination_deg == null && orbit.flight_azimuth_deg == null && orbit.orbit_class != null) c = Math.min(c, 0.6);
+  if (fieldConfidence) {
+    c = c * 0.7 + fieldConfidence.overall * 0.3;
+  }
   return clamp(c, 0, 0.99);
 }
 
+function estimateFieldConfidence(orbit: {
+  inclination_deg: number | null;
+  flight_azimuth_deg: number | null;
+  altitude_km?: number | null;
+  apogee_km?: number | null;
+  perigee_km?: number | null;
+  orbit_class?: string | null;
+}) {
+  const direction =
+    orbit.flight_azimuth_deg != null ? 0.96 : orbit.inclination_deg != null ? 0.82 : orbit.orbit_class ? 0.58 : 0.2;
+  const orbitShape =
+    orbit.altitude_km != null || orbit.apogee_km != null || orbit.perigee_km != null
+      ? 0.86
+      : orbit.orbit_class
+        ? 0.55
+        : 0.2;
+  const overall = clamp((direction * 0.65 + orbitShape * 0.35), 0, 0.99);
+  return {
+    direction,
+    orbitShape,
+    overall
+  };
+}
+
+function buildExtractedFieldMap(orbit: {
+  inclination_deg: number | null;
+  flight_azimuth_deg: number | null;
+  altitude_km?: number | null;
+  apogee_km?: number | null;
+  perigee_km?: number | null;
+  orbit_class?: string | null;
+}) {
+  const hasDirection = orbit.flight_azimuth_deg != null || orbit.inclination_deg != null;
+  return {
+    inclination_deg: orbit.inclination_deg != null,
+    flight_azimuth_deg: orbit.flight_azimuth_deg != null,
+    altitude_km: orbit.altitude_km != null,
+    apogee_km: orbit.apogee_km != null,
+    perigee_km: orbit.perigee_km != null,
+    orbit_class: orbit.orbit_class != null,
+    has_direction: hasDirection
+  };
+}
+
 async function sha256Hex(bytes: Uint8Array) {
   const hash = await crypto.subtle.digest('SHA-256', bytes);
   return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
 }
 
+async function sleep(ms: number) {
+  if (!Number.isFinite(ms) || ms <= 0) return;
+  await new Promise((resolve) => setTimeout(resolve, ms));
+}
+
 function clamp(value: number, min: number, max: number) {
   return Math.min(max, Math.max(min, value));
 }
@@ -1084,6 +1278,253 @@ function shouldAttemptDerivedOrbit(launch: CandidateLaunch) {
   return false;
 }
 
+type SupgpOrbitRow = {
+  group_or_source: string | null;
+  epoch: string | null;
+  inclination_deg: number | null;
+  mean_motion_rev_per_day: number | null;
+  eccentricity: number | null;
+  fetched_at: string | null;
+};
+
+async function deriveOrbitFromSupgp({
+  supabase,
+  launch
+}: {
+  supabase: ReturnType<typeof createSupabaseAdminClient>;
+  launch: CandidateLaunch;
+}) {
+  const searchKeys = buildSupgpSearchKeys(launch);
+  if (!searchKeys.length) return null;
+
+  const netMs = launch.net ? Date.parse(launch.net) : NaN;
+  const minEpochIso = Number.isFinite(netMs) ? new Date(netMs - 45 * 24 * 60 * 60 * 1000).toISOString() : null;
+  const maxEpochIso = Number.isFinite(netMs) ? new Date(netMs + 15 * 24 * 60 * 60 * 1000).toISOString() : null;
+
+  const dedupe = new Set<string>();
+  const rows: SupgpOrbitRow[] = [];
+
+  for (const key of searchKeys) {
+    let query = supabase
+      .from('orbit_elements')
+      .select('group_or_source,epoch,inclination_deg,mean_motion_rev_per_day,eccentricity,fetched_at')
+      .eq('source', 'supgp')
+      .ilike('group_or_source', `%${key}%`)
+      .order('epoch', { ascending: false })
+      .limit(250);
+
+    if (minEpochIso) query = query.gte('epoch', minEpochIso);
+    if (maxEpochIso) query = query.lte('epoch', maxEpochIso);
+
+    const { data, error } = await query;
+    if (error || !Array.isArray(data)) continue;
+
+    for (const raw of data as any[]) {
+      const group = typeof raw?.group_or_source === 'string' ? raw.group_or_source.trim() : '';
+      const epoch = typeof raw?.epoch === 'string' ? raw.epoch : '';
+      if (!group || !epoch) continue;
+      const rowKey = `${group}|${epoch}`;
+      if (dedupe.has(rowKey)) continue;
+      dedupe.add(rowKey);
+      rows.push({
+        group_or_source: group,
+        epoch,
+        inclination_deg: typeof raw?.inclination_deg === 'number' ? raw.inclination_deg : null,
+        mean_motion_rev_per_day: typeof raw?.mean_motion_rev_per_day === 'number' ? raw.mean_motion_rev_per_day : null,
+        eccentricity: typeof raw?.eccentricity === 'number' ? raw.eccentricity : null,
+        fetched_at: typeof raw?.fetched_at === 'string' ? raw.fetched_at : null
+      });
+    }
+  }
+
+  if (!rows.length) return null;
+
+  const byGroup = new Map<string, SupgpOrbitRow[]>();
+  for (const row of rows) {
+    const group = String(row.group_or_source || '').trim().toLowerCase();
+    if (!group) continue;
+    const list = byGroup.get(group) || [];
+    list.push(row);
+    byGroup.set(group, list);
+  }
+
+  const candidates: Array<{
+    group: string;
+    rows: SupgpOrbitRow[];
+    inclinationDeg: number;
+    inclinationSpreadDeg: number;
+    altitudeKm: number | null;
+    latestEpochIso: string | null;
+    nearestDeltaHours: number | null;
+    confidence: number;
+    score: number;
+  }> = [];
+
+  for (const [group, groupRows] of byGroup.entries()) {
+    const inclinations = groupRows
+      .map((r) => (typeof r.inclination_deg === 'number' && Number.isFinite(r.inclination_deg) ? r.inclination_deg : null))
+      .filter((v): v is number => v != null && v > 0 && v < 180);
+    if (!inclinations.length) continue;
+
+    const inclinationDeg = median(inclinations);
+    const inclinationSpreadDeg = inclinations.length >= 2 ? stddev(inclinations) : 0;
+
+    const meanMotionValues = groupRows
+      .map((r) => (typeof r.mean_motion_rev_per_day === 'number' && Number.isFinite(r.mean_motion_rev_per_day) ? r.mean_motion_rev_per_day : null))
+      .filter((v): v is number => v != null && v > 0);
+    const altitudeKm = meanMotionValues.length ? estimateAltitudeKmFromMeanMotion(median(meanMotionValues)) : null;
+
+    let latestEpochMs = Number.NaN;
+    for (const row of groupRows) {
+      const epochMs = row.epoch ? Date.parse(row.epoch) : NaN;
+      if (!Number.isFinite(epochMs)) continue;
+      if (!Number.isFinite(latestEpochMs) || epochMs > latestEpochMs) latestEpochMs = epochMs;
+    }
+    const latestEpochIso = Number.isFinite(latestEpochMs) ? new Date(latestEpochMs).toISOString() : null;
+
+    let nearestDeltaHours: number | null = null;
+    if (Number.isFinite(netMs)) {
+      let minDeltaMs = Number.POSITIVE_INFINITY;
+      for (const row of groupRows) {
+        const epochMs = row.epoch ? Date.parse(row.epoch) : NaN;
+        if (!Number.isFinite(epochMs)) continue;
+        const delta = Math.abs(epochMs - netMs);
+        if (delta < minDeltaMs) minDeltaMs = delta;
+      }
+      if (Number.isFinite(minDeltaMs) && minDeltaMs < Number.POSITIVE_INFINITY) {
+        nearestDeltaHours = minDeltaMs / (60 * 60 * 1000);
+      }
+    }
+
+    let confidence = 0.68;
+    if (inclinations.length >= 3) confidence += 0.08;
+    if (inclinations.length >= 8) confidence += 0.04;
+    if (inclinationSpreadDeg <= 1.0) confidence += 0.06;
+    else if (inclinationSpreadDeg > 3.0) confidence -= 0.06;
+    if (altitudeKm != null) confidence += 0.05;
+    if (nearestDeltaHours != null) {
+      if (nearestDeltaHours <= 24) confidence += 0.08;
+      else if (nearestDeltaHours <= 72) confidence += 0.05;
+      else if (nearestDeltaHours > 240) confidence -= 0.05;
+    } else {
+      confidence -= 0.03;
+    }
+    confidence = clamp(confidence, 0.55, 0.92);
+
+    const score = confidence * 100 + groupRows.length * 0.25 - (nearestDeltaHours ?? 240) * 0.08;
+    candidates.push({
+      group,
+      rows: groupRows,
+      inclinationDeg,
+      inclinationSpreadDeg,
+      altitudeKm,
+      latestEpochIso,
+      nearestDeltaHours,
+      confidence,
+      score
+    });
+  }
+
+  if (!candidates.length) return null;
+  candidates.sort((a, b) => b.score - a.score);
+  const best = candidates[0];
+  if (!best) return null;
+  if (best.confidence < 0.62) return null;
+
+  const notes = [
+    `SupGP group match: ${best.group}`,
+    `SupGP samples: ${best.rows.length}`,
+    `Inclination: ${best.inclinationDeg.toFixed(2)} deg`,
+    `Inclination spread: ${best.inclinationSpreadDeg.toFixed(2)} deg`,
+    best.altitudeKm != null ? `Altitude estimate: ${best.altitudeKm.toFixed(0)} km` : null,
+    best.nearestDeltaHours != null ? `Nearest SupGP epoch delta: ${best.nearestDeltaHours.toFixed(1)} h` : null,
+    best.latestEpochIso ? `Latest SupGP epoch: ${best.latestEpochIso}` : null,
+    'Derived from prelaunch SupGP state vectors (CelesTrak supplemental).'
+  ].filter(Boolean) as string[];
+
+  const sourceId = best.latestEpochIso ? `supgp:${best.group}:${best.latestEpochIso}` : `supgp:${best.group}`;
+  return {
+    source: 'celestrak_supgp',
+    sourceId,
+    sourceHash: sourceId,
+    confidence: best.confidence,
+    orbitType: 'supgp_prelaunch_match',
+    orbit: {
+      inclination_deg: best.inclinationDeg,
+      flight_azimuth_deg: null,
+      altitude_km: best.altitudeKm,
+      apogee_km: null,
+      perigee_km: null,
+      orbit_class: 'LEO'
+    },
+    notes
+  };
+}
+
+function buildSupgpSearchKeys(launch: CandidateLaunch) {
+  const provider = (launch.provider || '').toLowerCase();
+  if (!provider.includes('spacex')) return [];
+
+  const missionCandidates = [launch.mission_name, launch.name].filter((v): v is string => typeof v === 'string');
+  const keys = new Set<string>();
+
+  for (const candidate of missionCandidates) {
+    const parsed = parseStarlinkSupgpKey(candidate);
+    if (!parsed) continue;
+    keys.add(parsed.key);
+    keys.add(parsed.groupKey);
+  }
+
+  return [...keys];
+}
+
+function parseStarlinkSupgpKey(value: string): { key: string; groupKey: string } | null {
+  const raw = value.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
+  if (!raw.includes('starlink')) return null;
+
+  let match = raw.match(/starlink(?:\s*group)?\s*(?:g)?\s*([0-9]{1,2})\s*[-/]\s*([0-9]{1,2})/i);
+  if (!match) match = raw.match(/\bg\s*([0-9]{1,2})\s*[-/]\s*([0-9]{1,2})\b/i);
+  if (!match) return null;
+
+  const shell = Number(match[1]);
+  const mission = Number(match[2]);
+  if (!Number.isFinite(shell) || !Number.isFinite(mission)) return null;
+  if (shell <= 0 || mission <= 0) return null;
+
+  return {
+    key: `starlink-g${shell}-${mission}`,
+    groupKey: `g${shell}-${mission}`
+  };
+}
+
+function estimateAltitudeKmFromMeanMotion(meanMotionRevPerDay: number) {
+  if (!Number.isFinite(meanMotionRevPerDay) || meanMotionRevPerDay <= 0) return null;
+  const mu = 398600.4418; // km^3/s^2
+  const earthRadiusKm = 6378.137;
+  const nRadPerSec = (meanMotionRevPerDay * 2 * Math.PI) / 86400;
+  if (!Number.isFinite(nRadPerSec) || nRadPerSec <= 0) return null;
+  const aKm = Math.pow(mu / (nRadPerSec * nRadPerSec), 1 / 3);
+  if (!Number.isFinite(aKm)) return null;
+  const altitudeKm = aKm - earthRadiusKm;
+  if (!Number.isFinite(altitudeKm)) return null;
+  return clamp(altitudeKm, 120, 2500);
+}
+
+function median(values: number[]) {
+  if (!values.length) return 0;
+  const sorted = [...values].sort((a, b) => a - b);
+  const mid = Math.floor(sorted.length / 2);
+  if (sorted.length % 2) return sorted[mid];
+  return (sorted[mid - 1] + sorted[mid]) / 2;
+}
+
+function stddev(values: number[]) {
+  if (values.length <= 1) return 0;
+  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
+  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1);
+  return Math.sqrt(Math.max(0, variance));
+}
+
 function deriveOrbitFromHazards(launch: CandidateLaunch, hazards: HazardConstraintRow[]) {
   const padLat = typeof launch.pad_latitude === 'number' ? launch.pad_latitude : null;
   const padLon = typeof launch.pad_longitude === 'number' ? launch.pad_longitude : null;
@@ -1130,6 +1571,7 @@ function deriveOrbitFromHazards(launch: CandidateLaunch, hazards: HazardConstrai
   return {
     source: 'navcen_bnm',
     sourceId: `navcen:${top.guid}`,
+    sourceHash: `navcen:${top.guid}`,
     confidence,
     orbitType: 'hazard_azimuth_estimate',
     orbit: {
@@ -1213,6 +1655,7 @@ function wrapLonDeg(lon: number) {
 function deriveOrbitFromLaunch(launch: CandidateLaunch): {
   source: string;
   sourceId: string;
+  sourceHash: string;
   confidence: number;
   orbitType: string;
   orbit: ReturnType<typeof parseOrbitData>;
@@ -1236,6 +1679,7 @@ function deriveOrbitFromLaunch(launch: CandidateLaunch): {
       return {
         source: 'spacex_derived',
         sourceId: 'starlink_vandenberg_shell_v1',
+        sourceHash: 'spacex_derived:starlink_vandenberg_shell_v1',
         confidence: 0.6,
         orbitType: 'operational_shell_estimate',
         orbit: {
@@ -1254,6 +1698,7 @@ function deriveOrbitFromLaunch(launch: CandidateLaunch): {
     return {
       source: 'spacex_derived',
       sourceId: 'starlink_cape_shell_v1',
+      sourceHash: 'spacex_derived:starlink_cape_shell_v1',
       confidence: 0.6,
       orbitType: 'operational_shell_estimate',
       orbit: {
@@ -1273,6 +1718,7 @@ function deriveOrbitFromLaunch(launch: CandidateLaunch): {
     return {
       source: 'spacex_derived',
       sourceId: 'iss_family_v1',
+      sourceHash: 'spacex_derived:iss_family_v1',
       confidence: 0.75,
       orbitType: 'operational_orbit_estimate',
       orbit: {
@@ -1292,6 +1738,7 @@ function deriveOrbitFromLaunch(launch: CandidateLaunch): {
     return {
       source: 'spacex_derived',
       sourceId: 'gps_meo_v1',
+      sourceHash: 'spacex_derived:gps_meo_v1',
       confidence: 0.75,
       orbitType: 'operational_orbit_estimate',
       orbit: {
diff --git a/supabase/functions/trajectory-products-generate/index.ts b/supabase/functions/trajectory-products-generate/index.ts
index 5567811..8f7e1ba 100644
--- a/supabase/functions/trajectory-products-generate/index.ts
+++ b/supabase/functions/trajectory-products-generate/index.ts
@@ -28,12 +28,27 @@ type TrajectoryEvent = {
   confidence?: 'low' | 'med' | 'high';
 };
 
+type TrajectoryConfidenceTier = 'A' | 'B' | 'C' | 'D';
+
+type SourceContractEval = {
+  confidenceTier: TrajectoryConfidenceTier;
+  status: 'pass' | 'fail';
+  sourceSufficiency: Record<string, unknown>;
+  requiredFields: Record<string, unknown>;
+  missingFields: string[];
+  blockingReasons: string[];
+  freshnessState: 'fresh' | 'stale' | 'unknown';
+  lineageComplete: boolean;
+};
+
 type LaunchSite = 'cape' | 'vandenberg' | 'starbase' | 'unknown';
 type MissionClass = 'SSO_POLAR' | 'GTO_GEO' | 'ISS_CREW' | 'LEO_GENERIC' | 'UNKNOWN';
+type TrajectoryQualityLabel = 'pad_only' | 'landing_constrained' | 'estimate_corridor';
 
 type LaunchRow = {
   launch_id: string;
   net: string | null;
+  provider: string | null;
   status_name: string | null;
   timeline: Array<{ relative_time?: string | null }> | null;
   pad_latitude: number | null;
@@ -47,6 +62,7 @@ type LaunchRow = {
 };
 
 type ConstraintRow = {
+  id?: number | null;
   launch_id: string;
   source?: string | null;
   source_id?: string | null;
@@ -55,6 +71,11 @@ type ConstraintRow = {
   geometry?: any;
   confidence?: number | null;
   fetched_at?: string | null;
+  source_hash?: string | null;
+  parser_version?: string | null;
+  parse_rule_id?: string | null;
+  extracted_field_map?: any;
+  license_class?: string | null;
 };
 
 type RankedTargetOrbitConstraint = {
@@ -69,6 +90,34 @@ type RankedTargetOrbitConstraint = {
   hasInclination: boolean;
 };
 
+type TrajectoryProduct = {
+  version: string;
+  quality: number;
+  qualityLabel: TrajectoryQualityLabel | string;
+  generatedAt: string;
+  assumptions: string[];
+  samples: Array<{
+    tPlusSec: number;
+    ecef: [number, number, number];
+    sigmaDeg: number;
+    covariance?: { along_track: number; cross_track: number };
+  }>;
+  events: TrajectoryEvent[];
+  sourceSufficiency?: Record<string, unknown>;
+  milestones?: unknown;
+  tracks?: unknown;
+  milestoneSummary?: Record<string, unknown>;
+  trackSummary?: Record<string, unknown>;
+};
+
+type ProductConstraintRole = 'landing_primary' | 'orbit_azimuth' | 'orbit_altitude' | 'hazard_azimuth';
+
+type ProductConstraintUsage = {
+  constraint: ConstraintRow;
+  role: ProductConstraintRole;
+  weightUsed: number;
+};
+
 function scoreTargetOrbitConstraint(constraint: ConstraintRow, nowMs: number): RankedTargetOrbitConstraint {
   const confidence = typeof constraint.confidence === 'number' && Number.isFinite(constraint.confidence) ? constraint.confidence : 0;
   const fetchedAtMs = typeof constraint.fetched_at === 'string' ? Date.parse(constraint.fetched_at) : NaN;
@@ -140,7 +189,7 @@ function inferTier2AltMaxMFromTargetOrbit(targetOrbit: any): { altMaxM: number;
   return { altMaxM, notes };
 }
 
-serve(async (req) => {
+serve(async (req: Request) => {
   const startedAt = Date.now();
   let supabase: ReturnType<typeof createSupabaseAdminClient>;
   try {
@@ -159,20 +208,24 @@ serve(async (req) => {
 
   const { runId } = await startIngestionRun(supabase, 'trajectory_products_generate');
 
-	  const stats: Record<string, unknown> = {
-	    eligibleIds: [] as string[],
-	    previousIds: [] as string[],
-	    changed: false,
-	    missingProducts: [] as string[],
-	    staleProducts: [] as string[],
-	    hazardsConsidered: 0,
-	    hazardsUsed: 0,
-	    hazardsConsideredByLaunch: {} as Record<string, number>,
-	    hazardsUsedByLaunch: {} as Record<string, boolean>,
-	    templatesUsed: 0,
-	    templatesUsedByLaunch: {} as Record<string, string>,
-	    upserted: 0
-	  };
+  const stats: Record<string, unknown> = {
+    eligibleIds: [] as string[],
+    previousIds: [] as string[],
+    changed: false,
+    missingProducts: [] as string[],
+    staleProducts: [] as string[],
+    hazardsConsidered: 0,
+    hazardsUsed: 0,
+    hazardsConsideredByLaunch: {} as Record<string, number>,
+    hazardsUsedByLaunch: {} as Record<string, boolean>,
+    templatesUsed: 0,
+    templatesUsedByLaunch: {} as Record<string, string>,
+    confidenceTierByLaunch: {} as Record<string, TrajectoryConfidenceTier>,
+    downgradedLaunches: [] as string[],
+    upserted: 0,
+    sourceContractsInserted: 0,
+    lineageRowsInserted: 0
+  };
 
   try {
     const settings = await getSettings(supabase, SETTINGS_KEYS);
@@ -197,7 +250,7 @@ serve(async (req) => {
     const { data, error } = await supabase
       .from('launches_public_cache')
       .select(
-        'launch_id, net, status_name, timeline, pad_latitude, pad_longitude, rocket_family, vehicle, mission_name, mission_orbit, pad_name, location_name'
+        'launch_id, net, provider, status_name, timeline, pad_latitude, pad_longitude, rocket_family, vehicle, mission_name, mission_orbit, pad_name, location_name'
       )
       .gte('net', fromIso)
       .order('net', { ascending: true })
@@ -242,13 +295,15 @@ serve(async (req) => {
       .in('launch_id', eligibleIds);
 
     if (existingError) throw existingError;
-    const existingIds = new Set((existingProducts || []).map((row) => row.launch_id));
+    const existingIds = new Set((existingProducts || []).map((row: { launch_id: string }) => row.launch_id));
     const missingProducts = eligibleIds.filter((id) => !existingIds.has(id));
     stats.missingProducts = missingProducts;
 
     const { data: constraints, error: constraintsError } = await supabase
       .from('launch_trajectory_constraints')
-      .select('launch_id, source, source_id, constraint_type, data, geometry, confidence, fetched_at')
+      .select(
+        'id, launch_id, source, source_id, constraint_type, data, geometry, confidence, fetched_at, source_hash, parser_version, parse_rule_id, extracted_field_map, license_class'
+      )
       .in('launch_id', eligibleIds);
 
     if (constraintsError) throw constraintsError;
@@ -286,11 +341,14 @@ serve(async (req) => {
       return jsonResponse({ ok: true, skipped: true, reason: 'no_change', elapsedMs: Date.now() - startedAt });
     }
 
-    const rows = eligible.map((row) => {
+    const generated = eligible.map((row) => {
+      const launchConstraints = constraintsByLaunch.get(row.launch_id) || [];
+      const usedConstraints: ProductConstraintUsage[] = [];
+
       const landingPick =
         typeof row.pad_latitude === 'number' && typeof row.pad_longitude === 'number'
           ? pickBestLandingConstraint({
-              constraints: constraintsByLaunch.get(row.launch_id) || [],
+              constraints: launchConstraints,
               padLat: row.pad_latitude,
               padLon: row.pad_longitude
             })
@@ -311,19 +369,28 @@ serve(async (req) => {
         sigmaDeg = 10;
       }
 
-      const product =
+      let product: TrajectoryProduct =
         typeof row.pad_latitude === 'number' &&
         typeof row.pad_longitude === 'number' &&
         target &&
         assumptions
-          ? buildConstraintProduct({
-              padLat: row.pad_latitude,
-              padLon: row.pad_longitude,
-              targetLat: target.lat,
-              targetLon: target.lon,
-              sigmaDeg,
-              assumptions
-            })
+          ? (() => {
+              if (landingPick?.constraint) {
+                usedConstraints.push({
+                  constraint: landingPick.constraint,
+                  role: 'landing_primary',
+                  weightUsed: 1
+                });
+              }
+              return buildConstraintProduct({
+                padLat: row.pad_latitude,
+                padLon: row.pad_longitude,
+                targetLat: target.lat,
+                targetLon: target.lon,
+                sigmaDeg,
+                assumptions
+              });
+            })()
           : (() => {
               if (typeof row.pad_latitude === 'number' && typeof row.pad_longitude === 'number') {
                 const site = classifyLaunchSite({
@@ -332,186 +399,307 @@ serve(async (req) => {
                   padName: row.pad_name,
                   locationName: row.location_name
                 });
-	              const missionClass = classifyMission({
-	                orbitName: row.mission_orbit,
-	                missionName: row.mission_name,
-	                vehicleName: row.vehicle
-	              });
-
-	              const rankedOrbitConstraints = (constraintsByLaunch.get(row.launch_id) || [])
-	                .filter((c) => c.constraint_type === 'target_orbit' && c.data && typeof c.data === 'object')
-	                .map((constraint) => scoreTargetOrbitConstraint(constraint, nowMs))
-	                .sort((a, b) => {
-	                  const scoreDelta = b.score - a.score;
-	                  if (scoreDelta) return scoreDelta;
-	                  const azDelta = Number(b.hasFlightAzimuth) - Number(a.hasFlightAzimuth);
-	                  if (azDelta) return azDelta;
-	                  const confDelta = b.confidence - a.confidence;
-	                  if (confDelta) return confDelta;
-	                  const timeDelta = (b.fetchedAtMs || 0) - (a.fetchedAtMs || 0);
-	                  if (timeDelta) return timeDelta;
-	                  return String(b.constraint.source_id || '').localeCompare(String(a.constraint.source_id || ''));
-	                });
-
-	              let tier2AltPick: { altMaxM: number; notes: string[]; picked: RankedTargetOrbitConstraint } | null = null;
-	              for (const ranked of rankedOrbitConstraints) {
-	                const inferred = inferTier2AltMaxMFromTargetOrbit(ranked.constraint.data);
-	                if (!inferred) continue;
-	                tier2AltPick = { ...inferred, picked: ranked };
-	                break;
-	              }
-
-	              let orbitAzPick: { azDeg: number; sigmaBonusDeg: number; notes: string[]; picked: RankedTargetOrbitConstraint } | null = null;
-	              for (const ranked of rankedOrbitConstraints) {
-	                const candidateAz = pickAzimuthFromTargetOrbit({
-	                  padLat: row.pad_latitude,
-	                  site,
-	                  missionClass,
-	                  padName: row.pad_name,
-	                  targetOrbit: ranked.constraint.data
-	                });
-	                if (!candidateAz) continue;
-	                orbitAzPick = { ...candidateAz, picked: ranked };
-	                break;
-	              }
-
-	              if (orbitAzPick) {
-	                const assumptionsTier2 = [
-	                  'Estimate corridor (no landing constraint)',
-	                  'Target orbit constraint used for azimuth estimate',
-	                  `Target orbit pick (azimuth): ${formatTargetOrbitPick(orbitAzPick.picked)}`,
-	                  ...orbitAzPick.notes,
-	                  tier2AltPick ? `Target orbit pick (altitude): ${formatTargetOrbitPick(tier2AltPick.picked)}` : null,
-	                  ...(tier2AltPick ? tier2AltPick.notes : []),
-	                  `Azimuth: ${orbitAzPick.azDeg.toFixed(1)} deg (orbit-derived)`,
-	                  'Altitude: simple exponential rise',
-	                  'Downrange: quadratic ease-in',
-	                  'Earth model: spherical direct solve'
-	                ].filter(Boolean) as string[];
-	                return buildTier2EstimateProduct({
-	                  padLat: row.pad_latitude,
-	                  padLon: row.pad_longitude,
-	                  azDeg: orbitAzPick.azDeg,
-	                  sigmaBonusDeg: orbitAzPick.sigmaBonusDeg,
-	                  altMaxM: tier2AltPick?.altMaxM ?? null,
-	                  assumptions: assumptionsTier2
-	                });
-	              }
-
-	                const az = pickAzimuthEstimate({ site, missionClass, padName: row.pad_name });
-
-	                const hazards = (constraintsByLaunch.get(row.launch_id) || []).filter(
-	                  (c) => c.constraint_type === 'hazard_area' && c.geometry && typeof c.geometry === 'object'
-	                );
-	                (stats.hazardsConsideredByLaunch as Record<string, number>)[row.launch_id] = hazards.length;
-	                stats.hazardsConsidered = (stats.hazardsConsidered as number) + hazards.length;
-
-	                const hazardAz = pickAzimuthFromHazards({
-	                  padLat: row.pad_latitude,
-	                  padLon: row.pad_longitude,
-	                  netIso: row.net,
-	                  expectedAzDeg: az?.azDeg ?? null,
-	                  clampMinDeg: az?.clampMin ?? null,
-	                  clampMaxDeg: az?.clampMax ?? null,
-	                  hazards
-	                });
-	                if (hazardAz) {
-	                  (stats.hazardsUsedByLaunch as Record<string, boolean>)[row.launch_id] = true;
-	                  stats.hazardsUsed = (stats.hazardsUsed as number) + 1;
-	                  const assumptionsTier2 = [
-	                    'Estimate corridor (no landing constraint)',
-	                    tier2AltPick ? `Target orbit pick (altitude): ${formatTargetOrbitPick(tier2AltPick.picked)}` : null,
-	                    ...(tier2AltPick ? tier2AltPick.notes : []),
-	                    'Hazard area constraint used for azimuth estimate',
-	                    ...hazardAz.notes,
-	                    `Azimuth: ${hazardAz.azDeg.toFixed(1)} deg (hazard-derived)`,
-	                    'Altitude: simple exponential rise',
-	                    'Downrange: quadratic ease-in',
-	                    'Earth model: spherical direct solve'
-	                  ].filter(Boolean) as string[];
-		                  return buildTier2EstimateProduct({
-		                    padLat: row.pad_latitude,
-		                    padLon: row.pad_longitude,
-		                    azDeg: hazardAz.azDeg,
-		                    sigmaBonusDeg: hazardAz.sigmaBonusDeg,
-		                    altMaxM: tier2AltPick?.altMaxM ?? null,
-		                    assumptions: assumptionsTier2
-		                  });
-		                }
-
-		                const templateAz = pickAzimuthFromTemplates({
-		                  templatesSetting: settings.trajectory_templates_v1,
-		                  site,
-		                  missionClass,
-		                  rocketFamily: row.rocket_family
-		                });
-		                if (templateAz) {
-		                  (stats.templatesUsedByLaunch as Record<string, string>)[row.launch_id] = templateAz.templateKey;
-		                  stats.templatesUsed = (stats.templatesUsed as number) + 1;
-		                  const assumptionsTier2 = [
-		                    'Estimate corridor (no landing constraint)',
-		                    tier2AltPick ? `Target orbit pick (altitude): ${formatTargetOrbitPick(tier2AltPick.picked)}` : null,
-		                    ...(tier2AltPick ? tier2AltPick.notes : []),
-		                    ...templateAz.notes,
-		                    'Altitude: simple exponential rise',
-		                    'Downrange: quadratic ease-in',
-		                    'Earth model: spherical direct solve'
-		                  ].filter(Boolean) as string[];
-		                  return buildTier2EstimateProduct({
-		                    padLat: row.pad_latitude,
-		                    padLon: row.pad_longitude,
-		                    azDeg: templateAz.azDeg,
-		                    sigmaBonusDeg: templateAz.sigmaBonusDeg,
-		                    altMaxM: tier2AltPick?.altMaxM ?? null,
-		                    assumptions: assumptionsTier2
-		                  });
-		                }
-
-		                if (az) {
-		                  const clampedAz = clamp(az.azDeg, az.clampMin, az.clampMax);
-		                  const assumptionsTier2 = [
-		                    'Estimate corridor (no landing constraint)',
-		                    tier2AltPick ? `Target orbit pick (altitude): ${formatTargetOrbitPick(tier2AltPick.picked)}` : null,
-	                    ...(tier2AltPick ? tier2AltPick.notes : []),
-	                    ...az.notes,
-	                    `Mission class: ${missionClass}`,
-	                    `Site: ${site}`,
-	                    `Azimuth: ${clampedAz.toFixed(1)} deg (clamped)`,
-	                    'Altitude: simple exponential rise',
-	                    'Downrange: quadratic ease-in',
-	                    'Earth model: spherical direct solve'
-	                  ].filter(Boolean) as string[];
-	                  return buildTier2EstimateProduct({
-	                    padLat: row.pad_latitude,
-	                    padLon: row.pad_longitude,
-	                    azDeg: clampedAz,
-	                    sigmaBonusDeg: az.sigmaBonusDeg,
-	                    altMaxM: tier2AltPick?.altMaxM ?? null,
-	                    assumptions: assumptionsTier2
-	                  });
-	                }
-	              }
+                const missionClass = classifyMission({
+                  orbitName: row.mission_orbit,
+                  missionName: row.mission_name,
+                  vehicleName: row.vehicle
+                });
+
+                const rankedOrbitConstraints = launchConstraints
+                  .filter((c) => c.constraint_type === 'target_orbit' && c.data && typeof c.data === 'object')
+                  .map((constraint) => scoreTargetOrbitConstraint(constraint, nowMs))
+                  .sort((a, b) => {
+                    const scoreDelta = b.score - a.score;
+                    if (scoreDelta) return scoreDelta;
+                    const azDelta = Number(b.hasFlightAzimuth) - Number(a.hasFlightAzimuth);
+                    if (azDelta) return azDelta;
+                    const confDelta = b.confidence - a.confidence;
+                    if (confDelta) return confDelta;
+                    const timeDelta = (b.fetchedAtMs || 0) - (a.fetchedAtMs || 0);
+                    if (timeDelta) return timeDelta;
+                    return String(b.constraint.source_id || '').localeCompare(String(a.constraint.source_id || ''));
+                  });
+
+                let tier2AltPick: { altMaxM: number; notes: string[]; picked: RankedTargetOrbitConstraint } | null = null;
+                for (const ranked of rankedOrbitConstraints) {
+                  const inferred = inferTier2AltMaxMFromTargetOrbit(ranked.constraint.data);
+                  if (!inferred) continue;
+                  tier2AltPick = { ...inferred, picked: ranked };
+                  break;
+                }
+
+                let orbitAzPick: { azDeg: number; sigmaBonusDeg: number; notes: string[]; picked: RankedTargetOrbitConstraint } | null = null;
+                for (const ranked of rankedOrbitConstraints) {
+                  const candidateAz = pickAzimuthFromTargetOrbit({
+                    padLat: row.pad_latitude,
+                    site,
+                    missionClass,
+                    padName: row.pad_name,
+                    targetOrbit: ranked.constraint.data
+                  });
+                  if (!candidateAz) continue;
+                  orbitAzPick = { ...candidateAz, picked: ranked };
+                  break;
+                }
+
+                if (orbitAzPick) {
+                  usedConstraints.push({
+                    constraint: orbitAzPick.picked.constraint,
+                    role: 'orbit_azimuth',
+                    weightUsed: 1
+                  });
+                  if (tier2AltPick) {
+                    usedConstraints.push({
+                      constraint: tier2AltPick.picked.constraint,
+                      role: 'orbit_altitude',
+                      weightUsed: 0.65
+                    });
+                  }
+                  const assumptionsTier2 = [
+                    'Estimate corridor (no landing constraint)',
+                    'Target orbit constraint used for azimuth estimate',
+                    `Target orbit pick (azimuth): ${formatTargetOrbitPick(orbitAzPick.picked)}`,
+                    ...orbitAzPick.notes,
+                    tier2AltPick ? `Target orbit pick (altitude): ${formatTargetOrbitPick(tier2AltPick.picked)}` : null,
+                    ...(tier2AltPick ? tier2AltPick.notes : []),
+                    `Azimuth: ${orbitAzPick.azDeg.toFixed(1)} deg (orbit-derived)`,
+                    'Altitude: simple exponential rise',
+                    'Downrange: quadratic ease-in',
+                    'Earth model: WGS84 geodesic solve'
+                  ].filter(Boolean) as string[];
+                  return buildTier2EstimateProduct({
+                    padLat: row.pad_latitude,
+                    padLon: row.pad_longitude,
+                    azDeg: orbitAzPick.azDeg,
+                    sigmaBonusDeg: orbitAzPick.sigmaBonusDeg,
+                    altMaxM: tier2AltPick?.altMaxM ?? null,
+                    assumptions: assumptionsTier2
+                  });
+                }
+
+                const az = pickAzimuthEstimate({ site, missionClass, padName: row.pad_name });
+
+                const hazards = launchConstraints.filter(
+                  (c) => c.constraint_type === 'hazard_area' && c.geometry && typeof c.geometry === 'object'
+                );
+                (stats.hazardsConsideredByLaunch as Record<string, number>)[row.launch_id] = hazards.length;
+                stats.hazardsConsidered = (stats.hazardsConsidered as number) + hazards.length;
+
+                const hazardAz = pickAzimuthFromHazards({
+                  padLat: row.pad_latitude,
+                  padLon: row.pad_longitude,
+                  netIso: row.net,
+                  expectedAzDeg: az?.azDeg ?? null,
+                  clampMinDeg: az?.clampMin ?? null,
+                  clampMaxDeg: az?.clampMax ?? null,
+                  hazards
+                });
+                if (hazardAz) {
+                  usedConstraints.push({
+                    constraint: hazardAz.constraint,
+                    role: 'hazard_azimuth',
+                    weightUsed: 0.9
+                  });
+                  if (tier2AltPick) {
+                    usedConstraints.push({
+                      constraint: tier2AltPick.picked.constraint,
+                      role: 'orbit_altitude',
+                      weightUsed: 0.55
+                    });
+                  }
+                  (stats.hazardsUsedByLaunch as Record<string, boolean>)[row.launch_id] = true;
+                  stats.hazardsUsed = (stats.hazardsUsed as number) + 1;
+                  const assumptionsTier2 = [
+                    'Estimate corridor (no landing constraint)',
+                    tier2AltPick ? `Target orbit pick (altitude): ${formatTargetOrbitPick(tier2AltPick.picked)}` : null,
+                    ...(tier2AltPick ? tier2AltPick.notes : []),
+                    'Hazard area constraint used for azimuth estimate',
+                    ...hazardAz.notes,
+                    `Azimuth: ${hazardAz.azDeg.toFixed(1)} deg (hazard-derived)`,
+                    'Altitude: simple exponential rise',
+                    'Downrange: quadratic ease-in',
+                    'Earth model: WGS84 geodesic solve'
+                  ].filter(Boolean) as string[];
+                  return buildTier2EstimateProduct({
+                    padLat: row.pad_latitude,
+                    padLon: row.pad_longitude,
+                    azDeg: hazardAz.azDeg,
+                    sigmaBonusDeg: hazardAz.sigmaBonusDeg,
+                    altMaxM: tier2AltPick?.altMaxM ?? null,
+                    assumptions: assumptionsTier2
+                  });
+                }
+
+                const templateAz = pickAzimuthFromTemplates({
+                  templatesSetting: settings.trajectory_templates_v1,
+                  site,
+                  missionClass,
+                  rocketFamily: row.rocket_family
+                });
+                if (templateAz) {
+                  (stats.templatesUsedByLaunch as Record<string, string>)[row.launch_id] = templateAz.templateKey;
+                  stats.templatesUsed = (stats.templatesUsed as number) + 1;
+                  if (tier2AltPick) {
+                    usedConstraints.push({
+                      constraint: tier2AltPick.picked.constraint,
+                      role: 'orbit_altitude',
+                      weightUsed: 0.45
+                    });
+                  }
+                  const assumptionsTier2 = [
+                    'Estimate corridor (no landing constraint)',
+                    tier2AltPick ? `Target orbit pick (altitude): ${formatTargetOrbitPick(tier2AltPick.picked)}` : null,
+                    ...(tier2AltPick ? tier2AltPick.notes : []),
+                    ...templateAz.notes,
+                    'Altitude: simple exponential rise',
+                    'Downrange: quadratic ease-in',
+                    'Earth model: WGS84 geodesic solve'
+                  ].filter(Boolean) as string[];
+                  return buildTier2EstimateProduct({
+                    padLat: row.pad_latitude,
+                    padLon: row.pad_longitude,
+                    azDeg: templateAz.azDeg,
+                    sigmaBonusDeg: templateAz.sigmaBonusDeg,
+                    altMaxM: tier2AltPick?.altMaxM ?? null,
+                    assumptions: assumptionsTier2
+                  });
+                }
+
+                if (az) {
+                  if (tier2AltPick) {
+                    usedConstraints.push({
+                      constraint: tier2AltPick.picked.constraint,
+                      role: 'orbit_altitude',
+                      weightUsed: 0.35
+                    });
+                  }
+                  const clampedAz = clamp(az.azDeg, az.clampMin, az.clampMax);
+                  const assumptionsTier2 = [
+                    'Estimate corridor (no landing constraint)',
+                    tier2AltPick ? `Target orbit pick (altitude): ${formatTargetOrbitPick(tier2AltPick.picked)}` : null,
+                    ...(tier2AltPick ? tier2AltPick.notes : []),
+                    ...az.notes,
+                    `Mission class: ${missionClass}`,
+                    `Site: ${site}`,
+                    `Azimuth: ${clampedAz.toFixed(1)} deg (clamped)`,
+                    'Altitude: simple exponential rise',
+                    'Downrange: quadratic ease-in',
+                    'Earth model: WGS84 geodesic solve'
+                  ].filter(Boolean) as string[];
+                  return buildTier2EstimateProduct({
+                    padLat: row.pad_latitude,
+                    padLon: row.pad_longitude,
+                    azDeg: clampedAz,
+                    sigmaBonusDeg: az.sigmaBonusDeg,
+                    altMaxM: tier2AltPick?.altMaxM ?? null,
+                    assumptions: assumptionsTier2
+                  });
+                }
+              }
+
               return buildPadOnlyProduct({
                 lat: row.pad_latitude,
                 lon: row.pad_longitude
               });
             })();
 
-      const durationSec = maxTPlusSec(product.samples);
       const timelineEvents = buildTimelineEvents(row.timeline);
       const fallbackEvents = timelineEvents.length ? [] : buildDefaultEvents(row.rocket_family);
       const liftoffEvent: TrajectoryEvent = { key: 'LIFTOFF', tPlusSec: 0, label: 'Liftoff', confidence: 'high' };
-      product.events = mergeEvents([liftoffEvent, ...timelineEvents, ...fallbackEvents], durationSec);
+      const applyEvents = (targetProduct: TrajectoryProduct) => {
+        const durationSec = maxTPlusSec(targetProduct.samples);
+        targetProduct.events = mergeEvents([liftoffEvent, ...timelineEvents, ...fallbackEvents], durationSec);
+      };
+      applyEvents(product);
+
+      const prePublishContract = evaluateSourceContract({
+        launch: row,
+        product,
+        usedConstraints,
+        allConstraints: launchConstraints,
+        nowMs
+      });
+
+      let finalProduct = product;
+      let finalContract = prePublishContract;
+      let finalUsedConstraints = usedConstraints.slice();
+      let downgraded = false;
+
+      if (shouldDowngradeForPublish({ product, contract: prePublishContract })) {
+        downgraded = true;
+        finalProduct = buildPadOnlyProduct({
+          lat: row.pad_latitude,
+          lon: row.pad_longitude
+        });
+        finalProduct.assumptions = [
+          ...finalProduct.assumptions,
+          'Precision claim removed: source contract failed',
+          ...prePublishContract.blockingReasons.map((reason) => `Source contract: ${reason}`)
+        ];
+        applyEvents(finalProduct);
+        finalUsedConstraints = [];
+        finalContract = buildDowngradedContractEval(prePublishContract);
+      }
+
+      finalProduct = attachProductMetadata({
+        product: finalProduct,
+        contract: finalContract,
+        timelineEvents,
+        fallbackEvents,
+        usedConstraints: finalUsedConstraints,
+        downgraded
+      });
+
+      const generatedAt = new Date().toISOString();
 
       return {
-        launch_id: row.launch_id,
-        version: product.version,
-        quality: product.quality,
-        generated_at: new Date().toISOString(),
-        product
+        launchId: row.launch_id,
+        confidenceTier: finalContract.confidenceTier,
+        downgraded,
+        productRow: {
+          launch_id: row.launch_id,
+          version: finalProduct.version,
+          quality: finalProduct.quality,
+          generated_at: generatedAt,
+          product: finalProduct,
+          ingestion_run_id: runId,
+          confidence_tier: finalContract.confidenceTier,
+          source_sufficiency: finalContract.sourceSufficiency,
+          freshness_state: finalContract.freshnessState,
+          lineage_complete: finalContract.lineageComplete
+        },
+        sourceContractRow: {
+          launch_id: row.launch_id,
+          product_version: finalProduct.version,
+          contract_version: 'source_contract_v2_1',
+          confidence_tier: finalContract.confidenceTier,
+          status: finalContract.status,
+          source_sufficiency: finalContract.sourceSufficiency,
+          required_fields: finalContract.requiredFields,
+          missing_fields: finalContract.missingFields,
+          blocking_reasons: finalContract.blockingReasons,
+          freshness_state: finalContract.freshnessState,
+          lineage_complete: finalContract.lineageComplete,
+          evaluated_at: generatedAt,
+          ingestion_run_id: runId
+        },
+        lineageRows: buildTrajectoryProductLineageRows({
+          launchId: row.launch_id,
+          productVersion: finalProduct.version,
+          generatedAt,
+          usedConstraints: finalUsedConstraints,
+          ingestionRunId: runId
+        })
       };
     });
 
+    const rows = generated.map((entry) => entry.productRow);
+    const sourceContractRows = generated.map((entry) => entry.sourceContractRow);
+    const lineageRows = generated.flatMap((entry) => entry.lineageRows);
+
+    stats.confidenceTierByLaunch = Object.fromEntries(generated.map((entry) => [entry.launchId, entry.confidenceTier]));
+    stats.downgradedLaunches = generated.filter((entry) => entry.downgraded).map((entry) => entry.launchId);
+
     const { error: upsertError } = await supabase
       .from('launch_trajectory_products')
       .upsert(rows, { onConflict: 'launch_id' });
@@ -520,7 +708,27 @@ serve(async (req) => {
       throw new Error(`Failed to upsert launch_trajectory_products: ${upsertError.message}`);
     }
 
+    if (sourceContractRows.length) {
+      const { error: sourceContractError } = await supabase
+        .from('trajectory_source_contracts')
+        .insert(sourceContractRows);
+      if (sourceContractError) {
+        throw new Error(`Failed to insert trajectory_source_contracts: ${sourceContractError.message}`);
+      }
+    }
+
+    if (lineageRows.length) {
+      const { error: lineageError } = await supabase
+        .from('trajectory_product_lineage')
+        .upsert(lineageRows, { onConflict: 'launch_id,product_version,generated_at,source_ref_id' });
+      if (lineageError) {
+        throw new Error(`Failed to upsert trajectory_product_lineage: ${lineageError.message}`);
+      }
+    }
+
     stats.upserted = rows.length;
+    stats.sourceContractsInserted = sourceContractRows.length;
+    stats.lineageRowsInserted = lineageRows.length;
 
     await supabase
       .from('system_settings')
@@ -535,11 +743,583 @@ serve(async (req) => {
   }
 });
 
-function buildPadOnlyProduct({ lat, lon }: { lat: number | null; lon: number | null }) {
+function evaluateSourceContract({
+  launch,
+  product,
+  usedConstraints,
+  allConstraints,
+  nowMs
+}: {
+  launch: LaunchRow;
+  product: TrajectoryProduct;
+  usedConstraints: ProductConstraintUsage[];
+  allConstraints: ConstraintRow[];
+  nowMs: number;
+}): SourceContractEval {
+  const qualityLabel = String(product.qualityLabel || 'pad_only');
+  const precisionClaim = qualityLabel === 'landing_constrained' || qualityLabel === 'estimate_corridor';
+  const minimumTier = minimumTierForQualityLabel(qualityLabel);
+  const isSpaceX = isSpaceXLaunch(launch);
+
+  const hasPadLat = typeof launch.pad_latitude === 'number' && Number.isFinite(launch.pad_latitude);
+  const hasPadLon = typeof launch.pad_longitude === 'number' && Number.isFinite(launch.pad_longitude);
+  const hasPad = hasPadLat && hasPadLon;
+
+  const directionalUsages = usedConstraints.filter((usage) => isDirectionalRole(usage.role));
+  const hasDirectionalConstraint = directionalUsages.length > 0;
+  const hasLandingDirectional = directionalUsages.some(
+    (usage) => usage.role === 'landing_primary' && hasLandingCoordinates(usage.constraint)
+  );
+  const hasHazardDirectional = directionalUsages.some((usage) => usage.role === 'hazard_azimuth');
+
+  const uniqueUsedConstraints = dedupeConstraintUsage(usedConstraints);
+  const targetOrbitConstraints = allConstraints.filter((constraint) => constraint.constraint_type === 'target_orbit');
+  const hasMissionNumericOrbit = targetOrbitConstraints.some((constraint) => hasTargetOrbitNumerics(constraint) && !isDerivedConstraint(constraint));
+  const hasSupgpConstraint = targetOrbitConstraints.some((constraint) => isSupgpConstraint(constraint));
+  const hasLicensedTrajectoryFeed = targetOrbitConstraints.some((constraint) => isLicensedTrajectoryConstraint(constraint));
+
+  const spaceXCompletenessState = isSpaceX
+    ? hasLicensedTrajectoryFeed
+      ? 'licensed'
+      : hasSupgpConstraint
+        ? 'supgp'
+        : hasHazardDirectional
+          ? 'hazard'
+          : 'baseline'
+    : null;
+  const spaceXP95EnvelopeDeg =
+    spaceXCompletenessState === 'licensed'
+      ? '2-6'
+      : spaceXCompletenessState === 'supgp'
+        ? '4-9'
+        : spaceXCompletenessState === 'hazard'
+          ? '7-16'
+          : spaceXCompletenessState === 'baseline'
+            ? '20-35'
+            : null;
+
+  const freshnessBasisConstraints = uniqueUsedConstraints.length ? uniqueUsedConstraints : allConstraints;
+  const freshnessThresholdHours = getFreshnessThresholdHours({
+    netIso: launch.net,
+    nowMs
+  });
+  const newestConstraintAgeHours = newestConstraintAgeHoursFromRows(freshnessBasisConstraints, nowMs);
+  const freshnessState: 'fresh' | 'stale' | 'unknown' =
+    newestConstraintAgeHours == null ? 'unknown' : newestConstraintAgeHours <= freshnessThresholdHours ? 'fresh' : 'stale';
+
+  const nonDerivedDirectionalCount = directionalUsages.filter((usage) => !isDerivedConstraint(usage.constraint)).length;
+  const highConfidenceDirectional = directionalUsages.some(
+    (usage) => typeof usage.constraint.confidence === 'number' && Number.isFinite(usage.constraint.confidence) && usage.constraint.confidence >= 0.85
+  );
+
+  const lineageComplete = precisionClaim
+    ? uniqueUsedConstraints.length > 0 && uniqueUsedConstraints.every((constraint) => hasDeterministicConstraintIdentity(constraint))
+    : uniqueUsedConstraints.every((constraint) => hasDeterministicConstraintIdentity(constraint));
+
+  const missingFields: string[] = [];
+  if (!hasPadLat) missingFields.push('pad_latitude');
+  if (!hasPadLon) missingFields.push('pad_longitude');
+  if (precisionClaim && !hasDirectionalConstraint) missingFields.push('directional_constraint');
+  if (qualityLabel === 'landing_constrained' && !hasLandingDirectional) missingFields.push('landing_location');
+  if (precisionClaim && !lineageComplete) missingFields.push('lineage_identity');
+  if (isSpaceX && precisionClaim && !hasMissionNumericOrbit && !hasSupgpConstraint && !hasHazardDirectional) {
+    missingFields.push('spacex_orbit_constraint');
+  }
+
+  const blockingReasons: string[] = [];
+  if (missingFields.length) blockingReasons.push(`missing_required_fields:${missingFields.join(',')}`);
+  if (precisionClaim && freshnessState === 'stale') blockingReasons.push('sources_stale_for_precision_claim');
+  if (precisionClaim && !hasDirectionalConstraint) blockingReasons.push('no_constraint_backed_track');
+  if (precisionClaim && uniqueUsedConstraints.length === 0) blockingReasons.push('no_constraint_lineage');
+  if (precisionClaim && !lineageComplete) blockingReasons.push('lineage_incomplete');
+  if (isSpaceX && precisionClaim && spaceXCompletenessState === 'baseline') {
+    blockingReasons.push('spacex_baseline_only_precision_blocked');
+  }
+  if (isSpaceX && precisionClaim && !hasMissionNumericOrbit && !hasSupgpConstraint) {
+    blockingReasons.push('spacex_missing_numeric_orbit_prelaunch');
+  }
+
+  let confidenceTier: TrajectoryConfidenceTier = 'D';
+  if (!hasPad) {
+    confidenceTier = 'D';
+  } else if (hasDirectionalConstraint && freshnessState === 'fresh' && nonDerivedDirectionalCount > 0 && highConfidenceDirectional && lineageComplete) {
+    confidenceTier = 'A';
+  } else if (hasDirectionalConstraint && freshnessState !== 'stale' && lineageComplete) {
+    confidenceTier = 'B';
+  } else if (hasPad && (hasDirectionalConstraint || uniqueUsedConstraints.length > 0 || !precisionClaim)) {
+    confidenceTier = 'C';
+  } else {
+    confidenceTier = 'D';
+  }
+  if (isSpaceX && !hasMissionNumericOrbit && !hasSupgpConstraint && confidenceTier === 'A') {
+    confidenceTier = 'B';
+  }
+  if (isSpaceX && precisionClaim && spaceXCompletenessState === 'baseline') {
+    confidenceTier = 'D';
+  }
+
+  const dedupedMissingFields = [...new Set(missingFields)];
+  const dedupedBlockingReasons = [...new Set(blockingReasons)];
+
+  const tierPass = confidenceTierRank(confidenceTier) >= confidenceTierRank(minimumTier);
+  const freshnessPass = !precisionClaim || freshnessState !== 'stale';
+  const missingPass = dedupedMissingFields.length === 0;
+  const status: 'pass' | 'fail' = tierPass && freshnessPass && missingPass ? 'pass' : 'fail';
+
+  const netMs = typeof launch.net === 'string' ? Date.parse(launch.net) : NaN;
+  const hoursToNet = Number.isFinite(netMs) ? (netMs - nowMs) / (60 * 60 * 1000) : null;
+
+  return {
+    confidenceTier,
+    status,
+    sourceSufficiency: {
+      contractVersion: 'source_contract_v2_1',
+      qualityLabel,
+      precisionClaim,
+      minimumTier,
+      freshnessThresholdHours,
+      newestConstraintAgeHours,
+      hoursToNet,
+      signalSummary: {
+        hasPad,
+        hasDirectionalConstraint,
+        hasLandingDirectional,
+        hasHazardDirectional,
+        hasMissionNumericOrbit,
+        hasSupgpConstraint,
+        hasLicensedTrajectoryFeed,
+        nonDerivedDirectionalCount,
+        highConfidenceDirectional,
+        usedConstraintCount: uniqueUsedConstraints.length
+      },
+      ...(isSpaceX
+        ? {
+            spaceX: {
+              completenessState: spaceXCompletenessState,
+              expectedAngularErrorP95Deg: spaceXP95EnvelopeDeg,
+              missionNumericOrbitPresent: hasMissionNumericOrbit,
+              supgpPresent: hasSupgpConstraint,
+              hazardPresent: hasHazardDirectional
+            }
+          }
+        : {})
+    },
+    requiredFields: {
+      pad_latitude: true,
+      pad_longitude: true,
+      directional_constraint: precisionClaim,
+      landing_location: qualityLabel === 'landing_constrained',
+      freshness_threshold_hours: freshnessThresholdHours,
+      minimum_tier: minimumTier,
+      spacex_orbit_constraint: isSpaceX && precisionClaim
+    },
+    missingFields: dedupedMissingFields,
+    blockingReasons: dedupedBlockingReasons,
+    freshnessState,
+    lineageComplete
+  };
+}
+
+function shouldDowngradeForPublish({
+  product,
+  contract
+}: {
+  product: TrajectoryProduct;
+  contract: SourceContractEval;
+}) {
+  const qualityLabel = String(product.qualityLabel || '');
+  const hasPrecisionClaim = qualityLabel === 'landing_constrained' || qualityLabel === 'estimate_corridor';
+  return hasPrecisionClaim && contract.status === 'fail';
+}
+
+function buildDowngradedContractEval(contract: SourceContractEval): SourceContractEval {
+  const blockingReasons = [...contract.blockingReasons];
+  if (!blockingReasons.includes('precision_claim_downgraded_to_pad_only')) {
+    blockingReasons.push('precision_claim_downgraded_to_pad_only');
+  }
+  return {
+    ...contract,
+    confidenceTier: 'D',
+    status: 'fail',
+    blockingReasons,
+    lineageComplete: false,
+    sourceSufficiency: {
+      ...contract.sourceSufficiency,
+      downgradedToPadOnly: true,
+      preDowngradeTier: contract.confidenceTier
+    }
+  };
+}
+
+function attachProductMetadata({
+  product,
+  contract,
+  timelineEvents,
+  fallbackEvents,
+  usedConstraints,
+  downgraded
+}: {
+  product: TrajectoryProduct;
+  contract: SourceContractEval;
+  timelineEvents: TrajectoryEvent[];
+  fallbackEvents: TrajectoryEvent[];
+  usedConstraints: ProductConstraintUsage[];
+  downgraded: boolean;
+}): TrajectoryProduct {
+  const sourceRefIds = dedupeConstraintUsage(usedConstraints).map((constraint) => buildDeterministicSourceRefId(constraint));
+  const milestoneSourceRefIds = sourceRefIds.length ? sourceRefIds : ['model:default'];
+  const confidenceCounts = {
+    high: product.events.filter((event) => event.confidence === 'high').length,
+    med: product.events.filter((event) => event.confidence === 'med').length,
+    low: product.events.filter((event) => event.confidence === 'low').length
+  };
+  const milestones = product.events.map((event) => ({
+    key: event.key,
+    tPlusSec: event.tPlusSec,
+    label: event.label,
+    confidence: event.confidence ?? 'low',
+    sourceRefIds: milestoneSourceRefIds
+  }));
+
+  const coreTrack = {
+    trackKind: 'core_up',
+    samples: product.samples
+  };
+  const hasLandingPrimary = usedConstraints.some((usage) => usage.role === 'landing_primary');
+  const boosterTrack =
+    hasLandingPrimary && product.samples.length >= 2
+      ? {
+          trackKind: 'booster_down',
+          samples: [...product.samples]
+            .reverse()
+            .map((sample, idx, arr) => {
+              const anchor = arr[0];
+              const tPlusSec =
+                typeof anchor?.tPlusSec === 'number' && Number.isFinite(anchor.tPlusSec) && anchor.tPlusSec >= sample.tPlusSec
+                  ? Math.max(0, Math.round(anchor.tPlusSec - sample.tPlusSec))
+                  : idx * 2;
+              return {
+                ...sample,
+                tPlusSec,
+                sigmaDeg: clamp((typeof sample.sigmaDeg === 'number' ? sample.sigmaDeg : 10) + 3, 0, 90)
+              };
+            })
+            .sort((a, b) => a.tPlusSec - b.tPlusSec)
+        }
+      : null;
+  const tracks = boosterTrack ? [coreTrack, boosterTrack] : [coreTrack];
+
+  return {
+    ...product,
+    sourceSufficiency: {
+      confidenceTier: contract.confidenceTier,
+      status: contract.status,
+      freshnessState: contract.freshnessState,
+      lineageComplete: contract.lineageComplete,
+      requiredFields: contract.requiredFields,
+      missingFields: contract.missingFields,
+      blockingReasons: contract.blockingReasons,
+      ...contract.sourceSufficiency
+    },
+    milestones,
+    milestoneSummary: {
+      total: product.events.length,
+      fromTimeline: timelineEvents.length,
+      fromFallback: fallbackEvents.length,
+      confidenceCounts
+    },
+    tracks,
+    trackSummary: {
+      quality: product.quality,
+      qualityLabel: product.qualityLabel,
+      confidenceTier: contract.confidenceTier,
+      freshnessState: contract.freshnessState,
+      precisionClaim: product.quality > 0 && contract.confidenceTier !== 'D',
+      sourceCount: milestoneSourceRefIds.length,
+      sourceRefIds: milestoneSourceRefIds,
+      trackCount: tracks.length,
+      downgraded
+    }
+  };
+}
+
+function buildTrajectoryProductLineageRows({
+  launchId,
+  productVersion,
+  generatedAt,
+  usedConstraints,
+  ingestionRunId
+}: {
+  launchId: string;
+  productVersion: string;
+  generatedAt: string;
+  usedConstraints: ProductConstraintUsage[];
+  ingestionRunId: number | null;
+}) {
+  if (!usedConstraints.length) return [] as Array<Record<string, unknown>>;
+
+  const rowsByRef = new Map<
+    string,
+    {
+      row: Record<string, unknown>;
+      roles: Set<string>;
+    }
+  >();
+
+  for (const usage of usedConstraints) {
+    const constraint = usage.constraint;
+    const sourceRefId = buildDeterministicSourceRefId(constraint);
+    const confidence =
+      typeof constraint.confidence === 'number' && Number.isFinite(constraint.confidence) ? constraint.confidence : null;
+
+    let entry = rowsByRef.get(sourceRefId);
+    if (!entry) {
+      const extractedFieldMap =
+        constraint.extracted_field_map && typeof constraint.extracted_field_map === 'object'
+          ? { ...(constraint.extracted_field_map as Record<string, unknown>) }
+          : {};
+
+      entry = {
+        row: {
+          launch_id: launchId,
+          product_version: productVersion,
+          generated_at: generatedAt,
+          source_ref_id: sourceRefId,
+          source: String(constraint.source || 'unknown'),
+          source_id: constraint.source_id ?? null,
+          source_kind: constraint.constraint_type || null,
+          license_class: constraint.license_class ?? null,
+          constraint_id: typeof constraint.id === 'number' && Number.isFinite(constraint.id) ? Math.trunc(constraint.id) : null,
+          source_document_id: extractSourceDocumentId(constraint),
+          source_url: extractSourceUrl(constraint),
+          source_hash: constraint.source_hash ?? extractDocumentHash(constraint),
+          parser_version: constraint.parser_version ?? extractParserVersion(constraint),
+          parse_rule_id: constraint.parse_rule_id ?? null,
+          extracted_field_map: extractedFieldMap,
+          fetched_at: constraint.fetched_at ?? null,
+          weight_used: usage.weightUsed,
+          confidence,
+          ingestion_run_id: ingestionRunId
+        },
+        roles: new Set<string>()
+      };
+      rowsByRef.set(sourceRefId, entry);
+    } else {
+      const previousWeight =
+        typeof entry.row.weight_used === 'number' && Number.isFinite(entry.row.weight_used) ? entry.row.weight_used : 0;
+      if (usage.weightUsed > previousWeight) entry.row.weight_used = usage.weightUsed;
+      const previousConfidence =
+        typeof entry.row.confidence === 'number' && Number.isFinite(entry.row.confidence) ? entry.row.confidence : null;
+      if (confidence != null && (previousConfidence == null || confidence > previousConfidence)) {
+        entry.row.confidence = confidence;
+      }
+    }
+
+    entry.roles.add(usage.role);
+  }
+
+  return [...rowsByRef.values()].map((entry) => {
+    const baseMap =
+      entry.row.extracted_field_map && typeof entry.row.extracted_field_map === 'object'
+        ? (entry.row.extracted_field_map as Record<string, unknown>)
+        : {};
+    entry.row.extracted_field_map = {
+      ...baseMap,
+      lineage_roles: [...entry.roles].sort()
+    };
+    return entry.row;
+  });
+}
+
+function dedupeConstraintUsage(usedConstraints: ProductConstraintUsage[]) {
+  const byKey = new Map<string, ConstraintRow>();
+  for (const usage of usedConstraints) {
+    const key = buildConstraintIdentityKey(usage.constraint);
+    if (!byKey.has(key)) byKey.set(key, usage.constraint);
+  }
+  return [...byKey.values()];
+}
+
+function buildConstraintIdentityKey(constraint: ConstraintRow) {
+  const idPart = typeof constraint.id === 'number' && Number.isFinite(constraint.id) ? `id:${Math.trunc(constraint.id)}` : null;
+  if (idPart) return idPart;
+  return [
+    `type:${normalizeRefPart(constraint.constraint_type || 'unknown')}`,
+    `src:${normalizeRefPart(constraint.source || 'unknown')}`,
+    `sid:${normalizeRefPart(constraint.source_id || '')}`,
+    `hash:${normalizeRefPart(constraint.source_hash || '')}`,
+    `fetch:${normalizeRefPart(constraint.fetched_at || '')}`
+  ].join('|');
+}
+
+function buildDeterministicSourceRefId(constraint: ConstraintRow) {
+  const type = normalizeRefPart(constraint.constraint_type || 'unknown');
+  if (typeof constraint.id === 'number' && Number.isFinite(constraint.id)) {
+    return `${type}:cid:${Math.trunc(constraint.id)}`;
+  }
+  const source = normalizeRefPart(constraint.source || 'unknown');
+  const sourceId = normalizeRefPart(constraint.source_id || '');
+  if (sourceId) return `${type}:${source}:sid:${sourceId}`;
+  const sourceHash = normalizeRefPart(constraint.source_hash || extractDocumentHash(constraint) || '');
+  if (sourceHash) return `${type}:${source}:hash:${sourceHash}`;
+  const fetched = normalizeRefPart(constraint.fetched_at || '');
+  if (fetched) return `${type}:${source}:fetched:${fetched}`;
+  return `${type}:${source}:anonymous`;
+}
+
+function normalizeRefPart(value: unknown) {
+  const raw = String(value || '').trim().toLowerCase();
+  if (!raw) return '';
+  return raw.replace(/[^a-z0-9._:-]+/g, '_').replace(/_+/g, '_').slice(0, 128);
+}
+
+function extractSourceDocumentId(constraint: ConstraintRow) {
+  const data = constraint.data && typeof constraint.data === 'object' ? (constraint.data as any) : null;
+  const fromData = parseUuidLike(data?.documentId ?? null);
+  if (fromData) return fromData;
+  if (constraint.source === 'presskit_auto') return parseUuidLike(constraint.source_id ?? null);
+  return null;
+}
+
+function extractSourceUrl(constraint: ConstraintRow) {
+  const data = constraint.data && typeof constraint.data === 'object' ? (constraint.data as any) : null;
+  const value = typeof data?.sourceUrl === 'string' ? data.sourceUrl.trim() : '';
+  return value || null;
+}
+
+function extractDocumentHash(constraint: ConstraintRow) {
+  const data = constraint.data && typeof constraint.data === 'object' ? (constraint.data as any) : null;
+  const value = typeof data?.documentHash === 'string' ? data.documentHash.trim() : '';
+  return value || null;
+}
+
+function extractParserVersion(constraint: ConstraintRow) {
+  const data = constraint.data && typeof constraint.data === 'object' ? (constraint.data as any) : null;
+  const value = typeof data?.parserVersion === 'string' ? data.parserVersion.trim() : '';
+  return value || null;
+}
+
+function parseUuidLike(value: unknown) {
+  const raw = String(value || '').trim();
+  if (!raw) return null;
+  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw) ? raw : null;
+}
+
+function hasLandingCoordinates(constraint: ConstraintRow) {
+  if (constraint.constraint_type !== 'landing') return false;
+  const landingLocation = constraint?.data?.landing_location;
+  return (
+    typeof landingLocation?.latitude === 'number' &&
+    Number.isFinite(landingLocation.latitude) &&
+    typeof landingLocation?.longitude === 'number' &&
+    Number.isFinite(landingLocation.longitude)
+  );
+}
+
+function isDirectionalRole(role: ProductConstraintRole) {
+  return role === 'landing_primary' || role === 'orbit_azimuth' || role === 'hazard_azimuth';
+}
+
+function isDerivedConstraint(constraint: ConstraintRow) {
+  return Boolean(constraint?.data?.derived);
+}
+
+function isSupgpConstraint(constraint: ConstraintRow) {
+  if (String(constraint.source || '').toLowerCase() === 'celestrak_supgp') return true;
+  const orbitType = String(constraint?.data?.orbitType || '').toLowerCase();
+  if (orbitType.includes('supgp')) return true;
+  const sourceId = String(constraint.source_id || '').toLowerCase();
+  return sourceId.startsWith('supgp:');
+}
+
+function isLicensedTrajectoryConstraint(constraint: ConstraintRow) {
+  const license = String(constraint.license_class || '').toLowerCase();
+  if (!license) return false;
+  return license.includes('licensed') || license.includes('partner') || license.includes('operator');
+}
+
+function hasTargetOrbitNumerics(constraint: ConstraintRow) {
+  if (constraint.constraint_type !== 'target_orbit') return false;
+  const data = constraint.data && typeof constraint.data === 'object' ? (constraint.data as any) : null;
+  if (!data) return false;
+  const hasDirection =
+    typeof data.flight_azimuth_deg === 'number' ||
+    typeof data.inclination_deg === 'number';
+  const hasOrbitShape =
+    typeof data.altitude_km === 'number' ||
+    typeof data.apogee_km === 'number' ||
+    typeof data.perigee_km === 'number';
+  return hasDirection || hasOrbitShape;
+}
+
+function isSpaceXLaunch(launch: LaunchRow) {
+  const provider = String(launch.provider || '').toLowerCase();
+  const vehicle = String(launch.vehicle || '').toLowerCase();
+  const mission = String(launch.mission_name || '').toLowerCase();
+  return (
+    provider.includes('spacex') ||
+    vehicle.includes('falcon') ||
+    vehicle.includes('starship') ||
+    mission.includes('spacex') ||
+    mission.includes('starlink')
+  );
+}
+
+function hasDeterministicConstraintIdentity(constraint: ConstraintRow) {
+  if (typeof constraint.id === 'number' && Number.isFinite(constraint.id)) return true;
+  if (normalizeRefPart(constraint.source_id || '')) return true;
+  if (normalizeRefPart(constraint.source_hash || '')) return true;
+  if (parseUuidLike((constraint?.data as any)?.documentId || null)) return true;
+  return false;
+}
+
+function newestConstraintAgeHoursFromRows(constraints: ConstraintRow[], nowMs: number) {
+  let newestMs = Number.NEGATIVE_INFINITY;
+  for (const constraint of constraints) {
+    const fetchedAtMs = typeof constraint.fetched_at === 'string' ? Date.parse(constraint.fetched_at) : NaN;
+    if (!Number.isFinite(fetchedAtMs)) continue;
+    if (fetchedAtMs > newestMs) newestMs = fetchedAtMs;
+  }
+  if (newestMs === Number.NEGATIVE_INFINITY) return null;
+  return Math.max(0, (nowMs - newestMs) / (60 * 60 * 1000));
+}
+
+function getFreshnessThresholdHours({
+  netIso,
+  nowMs
+}: {
+  netIso: string | null;
+  nowMs: number;
+}) {
+  const netMs = typeof netIso === 'string' ? Date.parse(netIso) : NaN;
+  if (!Number.isFinite(netMs)) return 24;
+  const hoursToLaunch = (netMs - nowMs) / (60 * 60 * 1000);
+  if (hoursToLaunch <= 2 && hoursToLaunch >= -1) return 1 / 12; // T-2h..T+1h critical window (~5m)
+  if (hoursToLaunch < -1 && hoursToLaunch >= -24) return 0.25; // T+1h..T+24h reconciliation
+  if (hoursToLaunch <= 24 && hoursToLaunch > 2) return 0.25; // T-24h..T-2h (~15m)
+  if (hoursToLaunch <= 168 && hoursToLaunch > 24) return 1; // T-7d..T-24h
+  if (hoursToLaunch <= 720 && hoursToLaunch > 168) return 6; // T-30d..T-7d
+  return 24;
+}
+
+function minimumTierForQualityLabel(qualityLabel: string): TrajectoryConfidenceTier {
+  if (qualityLabel === 'landing_constrained') return 'B';
+  if (qualityLabel === 'estimate_corridor') return 'C';
+  return 'D';
+}
+
+function confidenceTierRank(tier: TrajectoryConfidenceTier) {
+  if (tier === 'A') return 4;
+  if (tier === 'B') return 3;
+  if (tier === 'C') return 2;
+  return 1;
+}
+
+function buildPadOnlyProduct({ lat, lon }: { lat: number | null; lon: number | null }): TrajectoryProduct {
   const samples = [];
   if (typeof lat === 'number' && typeof lon === 'number') {
     const ecef = ecefFromLatLon(lat, lon, 0);
-    samples.push({ tPlusSec: 0, ecef, sigmaDeg: 20 });
+    samples.push({ tPlusSec: 0, ecef, sigmaDeg: 20, covariance: { along_track: 15, cross_track: 20 } });
   }
   return {
     version: 'traj_v1',
@@ -566,7 +1346,7 @@ function buildConstraintProduct({
   targetLon: number;
   sigmaDeg: number;
   assumptions: string[];
-}) {
+}): TrajectoryProduct {
   const durationS = 600;
   const stepS = 2;
   const altMaxM = 130_000;
@@ -586,15 +1366,25 @@ function buildConstraintProduct({
   }
   const sigmaEndDeg = clamp(sigmaStartDeg + 8, sigmaStartDeg, 60);
 
-  const samples: Array<{ tPlusSec: number; ecef: [number, number, number]; sigmaDeg: number }> = [];
+  const samples: Array<{
+    tPlusSec: number;
+    ecef: [number, number, number];
+    sigmaDeg: number;
+    covariance: { along_track: number; cross_track: number };
+  }> = [];
 
   for (let t = 0; t <= durationS; t += stepS) {
     const u = clamp(t / durationS, 0, 1);
     const alt = altMaxM * (1 - Math.exp(-4.0 * u));
     const dr = downrangeMaxM * Math.pow(u, 2.0);
-    const pos = directSpherical({ lat1Deg: padLat, lon1Deg: padLon, azDeg, distM: dr });
+    const pos = directWgs84({ lat1Deg: padLat, lon1Deg: padLon, azDeg, distM: dr });
     const sigma = sigmaStartDeg + (sigmaEndDeg - sigmaStartDeg) * Math.sqrt(u);
-    samples.push({ tPlusSec: t, ecef: ecefFromLatLon(pos.latDeg, pos.lonDeg, alt), sigmaDeg: sigma });
+    samples.push({
+      tPlusSec: t,
+      ecef: ecefFromLatLon(pos.latDeg, pos.lonDeg, alt),
+      sigmaDeg: sigma,
+      covariance: { along_track: clamp(sigma * 0.75, 0, 90), cross_track: clamp(sigma, 0, 90) }
+    });
   }
 
   return {
@@ -608,7 +1398,7 @@ function buildConstraintProduct({
       Number.isFinite(landingDistKm) ? `Landing distance: ${Math.round(landingDistKm)} km` : null,
       'Altitude: simple exponential rise',
       'Downrange: quadratic ease-in',
-      'Earth model: spherical direct solve'
+      'Earth model: WGS84 geodesic solve'
     ].filter(Boolean) as string[],
     samples,
     events: [] as TrajectoryEvent[]
@@ -629,7 +1419,7 @@ function buildTier2EstimateProduct({
   sigmaBonusDeg: number;
   altMaxM?: number | null;
   assumptions: string[];
-}) {
+}): TrajectoryProduct {
   const durationS = 600;
   const stepS = 2;
   const altMaxMeters = typeof altMaxM === 'number' && Number.isFinite(altMaxM) ? altMaxM : 130_000;
@@ -638,15 +1428,25 @@ function buildTier2EstimateProduct({
   const sigmaStartDeg = 8;
   const sigmaEndDeg = 16;
 
-  const samples: Array<{ tPlusSec: number; ecef: [number, number, number]; sigmaDeg: number }> = [];
+  const samples: Array<{
+    tPlusSec: number;
+    ecef: [number, number, number];
+    sigmaDeg: number;
+    covariance: { along_track: number; cross_track: number };
+  }> = [];
 
   for (let t = 0; t <= durationS; t += stepS) {
     const u = clamp(t / durationS, 0, 1);
     const alt = altMax * (1 - Math.exp(-4.0 * u));
     const dr = downrangeMaxM * Math.pow(u, 2.0);
-    const pos = directSpherical({ lat1Deg: padLat, lon1Deg: padLon, azDeg, distM: dr });
+    const pos = directWgs84({ lat1Deg: padLat, lon1Deg: padLon, azDeg, distM: dr });
     const sigma = (sigmaStartDeg + (sigmaEndDeg - sigmaStartDeg) * Math.sqrt(u)) + sigmaBonusDeg;
-    samples.push({ tPlusSec: t, ecef: ecefFromLatLon(pos.latDeg, pos.lonDeg, alt), sigmaDeg: sigma });
+    samples.push({
+      tPlusSec: t,
+      ecef: ecefFromLatLon(pos.latDeg, pos.lonDeg, alt),
+      sigmaDeg: sigma,
+      covariance: { along_track: clamp(sigma * 0.8, 0, 90), cross_track: clamp(sigma, 0, 90) }
+    });
   }
 
   return {
@@ -873,12 +1673,12 @@ function pickAzimuthFromHazards({
 }: {
   padLat: number;
   padLon: number;
-  hazards: Array<{ data?: any; geometry?: any }>;
+  hazards: ConstraintRow[];
   netIso?: string | null;
   expectedAzDeg?: number | null;
   clampMinDeg?: number | null;
   clampMaxDeg?: number | null;
-}): { azDeg: number; sigmaBonusDeg: number; notes: string[] } | null {
+}): { azDeg: number; sigmaBonusDeg: number; notes: string[]; constraint: ConstraintRow } | null {
   const netMs = typeof netIso === 'string' ? Date.parse(netIso) : NaN;
 
   const candidates: Array<{
@@ -887,6 +1687,7 @@ function pickAzimuthFromHazards({
     sigmaBonusDeg: number;
     score: number;
     notes: string[];
+    constraint: ConstraintRow;
   }> = [];
 
   const pushRing = (ring: unknown, sink: Array<{ lat: number; lon: number }>) => {
@@ -1010,13 +1811,13 @@ function pickAzimuthFromHazards({
       !inClamp && clampPenalty ? `Outside typical clamp (${clampMinDeg}-${clampMaxDeg})` : null
     ].filter(Boolean) as string[];
 
-    candidates.push({ azDeg: meanAzDeg, maxDistKm, sigmaBonusDeg, score, notes });
+    candidates.push({ azDeg: meanAzDeg, maxDistKm, sigmaBonusDeg, score, notes, constraint: hazard });
   }
 
   candidates.sort((a, b) => b.score - a.score);
   const best = candidates[0] ?? null;
   if (!best) return null;
-  return { azDeg: best.azDeg, sigmaBonusDeg: best.sigmaBonusDeg, notes: best.notes };
+  return { azDeg: best.azDeg, sigmaBonusDeg: best.sigmaBonusDeg, notes: best.notes, constraint: best.constraint };
 }
 
 function classifyLaunchSite({
@@ -1230,7 +2031,7 @@ function angularDiffDeg(a: number, b: number) {
   return Math.min(d, 360 - d);
 }
 
-function directSpherical({
+function directWgs84({
   lat1Deg,
   lon1Deg,
   azDeg,
@@ -1241,18 +2042,95 @@ function directSpherical({
   azDeg: number;
   distM: number;
 }) {
-  const R = 6_371_000;
-  const az = (azDeg * Math.PI) / 180;
+  if (!Number.isFinite(distM) || distM <= 0) {
+    return { latDeg: lat1Deg, lonDeg: wrapLonDeg(lon1Deg) };
+  }
+
+  const a = 6378137.0;
+  const f = 1 / 298.257223563;
+  const b = (1 - f) * a;
+
   const phi1 = (lat1Deg * Math.PI) / 180;
-  const lambda1 = (lon1Deg * Math.PI) / 180;
-  const delta = distM / R;
+  const alpha1 = (wrapAzDeg(azDeg) * Math.PI) / 180;
+  const sinAlpha1 = Math.sin(alpha1);
+  const cosAlpha1 = Math.cos(alpha1);
+
+  const tanU1 = (1 - f) * Math.tan(phi1);
+  const cosU1 = 1 / Math.sqrt(1 + tanU1 * tanU1);
+  const sinU1 = tanU1 * cosU1;
+
+  const sigma1 = Math.atan2(tanU1, cosAlpha1);
+  const sinAlpha = cosU1 * sinAlpha1;
+  const cosSqAlpha = 1 - sinAlpha * sinAlpha;
+  const uSq = (cosSqAlpha * (a * a - b * b)) / (b * b);
+  const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
+  const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
+
+  let sigma = distM / (b * A);
+  let sigmaPrev = Number.NaN;
+  let iter = 0;
+  let cos2SigmaM = 0;
+  let sinSigma = 0;
+  let cosSigma = 0;
+
+  while ((!Number.isFinite(sigmaPrev) || Math.abs(sigma - sigmaPrev) > 1e-12) && iter < 100) {
+    cos2SigmaM = Math.cos(2 * sigma1 + sigma);
+    sinSigma = Math.sin(sigma);
+    cosSigma = Math.cos(sigma);
+    const deltaSigma =
+      B *
+      sinSigma *
+      (cos2SigmaM +
+        (B / 4) *
+          (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
+            (B / 6) *
+              cos2SigmaM *
+              (-3 + 4 * sinSigma * sinSigma) *
+              (-3 + 4 * cos2SigmaM * cos2SigmaM)));
+    sigmaPrev = sigma;
+    sigma = distM / (b * A) + deltaSigma;
+    iter += 1;
+  }
 
-  const sinPhi2 = Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(az);
-  const phi2 = Math.asin(clamp(sinPhi2, -1, 1));
+  if (!Number.isFinite(sigma) || iter >= 100) {
+    // Fallback for rare numerical instability near antipodal configurations.
+    const R = 6_371_000;
+    const az = (azDeg * Math.PI) / 180;
+    const lambda1 = (lon1Deg * Math.PI) / 180;
+    const delta = distM / R;
+    const sinPhi2 = Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(az);
+    const phi2 = Math.asin(clamp(sinPhi2, -1, 1));
+    const y = Math.sin(az) * Math.sin(delta) * Math.cos(phi1);
+    const x = Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2);
+    const lambda2 = lambda1 + Math.atan2(y, x);
+    return {
+      latDeg: (phi2 * 180) / Math.PI,
+      lonDeg: wrapLonDeg((lambda2 * 180) / Math.PI)
+    };
+  }
 
-  const y = Math.sin(az) * Math.sin(delta) * Math.cos(phi1);
-  const x = Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2);
-  const lambda2 = lambda1 + Math.atan2(y, x);
+  const tmp = sinU1 * sinSigma - cosU1 * cosSigma * cosAlpha1;
+  const phi2 = Math.atan2(
+    sinU1 * cosSigma + cosU1 * sinSigma * cosAlpha1,
+    (1 - f) * Math.sqrt(sinAlpha * sinAlpha + tmp * tmp)
+  );
+  const lambda = Math.atan2(
+    sinSigma * sinAlpha1,
+    cosU1 * cosSigma - sinU1 * sinSigma * cosAlpha1
+  );
+  const C = (f / 16) * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
+  const L =
+    lambda -
+    (1 - C) *
+      f *
+      sinAlpha *
+      (sigma +
+        C *
+          sinSigma *
+          (cos2SigmaM +
+            C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
+  const lambda1 = (lon1Deg * Math.PI) / 180;
+  const lambda2 = lambda1 + L;
 
   return {
     latDeg: (phi2 * 180) / Math.PI,
@@ -1338,7 +2216,7 @@ function pickBestLandingConstraint({
   constraints: ConstraintRow[];
   padLat: number;
   padLon: number;
-}): { lat: number; lon: number; distKm: number; confidence: number; fetchedAtMs: number; sourceId: string | null } | null {
+}): { lat: number; lon: number; distKm: number; confidence: number; fetchedAtMs: number; sourceId: string | null; constraint: ConstraintRow } | null {
   const candidates: Array<{
     lat: number;
     lon: number;
@@ -1347,6 +2225,7 @@ function pickBestLandingConstraint({
     fetchedAtMs: number;
     sourceId: string | null;
     rolePriority: number;
+    constraint: ConstraintRow;
   }> = [];
 
   for (const c of constraints) {
@@ -1372,7 +2251,7 @@ function pickBestLandingConstraint({
     const sourceIdRaw = (c.source_id || '').trim();
     const sourceId = source && sourceIdRaw ? `${source}:${sourceIdRaw}` : sourceIdRaw || null;
 
-    candidates.push({ lat, lon, distKm, confidence, fetchedAtMs: fetched, sourceId, rolePriority });
+    candidates.push({ lat, lon, distKm, confidence, fetchedAtMs: fetched, sourceId, rolePriority, constraint: c });
   }
 
   candidates.sort((a, b) => {
diff --git a/supabase/migrations/0150_trajectory_source_contracts_lineage.sql b/supabase/migrations/0150_trajectory_source_contracts_lineage.sql
new file mode 100644
index 0000000..375b7c0
--- /dev/null
+++ b/supabase/migrations/0150_trajectory_source_contracts_lineage.sql
@@ -0,0 +1,110 @@
+-- Trajectory v2.1 source sufficiency contracts + lineage foundation.
+-- Adds machine-enforced contract evaluation artifacts and lineage metadata.
+
+create table if not exists public.trajectory_source_contracts (
+  id bigserial primary key,
+  launch_id uuid not null references public.launches(id) on delete cascade,
+  product_version text not null default 'traj_v2',
+  contract_version text not null default 'source_contract_v2_1',
+  confidence_tier text not null check (confidence_tier in ('A', 'B', 'C', 'D')),
+  status text not null check (status in ('pass', 'fail')),
+  source_sufficiency jsonb not null default '{}'::jsonb,
+  required_fields jsonb not null default '{}'::jsonb,
+  missing_fields text[] not null default '{}'::text[],
+  blocking_reasons text[] not null default '{}'::text[],
+  freshness_state text not null default 'unknown' check (freshness_state in ('fresh', 'stale', 'unknown')),
+  lineage_complete boolean not null default false,
+  evaluated_at timestamptz not null default now(),
+  ingestion_run_id bigint references public.ingestion_runs(id) on delete set null,
+  created_at timestamptz not null default now(),
+  updated_at timestamptz not null default now()
+);
+
+create index if not exists trajectory_source_contracts_launch_eval_idx
+  on public.trajectory_source_contracts (launch_id, evaluated_at desc);
+
+create index if not exists trajectory_source_contracts_status_idx
+  on public.trajectory_source_contracts (status, confidence_tier, freshness_state);
+
+create table if not exists public.trajectory_product_lineage (
+  id uuid primary key default gen_random_uuid(),
+  launch_id uuid not null references public.launches(id) on delete cascade,
+  product_version text not null,
+  generated_at timestamptz not null,
+  source_ref_id text not null,
+
+  source text not null,
+  source_id text,
+  source_kind text,
+  license_class text,
+
+  constraint_id bigint references public.launch_trajectory_constraints(id) on delete set null,
+  source_document_id uuid references public.trajectory_source_documents(id) on delete set null,
+
+  source_url text,
+  source_hash text,
+  parser_version text,
+  parse_rule_id text,
+  extracted_field_map jsonb,
+  fetched_at timestamptz,
+
+  weight_used double precision,
+  confidence double precision,
+  ingestion_run_id bigint references public.ingestion_runs(id) on delete set null,
+
+  created_at timestamptz not null default now(),
+  updated_at timestamptz not null default now(),
+
+  unique (launch_id, product_version, generated_at, source_ref_id)
+);
+
+create index if not exists trajectory_product_lineage_launch_generated_idx
+  on public.trajectory_product_lineage (launch_id, generated_at desc);
+
+create index if not exists trajectory_product_lineage_constraint_idx
+  on public.trajectory_product_lineage (constraint_id);
+
+create index if not exists trajectory_product_lineage_doc_idx
+  on public.trajectory_product_lineage (source_document_id);
+
+alter table if exists public.launch_trajectory_constraints
+  add column if not exists ingestion_run_id bigint references public.ingestion_runs(id) on delete set null,
+  add column if not exists source_hash text,
+  add column if not exists extracted_field_map jsonb,
+  add column if not exists parse_rule_id text,
+  add column if not exists parser_version text,
+  add column if not exists license_class text;
+
+create index if not exists launch_trajectory_constraints_run_idx
+  on public.launch_trajectory_constraints (ingestion_run_id);
+
+alter table if exists public.launch_trajectory_products
+  add column if not exists ingestion_run_id bigint references public.ingestion_runs(id) on delete set null,
+  add column if not exists confidence_tier text check (confidence_tier is null or confidence_tier in ('A', 'B', 'C', 'D')),
+  add column if not exists source_sufficiency jsonb,
+  add column if not exists freshness_state text check (freshness_state is null or freshness_state in ('fresh', 'stale', 'unknown')),
+  add column if not exists lineage_complete boolean not null default false;
+
+create index if not exists launch_trajectory_products_quality_idx
+  on public.launch_trajectory_products (confidence_tier, freshness_state, generated_at desc);
+
+alter table if exists public.ar_camera_guide_sessions
+  add column if not exists confidence_tier_seen text check (confidence_tier_seen is null or confidence_tier_seen in ('A', 'B', 'C', 'D')),
+  add column if not exists contract_tier text check (contract_tier is null or contract_tier in ('A', 'B', 'C', 'D')),
+  add column if not exists render_tier text check (render_tier is null or render_tier in ('high', 'medium', 'low', 'unknown')),
+  add column if not exists dropped_frame_bucket text;
+
+alter table public.trajectory_source_contracts enable row level security;
+alter table public.trajectory_product_lineage enable row level security;
+
+drop policy if exists "admin read trajectory source contracts" on public.trajectory_source_contracts;
+create policy "admin read trajectory source contracts"
+  on public.trajectory_source_contracts
+  for select
+  using (public.is_admin());
+
+drop policy if exists "admin read trajectory product lineage" on public.trajectory_product_lineage;
+create policy "admin read trajectory product lineage"
+  on public.trajectory_product_lineage
+  for select
+  using (public.is_admin());
diff --git a/supabase/migrations/0151_trajectory_adaptive_job_cadence.sql b/supabase/migrations/0151_trajectory_adaptive_job_cadence.sql
new file mode 100644
index 0000000..2fe1dae
--- /dev/null
+++ b/supabase/migrations/0151_trajectory_adaptive_job_cadence.sql
@@ -0,0 +1,82 @@
+-- Increase trajectory-related job cadence to support near-launch freshness gates.
+-- This complements source-contract enforcement in trajectory-products-generate.
+
+-- Tune orbit ingest defaults for higher cadence runs (reduce per-run blast radius).
+insert into public.system_settings (key, value)
+values
+  ('trajectory_orbit_launch_limit', '20'::jsonb),
+  ('trajectory_orbit_horizon_days', '14'::jsonb)
+on conflict (key) do update
+  set value = excluded.value,
+      updated_at = now();
+
+-- Increase navcen hazard feed cadence (critical azimuth/downrange constraint).
+do $$
+begin
+  if exists (select 1 from cron.job where jobname = 'navcen_bnm_ingest') then
+    perform cron.unschedule('navcen_bnm_ingest');
+  end if;
+  perform cron.schedule(
+    'navcen_bnm_ingest',
+    '*/2 * * * *',
+    $job$select public.invoke_edge_job('navcen-bnm-ingest');$job$
+  );
+end $$;
+
+-- Increase trajectory orbit document cadence.
+do $$
+begin
+  if exists (select 1 from cron.job where jobname = 'trajectory_orbit_ingest') then
+    perform cron.unschedule('trajectory_orbit_ingest');
+  end if;
+  perform cron.schedule(
+    'trajectory_orbit_ingest',
+    '*/5 * * * *',
+    $job$select public.invoke_edge_job('trajectory-orbit-ingest');$job$
+  );
+end $$;
+
+-- Increase landing constraints cadence.
+do $$
+begin
+  if exists (select 1 from cron.job where jobname = 'trajectory_constraints_ingest') then
+    perform cron.unschedule('trajectory_constraints_ingest');
+  end if;
+  perform cron.schedule(
+    'trajectory_constraints_ingest',
+    '*/5 * * * *',
+    $job$select public.invoke_edge_job('trajectory-constraints-ingest');$job$
+  );
+end $$;
+
+-- Increase product regeneration cadence.
+do $$
+begin
+  if exists (select 1 from cron.job where jobname = 'trajectory_products_generate') then
+    perform cron.unschedule('trajectory_products_generate');
+  end if;
+  perform cron.schedule(
+    'trajectory_products_generate',
+    '*/5 * * * *',
+    $job$select public.invoke_edge_job('trajectory-products-generate');$job$
+  );
+end $$;
+
+-- Increase SupGP ingest cadence and lower dataset interval to support prelaunch windows.
+do $$
+begin
+  if exists (select 1 from cron.job where jobname = 'celestrak_supgp_ingest') then
+    perform cron.unschedule('celestrak_supgp_ingest');
+  end if;
+  perform cron.schedule(
+    'celestrak_supgp_ingest',
+    '*/2 * * * *',
+    $job$select public.invoke_edge_job('celestrak-supgp-ingest');$job$
+  );
+end $$;
+
+update public.celestrak_datasets
+set min_interval_seconds = least(coalesce(min_interval_seconds, 7200), 120),
+    updated_at = now()
+where dataset_type = 'supgp';
+
```

## Commit `a455daa`

```text
commit a455daa0c0a318d5fc4c0a222d3bd720ebfee213
Author:     joshwill85 <168236617+joshwill85@users.noreply.github.com>
AuthorDate: Thu Feb 5 22:17:33 2026 -0500
Commit:     joshwill85 <168236617+joshwill85@users.noreply.github.com>
CommitDate: Thu Feb 5 22:17:33 2026 -0500

    Add Starship program tracking feature
    
    Adds comprehensive Starship program monitoring and visualization including:
    - Event tracking and timeline explorer
    - Evidence center with media attachments
    - Flight rail and KPI metrics
    - Desktop and mobile workbench views
    - Systems graph visualization
    - Change ledger and mode switching
    
    Co-Authored-By: Contributor <noreply@example.com>
```

### Files

```text
A	components/starship/StarshipChangeLedger.tsx
A	components/starship/StarshipEventDrawer.tsx
A	components/starship/StarshipEvidenceCenter.tsx
A	components/starship/StarshipFlightRail.tsx
A	components/starship/StarshipKpiStrip.tsx
A	components/starship/StarshipModeSwitch.tsx
A	components/starship/StarshipProgramWorkbenchDesktop.tsx
A	components/starship/StarshipProgramWorkbenchMobile.tsx
A	components/starship/StarshipSystemsGraph.tsx
A	components/starship/StarshipTimelineExplorer.tsx
A	lib/server/starship.ts
A	lib/server/starshipUi.ts
A	lib/types/starship.ts
A	lib/utils/starship.ts
```

### Full Patch (+/-)

```diff
diff --git a/components/starship/StarshipChangeLedger.tsx b/components/starship/StarshipChangeLedger.tsx
new file mode 100644
index 0000000..b2373ec
--- /dev/null
+++ b/components/starship/StarshipChangeLedger.tsx
@@ -0,0 +1,102 @@
+import Link from 'next/link';
+import clsx from 'clsx';
+import type { StarshipChangeItem } from '@/lib/types/starship';
+
+export type StarshipChangeLedgerProps = {
+  changes: readonly StarshipChangeItem[];
+  title?: string;
+  emptyLabel?: string;
+  maxItems?: number;
+  className?: string;
+};
+
+export function StarshipChangeLedger({
+  changes,
+  title = 'Change ledger',
+  emptyLabel = 'No mission change entries are available yet.',
+  maxItems = 12,
+  className
+}: StarshipChangeLedgerProps) {
+  const sortedChanges = [...changes]
+    .sort((a, b) => parseDateOrZero(b.date) - parseDateOrZero(a.date))
+    .slice(0, Math.max(0, maxItems));
+
+  return (
+    <section className={clsx('rounded-2xl border border-stroke bg-surface-1 p-4', className)} aria-label={title}>
+      <div className="flex items-center justify-between gap-2">
+        <h3 className="text-base font-semibold text-text1">{title}</h3>
+        <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
+          {sortedChanges.length}
+        </span>
+      </div>
+
+      {sortedChanges.length === 0 ? (
+        <p className="mt-3 text-sm text-text3">{emptyLabel}</p>
+      ) : (
+        <ol className="mt-3 space-y-2">
+          {sortedChanges.map((change) => {
+            const isExternal = isExternalUrl(change.href);
+            return (
+              <li key={`${change.title}:${change.date}`} className="rounded-xl border border-stroke bg-surface-0 p-3">
+                <div className="flex items-start justify-between gap-3">
+                  <div className="min-w-0">
+                    <div className="truncate text-sm font-semibold text-text1">{change.title}</div>
+                    <p className="mt-1 text-xs text-text2">{change.summary}</p>
+                  </div>
+                  <time dateTime={toDateTimeAttr(change.date)} className="shrink-0 text-[11px] text-text3">
+                    {formatChangeDate(change.date)}
+                  </time>
+                </div>
+                {change.href ? (
+                  isExternal ? (
+                    <a
+                      href={change.href}
+                      className="mt-2 inline-flex text-xs uppercase tracking-[0.08em] text-primary hover:text-primary/80"
+                      target="_blank"
+                      rel="noreferrer"
+                    >
+                      Open source
+                    </a>
+                  ) : (
+                    <Link href={change.href} className="mt-2 inline-flex text-xs uppercase tracking-[0.08em] text-primary hover:text-primary/80">
+                      Open source
+                    </Link>
+                  )
+                ) : null}
+              </li>
+            );
+          })}
+        </ol>
+      )}
+    </section>
+  );
+}
+
+function parseDateOrZero(value: string) {
+  const parsed = Date.parse(value);
+  return Number.isNaN(parsed) ? 0 : parsed;
+}
+
+function toDateTimeAttr(value: string) {
+  const parsed = Date.parse(value);
+  if (Number.isNaN(parsed)) return value;
+  return new Date(parsed).toISOString();
+}
+
+function formatChangeDate(value: string) {
+  const parsed = Date.parse(value);
+  if (Number.isNaN(parsed)) return value;
+  return new Intl.DateTimeFormat('en-US', {
+    month: 'short',
+    day: '2-digit',
+    year: 'numeric',
+    hour: 'numeric',
+    minute: '2-digit',
+    timeZoneName: 'short'
+  }).format(new Date(parsed));
+}
+
+function isExternalUrl(value: string | undefined) {
+  if (!value) return false;
+  return /^https?:\/\//i.test(value);
+}
diff --git a/components/starship/StarshipEventDrawer.tsx b/components/starship/StarshipEventDrawer.tsx
new file mode 100644
index 0000000..9f37882
--- /dev/null
+++ b/components/starship/StarshipEventDrawer.tsx
@@ -0,0 +1,199 @@
+'use client';
+
+import { useCallback, useEffect, useId, useState } from 'react';
+import clsx from 'clsx';
+import type { StarshipFaqItem } from '@/lib/types/starship';
+import { StarshipEvidenceCenter, type StarshipEvidenceItem } from './StarshipEvidenceCenter';
+import type { StarshipTimelineEvent } from './StarshipTimelineExplorer';
+
+export type StarshipEventDrawerProps = {
+  event: StarshipTimelineEvent | null;
+  open?: boolean;
+  defaultOpen?: boolean;
+  onOpenChange?: (open: boolean) => void;
+  variant?: 'panel' | 'sheet';
+  title?: string;
+  evidenceItems?: readonly StarshipEvidenceItem[];
+  faq?: readonly StarshipFaqItem[];
+  className?: string;
+};
+
+export function StarshipEventDrawer({
+  event,
+  open,
+  defaultOpen = false,
+  onOpenChange,
+  variant = 'panel',
+  title = 'Event drawer',
+  evidenceItems,
+  faq,
+  className
+}: StarshipEventDrawerProps) {
+  const [internalOpen, setInternalOpen] = useState(defaultOpen);
+  const dialogId = useId();
+  const isControlled = typeof open === 'boolean';
+  const isOpen = isControlled ? Boolean(open) : internalOpen;
+
+  const setOpen = useCallback(
+    (nextOpen: boolean) => {
+      if (!isControlled) {
+        setInternalOpen(nextOpen);
+      }
+      onOpenChange?.(nextOpen);
+    },
+    [isControlled, onOpenChange]
+  );
+
+  useEffect(() => {
+    if (variant !== 'sheet' || !isOpen) return;
+    const onKeyDown = (eventKey: KeyboardEvent) => {
+      if (eventKey.key === 'Escape') {
+        setOpen(false);
+      }
+    };
+    window.addEventListener('keydown', onKeyDown);
+    return () => window.removeEventListener('keydown', onKeyDown);
+  }, [isOpen, setOpen, variant]);
+
+  useEffect(() => {
+    if (variant !== 'sheet' || !isOpen) return;
+    const previousOverflow = document.body.style.overflow;
+    document.body.style.overflow = 'hidden';
+    return () => {
+      document.body.style.overflow = previousOverflow;
+    };
+  }, [isOpen, variant]);
+
+  if (variant === 'sheet') {
+    return (
+      <>
+        <div
+          className={clsx(
+            'fixed inset-0 z-40 bg-[rgba(0,0,0,0.62)] transition-opacity duration-200 motion-reduce:transition-none',
+            isOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
+          )}
+          aria-hidden={!isOpen}
+          onClick={() => setOpen(false)}
+        />
+        <section
+          role="dialog"
+          aria-modal="true"
+          aria-labelledby={dialogId}
+          className={clsx(
+            'fixed inset-x-0 bottom-0 z-50 max-h-[86vh] rounded-t-2xl border border-stroke bg-surface-1 p-4 shadow-surface transition-transform duration-300 motion-reduce:transition-none',
+            isOpen ? 'translate-y-0' : 'translate-y-full',
+            className
+          )}
+        >
+          <div className="mx-auto h-1.5 w-16 rounded-full bg-text4/50" aria-hidden="true" />
+          <DrawerHeader headingId={dialogId} title={title} onClose={() => setOpen(false)} />
+          <DrawerBody event={event} evidenceItems={evidenceItems} faq={faq} compact />
+        </section>
+      </>
+    );
+  }
+
+  return (
+    <section className={clsx('rounded-2xl border border-stroke bg-surface-1 p-4', className)} aria-labelledby={dialogId}>
+      <DrawerHeader headingId={dialogId} title={title} />
+      <DrawerBody event={event} evidenceItems={evidenceItems} faq={faq} />
+    </section>
+  );
+}
+
+function DrawerHeader({
+  headingId,
+  title,
+  onClose
+}: {
+  headingId: string;
+  title: string;
+  onClose?: () => void;
+}) {
+  return (
+    <div className="mt-3 flex items-start justify-between gap-3">
+      <h3 id={headingId} className="text-base font-semibold text-text1">
+        {title}
+      </h3>
+      {onClose ? (
+        <button
+          type="button"
+          onClick={onClose}
+          className="rounded-lg border border-stroke px-3 py-1.5 text-xs uppercase tracking-[0.08em] text-text3 transition hover:border-primary hover:text-text1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
+        >
+          Close
+        </button>
+      ) : null}
+    </div>
+  );
+}
+
+function DrawerBody({
+  event,
+  evidenceItems,
+  faq,
+  compact = false
+}: {
+  event: StarshipTimelineEvent | null;
+  evidenceItems?: readonly StarshipEvidenceItem[];
+  faq?: readonly StarshipFaqItem[];
+  compact?: boolean;
+}) {
+  if (!event) {
+    return (
+      <div className={clsx('mt-3 rounded-xl border border-stroke bg-surface-0 p-3', compact ? 'text-xs' : 'text-sm')}>
+        <div className="font-semibold text-text1">No event selected</div>
+        <p className="mt-1 text-text3">Select a timeline item to inspect mission evidence and related references.</p>
+      </div>
+    );
+  }
+
+  return (
+    <div className={clsx('mt-3 space-y-3', compact ? 'max-h-[72vh] overflow-y-auto pr-1' : undefined)}>
+      <article className="rounded-xl border border-stroke bg-surface-0 p-3">
+        <div className="text-[11px] uppercase tracking-[0.08em] text-text3">Selected event</div>
+        <h4 className="mt-1 text-sm font-semibold text-text1">{event.title}</h4>
+        <p className="mt-1 text-xs text-text3">{formatDateLabel(event.eventTime || event.when)}</p>
+        {event.summary ? <p className="mt-2 text-sm text-text2">{event.summary}</p> : null}
+
+        <dl className="mt-3 grid gap-x-3 gap-y-1 text-xs text-text3 md:grid-cols-2">
+          <DetailRow label="event_time" value={formatDateLabel(event.eventTime || event.when)} />
+          <DetailRow label="announced_time" value={formatDateLabel(event.announcedTime || event.when)} />
+          <DetailRow label="source_type" value={event.sourceType || 'curated-fallback'} />
+          <DetailRow label="confidence" value={event.confidence || 'low'} />
+          <DetailRow label="supersedes" value={formatSupersedes(event.supersedes)} />
+          <DetailRow label="superseded_by" value={event.supersededBy?.eventId || 'none'} />
+        </dl>
+      </article>
+
+      <StarshipEvidenceCenter launch={event.launch || null} items={evidenceItems} faq={faq} compact={compact} />
+    </div>
+  );
+}
+
+function DetailRow({ label, value }: { label: string; value: string }) {
+  return (
+    <div className="rounded-md border border-stroke bg-surface-1 px-2 py-1">
+      <dt className="uppercase tracking-[0.08em]">{label}</dt>
+      <dd className="mt-0.5 text-text2">{value}</dd>
+    </div>
+  );
+}
+
+function formatDateLabel(value: string) {
+  const parsed = Date.parse(value);
+  if (Number.isNaN(parsed)) return value;
+  return new Intl.DateTimeFormat('en-US', {
+    month: 'short',
+    day: '2-digit',
+    year: 'numeric',
+    hour: 'numeric',
+    minute: '2-digit',
+    timeZoneName: 'short'
+  }).format(new Date(parsed));
+}
+
+function formatSupersedes(value: StarshipTimelineEvent['supersedes']) {
+  if (!value || value.length === 0) return 'none';
+  return value.map((entry) => (entry.reason ? `${entry.eventId} (${entry.reason})` : entry.eventId)).join(', ');
+}
diff --git a/components/starship/StarshipEvidenceCenter.tsx b/components/starship/StarshipEvidenceCenter.tsx
new file mode 100644
index 0000000..fe2f620
--- /dev/null
+++ b/components/starship/StarshipEvidenceCenter.tsx
@@ -0,0 +1,270 @@
+import Link from 'next/link';
+import clsx from 'clsx';
+import type { StarshipFaqItem } from '@/lib/types/starship';
+import type { Launch } from '@/lib/types/launch';
+
+export type StarshipEvidenceKind = 'stream' | 'report' | 'status' | 'reference' | 'note';
+
+export type StarshipEvidenceItem = {
+  id: string;
+  label: string;
+  href?: string;
+  detail?: string;
+  source?: string;
+  capturedAt?: string;
+  kind?: StarshipEvidenceKind;
+};
+
+export type StarshipEvidenceCenterProps = {
+  launch?: Launch | null;
+  items?: readonly StarshipEvidenceItem[];
+  faq?: readonly StarshipFaqItem[];
+  title?: string;
+  className?: string;
+  compact?: boolean;
+  emptyLabel?: string;
+  maxItems?: number;
+};
+
+export function StarshipEvidenceCenter({
+  launch,
+  items,
+  faq,
+  title = 'Evidence center',
+  className,
+  compact = false,
+  emptyLabel = 'No mission evidence links are available for the selected event.',
+  maxItems = 14
+}: StarshipEvidenceCenterProps) {
+  const resolvedItems = (items && items.length > 0 ? items : buildEvidenceItemsFromLaunch(launch)).slice(0, Math.max(0, maxItems));
+
+  return (
+    <section className={clsx('rounded-2xl border border-stroke bg-surface-1 p-4', className)} aria-label={title}>
+      <h3 className={clsx('font-semibold text-text1', compact ? 'text-sm' : 'text-base')}>{title}</h3>
+
+      {resolvedItems.length === 0 ? (
+        <p className={clsx('text-text3', compact ? 'mt-2 text-xs' : 'mt-3 text-sm')}>{emptyLabel}</p>
+      ) : (
+        <ul className={clsx(compact ? 'mt-2 space-y-2' : 'mt-3 space-y-2')}>
+          {resolvedItems.map((item) => {
+            const external = isExternalUrl(item.href);
+            return (
+              <li key={item.id} className="rounded-lg border border-stroke bg-surface-0 px-3 py-2">
+                {item.href ? (
+                  external ? (
+                    <a
+                      href={item.href}
+                      target="_blank"
+                      rel="noreferrer"
+                      className="block transition hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
+                    >
+                      <div className="flex items-center justify-between gap-2">
+                        <span className="text-sm font-semibold text-text1">{item.label}</span>
+                        {item.kind ? (
+                          <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
+                            {item.kind}
+                          </span>
+                        ) : null}
+                      </div>
+                      <EvidenceItemMeta item={item} />
+                    </a>
+                  ) : (
+                    <Link href={item.href} className="block transition hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
+                      <div className="flex items-center justify-between gap-2">
+                        <span className="text-sm font-semibold text-text1">{item.label}</span>
+                        {item.kind ? (
+                          <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
+                            {item.kind}
+                          </span>
+                        ) : null}
+                      </div>
+                      <EvidenceItemMeta item={item} />
+                    </Link>
+                  )
+                ) : (
+                  <div>
+                    <div className="flex items-center justify-between gap-2">
+                      <span className="text-sm font-semibold text-text1">{item.label}</span>
+                      {item.kind ? (
+                        <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
+                          {item.kind}
+                        </span>
+                      ) : null}
+                    </div>
+                    <EvidenceItemMeta item={item} />
+                  </div>
+                )}
+              </li>
+            );
+          })}
+        </ul>
+      )}
+
+      {!compact && faq && faq.length > 0 ? (
+        <details className="mt-3 rounded-xl border border-stroke bg-surface-0 p-3">
+          <summary className="cursor-pointer text-xs uppercase tracking-[0.08em] text-text3">Reference FAQ</summary>
+          <dl className="mt-2 space-y-2">
+            {faq.slice(0, 4).map((entry) => (
+              <div key={entry.question}>
+                <dt className="text-sm font-semibold text-text1">{entry.question}</dt>
+                <dd className="mt-1 text-xs text-text2">{entry.answer}</dd>
+              </div>
+            ))}
+          </dl>
+        </details>
+      ) : null}
+    </section>
+  );
+}
+
+function EvidenceItemMeta({ item }: { item: StarshipEvidenceItem }) {
+  return (
+    <div className="mt-1 space-y-1 text-xs text-text3">
+      {item.detail ? <p>{item.detail}</p> : null}
+      <div className="flex flex-wrap items-center gap-2">
+        {item.source ? <span>{item.source}</span> : null}
+        {item.capturedAt ? <time dateTime={toDateTimeAttr(item.capturedAt)}>{formatDate(item.capturedAt)}</time> : null}
+      </div>
+    </div>
+  );
+}
+
+function buildEvidenceItemsFromLaunch(launch: Launch | null | undefined): StarshipEvidenceItem[] {
+  if (!launch) return [];
+  const evidence: StarshipEvidenceItem[] = [];
+  const seen = new Set<string>();
+
+  const push = (entry: Omit<StarshipEvidenceItem, 'id'>) => {
+    const key = `${entry.href || entry.label}::${entry.kind || 'reference'}`;
+    if (seen.has(key)) return;
+    seen.add(key);
+    evidence.push({ ...entry, id: key });
+  };
+
+  push({
+    label: 'Status signal',
+    detail: launch.statusText || launch.status || 'Status pending',
+    capturedAt: launch.lastUpdated || launch.cacheGeneratedAt || launch.net,
+    source: 'Launch feed',
+    kind: 'status'
+  });
+
+  pushIfHref(
+    push,
+    launch.videoUrl,
+    launch.videoUrl,
+    {
+      label: 'Primary webcast',
+      detail: launch.name,
+      source: launch.provider,
+      capturedAt: launch.net,
+      kind: 'stream'
+    }
+  );
+
+  for (const link of launch.launchVidUrls || []) {
+    pushIfHref(push, link?.url, link?.url, {
+      label: link?.title?.trim() || 'Launch stream',
+      detail: link?.description?.trim() || undefined,
+      source: link?.source || link?.publisher || launch.provider,
+      kind: 'stream'
+    });
+  }
+
+  for (const link of launch.launchInfoUrls || []) {
+    pushIfHref(push, link?.url, link?.url, {
+      label: link?.title?.trim() || 'Mission report',
+      detail: link?.description?.trim() || undefined,
+      source: link?.source || 'Launch feed',
+      kind: 'report'
+    });
+  }
+
+  for (const link of launch.mission?.infoUrls || []) {
+    pushIfHref(push, link?.url, link?.url, {
+      label: link?.title?.trim() || 'Mission reference',
+      detail: link?.description?.trim() || launch.mission?.name,
+      source: link?.source || 'Mission feed',
+      kind: 'reference'
+    });
+  }
+
+  for (const link of launch.mission?.vidUrls || []) {
+    pushIfHref(push, link?.url, link?.url, {
+      label: link?.title?.trim() || 'Mission stream',
+      detail: link?.description?.trim() || launch.mission?.name,
+      source: link?.source || link?.publisher || 'Mission feed',
+      kind: 'stream'
+    });
+  }
+
+  pushIfHref(push, launch.currentEvent?.url, launch.currentEvent?.url, {
+    label: launch.currentEvent?.name || 'Current related event',
+    detail: launch.currentEvent?.typeName || undefined,
+    capturedAt: launch.currentEvent?.date || undefined,
+    source: 'Related events',
+    kind: 'reference'
+  });
+
+  pushIfHref(push, launch.nextEvent?.url, launch.nextEvent?.url, {
+    label: launch.nextEvent?.name || 'Next related event',
+    detail: launch.nextEvent?.typeName || undefined,
+    capturedAt: launch.nextEvent?.date || undefined,
+    source: 'Related events',
+    kind: 'reference'
+  });
+
+  pushIfHref(push, launch.flightclubUrl, launch.flightclubUrl, {
+    label: 'Trajectory profile',
+    source: 'FlightClub',
+    kind: 'reference'
+  });
+
+  pushIfHref(push, launch.spacexXPostUrl, launch.spacexXPostUrl, {
+    label: 'Mission social update',
+    source: 'X',
+    capturedAt: launch.spacexXPostCapturedAt || undefined,
+    kind: 'report'
+  });
+
+  return evidence;
+}
+
+function pushIfHref(
+  push: (entry: Omit<StarshipEvidenceItem, 'id'>) => void,
+  rawHref: string | undefined | null,
+  fallbackDetail: string | undefined | null,
+  entry: Omit<StarshipEvidenceItem, 'id' | 'href'>
+) {
+  const href = typeof rawHref === 'string' ? rawHref.trim() : '';
+  if (!href) return;
+  push({
+    ...entry,
+    href,
+    detail: entry.detail || (entry.source ? `${entry.source} • ${fallbackDetail || href}` : fallbackDetail || href)
+  });
+}
+
+function formatDate(value: string) {
+  const parsed = Date.parse(value);
+  if (Number.isNaN(parsed)) return value;
+  return new Intl.DateTimeFormat('en-US', {
+    month: 'short',
+    day: '2-digit',
+    year: 'numeric',
+    hour: 'numeric',
+    minute: '2-digit',
+    timeZoneName: 'short'
+  }).format(new Date(parsed));
+}
+
+function toDateTimeAttr(value: string) {
+  const parsed = Date.parse(value);
+  if (Number.isNaN(parsed)) return value;
+  return new Date(parsed).toISOString();
+}
+
+function isExternalUrl(value: string | undefined) {
+  if (!value) return false;
+  return /^https?:\/\//i.test(value);
+}
diff --git a/components/starship/StarshipFlightRail.tsx b/components/starship/StarshipFlightRail.tsx
new file mode 100644
index 0000000..65b57ec
--- /dev/null
+++ b/components/starship/StarshipFlightRail.tsx
@@ -0,0 +1,150 @@
+'use client';
+
+import { useId, useMemo } from 'react';
+import type { KeyboardEvent } from 'react';
+import clsx from 'clsx';
+
+export type StarshipMissionRailItem = {
+  id: string;
+  label: string;
+  subtitle?: string;
+  status?: string;
+  nextNet?: string | null;
+  launchCount?: number;
+  disabled?: boolean;
+  panelId?: string;
+};
+
+export type StarshipMissionRailProps = {
+  missions: readonly StarshipMissionRailItem[];
+  value: string | null;
+  onChange?: (missionId: string) => void;
+  ariaLabel?: string;
+  className?: string;
+  orientation?: 'horizontal' | 'vertical';
+};
+
+export function StarshipMissionRail({
+  missions,
+  value,
+  onChange,
+  ariaLabel = 'Mission selection',
+  className,
+  orientation = 'vertical'
+}: StarshipMissionRailProps) {
+  const tablistId = useId();
+  const missionList = useMemo(() => missions.filter(Boolean), [missions]);
+  const activeIndex = missionList.findIndex((mission) => mission.id === value);
+
+  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
+    if (!missionList.length) return;
+    const currentIndex = activeIndex >= 0 ? activeIndex : 0;
+    let nextIndex = -1;
+    const isHorizontal = orientation === 'horizontal';
+
+    if (event.key === 'Home') {
+      event.preventDefault();
+      nextIndex = findNextEnabledMissionIndex(missionList, -1, 1);
+    }
+    if (event.key === 'End') {
+      event.preventDefault();
+      nextIndex = findNextEnabledMissionIndex(missionList, 0, -1);
+    }
+    if (event.key === (isHorizontal ? 'ArrowRight' : 'ArrowDown')) {
+      event.preventDefault();
+      nextIndex = findNextEnabledMissionIndex(missionList, currentIndex, 1);
+    }
+    if (event.key === (isHorizontal ? 'ArrowLeft' : 'ArrowUp')) {
+      event.preventDefault();
+      nextIndex = findNextEnabledMissionIndex(missionList, currentIndex, -1);
+    }
+
+    if (nextIndex < 0) return;
+    const nextMission = missionList[nextIndex];
+    if (!nextMission || nextMission.disabled) return;
+    onChange?.(nextMission.id);
+    const element = document.getElementById(getMissionTabId(tablistId, nextMission.id));
+    element?.focus();
+  };
+
+  return (
+    <section className={clsx('rounded-2xl border border-stroke bg-surface-1 p-2', className)}>
+      <div
+        role="tablist"
+        aria-label={ariaLabel}
+        aria-orientation={orientation}
+        onKeyDown={handleKeyDown}
+        className={clsx('gap-2', orientation === 'horizontal' ? 'grid grid-cols-1 sm:grid-cols-2' : 'flex flex-col')}
+      >
+        {missionList.map((mission) => {
+          const isSelected = mission.id === value;
+          const nextNetLabel = formatMissionNetLabel(mission.nextNet || null);
+          return (
+            <button
+              key={mission.id}
+              id={getMissionTabId(tablistId, mission.id)}
+              type="button"
+              role="tab"
+              aria-selected={isSelected}
+              aria-controls={mission.panelId}
+              tabIndex={isSelected ? 0 : -1}
+              disabled={mission.disabled}
+              onClick={() => {
+                if (mission.disabled) return;
+                onChange?.(mission.id);
+              }}
+              className={clsx(
+                'rounded-xl border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none',
+                mission.disabled && 'cursor-not-allowed opacity-60',
+                isSelected
+                  ? 'border-primary bg-[rgba(34,211,238,0.1)] text-text1 shadow-glow'
+                  : 'border-stroke bg-surface-0 text-text2 hover:border-primary/60 hover:text-text1'
+              )}
+            >
+              <div className="flex items-center justify-between gap-2">
+                <div className="truncate text-sm font-semibold">{mission.label}</div>
+                {typeof mission.launchCount === 'number' ? (
+                  <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
+                    {mission.launchCount}
+                  </span>
+                ) : null}
+              </div>
+              {mission.subtitle ? <div className="mt-1 truncate text-xs text-text3">{mission.subtitle}</div> : null}
+              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
+                {mission.status ? (
+                  <span className="rounded-full border border-stroke px-2 py-0.5 uppercase tracking-[0.08em] text-text3">{mission.status}</span>
+                ) : null}
+                {nextNetLabel ? <span className="text-text3">Next: {nextNetLabel}</span> : null}
+              </div>
+            </button>
+          );
+        })}
+      </div>
+    </section>
+  );
+}
+
+function findNextEnabledMissionIndex(items: readonly StarshipMissionRailItem[], start: number, direction: 1 | -1) {
+  if (!items.length) return -1;
+  for (let step = 1; step <= items.length; step += 1) {
+    const index = (start + direction * step + items.length) % items.length;
+    const item = items[index];
+    if (item && !item.disabled) return index;
+  }
+  return -1;
+}
+
+function getMissionTabId(tablistId: string, missionId: string) {
+  return `${tablistId}-${missionId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
+}
+
+function formatMissionNetLabel(value: string | null) {
+  if (!value) return null;
+  const date = new Date(value);
+  if (Number.isNaN(date.getTime())) return value;
+  return new Intl.DateTimeFormat('en-US', {
+    month: 'short',
+    day: '2-digit',
+    year: 'numeric'
+  }).format(date);
+}
diff --git a/components/starship/StarshipKpiStrip.tsx b/components/starship/StarshipKpiStrip.tsx
new file mode 100644
index 0000000..7d76a9c
--- /dev/null
+++ b/components/starship/StarshipKpiStrip.tsx
@@ -0,0 +1,120 @@
+import clsx from 'clsx';
+import type { StarshipMissionSnapshot, StarshipProgramSnapshot } from '@/lib/types/starship';
+
+type StarshipSnapshot = StarshipProgramSnapshot | StarshipMissionSnapshot;
+
+export type StarshipKpiTone = 'default' | 'success' | 'warning' | 'danger' | 'info';
+
+export type StarshipKpiMetric = {
+  id: string;
+  label: string;
+  value: string;
+  detail?: string;
+  tone?: StarshipKpiTone;
+};
+
+export type StarshipKpiStripProps = {
+  snapshot: StarshipSnapshot;
+  metrics?: readonly StarshipKpiMetric[];
+  title?: string;
+  className?: string;
+};
+
+const TONE_CLASS: Record<StarshipKpiTone, string> = {
+  default: 'border-stroke',
+  success: 'border-success/40',
+  warning: 'border-warning/40',
+  danger: 'border-danger/40',
+  info: 'border-info/40'
+};
+
+export function StarshipKpiStrip({ snapshot, metrics, title = 'Program metrics', className }: StarshipKpiStripProps) {
+  const resolvedMetrics = metrics && metrics.length > 0 ? metrics : buildDefaultMetrics(snapshot);
+
+  return (
+    <section className={clsx('rounded-2xl border border-stroke bg-surface-1 p-4', className)} aria-label={title}>
+      <div className="text-xs uppercase tracking-[0.1em] text-text3">{title}</div>
+      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
+        {resolvedMetrics.map((metric) => (
+          <article key={metric.id} className={clsx('rounded-xl border bg-surface-0 px-3 py-2', TONE_CLASS[metric.tone || 'default'])}>
+            <div className="text-[11px] uppercase tracking-[0.08em] text-text3">{metric.label}</div>
+            <div className="mt-1 text-lg font-semibold text-text1">{metric.value}</div>
+            {metric.detail ? <div className="mt-1 text-xs text-text3">{metric.detail}</div> : null}
+          </article>
+        ))}
+      </div>
+    </section>
+  );
+}
+
+function buildDefaultMetrics(snapshot: StarshipSnapshot): StarshipKpiMetric[] {
+  const nextLaunchLabel = formatDate(snapshot.nextLaunch?.net || null);
+  const updatedLabel = formatDate(snapshot.lastUpdated || snapshot.generatedAt);
+
+  const metrics: StarshipKpiMetric[] = [
+    {
+      id: 'upcoming',
+      label: 'Upcoming',
+      value: String(snapshot.upcoming.length),
+      tone: 'info'
+    },
+    {
+      id: 'recent',
+      label: 'Recent',
+      value: String(snapshot.recent.length)
+    },
+    {
+      id: 'next-launch',
+      label: 'Next launch',
+      value: nextLaunchLabel || 'Awaiting feed',
+      tone: snapshot.nextLaunch ? 'success' : 'warning'
+    },
+    {
+      id: 'last-updated',
+      label: 'Last updated',
+      value: updatedLabel || 'Unknown'
+    }
+  ];
+
+  if (isMissionSnapshot(snapshot)) {
+    metrics.push(
+      {
+        id: 'crew',
+        label: 'Crew highlights',
+        value: String(snapshot.crewHighlights.length),
+        tone: snapshot.crewHighlights.length > 0 ? 'success' : 'default'
+      },
+      {
+        id: 'changes',
+        label: 'Change entries',
+        value: String(snapshot.changes.length)
+      }
+    );
+  } else {
+    metrics.push({
+      id: 'faq',
+      label: 'FAQ entries',
+      value: String(snapshot.faq.length)
+    });
+  }
+
+  return metrics;
+}
+
+function isMissionSnapshot(snapshot: StarshipSnapshot): snapshot is StarshipMissionSnapshot {
+  return 'missionName' in snapshot;
+}
+
+function formatDate(value: string | null) {
+  if (!value) return null;
+  const date = new Date(value);
+  if (Number.isNaN(date.getTime())) return value;
+  return new Intl.DateTimeFormat('en-US', {
+    month: 'short',
+    day: '2-digit',
+    year: 'numeric',
+    hour: 'numeric',
+    minute: '2-digit',
+    timeZoneName: 'short'
+  }).format(date);
+}
diff --git a/components/starship/StarshipModeSwitch.tsx b/components/starship/StarshipModeSwitch.tsx
new file mode 100644
index 0000000..0badaba
--- /dev/null
+++ b/components/starship/StarshipModeSwitch.tsx
@@ -0,0 +1,134 @@
+'use client';
+
+import { useId, useMemo } from 'react';
+import type { KeyboardEvent } from 'react';
+import clsx from 'clsx';
+
+export type StarshipWorkbenchMode = 'quick' | 'explorer' | 'technical';
+
+export type StarshipModeSwitchOption<TMode extends string = StarshipWorkbenchMode> = {
+  id: TMode;
+  label: string;
+  description?: string;
+  badge?: string;
+  disabled?: boolean;
+  panelId?: string;
+};
+
+export type StarshipModeSwitchProps<TMode extends string = StarshipWorkbenchMode> = {
+  options: readonly StarshipModeSwitchOption<TMode>[];
+  value: TMode;
+  onChange?: (next: TMode) => void;
+  ariaLabel?: string;
+  className?: string;
+};
+
+export function StarshipModeSwitch<TMode extends string = StarshipWorkbenchMode>({
+  options,
+  value,
+  onChange,
+  ariaLabel = 'Workbench mode',
+  className
+}: StarshipModeSwitchProps<TMode>) {
+  const tablistId = useId();
+  const normalizedOptions = useMemo(() => options.filter(Boolean), [options]);
+
+  const activeIndex = normalizedOptions.findIndex((option) => option.id === value);
+
+  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
+    if (!normalizedOptions.length) return;
+    const currentIndex = activeIndex >= 0 ? activeIndex : 0;
+    let nextIndex = -1;
+
+    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
+      event.preventDefault();
+      nextIndex = findNextEnabledIndex(normalizedOptions, currentIndex, 1);
+    }
+    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
+      event.preventDefault();
+      nextIndex = findNextEnabledIndex(normalizedOptions, currentIndex, -1);
+    }
+    if (event.key === 'Home') {
+      event.preventDefault();
+      nextIndex = findNextEnabledIndex(normalizedOptions, -1, 1);
+    }
+    if (event.key === 'End') {
+      event.preventDefault();
+      nextIndex = findNextEnabledIndex(normalizedOptions, 0, -1);
+    }
+
+    if (nextIndex < 0) return;
+    const nextOption = normalizedOptions[nextIndex];
+    if (!nextOption || nextOption.disabled) return;
+    onChange?.(nextOption.id);
+    const element = document.getElementById(getTabId(tablistId, nextOption.id));
+    element?.focus();
+  };
+
+  return (
+    <div
+      className={clsx('rounded-2xl border border-stroke bg-surface-1 p-2', className)}
+      role="tablist"
+      aria-label={ariaLabel}
+      aria-orientation="horizontal"
+      onKeyDown={handleKeyDown}
+    >
+      <div className="grid gap-2 sm:grid-cols-3">
+        {normalizedOptions.map((option) => {
+          const isSelected = option.id === value;
+          return (
+            <button
+              key={option.id}
+              id={getTabId(tablistId, option.id)}
+              role="tab"
+              type="button"
+              aria-selected={isSelected}
+              aria-controls={option.panelId}
+              disabled={option.disabled}
+              tabIndex={isSelected ? 0 : -1}
+              onClick={() => {
+                if (option.disabled) return;
+                onChange?.(option.id);
+              }}
+              className={clsx(
+                'rounded-xl border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none',
+                option.disabled && 'cursor-not-allowed opacity-60',
+                isSelected
+                  ? 'border-primary bg-[rgba(34,211,238,0.12)] text-text1 shadow-glow'
+                  : 'border-stroke bg-surface-0 text-text2 hover:border-primary/60 hover:text-text1'
+              )}
+            >
+              <div className="flex items-center justify-between gap-2">
+                <span className="text-sm font-semibold">{option.label}</span>
+                {option.badge ? (
+                  <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
+                    {option.badge}
+                  </span>
+                ) : null}
+              </div>
+              {option.description ? <p className="mt-1 text-xs text-text3">{option.description}</p> : null}
+            </button>
+          );
+        })}
+      </div>
+    </div>
+  );
+}
+
+function findNextEnabledIndex<TMode extends string>(
+  options: readonly StarshipModeSwitchOption<TMode>[],
+  start: number,
+  direction: 1 | -1
+) {
+  if (!options.length) return -1;
+  for (let step = 1; step <= options.length; step += 1) {
+    const index = (start + direction * step + options.length) % options.length;
+    const option = options[index];
+    if (option && !option.disabled) return index;
+  }
+  return -1;
+}
+
+function getTabId(tablistId: string, optionId: string) {
+  return `${tablistId}-${optionId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
+}
diff --git a/components/starship/StarshipProgramWorkbenchDesktop.tsx b/components/starship/StarshipProgramWorkbenchDesktop.tsx
new file mode 100644
index 0000000..0f69b5d
--- /dev/null
+++ b/components/starship/StarshipProgramWorkbenchDesktop.tsx
@@ -0,0 +1,244 @@
+'use client';
+
+import { useEffect, useMemo, useState } from 'react';
+import clsx from 'clsx';
+import type { StarshipChangeItem, StarshipMissionSnapshot, StarshipProgramSnapshot } from '@/lib/types/starship';
+import { buildLaunchHref } from '@/lib/utils/launchLinks';
+import { StarshipChangeLedger } from './StarshipChangeLedger';
+import { StarshipEventDrawer } from './StarshipEventDrawer';
+import { StarshipKpiStrip } from './StarshipKpiStrip';
+import { StarshipMissionRail } from './StarshipFlightRail';
+import { StarshipModeSwitch, type StarshipWorkbenchMode } from './StarshipModeSwitch';
+import { StarshipSystemsGraph } from './StarshipSystemsGraph';
+import { StarshipTimelineExplorer, type StarshipTimelineEvent, type StarshipTimelineFilters } from './StarshipTimelineExplorer';
+
+export type StarshipWorkbenchMission = {
+  id: string;
+  label: string;
+  snapshot: StarshipMissionSnapshot;
+  subtitle?: string;
+  status?: string;
+};
+
+export type StarshipProgramWorkbenchDesktopProps = {
+  programSnapshot: StarshipProgramSnapshot;
+  missions: readonly StarshipWorkbenchMission[];
+  timelineEvents?: readonly StarshipTimelineEvent[];
+  mode?: StarshipWorkbenchMode;
+  defaultMode?: StarshipWorkbenchMode;
+  onModeChange?: (mode: StarshipWorkbenchMode) => void;
+  missionId?: string | null;
+  defaultMissionId?: string | null;
+  onMissionChange?: (missionId: string) => void;
+  selectedEventId?: string | null;
+  defaultSelectedEventId?: string | null;
+  onSelectedEventChange?: (event: StarshipTimelineEvent | null) => void;
+  initialFilters?: StarshipTimelineFilters;
+  onFiltersChange?: (filters: StarshipTimelineFilters) => void;
+  className?: string;
+};
+
+const DEFAULT_FILTERS: StarshipTimelineFilters = {
+  sourceType: 'all',
+  includeSuperseded: false,
+  from: null,
+  to: null
+};
+
+export function StarshipProgramWorkbenchDesktop({
+  programSnapshot,
+  missions,
+  timelineEvents,
+  mode,
+  defaultMode = 'quick',
+  onModeChange,
+  missionId,
+  defaultMissionId,
+  onMissionChange,
+  selectedEventId,
+  defaultSelectedEventId = null,
+  onSelectedEventChange,
+  initialFilters,
+  onFiltersChange,
+  className
+}: StarshipProgramWorkbenchDesktopProps) {
+  const [internalMode, setInternalMode] = useState<StarshipWorkbenchMode>(defaultMode);
+  const [internalMissionId, setInternalMissionId] = useState<string | null>(defaultMissionId || missions[0]?.id || null);
+  const [activeEvent, setActiveEvent] = useState<StarshipTimelineEvent | null>(null);
+  const [filters, setFilters] = useState<StarshipTimelineFilters>(initialFilters || DEFAULT_FILTERS);
+
+  const activeMode = mode || internalMode;
+  const activeMissionId = missionId ?? internalMissionId ?? missions[0]?.id ?? null;
+  const activeMission = missions.find((entry) => entry.id === activeMissionId) || missions[0] || null;
+  const activeSnapshot = activeMode === 'quick' || !activeMission ? programSnapshot : activeMission.snapshot;
+  const timelineById = useMemo(() => {
+    const map = new Map<string, StarshipTimelineEvent>();
+    for (const event of timelineEvents || []) {
+      map.set(event.id, event);
+    }
+    return map;
+  }, [timelineEvents]);
+
+  useEffect(() => {
+    setActiveEvent(null);
+    onSelectedEventChange?.(null);
+  }, [activeMode, activeMissionId, activeSnapshot.generatedAt, onSelectedEventChange]);
+
+  useEffect(() => {
+    const preferredId = selectedEventId || defaultSelectedEventId || null;
+    if (!preferredId) return;
+    const nextEvent = timelineById.get(preferredId) || null;
+    if (!nextEvent) return;
+    setActiveEvent(nextEvent);
+    onSelectedEventChange?.(nextEvent);
+  }, [defaultSelectedEventId, onSelectedEventChange, selectedEventId, timelineById]);
+
+  useEffect(() => {
+    if (typeof window === 'undefined') return;
+    const params = new URLSearchParams(window.location.search);
+    params.set('mode', activeMode);
+    if (activeMissionId) params.set('mission', activeMissionId);
+    else params.delete('mission');
+
+    const eventId = activeEvent?.id || selectedEventId || defaultSelectedEventId || null;
+    if (eventId) params.set('event', eventId);
+    else params.delete('event');
+
+    params.set('sourceType', filters.sourceType);
+    if (filters.includeSuperseded) params.set('includeSuperseded', 'true');
+    else params.delete('includeSuperseded');
+    if (filters.from) params.set('from', filters.from);
+    else params.delete('from');
+    if (filters.to) params.set('to', filters.to);
+    else params.delete('to');
+
+    const nextQuery = params.toString();
+    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`;
+    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
+    if (nextUrl !== currentUrl) {
+      window.history.replaceState(null, '', nextUrl);
+    }
+  }, [activeEvent?.id, activeMissionId, activeMode, defaultSelectedEventId, filters, selectedEventId]);
+
+  const missionRailItems = useMemo(
+    () =>
+      missions.map((entry) => ({
+        id: entry.id,
+        label: entry.label,
+        subtitle: entry.subtitle || entry.snapshot.missionName,
+        status: entry.status || entry.snapshot.nextLaunch?.statusText || 'Tracking',
+        nextNet: entry.snapshot.nextLaunch?.net || null,
+        launchCount: entry.snapshot.upcoming.length
+      })),
+    [missions]
+  );
+
+  const modeOptions = useMemo(
+    () => [
+      {
+        id: 'quick' as const,
+        label: 'Quick',
+        description: 'Fast signal overview',
+        badge: `${programSnapshot.upcoming.length}`
+      },
+      {
+        id: 'explorer' as const,
+        label: 'Explorer',
+        description: activeMission ? activeMission.label : 'Mission timeline view',
+        badge: activeMission ? `${activeMission.snapshot.upcoming.length}` : '0',
+        disabled: missions.length === 0
+      },
+      {
+        id: 'technical' as const,
+        label: 'Technical',
+        description: 'Deep evidence and supersession',
+        badge: String((timelineEvents || []).length)
+      }
+    ],
+    [activeMission, missions.length, programSnapshot.upcoming.length, timelineEvents]
+  );
+
+  const ledgerChanges: StarshipChangeItem[] = useMemo(() => {
+    if (isMissionSnapshot(activeSnapshot)) return [...activeSnapshot.changes];
+    return buildProgramChanges(activeSnapshot);
+  }, [activeSnapshot]);
+
+  return (
+    <section className={clsx('grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_340px]', className)}>
+      <aside className="self-start space-y-4 xl:sticky xl:top-24">
+        <StarshipModeSwitch
+          options={modeOptions}
+          value={activeMode}
+          onChange={(nextMode) => {
+            if (!mode) setInternalMode(nextMode);
+            onModeChange?.(nextMode);
+          }}
+        />
+
+        <StarshipMissionRail
+          missions={missionRailItems}
+          value={activeMissionId}
+          onChange={(nextMissionId) => {
+            if (!missionId) setInternalMissionId(nextMissionId);
+            onMissionChange?.(nextMissionId);
+          }}
+        />
+
+        <StarshipKpiStrip snapshot={activeSnapshot} />
+      </aside>
+
+      <main className="min-w-0 space-y-4">
+        <StarshipTimelineExplorer
+          snapshot={activeSnapshot}
+          events={timelineEvents}
+          selectedEventId={selectedEventId}
+          defaultSelectedEventId={defaultSelectedEventId}
+          initialSourceType={filters.sourceType}
+          initialIncludeSuperseded={filters.includeSuperseded}
+          initialFrom={filters.from}
+          initialTo={filters.to}
+          onFiltersChange={(nextFilters) => {
+            setFilters(nextFilters);
+            onFiltersChange?.(nextFilters);
+          }}
+          onSelectEvent={(event) => {
+            setActiveEvent(event);
+            onSelectedEventChange?.(event);
+          }}
+        />
+
+        {activeMode !== 'quick' ? <StarshipSystemsGraph snapshot={activeSnapshot} /> : null}
+        {activeMode !== 'quick' ? <StarshipChangeLedger changes={ledgerChanges} /> : null}
+      </main>
+
+      <aside className="self-start xl:sticky xl:top-24">
+        <StarshipEventDrawer
+          variant="panel"
+          title="Event evidence drawer"
+          event={activeEvent}
+          faq={activeSnapshot.faq}
+        />
+      </aside>
+    </section>
+  );
+}
+
+function buildProgramChanges(snapshot: StarshipProgramSnapshot): StarshipChangeItem[] {
+  const changes = [...snapshot.upcoming, ...snapshot.recent].map((launch) => ({
+    title: launch.name,
+    summary: `${launch.statusText || launch.status || 'Status pending'} • ${launch.provider} • ${launch.pad?.shortCode || 'Pad TBD'}`,
+    date: launch.lastUpdated || launch.cacheGeneratedAt || launch.net,
+    href: buildLaunchHref(launch)
+  }));
+  changes.sort((a, b) => parseDateOrZero(b.date) - parseDateOrZero(a.date));
+  return changes.slice(0, 12);
+}
+
+function parseDateOrZero(value: string) {
+  const parsed = Date.parse(value);
+  return Number.isNaN(parsed) ? 0 : parsed;
+}
+
+function isMissionSnapshot(snapshot: StarshipProgramSnapshot | StarshipMissionSnapshot): snapshot is StarshipMissionSnapshot {
+  return 'missionName' in snapshot;
+}
diff --git a/components/starship/StarshipProgramWorkbenchMobile.tsx b/components/starship/StarshipProgramWorkbenchMobile.tsx
new file mode 100644
index 0000000..5b4f0ec
--- /dev/null
+++ b/components/starship/StarshipProgramWorkbenchMobile.tsx
@@ -0,0 +1,246 @@
+'use client';
+
+import { useEffect, useMemo, useState } from 'react';
+import clsx from 'clsx';
+import type { StarshipChangeItem, StarshipMissionSnapshot, StarshipProgramSnapshot } from '@/lib/types/starship';
+import { buildLaunchHref } from '@/lib/utils/launchLinks';
+import { StarshipChangeLedger } from './StarshipChangeLedger';
+import { StarshipEventDrawer } from './StarshipEventDrawer';
+import { StarshipKpiStrip } from './StarshipKpiStrip';
+import { StarshipMissionRail } from './StarshipFlightRail';
+import { StarshipModeSwitch, type StarshipWorkbenchMode } from './StarshipModeSwitch';
+import { StarshipSystemsGraph } from './StarshipSystemsGraph';
+import { StarshipTimelineExplorer, type StarshipTimelineEvent, type StarshipTimelineFilters } from './StarshipTimelineExplorer';
+import type { StarshipWorkbenchMission } from './StarshipProgramWorkbenchDesktop';
+
+export type StarshipProgramWorkbenchMobileProps = {
+  programSnapshot: StarshipProgramSnapshot;
+  missions: readonly StarshipWorkbenchMission[];
+  timelineEvents?: readonly StarshipTimelineEvent[];
+  mode?: StarshipWorkbenchMode;
+  defaultMode?: StarshipWorkbenchMode;
+  onModeChange?: (mode: StarshipWorkbenchMode) => void;
+  missionId?: string | null;
+  defaultMissionId?: string | null;
+  onMissionChange?: (missionId: string) => void;
+  selectedEventId?: string | null;
+  defaultSelectedEventId?: string | null;
+  onSelectedEventChange?: (event: StarshipTimelineEvent | null) => void;
+  initialFilters?: StarshipTimelineFilters;
+  onFiltersChange?: (filters: StarshipTimelineFilters) => void;
+  className?: string;
+};
+
+const DEFAULT_FILTERS: StarshipTimelineFilters = {
+  sourceType: 'all',
+  includeSuperseded: false,
+  from: null,
+  to: null
+};
+
+export function StarshipProgramWorkbenchMobile({
+  programSnapshot,
+  missions,
+  timelineEvents,
+  mode,
+  defaultMode = 'quick',
+  onModeChange,
+  missionId,
+  defaultMissionId,
+  onMissionChange,
+  selectedEventId,
+  defaultSelectedEventId = null,
+  onSelectedEventChange,
+  initialFilters,
+  onFiltersChange,
+  className
+}: StarshipProgramWorkbenchMobileProps) {
+  const [internalMode, setInternalMode] = useState<StarshipWorkbenchMode>(defaultMode);
+  const [internalMissionId, setInternalMissionId] = useState<string | null>(defaultMissionId || missions[0]?.id || null);
+  const [activeEvent, setActiveEvent] = useState<StarshipTimelineEvent | null>(null);
+  const [sheetOpen, setSheetOpen] = useState(false);
+  const [filters, setFilters] = useState<StarshipTimelineFilters>(initialFilters || DEFAULT_FILTERS);
+
+  const activeMode = mode || internalMode;
+  const activeMissionId = missionId ?? internalMissionId ?? missions[0]?.id ?? null;
+  const activeMission = missions.find((entry) => entry.id === activeMissionId) || missions[0] || null;
+  const activeSnapshot = activeMode === 'quick' || !activeMission ? programSnapshot : activeMission.snapshot;
+  const timelineById = useMemo(() => {
+    const map = new Map<string, StarshipTimelineEvent>();
+    for (const event of timelineEvents || []) {
+      map.set(event.id, event);
+    }
+    return map;
+  }, [timelineEvents]);
+
+  useEffect(() => {
+    setActiveEvent(null);
+    setSheetOpen(false);
+    onSelectedEventChange?.(null);
+  }, [activeMode, activeMissionId, activeSnapshot.generatedAt, onSelectedEventChange]);
+
+  useEffect(() => {
+    const preferredId = selectedEventId || defaultSelectedEventId || null;
+    if (!preferredId) return;
+    const nextEvent = timelineById.get(preferredId) || null;
+    if (!nextEvent) return;
+    setActiveEvent(nextEvent);
+    onSelectedEventChange?.(nextEvent);
+  }, [defaultSelectedEventId, onSelectedEventChange, selectedEventId, timelineById]);
+
+  useEffect(() => {
+    if (typeof window === 'undefined') return;
+    const params = new URLSearchParams(window.location.search);
+    params.set('mode', activeMode);
+    if (activeMissionId) params.set('mission', activeMissionId);
+    else params.delete('mission');
+
+    const eventId = activeEvent?.id || selectedEventId || defaultSelectedEventId || null;
+    if (eventId) params.set('event', eventId);
+    else params.delete('event');
+
+    params.set('sourceType', filters.sourceType);
+    if (filters.includeSuperseded) params.set('includeSuperseded', 'true');
+    else params.delete('includeSuperseded');
+    if (filters.from) params.set('from', filters.from);
+    else params.delete('from');
+    if (filters.to) params.set('to', filters.to);
+    else params.delete('to');
+
+    const nextQuery = params.toString();
+    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`;
+    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
+    if (nextUrl !== currentUrl) {
+      window.history.replaceState(null, '', nextUrl);
+    }
+  }, [activeEvent?.id, activeMissionId, activeMode, defaultSelectedEventId, filters, selectedEventId]);
+
+  const modeOptions = useMemo(
+    () => [
+      {
+        id: 'quick' as const,
+        label: 'Quick',
+        description: 'Fast signal overview',
+        badge: `${programSnapshot.upcoming.length}`
+      },
+      {
+        id: 'explorer' as const,
+        label: 'Explorer',
+        description: activeMission ? activeMission.label : 'Mission timeline view',
+        badge: activeMission ? `${activeMission.snapshot.upcoming.length}` : '0',
+        disabled: missions.length === 0
+      },
+      {
+        id: 'technical' as const,
+        label: 'Technical',
+        description: 'Deep evidence and supersession',
+        badge: String((timelineEvents || []).length)
+      }
+    ],
+    [activeMission, missions.length, programSnapshot.upcoming.length, timelineEvents]
+  );
+
+  const missionRailItems = useMemo(
+    () =>
+      missions.map((entry) => ({
+        id: entry.id,
+        label: entry.label,
+        subtitle: entry.subtitle || entry.snapshot.missionName,
+        status: entry.status || entry.snapshot.nextLaunch?.statusText || 'Tracking',
+        nextNet: entry.snapshot.nextLaunch?.net || null,
+        launchCount: entry.snapshot.upcoming.length
+      })),
+    [missions]
+  );
+
+  const ledgerChanges: StarshipChangeItem[] = useMemo(() => {
+    if (isMissionSnapshot(activeSnapshot)) return [...activeSnapshot.changes];
+    return buildProgramChanges(activeSnapshot);
+  }, [activeSnapshot]);
+
+  return (
+    <section className={clsx('space-y-4', className)}>
+      <StarshipModeSwitch
+        options={modeOptions}
+        value={activeMode}
+        onChange={(nextMode) => {
+          if (!mode) setInternalMode(nextMode);
+          onModeChange?.(nextMode);
+        }}
+      />
+
+      <StarshipMissionRail
+        missions={missionRailItems}
+        value={activeMissionId}
+        orientation="horizontal"
+        onChange={(nextMissionId) => {
+          if (!missionId) setInternalMissionId(nextMissionId);
+          onMissionChange?.(nextMissionId);
+        }}
+      />
+
+      <StarshipKpiStrip snapshot={activeSnapshot} />
+      <StarshipTimelineExplorer
+        snapshot={activeSnapshot}
+        events={timelineEvents}
+        selectedEventId={selectedEventId}
+        defaultSelectedEventId={defaultSelectedEventId}
+        initialSourceType={filters.sourceType}
+        initialIncludeSuperseded={filters.includeSuperseded}
+        initialFrom={filters.from}
+        initialTo={filters.to}
+        onFiltersChange={(nextFilters) => {
+          setFilters(nextFilters);
+          onFiltersChange?.(nextFilters);
+        }}
+        onSelectEvent={(event) => {
+          setActiveEvent(event);
+          setSheetOpen(true);
+          onSelectedEventChange?.(event);
+        }}
+      />
+
+      {activeMode !== 'quick' ? <StarshipSystemsGraph snapshot={activeSnapshot} /> : null}
+      {activeMode !== 'quick' ? <StarshipChangeLedger changes={ledgerChanges} /> : null}
+
+      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+12px)] z-30">
+        <button
+          type="button"
+          onClick={() => setSheetOpen(true)}
+          className="w-full rounded-xl border border-stroke bg-[rgba(5,6,10,0.88)] px-4 py-3 text-sm font-semibold text-text1 shadow-surface backdrop-blur-xl transition hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none"
+        >
+          {activeEvent ? 'Open evidence drawer' : 'Select timeline event for evidence'}
+        </button>
+      </div>
+
+      <StarshipEventDrawer
+        variant="sheet"
+        open={sheetOpen}
+        onOpenChange={setSheetOpen}
+        title="Event evidence drawer"
+        event={activeEvent}
+        faq={activeSnapshot.faq}
+      />
+    </section>
+  );
+}
+
+function buildProgramChanges(snapshot: StarshipProgramSnapshot): StarshipChangeItem[] {
+  const changes = [...snapshot.upcoming, ...snapshot.recent].map((launch) => ({
+    title: launch.name,
+    summary: `${launch.statusText || launch.status || 'Status pending'} • ${launch.provider} • ${launch.pad?.shortCode || 'Pad TBD'}`,
+    date: launch.lastUpdated || launch.cacheGeneratedAt || launch.net,
+    href: buildLaunchHref(launch)
+  }));
+  changes.sort((a, b) => parseDateOrZero(b.date) - parseDateOrZero(a.date));
+  return changes.slice(0, 12);
+}
+
+function parseDateOrZero(value: string) {
+  const parsed = Date.parse(value);
+  return Number.isNaN(parsed) ? 0 : parsed;
+}
+
+function isMissionSnapshot(snapshot: StarshipProgramSnapshot | StarshipMissionSnapshot): snapshot is StarshipMissionSnapshot {
+  return 'missionName' in snapshot;
+}
diff --git a/components/starship/StarshipSystemsGraph.tsx b/components/starship/StarshipSystemsGraph.tsx
new file mode 100644
index 0000000..90fdb83
--- /dev/null
+++ b/components/starship/StarshipSystemsGraph.tsx
@@ -0,0 +1,333 @@
+'use client';
+
+import { useMemo, useRef, useState } from 'react';
+import type { KeyboardEvent } from 'react';
+import clsx from 'clsx';
+import type { StarshipMissionSnapshot, StarshipProgramSnapshot } from '@/lib/types/starship';
+import type { Launch } from '@/lib/types/launch';
+
+type StarshipSnapshot = StarshipProgramSnapshot | StarshipMissionSnapshot;
+
+export type StarshipSystemsGraphNodeStatus = 'nominal' | 'watch' | 'risk' | 'inactive';
+
+export type StarshipSystemsGraphNode = {
+  id: string;
+  label: string;
+  summary?: string;
+  status?: StarshipSystemsGraphNodeStatus;
+  value?: string;
+};
+
+export type StarshipSystemsGraphEdge = {
+  id?: string;
+  from: string;
+  to: string;
+  label?: string;
+};
+
+export type StarshipSystemsGraphProps = {
+  snapshot?: StarshipSnapshot;
+  nodes?: readonly StarshipSystemsGraphNode[];
+  edges?: readonly StarshipSystemsGraphEdge[];
+  selectedNodeId?: string | null;
+  defaultSelectedNodeId?: string | null;
+  onSelectNode?: (node: StarshipSystemsGraphNode) => void;
+  title?: string;
+  className?: string;
+};
+
+const STATUS_CLASS: Record<StarshipSystemsGraphNodeStatus, string> = {
+  nominal: 'border-success/40 bg-[rgba(52,211,153,0.08)]',
+  watch: 'border-warning/40 bg-[rgba(251,191,36,0.08)]',
+  risk: 'border-danger/40 bg-[rgba(251,113,133,0.08)]',
+  inactive: 'border-stroke bg-surface-0'
+};
+
+export function StarshipSystemsGraph({
+  snapshot,
+  nodes,
+  edges,
+  selectedNodeId,
+  defaultSelectedNodeId = null,
+  onSelectNode,
+  title = 'Systems graph',
+  className
+}: StarshipSystemsGraphProps) {
+  const derivedGraph = useMemo(() => buildGraphFromSnapshot(snapshot), [snapshot]);
+  const resolvedNodes = useMemo(
+    () => (nodes && nodes.length > 0 ? [...nodes] : derivedGraph.nodes),
+    [derivedGraph.nodes, nodes]
+  );
+  const resolvedEdges = useMemo(
+    () => (edges && edges.length > 0 ? [...edges] : derivedGraph.edges),
+    [derivedGraph.edges, edges]
+  );
+  const [internalSelectedNodeId, setInternalSelectedNodeId] = useState<string | null>(defaultSelectedNodeId);
+  const activeNodeId = selectedNodeId ?? internalSelectedNodeId ?? resolvedNodes[0]?.id ?? null;
+  const activeIndex = resolvedNodes.findIndex((node) => node.id === activeNodeId);
+  const activeNode = activeIndex >= 0 ? resolvedNodes[activeIndex] : resolvedNodes[0] || null;
+  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
+  const gridColumns = Math.max(1, Math.min(4, resolvedNodes.length));
+  const positionMap = useMemo(() => buildNodePositionMap(resolvedNodes, gridColumns), [resolvedNodes, gridColumns]);
+
+  const selectNode = (index: number, shouldFocus: boolean) => {
+    const next = resolvedNodes[index];
+    if (!next) return;
+    if (selectedNodeId == null) {
+      setInternalSelectedNodeId(next.id);
+    }
+    onSelectNode?.(next);
+    if (shouldFocus) {
+      buttonRefs.current[index]?.focus();
+    }
+  };
+
+  const handleNodeKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
+    if (!resolvedNodes.length) return;
+    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
+      event.preventDefault();
+      selectNode((index + 1) % resolvedNodes.length, true);
+      return;
+    }
+    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
+      event.preventDefault();
+      selectNode((index - 1 + resolvedNodes.length) % resolvedNodes.length, true);
+      return;
+    }
+    if (event.key === 'Home') {
+      event.preventDefault();
+      selectNode(0, true);
+      return;
+    }
+    if (event.key === 'End') {
+      event.preventDefault();
+      selectNode(resolvedNodes.length - 1, true);
+    }
+  };
+
+  const relatedEdges = activeNode
+    ? resolvedEdges.filter((edge) => edge.from === activeNode.id || edge.to === activeNode.id)
+    : [];
+
+  return (
+    <section className={clsx('rounded-2xl border border-stroke bg-surface-1 p-4', className)}>
+      <h3 className="text-base font-semibold text-text1">{title}</h3>
+
+      {resolvedNodes.length === 0 ? (
+        <p className="mt-3 text-sm text-text3">No systems data is available for this scope.</p>
+      ) : (
+        <>
+          <div className="relative mt-3 h-[240px] overflow-hidden rounded-xl border border-stroke bg-[rgba(255,255,255,0.01)]">
+            <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
+              {resolvedEdges.map((edge) => {
+                const from = positionMap[edge.from];
+                const to = positionMap[edge.to];
+                if (!from || !to) return null;
+                return (
+                  <line
+                    key={edge.id || `${edge.from}:${edge.to}:${edge.label || ''}`}
+                    x1={`${from.x}%`}
+                    y1={`${from.y}%`}
+                    x2={`${to.x}%`}
+                    y2={`${to.y}%`}
+                    stroke="rgba(234,240,255,0.24)"
+                    strokeWidth="1.2"
+                    strokeLinecap="round"
+                    strokeDasharray="4 5"
+                  />
+                );
+              })}
+            </svg>
+
+            {resolvedNodes.map((node, index) => {
+              const isSelected = (activeNode?.id || '') === node.id;
+              const point = positionMap[node.id];
+              if (!point) return null;
+              return (
+                <button
+                  key={node.id}
+                  ref={(button) => {
+                    buttonRefs.current[index] = button;
+                  }}
+                  type="button"
+                  onClick={() => selectNode(index, false)}
+                  onKeyDown={(event) => handleNodeKeyDown(event, index)}
+                  aria-pressed={isSelected}
+                  tabIndex={isSelected ? 0 : -1}
+                  className={clsx(
+                    'absolute min-w-[122px] -translate-x-1/2 -translate-y-1/2 rounded-xl border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none',
+                    STATUS_CLASS[node.status || 'inactive'],
+                    isSelected && 'border-primary shadow-glow'
+                  )}
+                  style={{ left: `${point.x}%`, top: `${point.y}%` }}
+                >
+                  <div className="text-xs font-semibold text-text1">{node.label}</div>
+                  {node.value ? <div className="mt-1 text-[11px] text-text3">{node.value}</div> : null}
+                </button>
+              );
+            })}
+          </div>
+
+          {activeNode ? (
+            <article className="mt-3 rounded-xl border border-stroke bg-surface-0 p-3" aria-live="polite">
+              <div className="text-[11px] uppercase tracking-[0.08em] text-text3">Focused system</div>
+              <div className="mt-1 text-sm font-semibold text-text1">{activeNode.label}</div>
+              {activeNode.summary ? <p className="mt-2 text-sm text-text2">{activeNode.summary}</p> : null}
+              {relatedEdges.length > 0 ? (
+                <ul className="mt-2 space-y-1 text-xs text-text3">
+                  {relatedEdges.map((edge) => (
+                    <li key={edge.id || `${edge.from}:${edge.to}:${edge.label || ''}`}>{formatEdgeLabel(edge, resolvedNodes)}</li>
+                  ))}
+                </ul>
+              ) : null}
+            </article>
+          ) : null}
+        </>
+      )}
+    </section>
+  );
+}
+
+function buildGraphFromSnapshot(snapshot: StarshipSnapshot | undefined) {
+  if (!snapshot) {
+    return { nodes: [] as StarshipSystemsGraphNode[], edges: [] as StarshipSystemsGraphEdge[] };
+  }
+
+  const nextLaunch = snapshot.nextLaunch;
+  const rootId = isMissionSnapshot(snapshot) ? 'mission-core' : 'program-core';
+  const rootLabel = isMissionSnapshot(snapshot) ? snapshot.missionName : 'Starship Program';
+  const rootSummary = isMissionSnapshot(snapshot)
+    ? `${snapshot.upcoming.length} upcoming, ${snapshot.recent.length} recent mission launches`
+    : `${snapshot.upcoming.length} upcoming Starship launches`;
+
+  const nodes: StarshipSystemsGraphNode[] = [
+    {
+      id: rootId,
+      label: rootLabel,
+      summary: rootSummary,
+      value: snapshot.lastUpdated ? `Updated ${formatShortDate(snapshot.lastUpdated)}` : undefined,
+      status: statusFromLaunch(nextLaunch)
+    }
+  ];
+
+  const edges: StarshipSystemsGraphEdge[] = [];
+
+  if (nextLaunch) {
+    pushNode(nodes, edges, rootId, {
+      id: 'vehicle',
+      label: nextLaunch.vehicle || 'Vehicle',
+      summary: nextLaunch.rocket?.description || 'Launch vehicle profile',
+      value: nextLaunch.rocket?.family || undefined,
+      status: statusFromLaunch(nextLaunch)
+    }, 'vehicle');
+
+    pushNode(nodes, edges, rootId, {
+      id: 'provider',
+      label: nextLaunch.provider || 'Provider',
+      summary: nextLaunch.providerDescription || 'Mission provider',
+      value: nextLaunch.providerCountryCode || undefined,
+      status: 'nominal'
+    }, 'provider');
+
+    pushNode(nodes, edges, rootId, {
+      id: 'pad',
+      label: nextLaunch.pad?.shortCode || nextLaunch.pad?.name || 'Launch pad',
+      summary: nextLaunch.pad?.locationName || nextLaunch.pad?.state || 'Pad location',
+      value: nextLaunch.pad?.timezone || undefined,
+      status: 'nominal'
+    }, 'pad');
+
+    if (nextLaunch.mission?.name) {
+      pushNode(nodes, edges, rootId, {
+        id: 'mission',
+        label: nextLaunch.mission.name,
+        summary: nextLaunch.mission.description || 'Mission profile',
+        value: nextLaunch.mission.type || undefined,
+        status: statusFromLaunch(nextLaunch)
+      }, 'mission');
+    }
+
+    if ((nextLaunch.crew || []).length > 0) {
+      pushNode(nodes, edges, 'mission', {
+        id: 'crew',
+        label: 'Crew',
+        summary: `${nextLaunch.crew?.length || 0} listed crew roles`,
+        value: `${nextLaunch.crew?.length || 0} crew`,
+        status: 'nominal'
+      }, 'crew');
+    }
+
+    if ((nextLaunch.payloads || []).length > 0) {
+      pushNode(nodes, edges, 'mission', {
+        id: 'payloads',
+        label: 'Payloads',
+        summary: `${nextLaunch.payloads?.length || 0} payload records`,
+        value: `${nextLaunch.payloads?.length || 0} payloads`,
+        status: 'nominal'
+      }, 'payloads');
+    }
+  }
+
+  return { nodes, edges: edges.filter((edge) => nodes.some((node) => node.id === edge.from) && nodes.some((node) => node.id === edge.to)) };
+}
+
+function pushNode(
+  nodes: StarshipSystemsGraphNode[],
+  edges: StarshipSystemsGraphEdge[],
+  fromId: string,
+  node: StarshipSystemsGraphNode,
+  edgeLabel: string
+) {
+  if (!nodes.some((entry) => entry.id === node.id)) {
+    nodes.push(node);
+  }
+  edges.push({
+    id: `${fromId}:${node.id}`,
+    from: fromId,
+    to: node.id,
+    label: edgeLabel
+  });
+}
+
+function buildNodePositionMap(nodes: StarshipSystemsGraphNode[], columns: number) {
+  const rows = Math.max(1, Math.ceil(nodes.length / columns));
+  const map: Record<string, { x: number; y: number }> = {};
+
+  nodes.forEach((node, index) => {
+    const row = Math.floor(index / columns);
+    const col = index % columns;
+    const x = ((col + 0.5) / columns) * 100;
+    const y = ((row + 0.5) / rows) * 100;
+    map[node.id] = { x, y };
+  });
+
+  return map;
+}
+
+function formatEdgeLabel(edge: StarshipSystemsGraphEdge, nodes: StarshipSystemsGraphNode[]) {
+  const from = nodes.find((node) => node.id === edge.from)?.label || edge.from;
+  const to = nodes.find((node) => node.id === edge.to)?.label || edge.to;
+  if (edge.label) return `${from} -> ${edge.label} -> ${to}`;
+  return `${from} -> ${to}`;
+}
+
+function statusFromLaunch(launch: Launch | null | undefined): StarshipSystemsGraphNodeStatus {
+  if (!launch) return 'inactive';
+  if (launch.status === 'scrubbed') return 'risk';
+  if (launch.status === 'hold') return 'watch';
+  if (launch.status === 'go') return 'nominal';
+  return 'inactive';
+}
+
+function isMissionSnapshot(snapshot: StarshipSnapshot): snapshot is StarshipMissionSnapshot {
+  return 'missionName' in snapshot;
+}
+
+function formatShortDate(value: string) {
+  const parsed = Date.parse(value);
+  if (Number.isNaN(parsed)) return value;
+  return new Intl.DateTimeFormat('en-US', {
+    month: 'short',
+    day: '2-digit'
+  }).format(new Date(parsed));
+}
diff --git a/components/starship/StarshipTimelineExplorer.tsx b/components/starship/StarshipTimelineExplorer.tsx
new file mode 100644
index 0000000..61c8fe7
--- /dev/null
+++ b/components/starship/StarshipTimelineExplorer.tsx
@@ -0,0 +1,467 @@
+'use client';
+
+import { useEffect, useMemo, useRef, useState } from 'react';
+import type { KeyboardEvent } from 'react';
+import clsx from 'clsx';
+import type { StarshipMissionSnapshot, StarshipProgramSnapshot } from '@/lib/types/starship';
+import type { Launch } from '@/lib/types/launch';
+
+type StarshipSnapshot = StarshipProgramSnapshot | StarshipMissionSnapshot;
+
+export type StarshipTimelineEventTone = 'default' | 'success' | 'warning' | 'danger' | 'info';
+
+export type StarshipTimelineLink = {
+  eventId: string;
+  reason?: string;
+};
+
+export type StarshipTimelineEvent = {
+  id: string;
+  title: string;
+  when: string;
+  summary?: string;
+  mission?: string;
+  tone?: StarshipTimelineEventTone;
+  launch?: Launch | null;
+  status?: 'completed' | 'upcoming' | 'tentative' | 'superseded' | string;
+  eventTime?: string | null;
+  announcedTime?: string | null;
+  sourceType?: string;
+  sourceLabel?: string;
+  sourceHref?: string;
+  confidence?: string;
+  supersedes?: StarshipTimelineLink[];
+  supersededBy?: StarshipTimelineLink | null;
+};
+
+export type StarshipTimelineSourceFilter = 'all' | 'll2-cache' | 'nasa-official' | 'curated-fallback';
+
+export type StarshipTimelineFilters = {
+  sourceType: StarshipTimelineSourceFilter;
+  includeSuperseded: boolean;
+  from: string | null;
+  to: string | null;
+};
+
+export type StarshipTimelineExplorerProps = {
+  snapshot?: StarshipSnapshot;
+  events?: readonly StarshipTimelineEvent[];
+  selectedEventId?: string | null;
+  defaultSelectedEventId?: string | null;
+  onSelectEvent?: (event: StarshipTimelineEvent) => void;
+  title?: string;
+  emptyLabel?: string;
+  listAriaLabel?: string;
+  className?: string;
+  initialSourceType?: StarshipTimelineSourceFilter;
+  initialIncludeSuperseded?: boolean;
+  initialFrom?: string | null;
+  initialTo?: string | null;
+  onFiltersChange?: (filters: StarshipTimelineFilters) => void;
+};
+
+const TONE_CLASS: Record<StarshipTimelineEventTone, string> = {
+  default: 'border-stroke bg-surface-0',
+  success: 'border-success/35 bg-[rgba(52,211,153,0.08)]',
+  warning: 'border-warning/35 bg-[rgba(251,191,36,0.08)]',
+  danger: 'border-danger/35 bg-[rgba(251,113,133,0.08)]',
+  info: 'border-info/35 bg-[rgba(96,165,250,0.08)]'
+};
+
+const SOURCE_LABELS: Record<Exclude<StarshipTimelineSourceFilter, 'all'>, string> = {
+  'll2-cache': 'Launch Library cache',
+  'nasa-official': 'NASA official',
+  'curated-fallback': 'Curated fallback'
+};
+
+export function StarshipTimelineExplorer({
+  snapshot,
+  events,
+  selectedEventId,
+  defaultSelectedEventId = null,
+  onSelectEvent,
+  title = 'Timeline explorer',
+  emptyLabel = 'No timeline events are available for the selected scope.',
+  listAriaLabel = 'Timeline events',
+  className,
+  initialSourceType = 'all',
+  initialIncludeSuperseded = false,
+  initialFrom = null,
+  initialTo = null,
+  onFiltersChange
+}: StarshipTimelineExplorerProps) {
+  const prefersReducedMotion = usePrefersReducedMotion();
+
+  const resolvedEvents = useMemo(() => {
+    const source = events && events.length > 0 ? [...events] : buildTimelineEvents(snapshot);
+    source.sort((a, b) => parseDateOrFallback(a.when) - parseDateOrFallback(b.when));
+    return source;
+  }, [events, snapshot]);
+
+  const [sourceType, setSourceType] = useState<StarshipTimelineSourceFilter>(initialSourceType);
+  const [includeSuperseded, setIncludeSuperseded] = useState(initialIncludeSuperseded);
+  const [fromValue, setFromValue] = useState(initialFrom ? initialFrom.slice(0, 10) : '');
+  const [toValue, setToValue] = useState(initialTo ? initialTo.slice(0, 10) : '');
+  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(defaultSelectedEventId);
+
+  const filteredEvents = useMemo(() => {
+    return resolvedEvents.filter((event) => {
+      if (!includeSuperseded && (event.status === 'superseded' || event.supersededBy)) return false;
+      if (sourceType !== 'all' && event.sourceType !== sourceType) return false;
+
+      const eventMs = Date.parse(event.when);
+      if (!Number.isNaN(eventMs) && fromValue) {
+        const fromMs = Date.parse(`${fromValue}T00:00:00Z`);
+        if (!Number.isNaN(fromMs) && eventMs < fromMs) return false;
+      }
+      if (!Number.isNaN(eventMs) && toValue) {
+        const toMs = Date.parse(`${toValue}T23:59:59Z`);
+        if (!Number.isNaN(toMs) && eventMs > toMs) return false;
+      }
+      return true;
+    });
+  }, [fromValue, includeSuperseded, resolvedEvents, sourceType, toValue]);
+
+  const selectedId = selectedEventId ?? internalSelectedId ?? filteredEvents[0]?.id ?? null;
+  const activeIndex = Math.max(0, filteredEvents.length > 0 ? filteredEvents.findIndex((event) => event.id === selectedId) : -1);
+  const activeEvent = filteredEvents[activeIndex] || null;
+  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
+
+  useEffect(() => {
+    const nextFilters: StarshipTimelineFilters = {
+      sourceType,
+      includeSuperseded,
+      from: fromValue ? `${fromValue}T00:00:00.000Z` : null,
+      to: toValue ? `${toValue}T23:59:59.999Z` : null
+    };
+    onFiltersChange?.(nextFilters);
+  }, [fromValue, includeSuperseded, onFiltersChange, sourceType, toValue]);
+
+  useEffect(() => {
+    if (!filteredEvents.length) return;
+    const selectedStillExists = selectedId ? filteredEvents.some((event) => event.id === selectedId) : false;
+    if (selectedStillExists) return;
+    const next = filteredEvents[0];
+    if (!next) return;
+    setInternalSelectedId(next.id);
+    onSelectEvent?.(next);
+  }, [filteredEvents, onSelectEvent, selectedId]);
+
+  useEffect(() => {
+    const activeNode = optionRefs.current[activeIndex];
+    if (!activeNode) return;
+    activeNode.scrollIntoView({
+      block: 'nearest',
+      behavior: prefersReducedMotion ? 'auto' : 'smooth'
+    });
+  }, [activeIndex, prefersReducedMotion]);
+
+  const sourceTypeOptions = useMemo(() => {
+    const counts = new Map<string, number>();
+    for (const event of resolvedEvents) {
+      const key = event.sourceType || 'curated-fallback';
+      counts.set(key, (counts.get(key) || 0) + 1);
+    }
+
+    const options: Array<{ value: StarshipTimelineSourceFilter; label: string }> = [
+      { value: 'all', label: `All sources (${resolvedEvents.length})` }
+    ];
+
+    for (const key of ['ll2-cache', 'nasa-official', 'curated-fallback'] as const) {
+      if (!counts.has(key) && key !== sourceType) continue;
+      options.push({ value: key, label: `${SOURCE_LABELS[key]} (${counts.get(key) || 0})` });
+    }
+
+    return options;
+  }, [resolvedEvents, sourceType]);
+
+  const selectEvent = (index: number, shouldFocus: boolean) => {
+    const next = filteredEvents[index];
+    if (!next) return;
+    if (selectedEventId == null) {
+      setInternalSelectedId(next.id);
+    }
+    onSelectEvent?.(next);
+    if (shouldFocus) {
+      optionRefs.current[index]?.focus();
+    }
+  };
+
+  const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
+    if (!filteredEvents.length) return;
+
+    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
+      event.preventDefault();
+      const nextIndex = (index + 1) % filteredEvents.length;
+      selectEvent(nextIndex, true);
+      return;
+    }
+
+    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
+      event.preventDefault();
+      const nextIndex = (index - 1 + filteredEvents.length) % filteredEvents.length;
+      selectEvent(nextIndex, true);
+      return;
+    }
+
+    if (event.key === 'Home') {
+      event.preventDefault();
+      selectEvent(0, true);
+      return;
+    }
+
+    if (event.key === 'End') {
+      event.preventDefault();
+      selectEvent(filteredEvents.length - 1, true);
+      return;
+    }
+
+    if (event.key === 'Enter' || event.key === ' ') {
+      event.preventDefault();
+      selectEvent(index, false);
+    }
+  };
+
+  return (
+    <section className={clsx('rounded-2xl border border-stroke bg-surface-1 p-4', className)}>
+      <div className="flex flex-wrap items-center justify-between gap-2">
+        <h3 className="text-base font-semibold text-text1">{title}</h3>
+        <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
+          {filteredEvents.length} events
+        </span>
+      </div>
+
+      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
+        <label className="rounded-lg border border-stroke bg-surface-0 px-2 py-1.5 text-xs text-text3">
+          <span className="mb-1 block uppercase tracking-[0.08em]">Source type</span>
+          <select
+            value={sourceType}
+            onChange={(event) => setSourceType(event.target.value as StarshipTimelineSourceFilter)}
+            className="w-full rounded-md border border-stroke bg-surface-1 px-2 py-1 text-xs text-text1"
+          >
+            {sourceTypeOptions.map((option) => (
+              <option key={option.value} value={option.value}>
+                {option.label}
+              </option>
+            ))}
+          </select>
+        </label>
+
+        <label className="rounded-lg border border-stroke bg-surface-0 px-2 py-1.5 text-xs text-text3">
+          <span className="mb-1 block uppercase tracking-[0.08em]">From</span>
+          <input
+            type="date"
+            value={fromValue}
+            onChange={(event) => setFromValue(event.target.value)}
+            className="w-full rounded-md border border-stroke bg-surface-1 px-2 py-1 text-xs text-text1"
+          />
+        </label>
+
+        <label className="rounded-lg border border-stroke bg-surface-0 px-2 py-1.5 text-xs text-text3">
+          <span className="mb-1 block uppercase tracking-[0.08em]">To</span>
+          <input
+            type="date"
+            value={toValue}
+            onChange={(event) => setToValue(event.target.value)}
+            className="w-full rounded-md border border-stroke bg-surface-1 px-2 py-1 text-xs text-text1"
+          />
+        </label>
+
+        <label className="flex items-center gap-2 rounded-lg border border-stroke bg-surface-0 px-2 py-2 text-xs text-text2">
+          <input
+            type="checkbox"
+            checked={includeSuperseded}
+            onChange={(event) => setIncludeSuperseded(event.target.checked)}
+            className="h-4 w-4 rounded border-stroke bg-surface-1"
+          />
+          Show superseded milestones
+        </label>
+      </div>
+
+      {filteredEvents.length === 0 ? (
+        <p className="mt-3 text-sm text-text3">{emptyLabel}</p>
+      ) : (
+        <>
+          <div
+            role="listbox"
+            aria-label={listAriaLabel}
+            aria-activedescendant={activeEvent ? getTimelineOptionId(activeEvent.id) : undefined}
+            className="mt-3 max-h-[300px] space-y-2 overflow-y-auto pr-1"
+          >
+            {filteredEvents.map((event, index) => {
+              const isSelected = index === activeIndex;
+              return (
+                <button
+                  key={event.id}
+                  ref={(node) => {
+                    optionRefs.current[index] = node;
+                  }}
+                  id={getTimelineOptionId(event.id)}
+                  role="option"
+                  type="button"
+                  aria-selected={isSelected}
+                  tabIndex={isSelected ? 0 : -1}
+                  onClick={() => selectEvent(index, false)}
+                  onKeyDown={(keyEvent) => handleOptionKeyDown(keyEvent, index)}
+                  className={clsx(
+                    'w-full rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none',
+                    TONE_CLASS[event.tone || 'default'],
+                    isSelected && 'border-primary bg-[rgba(34,211,238,0.12)] shadow-glow'
+                  )}
+                >
+                  <div className="flex items-start justify-between gap-3">
+                    <div className="min-w-0">
+                      <div className="truncate text-sm font-semibold text-text1">{event.title}</div>
+                      <div className="mt-1 text-xs text-text3">{formatTimelineDate(event.when)}</div>
+                    </div>
+                    {event.mission ? (
+                      <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
+                        {event.mission}
+                      </span>
+                    ) : null}
+                  </div>
+                  {event.summary ? <p className="mt-2 text-xs text-text2">{event.summary}</p> : null}
+                </button>
+              );
+            })}
+          </div>
+
+          {activeEvent ? (
+            <article className="mt-3 rounded-xl border border-stroke bg-surface-0 p-3" aria-live="polite">
+              <div className="text-[11px] uppercase tracking-[0.08em] text-text3">Focused event</div>
+              <h4 className="mt-1 text-sm font-semibold text-text1">{activeEvent.title}</h4>
+              {activeEvent.summary ? <p className="mt-1 text-sm text-text2">{activeEvent.summary}</p> : null}
+
+              <dl className="mt-2 grid gap-x-3 gap-y-1 text-xs text-text3 md:grid-cols-2">
+                <DetailRow label="event_time" value={formatTimelineDate(activeEvent.eventTime || activeEvent.when)} />
+                <DetailRow label="announced_time" value={formatTimelineDate(activeEvent.announcedTime || activeEvent.when)} />
+                <DetailRow label="source_type" value={activeEvent.sourceType || 'curated-fallback'} />
+                <DetailRow label="confidence" value={activeEvent.confidence || 'low'} />
+                <DetailRow label="supersedes" value={formatSupersedes(activeEvent.supersedes)} />
+                <DetailRow label="superseded_by" value={activeEvent.supersededBy?.eventId || 'none'} />
+              </dl>
+            </article>
+          ) : null}
+        </>
+      )}
+    </section>
+  );
+}
+
+function DetailRow({ label, value }: { label: string; value: string }) {
+  return (
+    <div className="rounded-md border border-stroke bg-surface-1 px-2 py-1">
+      <dt className="uppercase tracking-[0.08em]">{label}</dt>
+      <dd className="mt-0.5 text-text2">{value}</dd>
+    </div>
+  );
+}
+
+function buildTimelineEvents(snapshot: StarshipSnapshot | undefined): StarshipTimelineEvent[] {
+  if (!snapshot) return [];
+  const events: StarshipTimelineEvent[] = [];
+  const seen = new Set<string>();
+
+  for (const launch of [...snapshot.recent, ...snapshot.upcoming]) {
+    const id = launch.id || `${launch.name}:${launch.net}`;
+    if (seen.has(id)) continue;
+    seen.add(id);
+    events.push({
+      id,
+      title: launch.name,
+      when: launch.net,
+      summary: `${launch.statusText || launch.status || 'Status pending'} • ${launch.provider} • ${launch.pad?.shortCode || 'Pad TBD'}`,
+      mission: launch.mission?.name || undefined,
+      tone: toneFromLaunchStatus(launch.status),
+      launch,
+      status: launch.status,
+      eventTime: launch.net,
+      announcedTime: launch.lastUpdated || launch.cacheGeneratedAt || launch.net,
+      sourceType: 'll2-cache',
+      sourceLabel: 'Launch Library 2 cache',
+      confidence: launch.netPrecision === 'minute' || launch.netPrecision === 'hour' ? 'high' : 'medium',
+      supersedes: [],
+      supersededBy: null
+    });
+  }
+
+  if (isMissionSnapshot(snapshot)) {
+    snapshot.changes.forEach((change, index) => {
+      const id = `change-${index}-${change.date}-${change.title}`;
+      if (seen.has(id)) return;
+      seen.add(id);
+      events.push({
+        id,
+        title: change.title,
+        when: change.date,
+        summary: change.summary,
+        mission: snapshot.missionName,
+        tone: 'info',
+        launch: null,
+        status: 'tentative',
+        eventTime: change.date,
+        announcedTime: change.date,
+        sourceType: 'curated-fallback',
+        sourceLabel: 'Mission change log',
+        confidence: 'medium',
+        supersedes: [],
+        supersededBy: null
+      });
+    });
+  }
+
+  return events;
+}
+
+function toneFromLaunchStatus(status: Launch['status'] | undefined): StarshipTimelineEventTone {
+  if (status === 'go') return 'success';
+  if (status === 'hold') return 'warning';
+  if (status === 'scrubbed') return 'danger';
+  if (status === 'tbd') return 'info';
+  return 'default';
+}
+
+function isMissionSnapshot(snapshot: StarshipSnapshot): snapshot is StarshipMissionSnapshot {
+  return 'missionName' in snapshot;
+}
+
+function formatTimelineDate(value: string) {
+  const parsed = Date.parse(value);
+  if (Number.isNaN(parsed)) return value;
+  return new Intl.DateTimeFormat('en-US', {
+    month: 'short',
+    day: '2-digit',
+    year: 'numeric',
+    hour: 'numeric',
+    minute: '2-digit',
+    timeZoneName: 'short'
+  }).format(new Date(parsed));
+}
+
+function parseDateOrFallback(value: string) {
+  const parsed = Date.parse(value);
+  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
+}
+
+function getTimelineOptionId(eventId: string) {
+  return `timeline-event-${eventId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
+}
+
+function formatSupersedes(value: StarshipTimelineLink[] | undefined) {
+  if (!value || value.length === 0) return 'none';
+  return value.map((entry) => (entry.reason ? `${entry.eventId} (${entry.reason})` : entry.eventId)).join(', ');
+}
+
+function usePrefersReducedMotion() {
+  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
+
+  useEffect(() => {
+    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
+    const update = () => setPrefersReducedMotion(media.matches);
+    update();
+    media.addEventListener('change', update);
+    return () => media.removeEventListener('change', update);
+  }, []);
+
+  return prefersReducedMotion;
+}
diff --git a/lib/server/starship.ts b/lib/server/starship.ts
new file mode 100644
index 0000000..2008ae3
--- /dev/null
+++ b/lib/server/starship.ts
@@ -0,0 +1,323 @@
+import { cache } from 'react';
+import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
+import { isSupabaseConfigured } from '@/lib/server/env';
+import { mapPublicCacheRow } from '@/lib/server/transformers';
+import { buildLaunchHref } from '@/lib/utils/launchLinks';
+import {
+  buildStarshipFlightSlug,
+  extractStarshipFlightNumber,
+  isStarshipProgramLaunch,
+  parseStarshipFlightSlug
+} from '@/lib/utils/starship';
+import type { Launch } from '@/lib/types/launch';
+import type {
+  StarshipChangeItem,
+  StarshipFaqItem,
+  StarshipFlightIndexEntry,
+  StarshipFlightSnapshot,
+  StarshipProgramSnapshot
+} from '@/lib/types/starship';
+
+const STARSHIP_OR_FILTER = [
+  'name.ilike.%Starship%',
+  'mission_name.ilike.%Starship%',
+  'rocket_full_name.ilike.%Starship%',
+  'vehicle.ilike.%Starship%',
+  'name.ilike.%Super Heavy%',
+  'mission_name.ilike.%Super Heavy%',
+  'rocket_full_name.ilike.%Super Heavy%',
+  'vehicle.ilike.%Super Heavy%'
+].join(',');
+
+const STARSHIP_UPCOMING_LIMIT = 160;
+const STARSHIP_RECENT_LIMIT = 160;
+const MAX_LIST_ITEMS = 40;
+const MAX_CHANGES = 16;
+const MAX_FLIGHTS = 32;
+
+export type StarshipLaunchBuckets = {
+  generatedAt: string;
+  upcoming: Launch[];
+  recent: Launch[];
+};
+
+const PROGRAM_FAQ: StarshipFaqItem[] = [
+  {
+    question: 'What is the Starship program hub?',
+    answer:
+      'This page tracks Starship and Super Heavy launch records from the live feed, then organizes them into program and per-flight views.'
+  },
+  {
+    question: 'What does flight-<number> mean?',
+    answer:
+      'Canonical Starship flight routes use /starship/flight-<number>. Legacy aliases like IFT-<number> redirect to that format.'
+  },
+  {
+    question: 'How often does the Starship workbench update?',
+    answer:
+      'The page revalidates automatically and reflects feed updates as launch timing, status, and links change.'
+  }
+];
+
+export const fetchStarshipLaunchBuckets = cache(async (): Promise<StarshipLaunchBuckets> => {
+  const generatedAt = new Date().toISOString();
+  if (!isSupabaseConfigured()) {
+    return { generatedAt, upcoming: [], recent: [] };
+  }
+
+  const supabase = createSupabasePublicClient();
+  const nowIso = new Date().toISOString();
+
+  const [upcomingRes, recentRes] = await Promise.all([
+    supabase
+      .from('launches_public_cache')
+      .select('*')
+      .or(STARSHIP_OR_FILTER)
+      .gte('net', nowIso)
+      .order('net', { ascending: true })
+      .limit(STARSHIP_UPCOMING_LIMIT),
+    supabase
+      .from('launches_public_cache')
+      .select('*')
+      .or(STARSHIP_OR_FILTER)
+      .lt('net', nowIso)
+      .order('net', { ascending: false })
+      .limit(STARSHIP_RECENT_LIMIT)
+  ]);
+
+  if (upcomingRes.error || recentRes.error) {
+    console.error('starship snapshot query error', {
+      upcoming: upcomingRes.error,
+      recent: recentRes.error
+    });
+    return { generatedAt, upcoming: [], recent: [] };
+  }
+
+  const upcoming = dedupeLaunches((upcomingRes.data || []).map(mapPublicCacheRow).filter(isStarshipProgramLaunch)).slice(0, MAX_LIST_ITEMS);
+  const recent = dedupeLaunches((recentRes.data || []).map(mapPublicCacheRow).filter(isStarshipProgramLaunch)).slice(0, MAX_LIST_ITEMS);
+
+  return { generatedAt, upcoming, recent };
+});
+
+export function buildStarshipFaq(scope: 'program' | 'flight', flightNumber?: number): StarshipFaqItem[] {
+  if (scope === 'program') return PROGRAM_FAQ;
+
+  const numberLabel = Number.isFinite(flightNumber) ? String(Math.max(1, Math.trunc(flightNumber || 0))) : 'this';
+  return [
+    {
+      question: `Is Starship Flight ${numberLabel} the same as IFT-${numberLabel}?`,
+      answer:
+        'Yes. This route treats Starship Flight numbering and IFT naming as equivalent and uses the flight-<number> URL as canonical.'
+    },
+    {
+      question: `Where can I find the latest schedule updates for Flight ${numberLabel}?`,
+      answer:
+        'This page tracks upcoming and recent records for the selected flight number, with links back to the full launch detail entries.'
+    },
+    {
+      question: 'Why can a flight page be empty?',
+      answer:
+        'If the feed has no launch entries tagged with that flight number yet, the page stays live and updates automatically when data arrives.'
+    }
+  ];
+}
+
+export const fetchStarshipProgramSnapshot = cache(async (): Promise<StarshipProgramSnapshot> => {
+  const buckets = await fetchStarshipLaunchBuckets();
+  const combined = [...buckets.upcoming, ...buckets.recent];
+
+  return {
+    generatedAt: buckets.generatedAt,
+    lastUpdated: resolveLastUpdated(combined, buckets.generatedAt),
+    nextLaunch: buckets.upcoming[0] || null,
+    upcoming: buckets.upcoming,
+    recent: buckets.recent,
+    faq: buildStarshipFaq('program')
+  };
+});
+
+export const fetchStarshipFlightSnapshot = cache(async (flightNumber: number): Promise<StarshipFlightSnapshot> => {
+  const normalizedFlightNumber = Math.max(1, Math.trunc(flightNumber));
+  const buckets = await fetchStarshipLaunchBuckets();
+  const upcoming = buckets.upcoming.filter((launch) => extractStarshipFlightNumber(launch) === normalizedFlightNumber).slice(0, MAX_LIST_ITEMS);
+  const recent = buckets.recent.filter((launch) => extractStarshipFlightNumber(launch) === normalizedFlightNumber).slice(0, MAX_LIST_ITEMS);
+  const combined = dedupeLaunches([...upcoming, ...recent]);
+  const nextLaunch = upcoming[0] || null;
+  const fallbackTimestamp = buckets.generatedAt;
+
+  return {
+    generatedAt: buckets.generatedAt,
+    lastUpdated: resolveLastUpdated(combined.length ? combined : [...buckets.upcoming, ...buckets.recent], fallbackTimestamp),
+    missionName: `Starship Flight ${normalizedFlightNumber}`,
+    flightNumber: normalizedFlightNumber,
+    flightSlug: buildStarshipFlightSlug(normalizedFlightNumber),
+    nextLaunch,
+    upcoming,
+    recent,
+    crewHighlights: buildFlightHighlights(nextLaunch),
+    changes: buildStarshipChanges(combined),
+    faq: buildStarshipFaq('flight', normalizedFlightNumber)
+  };
+});
+
+export const fetchStarshipFlightSnapshotBySlug = cache(async (flightSlug: string) => {
+  const flightNumber = parseStarshipFlightSlug(flightSlug);
+  if (flightNumber == null) return null;
+  return fetchStarshipFlightSnapshot(flightNumber);
+});
+
+export const fetchStarshipFlightIndex = cache(async (): Promise<StarshipFlightIndexEntry[]> => {
+  const buckets = await fetchStarshipLaunchBuckets();
+  const byFlight = new Map<
+    number,
+    {
+      upcoming: Launch[];
+      recent: Launch[];
+      nextLaunch: Launch | null;
+      lastUpdated: string | null;
+    }
+  >();
+
+  for (const launch of buckets.upcoming) {
+    const flightNumber = extractStarshipFlightNumber(launch);
+    if (flightNumber == null) continue;
+    const existing =
+      byFlight.get(flightNumber) ||
+      {
+        upcoming: [],
+        recent: [],
+        nextLaunch: null,
+        lastUpdated: null
+      };
+
+    existing.upcoming.push(launch);
+    if (!existing.nextLaunch) {
+      existing.nextLaunch = launch;
+    }
+    existing.lastUpdated = maxIso(existing.lastUpdated, resolveLaunchIso(launch));
+    byFlight.set(flightNumber, existing);
+  }
+
+  for (const launch of buckets.recent) {
+    const flightNumber = extractStarshipFlightNumber(launch);
+    if (flightNumber == null) continue;
+    const existing =
+      byFlight.get(flightNumber) ||
+      {
+        upcoming: [],
+        recent: [],
+        nextLaunch: null,
+        lastUpdated: null
+      };
+
+    existing.recent.push(launch);
+    existing.lastUpdated = maxIso(existing.lastUpdated, resolveLaunchIso(launch));
+    byFlight.set(flightNumber, existing);
+  }
+
+  return [...byFlight.entries()]
+    .sort(([a], [b]) => b - a)
+    .slice(0, MAX_FLIGHTS)
+    .map(([flightNumber, value]) => ({
+      flightNumber,
+      flightSlug: buildStarshipFlightSlug(flightNumber),
+      label: `Starship Flight ${flightNumber}`,
+      nextLaunch: value.nextLaunch,
+      upcomingCount: value.upcoming.length,
+      recentCount: value.recent.length,
+      lastUpdated: value.lastUpdated
+    }));
+});
+
+function buildFlightHighlights(launch: Launch | null) {
+  if (!launch) return [];
+
+  const highlights: string[] = [];
+  for (const payload of launch.payloads || []) {
+    if (payload?.name?.trim()) highlights.push(payload.name.trim());
+    if (highlights.length >= 6) return highlights;
+  }
+
+  const missionType = launch.mission?.type?.trim();
+  if (missionType) highlights.push(`Mission type: ${missionType}`);
+  const statusText = launch.statusText?.trim() || launch.status;
+  if (statusText) highlights.push(`Status: ${statusText}`);
+  if (launch.pad?.shortCode?.trim()) highlights.push(`Pad: ${launch.pad.shortCode.trim()}`);
+
+  return highlights.slice(0, 6);
+}
+
+function buildStarshipChanges(launches: Launch[]) {
+  const mapped = launches
+    .map((launch): StarshipChangeItem | null => {
+      const date = resolveLaunchIso(launch);
+      if (!date) return null;
+      const status = launch.statusText?.trim() || launch.status || 'Status pending';
+      const when = formatDateLabel(launch.net);
+      return {
+        title: launch.name,
+        summary: `Status: ${status}. NET: ${when}.`,
+        date,
+        href: buildLaunchHref(launch)
+      };
+    })
+    .filter((entry): entry is StarshipChangeItem => Boolean(entry));
+
+  mapped.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
+  return mapped.slice(0, MAX_CHANGES);
+}
+
+function dedupeLaunches(launches: Launch[]) {
+  const seen = new Set<string>();
+  const deduped: Launch[] = [];
+  for (const launch of launches) {
+    if (seen.has(launch.id)) continue;
+    seen.add(launch.id);
+    deduped.push(launch);
+  }
+  return deduped;
+}
+
+function resolveLastUpdated(launches: Launch[], fallbackIso: string) {
+  const candidates = launches
+    .flatMap((launch) => [launch.cacheGeneratedAt, launch.lastUpdated, launch.net])
+    .map((value) => toIsoOrNull(value))
+    .filter(Boolean) as string[];
+  if (!candidates.length) return toIsoOrNull(fallbackIso) || null;
+  return candidates.reduce((latest, current) => (Date.parse(current) > Date.parse(latest) ? current : latest));
+}
+
+function resolveLaunchIso(launch: Launch) {
+  const candidates = [launch.cacheGeneratedAt, launch.lastUpdated, launch.net];
+  for (const candidate of candidates) {
+    const iso = toIsoOrNull(candidate);
+    if (iso) return iso;
+  }
+  return null;
+}
+
+function maxIso(first: string | null, second: string | null) {
+  if (!first) return second;
+  if (!second) return first;
+  return Date.parse(second) > Date.parse(first) ? second : first;
+}
+
+function toIsoOrNull(value: string | null | undefined) {
+  if (!value) return null;
+  const date = new Date(value);
+  if (Number.isNaN(date.getTime())) return null;
+  return date.toISOString();
+}
+
+function formatDateLabel(value: string) {
+  const date = new Date(value);
+  if (Number.isNaN(date.getTime())) return value;
+  return new Intl.DateTimeFormat('en-US', {
+    month: 'short',
+    day: '2-digit',
+    year: 'numeric',
+    hour: 'numeric',
+    minute: '2-digit',
+    timeZoneName: 'short'
+  }).format(date);
+}
diff --git a/lib/server/starshipUi.ts b/lib/server/starshipUi.ts
new file mode 100644
index 0000000..1ac807c
--- /dev/null
+++ b/lib/server/starshipUi.ts
@@ -0,0 +1,630 @@
+import { cache } from 'react';
+import { fetchStarshipFlightIndex, fetchStarshipLaunchBuckets } from '@/lib/server/starship';
+import { buildLaunchHref } from '@/lib/utils/launchLinks';
+import { buildStarshipFlightSlug, extractStarshipFlightNumber } from '@/lib/utils/starship';
+import type { Launch } from '@/lib/types/launch';
+import type {
+  StarshipAudienceMode,
+  StarshipEventEvidence,
+  StarshipEvidenceSource,
+  StarshipFlightIndexEntry,
+  StarshipMissionProgressCard,
+  StarshipTimelineConfidence,
+  StarshipTimelineEvent,
+  StarshipTimelineFacet,
+  StarshipTimelineKpis,
+  StarshipTimelineMission,
+  StarshipTimelineMissionFilter,
+  StarshipTimelineQuery,
+  StarshipTimelineResponse,
+  StarshipTimelineSourceFilter,
+  StarshipTimelineSourceType,
+  StarshipTimelineSupersedeReason,
+  StarshipTimelineSupersedesLink
+} from '@/lib/types/starship';
+
+export const STARSHIP_TIMELINE_DEFAULT_LIMIT = 25;
+export const STARSHIP_TIMELINE_MAX_LIMIT = 100;
+
+const SPACEX_STARSHIP_URL = 'https://www.spacex.com/vehicles/starship/';
+
+type TimelineDataset = {
+  generatedAt: string;
+  events: StarshipTimelineEvent[];
+  evidenceById: Record<string, StarshipEventEvidence>;
+  missionProgress: StarshipMissionProgressCard[];
+};
+
+type TimelineRecord = {
+  event: StarshipTimelineEvent;
+  evidence: StarshipEventEvidence;
+};
+
+type FallbackDefinition = {
+  id: string;
+  mission: StarshipTimelineMission;
+  title: string;
+  summary: string;
+  date: string;
+  kind: StarshipTimelineEvent['kind'];
+  status: StarshipTimelineEvent['status'];
+  sourceType: StarshipTimelineSourceType;
+  sourceLabel: string;
+  sourceHref?: string;
+  confidence: StarshipTimelineConfidence;
+  supersedes?: StarshipTimelineSupersedesLink[];
+  supersededBy?: StarshipTimelineSupersedesLink | null;
+  evidenceSources: StarshipEvidenceSource[];
+  payload: Record<string, unknown>;
+};
+
+const FALLBACK_TIMELINE_EVENTS: FallbackDefinition[] = [
+  {
+    id: 'fallback:starship-program',
+    mission: 'starship-program',
+    title: 'Starship program tracking baseline',
+    summary: 'Program-level fallback event used when launch-feed timelines are sparse.',
+    date: '2023-04-20T00:00:00Z',
+    kind: 'program-milestone',
+    status: 'completed',
+    sourceType: 'curated-fallback',
+    sourceLabel: 'Program fallback baseline',
+    sourceHref: SPACEX_STARSHIP_URL,
+    confidence: 'low',
+    evidenceSources: [
+      {
+        label: 'SpaceX Starship overview',
+        href: SPACEX_STARSHIP_URL,
+        note: 'Fallback program reference when feed events are unavailable.'
+      }
+    ],
+    payload: {
+      category: 'fallback-milestone',
+      mission: 'Starship Program',
+      milestone: 'tracking-baseline'
+    }
+  }
+];
+
+const buildTimelineDataset = cache(async (): Promise<TimelineDataset> => {
+  const [buckets, flightIndex] = await Promise.all([fetchStarshipLaunchBuckets(), fetchStarshipFlightIndex()]);
+  const nowMs = Date.now();
+  const dedupedLaunches = dedupeById([...buckets.upcoming, ...buckets.recent]);
+  const launchRecords = dedupedLaunches.map((launch) => buildLaunchRecord({ launch, generatedAt: buckets.generatedAt, nowMs }));
+  const fallbackRecords = FALLBACK_TIMELINE_EVENTS.map((definition) => buildFallbackRecord({ definition, generatedAt: buckets.generatedAt }));
+  const allRecords = [...fallbackRecords, ...launchRecords];
+
+  const events = allRecords.map((record) => normalizeEvent(record.event)).sort(compareEventsAscending);
+  const evidenceById = Object.fromEntries(allRecords.map((record) => [record.event.id, record.evidence]));
+  const missionProgress = buildMissionProgressCards({ events, flightIndex });
+
+  return {
+    generatedAt: buckets.generatedAt,
+    events,
+    evidenceById,
+    missionProgress
+  };
+});
+
+export async function fetchStarshipTimelineViewModel(query: StarshipTimelineQuery): Promise<StarshipTimelineResponse> {
+  const dataset = await buildTimelineDataset();
+  const effectiveMission = resolveEffectiveMissionFilter(query.mode, query.mission, dataset.events);
+  const cursorOffset = decodeCursor(query.cursor);
+  const limit = clampInt(query.limit, STARSHIP_TIMELINE_DEFAULT_LIMIT, 1, STARSHIP_TIMELINE_MAX_LIMIT);
+
+  const baseFiltered = dataset.events
+    .filter((event) => (query.includeSuperseded ? true : event.status !== 'superseded'))
+    .filter((event) => (query.from ? event.date >= query.from : true))
+    .filter((event) => (query.to ? event.date <= query.to : true));
+
+  const facets = buildTimelineFacets({
+    events: baseFiltered,
+    missionFilter: effectiveMission,
+    sourceTypeFilter: query.sourceType
+  });
+
+  const fullyFiltered = baseFiltered
+    .filter((event) => (effectiveMission === 'all' ? true : event.mission === effectiveMission))
+    .filter((event) => (query.sourceType === 'all' ? true : event.source.type === query.sourceType))
+    .sort(compareEventsAscending);
+
+  const pagedEvents = fullyFiltered.slice(cursorOffset, cursorOffset + limit);
+  const nextCursor = cursorOffset + pagedEvents.length < fullyFiltered.length ? encodeCursor(cursorOffset + pagedEvents.length) : null;
+  const kpis = buildKpis(fullyFiltered);
+  const missionProgress =
+    effectiveMission === 'all'
+      ? dataset.missionProgress
+      : dataset.missionProgress.filter((card) => card.mission === effectiveMission);
+
+  return {
+    generatedAt: dataset.generatedAt,
+    mode: query.mode,
+    mission: effectiveMission,
+    sourceType: query.sourceType,
+    includeSuperseded: query.includeSuperseded,
+    from: query.from,
+    to: query.to,
+    events: pagedEvents,
+    facets,
+    kpis,
+    missionProgress,
+    nextCursor
+  };
+}
+
+export async function fetchStarshipEventEvidence(eventId: string) {
+  const dataset = await buildTimelineDataset();
+  return dataset.evidenceById[eventId] || null;
+}
+
+export function parseStarshipAudienceMode(value: string | null): StarshipAudienceMode | null {
+  if (!value) return 'quick';
+  const normalized = value.trim().toLowerCase();
+  if (normalized === 'quick' || normalized === 'summary' || normalized === 'overview') return 'quick';
+  if (normalized === 'explorer' || normalized === 'explore' || normalized === 'flight') return 'explorer';
+  if (normalized === 'technical' || normalized === 'detail' || normalized === 'deep') return 'technical';
+  return null;
+}
+
+export function parseStarshipMissionFilter(value: string | null): StarshipTimelineMissionFilter | null {
+  if (!value) return 'all';
+  const normalized = value.trim().toLowerCase().replace(/\s+/g, '').replace(/_/g, '-');
+  if (normalized === 'all') return 'all';
+  if (normalized === 'starship' || normalized === 'starship-program' || normalized === 'program') return 'starship-program';
+
+  const directFlight = normalized.match(/^flight-(\d{1,3})$/);
+  if (directFlight?.[1]) {
+    return buildStarshipFlightSlug(Number(directFlight[1]));
+  }
+
+  const ift = normalized.match(/^ift-?(\d{1,3})$/);
+  if (ift?.[1]) {
+    return buildStarshipFlightSlug(Number(ift[1]));
+  }
+
+  const numberOnly = normalized.match(/^(\d{1,3})$/);
+  if (numberOnly?.[1]) {
+    return buildStarshipFlightSlug(Number(numberOnly[1]));
+  }
+
+  return null;
+}
+
+export function parseStarshipSourceFilter(value: string | null): StarshipTimelineSourceFilter | null {
+  if (!value) return 'all';
+  const normalized = value.trim().toLowerCase();
+  if (normalized === 'all') return 'all';
+  if (normalized === 'll2-cache' || normalized === 'll2' || normalized === 'launch-library-2') return 'll2-cache';
+  if (normalized === 'spacex-official' || normalized === 'spacex') return 'spacex-official';
+  if (normalized === 'curated-fallback' || normalized === 'fallback') return 'curated-fallback';
+  return null;
+}
+
+export function parseBooleanParam(value: string | null, fallback: boolean): boolean | null {
+  if (value == null || value === '') return fallback;
+  const normalized = value.trim().toLowerCase();
+  if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
+  if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
+  return null;
+}
+
+export function parseIsoDateParam(value: string | null): string | null | 'invalid' {
+  if (!value) return null;
+  const date = new Date(value);
+  if (Number.isNaN(date.getTime())) return 'invalid';
+  return date.toISOString();
+}
+
+export function parseTimelineLimit(value: string | null) {
+  if (value == null || value === '') return STARSHIP_TIMELINE_DEFAULT_LIMIT;
+  const parsed = Number(value);
+  if (!Number.isFinite(parsed)) return null;
+  return clampInt(parsed, STARSHIP_TIMELINE_DEFAULT_LIMIT, 1, STARSHIP_TIMELINE_MAX_LIMIT);
+}
+
+export function parseTimelineCursor(value: string | null) {
+  if (!value) return null;
+  if (!/^\d+$/.test(value)) return null;
+  return value;
+}
+
+function buildFallbackRecord({ definition, generatedAt }: { definition: FallbackDefinition; generatedAt: string }): TimelineRecord {
+  const event: StarshipTimelineEvent = {
+    id: definition.id,
+    mission: definition.mission,
+    title: definition.title,
+    summary: definition.summary,
+    date: definition.date,
+    kind: definition.kind,
+    status: definition.status,
+    source: {
+      type: definition.sourceType,
+      label: definition.sourceLabel,
+      href: definition.sourceHref,
+      lastVerifiedAt: generatedAt
+    },
+    confidence: definition.confidence,
+    supersedes: definition.supersedes ? [...definition.supersedes] : [],
+    supersededBy: definition.supersededBy ?? null,
+    evidenceId: definition.id
+  };
+
+  const evidence: StarshipEventEvidence = {
+    eventId: definition.id,
+    mission: definition.mission,
+    title: definition.title,
+    summary: definition.summary,
+    sourceType: definition.sourceType,
+    confidence: definition.confidence,
+    generatedAt,
+    sources: definition.evidenceSources,
+    payload: {
+      ...definition.payload,
+      source: {
+        label: definition.sourceLabel,
+        href: definition.sourceHref || SPACEX_STARSHIP_URL
+      }
+    }
+  };
+
+  return { event, evidence };
+}
+
+function buildLaunchRecord({ launch, generatedAt, nowMs }: { launch: Launch; generatedAt: string; nowMs: number }): TimelineRecord {
+  const mission = inferMissionFromLaunch(launch);
+  const sourceHref = launch.ll2Id ? `https://ll.thespacedevs.com/2.3.0/launch/${encodeURIComponent(launch.ll2Id)}/` : undefined;
+  const status = deriveLaunchStatus(launch, nowMs);
+  const confidence = deriveLaunchConfidence(launch);
+  const summary = buildLaunchSummary(launch);
+  const eventId = `launch:${launch.id}`;
+  const sourceCapturedAt = toIsoOrNull(launch.cacheGeneratedAt) || toIsoOrNull(launch.lastUpdated) || generatedAt;
+  const launchHref = buildLaunchHref(launch);
+  const sources = buildLaunchEvidenceSources({ launch, sourceHref, sourceCapturedAt });
+
+  const event: StarshipTimelineEvent = {
+    id: eventId,
+    mission,
+    title: launch.name,
+    summary,
+    date: launch.net,
+    endDate: launch.windowEnd || null,
+    kind: 'launch',
+    status,
+    source: {
+      type: 'll2-cache',
+      label: 'Launch Library 2 cache',
+      href: sourceHref,
+      lastVerifiedAt: sourceCapturedAt
+    },
+    confidence,
+    supersedes: [],
+    supersededBy: null,
+    evidenceId: eventId,
+    launch
+  };
+
+  const evidence: StarshipEventEvidence = {
+    eventId,
+    mission,
+    title: launch.name,
+    summary,
+    sourceType: 'll2-cache',
+    confidence,
+    generatedAt,
+    sources,
+    payload: {
+      launch,
+      launchHref,
+      derived: {
+        mission,
+        status,
+        confidence
+      }
+    }
+  };
+
+  return { event, evidence };
+}
+
+function buildLaunchEvidenceSources({
+  launch,
+  sourceHref,
+  sourceCapturedAt
+}: {
+  launch: Launch;
+  sourceHref?: string;
+  sourceCapturedAt: string;
+}) {
+  const sources: StarshipEvidenceSource[] = [
+    {
+      label: 'Launch Library 2 launch record',
+      href: sourceHref,
+      capturedAt: sourceCapturedAt
+    }
+  ];
+
+  if (launch.spacexXPostUrl) {
+    sources.push({
+      label: 'SpaceX mission post',
+      href: launch.spacexXPostUrl,
+      capturedAt: launch.spacexXPostCapturedAt || null
+    });
+  }
+
+  for (const info of launch.launchInfoUrls || []) {
+    const href = normalizeUrlCandidate(info?.url);
+    if (!href) continue;
+    sources.push({
+      label: info?.title?.trim() || 'Launch information link',
+      href,
+      note: info?.source?.trim() || undefined
+    });
+    if (sources.length >= 6) break;
+  }
+
+  if (sources.length < 6) {
+    for (const video of launch.launchVidUrls || []) {
+      const href = normalizeUrlCandidate(video?.url);
+      if (!href) continue;
+      sources.push({
+        label: video?.title?.trim() || 'Launch video link',
+        href,
+        note: video?.publisher?.trim() || video?.source?.trim() || undefined
+      });
+      if (sources.length >= 6) break;
+    }
+  }
+
+  return sources;
+}
+
+function normalizeUrlCandidate(value: unknown) {
+  if (typeof value !== 'string') return null;
+  const trimmed = value.trim();
+  if (!trimmed) return null;
+  return trimmed;
+}
+
+function inferMissionFromLaunch(launch: Launch): StarshipTimelineMission {
+  const flightNumber = extractStarshipFlightNumber(launch);
+  if (flightNumber != null) {
+    return buildStarshipFlightSlug(flightNumber);
+  }
+  return 'starship-program';
+}
+
+function deriveLaunchStatus(launch: Launch, nowMs: number): StarshipTimelineEvent['status'] {
+  const netMs = Date.parse(launch.net);
+  if (launch.status === 'scrubbed') return 'superseded';
+  if (!Number.isNaN(netMs) && netMs < nowMs) return 'completed';
+  if (launch.status === 'hold' || launch.netPrecision === 'tbd' || launch.netPrecision === 'day' || launch.netPrecision === 'month') {
+    return 'tentative';
+  }
+  return 'upcoming';
+}
+
+function deriveLaunchConfidence(launch: Launch): StarshipTimelineConfidence {
+  if (launch.netPrecision === 'tbd') return 'low';
+  if (launch.netPrecision === 'day' || launch.netPrecision === 'month') return 'medium';
+  if (launch.status === 'hold' || launch.status === 'scrubbed') return 'medium';
+  return 'high';
+}
+
+function buildLaunchSummary(launch: Launch) {
+  const status = launch.statusText?.trim() || launch.status || 'Unknown';
+  return `${launch.provider} • ${launch.vehicle} • Status: ${status}`;
+}
+
+function buildMissionProgressCards({
+  events,
+  flightIndex
+}: {
+  events: StarshipTimelineEvent[];
+  flightIndex: StarshipFlightIndexEntry[];
+}) {
+  const eventByMission = new Map<string, StarshipTimelineEvent[]>();
+  for (const event of events) {
+    const list = eventByMission.get(event.mission) || [];
+    list.push(event);
+    eventByMission.set(event.mission, list);
+  }
+
+  return flightIndex.slice(0, 8).map((entry) => {
+    const missionEvents = [...(eventByMission.get(entry.flightSlug) || [])].sort(compareEventsAscending);
+    const latestKnown = missionEvents[missionEvents.length - 1] || null;
+    const nextUpcoming = missionEvents.find((event) => event.status === 'upcoming');
+
+    const state: StarshipMissionProgressCard['state'] =
+      entry.upcomingCount > 0 ? 'in-preparation' : entry.recentCount > 0 ? 'completed' : 'planned';
+
+    return {
+      mission: entry.flightSlug,
+      label: entry.label,
+      state,
+      summary:
+        nextUpcoming?.summary ||
+        latestKnown?.summary ||
+        `${entry.upcomingCount} upcoming and ${entry.recentCount} recent launch records tracked for ${entry.label}.`,
+      targetDate: entry.nextLaunch?.net || latestKnown?.date || null,
+      sourceType: latestKnown?.source.type || 'll2-cache',
+      confidence: latestKnown?.confidence || deriveProgressConfidence(entry.nextLaunch),
+      eventId: nextUpcoming?.id || latestKnown?.id || null
+    } satisfies StarshipMissionProgressCard;
+  });
+}
+
+function deriveProgressConfidence(launch: Launch | null): StarshipTimelineConfidence {
+  if (!launch) return 'low';
+  return deriveLaunchConfidence(launch);
+}
+
+function buildTimelineFacets({
+  events,
+  missionFilter,
+  sourceTypeFilter
+}: {
+  events: StarshipTimelineEvent[];
+  missionFilter: StarshipTimelineMissionFilter;
+  sourceTypeFilter: StarshipTimelineSourceFilter;
+}): StarshipTimelineFacet[] {
+  const missionCounts = countBy(events, (event) => event.mission);
+  const sourceTypeCounts = countBy(events, (event) => event.source.type);
+
+  const missionKeys = Object.keys(missionCounts)
+    .sort(compareMissionKey)
+    .filter((key): key is StarshipTimelineMission => key === 'starship-program' || /^flight-\d+$/.test(key));
+
+  const missionOptions = [
+    { value: 'all', label: 'All flights', count: events.length, selected: missionFilter === 'all' },
+    ...missionKeys.map((value) => ({
+      value,
+      label: value === 'starship-program' ? 'Program-level' : `Starship ${value.replace('-', ' ')}`,
+      count: missionCounts[value] || 0,
+      selected: missionFilter === value
+    }))
+  ];
+
+  const sourceTypeOptions = [
+    { value: 'all', label: 'All sources', count: events.length, selected: sourceTypeFilter === 'all' },
+    ...(['ll2-cache', 'spacex-official', 'curated-fallback'] as const).map((value) => ({
+      value,
+      label:
+        value === 'll2-cache'
+          ? 'Launch Library 2 cache'
+          : value === 'spacex-official'
+            ? 'SpaceX official'
+            : 'Curated fallback',
+      count: sourceTypeCounts[value] || 0,
+      selected: sourceTypeFilter === value
+    }))
+  ];
+
+  return [
+    {
+      key: 'mission',
+      label: 'Flight',
+      options: missionOptions
+    },
+    {
+      key: 'sourceType',
+      label: 'Source',
+      options: sourceTypeOptions
+    }
+  ];
+}
+
+function buildKpis(events: StarshipTimelineEvent[]): StarshipTimelineKpis {
+  const completedEvents = events.filter((event) => event.status === 'completed').length;
+  const upcomingEvents = events.filter((event) => event.status === 'upcoming').length;
+  const tentativeEvents = events.filter((event) => event.status === 'tentative').length;
+  const supersededEvents = events.filter((event) => event.status === 'superseded').length;
+  const highConfidenceEvents = events.filter((event) => event.confidence === 'high').length;
+  const lastUpdated = resolveLastUpdated(events);
+
+  return {
+    totalEvents: events.length,
+    completedEvents,
+    upcomingEvents,
+    tentativeEvents,
+    supersededEvents,
+    highConfidenceEvents,
+    lastUpdated
+  };
+}
+
+function resolveEffectiveMissionFilter(
+  mode: StarshipAudienceMode,
+  mission: StarshipTimelineMissionFilter,
+  events: StarshipTimelineEvent[]
+): StarshipTimelineMissionFilter {
+  if (mission !== 'all') return mission;
+  if (mode === 'quick') return 'all';
+
+  const flightEvents = events
+    .filter((event) => /^flight-\d+$/.test(event.mission))
+    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
+
+  return flightEvents[0]?.mission || 'starship-program';
+}
+
+function resolveLastUpdated(events: StarshipTimelineEvent[]) {
+  const candidates = events
+    .map((event) => event.source.lastVerifiedAt || event.date)
+    .map((value) => toIsoOrNull(value))
+    .filter(Boolean) as string[];
+  if (!candidates.length) return null;
+  return candidates.reduce((latest, current) => (Date.parse(current) > Date.parse(latest) ? current : latest));
+}
+
+function compareEventsAscending(a: StarshipTimelineEvent, b: StarshipTimelineEvent) {
+  const aMs = Date.parse(a.date);
+  const bMs = Date.parse(b.date);
+  const safeAMs = Number.isNaN(aMs) ? Number.MAX_SAFE_INTEGER : aMs;
+  const safeBMs = Number.isNaN(bMs) ? Number.MAX_SAFE_INTEGER : bMs;
+  if (safeAMs !== safeBMs) return safeAMs - safeBMs;
+  return a.id.localeCompare(b.id);
+}
+
+function compareMissionKey(a: string, b: string) {
+  if (a === 'starship-program') return 1;
+  if (b === 'starship-program') return -1;
+
+  const aMatch = a.match(/^flight-(\d+)$/);
+  const bMatch = b.match(/^flight-(\d+)$/);
+  if (aMatch?.[1] && bMatch?.[1]) {
+    return Number(bMatch[1]) - Number(aMatch[1]);
+  }
+  return a.localeCompare(b);
+}
+
+function countBy<T, K extends string>(items: T[], resolver: (value: T) => K) {
+  const out = {} as Record<K, number>;
+  for (const item of items) {
+    const key = resolver(item);
+    out[key] = (out[key] || 0) + 1;
+  }
+  return out;
+}
+
+function dedupeById(launches: Launch[]) {
+  const seen = new Set<string>();
+  const deduped: Launch[] = [];
+  for (const launch of launches) {
+    if (seen.has(launch.id)) continue;
+    seen.add(launch.id);
+    deduped.push(launch);
+  }
+  return deduped;
+}
+
+function normalizeEvent(event: StarshipTimelineEvent): StarshipTimelineEvent {
+  return {
+    ...event,
+    supersedes: event.supersedes || [],
+    supersededBy: event.supersededBy ?? null
+  };
+}
+
+function toIsoOrNull(value: string | null | undefined) {
+  if (!value) return null;
+  const date = new Date(value);
+  if (Number.isNaN(date.getTime())) return null;
+  return date.toISOString();
+}
+
+function clampInt(value: number, fallback: number, min: number, max: number) {
+  if (!Number.isFinite(value)) return fallback;
+  const truncated = Math.trunc(value);
+  return Math.max(min, Math.min(max, truncated));
+}
+
+function decodeCursor(cursor: string | null) {
+  if (!cursor) return 0;
+  const parsed = Number(cursor);
+  if (!Number.isFinite(parsed)) return 0;
+  return Math.max(0, Math.trunc(parsed));
+}
+
+function encodeCursor(value: number) {
+  return String(Math.max(0, Math.trunc(value)));
+}
diff --git a/lib/types/starship.ts b/lib/types/starship.ts
new file mode 100644
index 0000000..371692b
--- /dev/null
+++ b/lib/types/starship.ts
@@ -0,0 +1,176 @@
+import type { Launch } from '@/lib/types/launch';
+
+export type StarshipFaqItem = {
+  question: string;
+  answer: string;
+};
+
+export type StarshipChangeItem = {
+  title: string;
+  summary: string;
+  date: string;
+  href?: string;
+};
+
+export type StarshipProgramSnapshot = {
+  generatedAt: string;
+  lastUpdated: string | null;
+  nextLaunch: Launch | null;
+  upcoming: Launch[];
+  recent: Launch[];
+  faq: StarshipFaqItem[];
+};
+
+export type StarshipFlightSnapshot = {
+  generatedAt: string;
+  lastUpdated: string | null;
+  missionName: string;
+  flightNumber: number;
+  flightSlug: string;
+  nextLaunch: Launch | null;
+  upcoming: Launch[];
+  recent: Launch[];
+  crewHighlights: string[];
+  changes: StarshipChangeItem[];
+  faq: StarshipFaqItem[];
+};
+
+export type StarshipMissionSnapshot = StarshipFlightSnapshot;
+
+export type StarshipAudienceMode = 'quick' | 'explorer' | 'technical';
+
+export type StarshipTimelineMission = `flight-${number}` | 'starship-program';
+
+export type StarshipTimelineSourceType = 'll2-cache' | 'spacex-official' | 'curated-fallback';
+
+export type StarshipTimelineConfidence = 'high' | 'medium' | 'low';
+
+export type StarshipTimelineEventKind = 'program-milestone' | 'launch' | 'update';
+
+export type StarshipTimelineEventStatus = 'completed' | 'upcoming' | 'tentative' | 'superseded';
+
+export type StarshipTimelineSupersedeReason = 'rescheduled' | 'refined' | 'replaced';
+
+export type StarshipTimelineSupersedesLink = {
+  eventId: string;
+  reason: StarshipTimelineSupersedeReason;
+};
+
+export type StarshipTimelineSource = {
+  type: StarshipTimelineSourceType;
+  label: string;
+  href?: string;
+  lastVerifiedAt?: string | null;
+};
+
+export type StarshipTimelineEvent = {
+  id: string;
+  mission: StarshipTimelineMission;
+  title: string;
+  summary: string;
+  date: string;
+  endDate?: string | null;
+  kind: StarshipTimelineEventKind;
+  status: StarshipTimelineEventStatus;
+  source: StarshipTimelineSource;
+  confidence: StarshipTimelineConfidence;
+  supersedes: StarshipTimelineSupersedesLink[];
+  supersededBy?: StarshipTimelineSupersedesLink | null;
+  evidenceId: string;
+  launch?: Launch | null;
+};
+
+export type StarshipTimelineFacetOption = {
+  value: string;
+  label: string;
+  count: number;
+  selected: boolean;
+};
+
+export type StarshipTimelineFacet = {
+  key: 'mission' | 'sourceType';
+  label: string;
+  options: StarshipTimelineFacetOption[];
+};
+
+export type StarshipTimelineKpis = {
+  totalEvents: number;
+  completedEvents: number;
+  upcomingEvents: number;
+  tentativeEvents: number;
+  supersededEvents: number;
+  highConfidenceEvents: number;
+  lastUpdated: string | null;
+};
+
+export type StarshipMissionProgressState = 'completed' | 'in-preparation' | 'planned';
+
+export type StarshipMissionProgressCard = {
+  mission: StarshipTimelineMission;
+  label: string;
+  state: StarshipMissionProgressState;
+  summary: string;
+  targetDate: string | null;
+  sourceType: StarshipTimelineSourceType;
+  confidence: StarshipTimelineConfidence;
+  eventId: string | null;
+};
+
+export type StarshipEvidenceSource = {
+  label: string;
+  href?: string;
+  note?: string;
+  capturedAt?: string | null;
+};
+
+export type StarshipEventEvidence = {
+  eventId: string;
+  mission: StarshipTimelineMission;
+  title: string;
+  summary: string;
+  sourceType: StarshipTimelineSourceType;
+  confidence: StarshipTimelineConfidence;
+  generatedAt: string;
+  sources: StarshipEvidenceSource[];
+  payload: Record<string, unknown>;
+};
+
+export type StarshipTimelineMissionFilter = StarshipTimelineMission | 'all';
+
+export type StarshipTimelineSourceFilter = StarshipTimelineSourceType | 'all';
+
+export type StarshipTimelineQuery = {
+  mode: StarshipAudienceMode;
+  mission: StarshipTimelineMissionFilter;
+  sourceType: StarshipTimelineSourceFilter;
+  includeSuperseded: boolean;
+  from: string | null;
+  to: string | null;
+  cursor: string | null;
+  limit: number;
+};
+
+export type StarshipTimelineResponse = {
+  generatedAt: string;
+  mode: StarshipAudienceMode;
+  mission: StarshipTimelineMissionFilter;
+  sourceType: StarshipTimelineSourceFilter;
+  includeSuperseded: boolean;
+  from: string | null;
+  to: string | null;
+  events: StarshipTimelineEvent[];
+  facets: StarshipTimelineFacet[];
+  kpis: StarshipTimelineKpis;
+  missionProgress: StarshipMissionProgressCard[];
+  nextCursor: string | null;
+};
+
+export type StarshipFlightIndexEntry = {
+  flightNumber: number;
+  flightSlug: `flight-${number}`;
+  label: string;
+  nextLaunch: Launch | null;
+  upcomingCount: number;
+  recentCount: number;
+  lastUpdated: string | null;
+};
diff --git a/lib/utils/starship.ts b/lib/utils/starship.ts
new file mode 100644
index 0000000..78bcbf2
--- /dev/null
+++ b/lib/utils/starship.ts
@@ -0,0 +1,89 @@
+import type { Launch } from '@/lib/types/launch';
+
+type StarshipLaunchLike = Pick<Launch, 'name' | 'mission' | 'programs' | 'vehicle' | 'rocket'>;
+
+const STARSHIP_TEXT_PATTERN = /\bstarship\b|\bsuper\s*heavy\b/i;
+const FLIGHT_NUMBER_PATTERNS = [
+  /\bstarship\s*(?:integrated\s*)?flight\s*(?:test\s*)?(\d{1,3})\b/i,
+  /\bift\s*[-#: ]?\s*(\d{1,3})\b/i,
+  /\bflight\s*[-#: ]?\s*(\d{1,3})\b/i
+] as const;
+
+function normalizeText(value: string | null | undefined) {
+  return typeof value === 'string' ? value.trim() : '';
+}
+
+function collectLaunchTextCandidates(launch: StarshipLaunchLike) {
+  const candidates: Array<string | null | undefined> = [launch.name, launch.mission?.name, launch.vehicle, launch.rocket?.fullName];
+  for (const program of launch.programs || []) {
+    if (program?.name) candidates.push(program.name);
+    if (program?.description) candidates.push(program.description);
+  }
+  return candidates.map(normalizeText).filter(Boolean);
+}
+
+export function isStarshipProgramText(value: string | null | undefined) {
+  const normalized = normalizeText(value);
+  if (!normalized) return false;
+  return STARSHIP_TEXT_PATTERN.test(normalized);
+}
+
+export function isStarshipProgramLaunch(launch: StarshipLaunchLike) {
+  const candidates = collectLaunchTextCandidates(launch);
+  return candidates.some((candidate) => isStarshipProgramText(candidate) || /\bift\s*[-#: ]?\s*\d{1,3}\b/i.test(candidate));
+}
+
+export function extractStarshipFlightNumberFromText(value: string | null | undefined) {
+  const normalized = normalizeText(value);
+  if (!normalized) return null;
+
+  for (const pattern of FLIGHT_NUMBER_PATTERNS) {
+    const match = normalized.match(pattern);
+    const raw = match?.[1];
+    if (!raw) continue;
+    const number = Number(raw);
+    if (!Number.isFinite(number)) continue;
+    const int = Math.trunc(number);
+    if (int <= 0 || int > 999) continue;
+
+    // Generic "Flight <n>" should only count when Starship context is present.
+    if (pattern === FLIGHT_NUMBER_PATTERNS[2] && !STARSHIP_TEXT_PATTERN.test(normalized)) {
+      continue;
+    }
+
+    return int;
+  }
+
+  return null;
+}
+
+export function extractStarshipFlightNumber(launch: StarshipLaunchLike) {
+  for (const candidate of collectLaunchTextCandidates(launch)) {
+    const number = extractStarshipFlightNumberFromText(candidate);
+    if (number != null) return number;
+  }
+  return null;
+}
+
+export function buildStarshipFlightSlug(flightNumber: number): `flight-${number}` {
+  return `flight-${Math.max(1, Math.trunc(flightNumber))}` as `flight-${number}`;
+}
+
+export function parseStarshipFlightSlug(value: string | null | undefined) {
+  if (!value) return null;
+  const normalized = value.trim().toLowerCase();
+  const match = normalized.match(/^flight-(\d{1,3})$/);
+  if (!match?.[1]) return null;
+  const number = Number(match[1]);
+  if (!Number.isFinite(number)) return null;
+  const int = Math.trunc(number);
+  if (int <= 0 || int > 999) return null;
+  return int;
+}
+
+export function getStarshipVariantLabel(launch: StarshipLaunchLike): `flight-${number}` | 'starship' | null {
+  const flightNumber = extractStarshipFlightNumber(launch);
+  if (flightNumber != null) return buildStarshipFlightSlug(flightNumber);
+  if (isStarshipProgramLaunch(launch)) return 'starship';
+  return null;
+}
```

## Notes

- The patch sections above are emitted directly from git and include all added/removed lines for those commits.
- A character-perfect export of the full chat transcript (assistant/user/system messages) is not available via git; this file captures the full code-change record.

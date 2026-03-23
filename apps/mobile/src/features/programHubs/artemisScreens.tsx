import type { ReactNode } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import type { ArtemisMissionKeyV1, ArtemisMissionOverviewV1, ArtemisOverviewV1 } from '@tminuszero/api-client';
import { useArtemisMissionOverviewQuery, useArtemisOverviewQuery } from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import {
  CustomerShellBadge,
  CustomerShellHero,
  CustomerShellMetric,
  CustomerShellPanel
} from '@/src/components/CustomerShell';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import {
  buildArtemisAwardeesHref,
  buildArtemisContentHref,
  buildArtemisContractsHref
} from './artemisRoutes';

const ARTEMIS_ALIAS_MAP: Record<string, ArtemisMissionKeyV1> = {
  'artemis-1': 'artemis-i',
  'artemis-i': 'artemis-i',
  'artemis-2': 'artemis-ii',
  'artemis-ii': 'artemis-ii',
  'artemis-3': 'artemis-iii',
  'artemis-iii': 'artemis-iii',
  'artemis-4': 'artemis-iv',
  'artemis-iv': 'artemis-iv',
  'artemis-5': 'artemis-v',
  'artemis-v': 'artemis-v',
  'artemis-6': 'artemis-vi',
  'artemis-vi': 'artemis-vi',
  'artemis-7': 'artemis-vii',
  'artemis-vii': 'artemis-vii'
};

type QueryState<T> = {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
};

export function normalizeArtemisMissionParam(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/_/g, '-');

  return ARTEMIS_ALIAS_MAP[normalized] || null;
}

export function ArtemisHubScreen() {
  const router = useRouter();
  const overviewQuery = useArtemisOverviewQuery();

  return (
    <AppScreen testID="artemis-hub-screen">
      <CustomerShellHero
        eyebrow="Program Hub"
        title="Artemis"
        description="Native Artemis program hub with mission routing, timeline previews, and source-linked content snapshots."
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label="Native beta" tone="accent" />
          <CustomerShellBadge label="Rollout gated" tone="warning" />
        </View>
      </CustomerShellHero>

      {renderQueryState(overviewQuery, {
        emptyTitle: 'Artemis unavailable',
        emptyDescription: 'No Artemis overview payload is currently available.',
        render: (payload) => (
          <>
            <MetricsPanel
              title="Program status"
              metrics={[
                { label: 'Missions', value: String(payload.stats.missions) },
                { label: 'Upcoming', value: String(payload.stats.upcomingLaunches) },
                { label: 'Timeline', value: String(payload.stats.timelineEvents) },
                { label: 'Content', value: String(payload.stats.contentItems) }
              ]}
            />

            <CustomerShellPanel title="Native routes" description="Mission-specific native routes mirror the current Artemis family already published on the web.">
              <View style={{ gap: 10 }}>
                <ProgramRow
                  title="Contracts"
                  body="Native Artemis contract-family intelligence and story routes."
                  onPress={() => router.push(buildArtemisContractsHref() as Href)}
                />
                <ProgramRow
                  title="Awardees"
                  body="Native recipient profiles for Artemis procurement partners and contractors."
                  onPress={() => router.push(buildArtemisAwardeesHref() as Href)}
                />
                <ProgramRow
                  title="Content"
                  body="Native Artemis content feed with kind, mission, and tier filters."
                  onPress={() => router.push(buildArtemisContentHref() as Href)}
                />
                {payload.missions.map((mission) => (
                  <ProgramRow key={mission.missionKey} title={mission.title} body={mission.description} onPress={() => router.push(mission.href as Href)} />
                ))}
              </View>
            </CustomerShellPanel>

            <LaunchSummaryPanel title="Next launch" description="The next Artemis-linked launch routed through the shared launch-detail screen." launch={payload.snapshot.nextLaunch} />

            <CustomerShellPanel title="Timeline preview" description={`${payload.timeline.length} Artemis timeline event${payload.timeline.length === 1 ? '' : 's'} in preview.`}>
              <View style={{ gap: 10 }}>
                {payload.timeline.length ? (
                  payload.timeline.map((event) => (
                    <TimelineRow key={event.id} title={event.title} body={[event.missionLabel, formatDate(event.date), event.sourceLabel].filter(Boolean).join(' • ')} href={event.href} />
                  ))
                ) : (
                  <TextBlock value="No timeline previews are currently available." />
                )}
              </View>
            </CustomerShellPanel>

            <CustomerShellPanel title="Content preview" description={`${payload.content.length} content item${payload.content.length === 1 ? '' : 's'} in preview.`}>
              <View style={{ gap: 10 }}>
                {payload.content.length ? (
                  payload.content.map((item) => (
                    <ExternalRow
                      key={item.id}
                      title={item.title}
                      body={[item.missionLabel, item.sourceLabel, item.publishedAt ? formatDate(item.publishedAt) : null].filter(Boolean).join(' • ') || item.summary || 'Artemis content item'}
                      href={item.url}
                    />
                  ))
                ) : (
                  <TextBlock value="No content previews are currently available." />
                )}
              </View>
            </CustomerShellPanel>
          </>
        )
      })}
    </AppScreen>
  );
}

export function ArtemisMissionScreen({ mission }: { mission: ArtemisMissionKeyV1 }) {
  const missionQuery = useArtemisMissionOverviewQuery(mission);

  return (
    <AppScreen testID={`artemis-mission-${mission}`}>
      <CustomerShellHero
        eyebrow="Artemis Mission"
        title={missionLabel(mission)}
        description="Mission route with launch snapshot, crew highlights, watch links, evidence, and source-linked updates."
      />
      {renderQueryState(missionQuery, {
        emptyTitle: 'Mission unavailable',
        emptyDescription: 'The requested Artemis mission payload could not be loaded.',
        render: (payload) => (
          <>
            <LaunchSummaryPanel title="Next launch" description="Shared mission snapshot routed to native launch detail when a launch exists." launch={payload.snapshot.nextLaunch} />

            <MetricsPanel
              title="Coverage"
              metrics={[
                { label: 'Crew', value: payload.coverage.hasCrew ? 'Yes' : 'No' },
                { label: 'Watch', value: payload.coverage.hasWatchLinks ? 'Yes' : 'No' },
                { label: 'Evidence', value: payload.coverage.hasEvidenceLinks ? 'Yes' : 'No' },
                { label: 'News', value: payload.coverage.hasNews ? 'Yes' : 'No' }
              ]}
            />

            <CustomerShellPanel title="Crew highlights" description={`${payload.snapshot.crewHighlights.length} crew highlight${payload.snapshot.crewHighlights.length === 1 ? '' : 's'} available.`}>
              <View style={{ gap: 10 }}>
                {payload.snapshot.crewHighlights.length ? (
                  payload.snapshot.crewHighlights.map((highlight) => <SimpleRow key={highlight} title={highlight} body="" />)
                ) : (
                  <TextBlock value="No crew highlights are currently available." />
                )}
              </View>
            </CustomerShellPanel>

            <CustomerShellPanel title="Timeline changes" description="Recent mission deltas and tracked public updates.">
              <View style={{ gap: 10 }}>
                {payload.snapshot.changes.length ? (
                  payload.snapshot.changes.map((change) => (
                    <TimelineRow
                      key={`${change.date}:${change.title}`}
                      title={change.title}
                      body={`${formatDate(change.date)} • ${change.summary}`}
                      href={change.href || null}
                    />
                  ))
                ) : (
                  <TextBlock value="No tracked mission changes are currently available." />
                )}
              </View>
            </CustomerShellPanel>

            <ExternalPanel title="Watch links" description={`${payload.watchLinks.length} watch link${payload.watchLinks.length === 1 ? '' : 's'} available.`} items={payload.watchLinks.map((link) => ({ key: link.url, title: link.label, body: link.url, href: link.url }))} emptyValue="No mission watch links are currently available." />
            <ExternalPanel title="Evidence" description={`${payload.evidenceLinks.length} evidence link${payload.evidenceLinks.length === 1 ? '' : 's'} available.`} items={payload.evidenceLinks.map((link) => ({ key: `${link.url}:${link.label}`, title: link.label, body: [link.source, link.detail, link.capturedAt ? formatDate(link.capturedAt) : null].filter(Boolean).join(' • ') || link.url, href: link.url }))} emptyValue="No mission evidence links are currently available." />
            <ExternalPanel title="News" description={`${payload.news.length} article${payload.news.length === 1 ? '' : 's'} available.`} items={payload.news.map((item) => ({ key: item.id, title: item.title, body: [item.newsSite, item.publishedAt ? formatDate(item.publishedAt) : null, item.relevance].filter(Boolean).join(' • ') || item.summary || item.url, href: item.url }))} emptyValue="No mission news items are currently available." />
            <ExternalPanel title="Social" description={`${payload.social.length} social post${payload.social.length === 1 ? '' : 's'} available.`} items={payload.social.filter((item) => Boolean(item.externalUrl)).map((item) => ({ key: item.id, title: item.launchName || item.platform, body: [item.platform, item.postedAt ? formatDate(item.postedAt) : null, item.status].filter(Boolean).join(' • ') || item.text || item.externalUrl || 'Social post', href: item.externalUrl || '' }))} emptyValue="No mission social links are currently available." />
          </>
        )
      })}
    </AppScreen>
  );
}

function renderQueryState<T>(
  query: QueryState<T>,
  options: {
    emptyTitle: string;
    emptyDescription: string;
    render: (payload: T) => ReactNode;
  }
) {
  if (query.isPending) {
    return <CustomerShellPanel title="Loading" description="Fetching the latest Artemis payload." />;
  }

  if (query.isError) {
    return <CustomerShellPanel title="Unavailable" description={query.error?.message || 'Unable to load the Artemis payload.'} />;
  }

  if (!query.data) {
    return <CustomerShellPanel title={options.emptyTitle} description={options.emptyDescription} />;
  }

  return options.render(query.data);
}

function MetricsPanel({
  title,
  metrics
}: {
  title: string;
  metrics: Array<{ label: string; value: string }>;
}) {
  return (
    <CustomerShellPanel title={title} description="Snapshot metrics from the shared Artemis loaders.">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {metrics.map((metric) => (
          <CustomerShellMetric key={metric.label} label={metric.label} value={metric.value} />
        ))}
      </View>
    </CustomerShellPanel>
  );
}

function ExternalPanel({
  title,
  description,
  items,
  emptyValue
}: {
  title: string;
  description: string;
  items: Array<{ key: string; title: string; body: string; href: string }>;
  emptyValue: string;
}) {
  return (
    <CustomerShellPanel title={title} description={description}>
      <View style={{ gap: 10 }}>
        {items.length ? (
          items.map((item) => <ExternalRow key={item.key} title={item.title} body={item.body} href={item.href} />)
        ) : (
          <TextBlock value={emptyValue} />
        )}
      </View>
    </CustomerShellPanel>
  );
}

function LaunchSummaryPanel({
  title,
  description,
  launch
}: {
  title: string;
  description: string;
  launch: ArtemisOverviewV1['snapshot']['nextLaunch'] | ArtemisMissionOverviewV1['snapshot']['nextLaunch'];
}) {
  const router = useRouter();
  return (
    <CustomerShellPanel title={title} description={description}>
      {launch ? (
        <SimpleRow
          title={launch.name}
          body={[launch.vehicle, launch.padShortCode, formatDate(launch.net), launch.statusText].filter(Boolean).join(' • ')}
          meta="Open launch detail"
          onPress={() => router.push(launch.href as Href)}
        />
      ) : (
        <TextBlock value="No linked Artemis launch is currently available." />
      )}
    </CustomerShellPanel>
  );
}

function TimelineRow({
  title,
  body,
  href
}: {
  title: string;
  body: string;
  href: string | null | undefined;
}) {
  const router = useRouter();
  return (
    <SimpleRow
      title={title}
      body={body}
      meta={href ? (href.startsWith('/') ? 'Open' : 'Open source') : null}
      onPress={
        href
          ? () => {
              if (href.startsWith('/')) {
                router.push(href as Href);
                return;
              }
              void Linking.openURL(href);
            }
          : undefined
      }
    />
  );
}

function ExternalRow({
  title,
  body,
  href
}: {
  title: string;
  body: string;
  href: string;
}) {
  return <SimpleRow title={title} body={body} meta="Open source" onPress={() => void Linking.openURL(href)} />;
}

function ProgramRow({
  title,
  body,
  onPress
}: {
  title: string;
  body: string;
  onPress: () => void;
}) {
  return <SimpleRow title={title} body={body} meta="Open" onPress={onPress} />;
}

function SimpleRow({
  title,
  body,
  meta,
  onPress
}: {
  title: string;
  body: string;
  meta?: string | null;
  onPress?: (() => void) | undefined;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        gap: 6,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: pressed && onPress ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 14,
        paddingVertical: 14,
        opacity: onPress ? 1 : 0.96
      })}
    >
      <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{title}</Text>
      {body ? <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>{body}</Text> : null}
      {meta ? <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>{meta}</Text> : null}
    </Pressable>
  );
}

function TextBlock({ value }: { value: string }) {
  const { theme } = useMobileBootstrap();
  return <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>{value}</Text>;
}

function missionLabel(mission: ArtemisMissionKeyV1) {
  return mission.toUpperCase().replace('ARTEMIS-', 'Artemis ');
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

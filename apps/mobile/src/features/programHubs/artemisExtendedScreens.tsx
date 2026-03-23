import { useState, type ReactNode } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import type { ArtemisMissionKeyV1 } from '@tminuszero/api-client';
import {
  useArtemisAwardeeDetailQuery,
  useArtemisAwardeesQuery,
  useArtemisContentQuery,
  useArtemisContractDetailQuery,
  useArtemisContractsQuery
} from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import {
  CustomerShellHero,
  CustomerShellMetric,
  CustomerShellPanel
} from '@/src/components/CustomerShell';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import {
  artemisMissionOrProgramLabel,
  buildArtemisAwardeeHref,
  buildArtemisContractHref,
  buildArtemisMissionHref,
  normalizeArtemisAwardeeSlugParam,
  normalizeArtemisContractPiidParam
} from './artemisRoutes';

type QueryState<T> = {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
};

type ArtemisContentMissionFilter = ArtemisMissionKeyV1 | 'program' | 'all';
type ArtemisContentKindFilter = 'article' | 'photo' | 'social' | 'data' | 'all';
type ArtemisContentTierFilter = 'tier1' | 'tier2' | 'all';

const CONTENT_KIND_OPTIONS: Array<{ value: ArtemisContentKindFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'article', label: 'Articles' },
  { value: 'photo', label: 'Photos' },
  { value: 'social', label: 'Social' },
  { value: 'data', label: 'Data' }
];

const CONTENT_TIER_OPTIONS: Array<{ value: ArtemisContentTierFilter; label: string }> = [
  { value: 'all', label: 'All tiers' },
  { value: 'tier1', label: 'Tier 1' },
  { value: 'tier2', label: 'Tier 2' }
];

const CONTENT_MISSION_OPTIONS: Array<{ value: ArtemisContentMissionFilter; label: string }> = [
  { value: 'all', label: 'All missions' },
  { value: 'program', label: 'Program' },
  { value: 'artemis-i', label: 'Artemis I' },
  { value: 'artemis-ii', label: 'Artemis II' },
  { value: 'artemis-iii', label: 'Artemis III' },
  { value: 'artemis-iv', label: 'Artemis IV' },
  { value: 'artemis-v', label: 'Artemis V' },
  { value: 'artemis-vi', label: 'Artemis VI' },
  { value: 'artemis-vii', label: 'Artemis VII' }
];

export {
  normalizeArtemisAwardeeSlugParam,
  normalizeArtemisContractPiidParam
};

export function ArtemisContractsScreen() {
  const router = useRouter();
  const contractsQuery = useArtemisContractsQuery();

  return (
    <AppScreen testID="artemis-contracts-screen">
      <CustomerShellHero
        eyebrow="Artemis"
        title="Contracts"
        description="Native contract-family index backed by the shared Artemis procurement story loaders."
      />
      {renderQueryState(contractsQuery, {
        emptyTitle: 'No Artemis contracts',
        emptyDescription: 'No Artemis contract families are currently available.',
        render: (payload) => (
          <>
            <MetricsPanel
              title="Contract intelligence"
              metrics={[
                { label: 'Rows', value: String(payload.totalRows) },
                { label: 'Families', value: String(payload.totalFamilies) }
              ]}
            />
            <CustomerShellPanel title="Contract families" description={`${payload.items.length} contract family${payload.items.length === 1 ? '' : 'ies'} available.`}>
              <View style={{ gap: 10 }}>
                {payload.items.length ? (
                  payload.items.map((item) => (
                    <DetailRow
                      key={item.id}
                      title={item.contractKey}
                      body={[
                        artemisMissionOrProgramLabel(item.missionKey as ArtemisMissionKeyV1 | 'program' | null),
                        item.awardeeName,
                        item.baseAwardDate ? formatDate(item.baseAwardDate) : null,
                        item.contractType
                      ]
                        .filter(Boolean)
                        .join(' • ') || 'Contract family'}
                      meta="Open contract story"
                      onPress={() => router.push(buildArtemisContractHref(item.piid) as Href)}
                    />
                  ))
                ) : (
                  <TextBlock value="No Artemis contract families are currently available on mobile." />
                )}
              </View>
            </CustomerShellPanel>
          </>
        )
      })}
    </AppScreen>
  );
}

export function ArtemisContractDetailScreen({ piid }: { piid: string }) {
  const router = useRouter();
  const detailQuery = useArtemisContractDetailQuery(piid);

  return (
    <AppScreen testID="artemis-contract-detail-screen">
      <CustomerShellHero
        eyebrow="Artemis Contract"
        title={detailQuery.data?.title || 'Contract story'}
        description="Native contract-family detail with members, action history, notices, and funding trend."
      />
      {renderQueryState(detailQuery, {
        emptyTitle: 'Contract unavailable',
        emptyDescription: 'The requested Artemis contract family is not available on mobile.',
        render: (payload) => {
          const primary = payload.story.members[0] || null;
          return (
            <>
              <MetricsPanel
                title="Story snapshot"
                metrics={[
                  { label: 'Family', value: String(payload.story.members.length) },
                  { label: 'Actions', value: String(payload.story.actions.length) },
                  { label: 'Notices', value: String(payload.story.notices.length) },
                  { label: 'Bidders', value: String(payload.story.bidders.length) }
                ]}
              />

              <CustomerShellPanel title="Award profile" description={payload.description}>
                <View style={{ gap: 10 }}>
                  {primary ? (
                    <>
                      <DetailRow
                        title={primary.contractKey}
                        body={[
                          artemisMissionOrProgramLabel(primary.missionKey as ArtemisMissionKeyV1 | 'program' | null),
                          primary.awardeeName,
                          primary.baseAwardDate ? formatDate(primary.baseAwardDate) : null,
                          primary.contractType
                        ]
                          .filter(Boolean)
                          .join(' • ') || 'Contract family'}
                      />
                      {primary.missionKey && primary.missionKey !== 'program' ? (
                        <DetailRow
                          title={`${artemisMissionOrProgramLabel(primary.missionKey as ArtemisMissionKeyV1)} mission hub`}
                          body="Open the linked native Artemis mission route."
                          meta="Open mission hub"
                          onPress={() => router.push(buildArtemisMissionHref(primary.missionKey as ArtemisMissionKeyV1) as Href)}
                        />
                      ) : null}
                      {primary.sourceUrl ? (
                        <DetailRow
                          title="Source record"
                          body={primary.sourceUrl}
                          meta="Open source"
                          onPress={() => void Linking.openURL(primary.sourceUrl || '')}
                        />
                      ) : null}
                    </>
                  ) : (
                    <TextBlock value="No primary Artemis contract row is currently available." />
                  )}
                </View>
              </CustomerShellPanel>

              <CustomerShellPanel title="Contract family" description={`${payload.story.members.length} family member${payload.story.members.length === 1 ? '' : 's'} available.`}>
                <View style={{ gap: 10 }}>
                  {payload.story.members.map((member) => (
                    <DetailRow
                      key={member.id}
                      title={member.contractKey}
                      body={[member.awardeeName, member.baseAwardDate ? formatDate(member.baseAwardDate) : null, member.contractType].filter(Boolean).join(' • ') || 'Contract member'}
                    />
                  ))}
                </View>
              </CustomerShellPanel>

              <CustomerShellPanel title="Action timeline" description={`${payload.story.actions.length} action record${payload.story.actions.length === 1 ? '' : 's'} available.`}>
                <View style={{ gap: 10 }}>
                  {payload.story.actions.length ? (
                    payload.story.actions.slice(0, 16).map((action) => (
                      <DetailRow
                        key={action.id}
                        title={`Mod ${action.modNumber || '0'}`}
                        body={[
                          action.actionDate ? formatDate(action.actionDate) : null,
                          formatCurrency(action.obligationDelta),
                          action.solicitationId
                        ]
                          .filter(Boolean)
                          .join(' • ') || 'Contract action'}
                      />
                    ))
                  ) : (
                    <TextBlock value="No Artemis action records are currently available on mobile." />
                  )}
                </View>
              </CustomerShellPanel>

              <CustomerShellPanel title="Opportunity notices" description={`${payload.story.notices.length} notice${payload.story.notices.length === 1 ? '' : 's'} available.`}>
                <View style={{ gap: 10 }}>
                  {payload.story.notices.length ? (
                    payload.story.notices.slice(0, 12).map((notice) => (
                      <DetailRow
                        key={notice.id}
                        title={notice.title || notice.noticeId}
                        body={[
                          notice.postedDate ? formatDate(notice.postedDate) : null,
                          notice.awardeeName,
                          formatCurrency(notice.awardAmount)
                        ]
                          .filter(Boolean)
                          .join(' • ') || 'Opportunity notice'}
                        meta={notice.noticeUrl ? 'Open source' : null}
                        onPress={notice.noticeUrl ? () => void Linking.openURL(notice.noticeUrl || '') : undefined}
                      />
                    ))
                  ) : (
                    <TextBlock value="No Artemis notice records are currently available on mobile." />
                  )}
                </View>
              </CustomerShellPanel>

              <CustomerShellPanel title="Funding trend" description={`${payload.story.spending.length} funding point${payload.story.spending.length === 1 ? '' : 's'} available.`}>
                <View style={{ gap: 10 }}>
                  {payload.story.spending.length ? (
                    payload.story.spending.slice(0, 16).map((entry) => (
                      <DetailRow
                        key={entry.id}
                        title={`FY ${entry.fiscalYear} M${String(entry.fiscalMonth).padStart(2, '0')}`}
                        body={[formatCurrency(entry.obligations), formatCurrency(entry.outlays), entry.source].filter(Boolean).join(' • ') || 'Funding point'}
                      />
                    ))
                  ) : (
                    <TextBlock value="No Artemis funding points are currently available on mobile." />
                  )}
                </View>
              </CustomerShellPanel>
            </>
          );
        }
      })}
    </AppScreen>
  );
}

export function ArtemisAwardeesScreen() {
  const router = useRouter();
  const awardeesQuery = useArtemisAwardeesQuery();

  return (
    <AppScreen testID="artemis-awardees-screen">
      <CustomerShellHero
        eyebrow="Artemis"
        title="Awardees"
        description="Native recipient index for Artemis procurement pages and contract-linked award context."
      />
      {renderQueryState(awardeesQuery, {
        emptyTitle: 'No Artemis awardees',
        emptyDescription: 'No approved Artemis awardee profiles are currently available.',
        render: (payload) => (
          <>
            <MetricsPanel
              title="Recipient index"
              metrics={[
                { label: 'Profiles', value: String(payload.items.length) },
                { label: 'Query', value: payload.query || 'All' }
              ]}
            />
            <CustomerShellPanel title="Approved profiles" description={`${payload.items.length} awardee profile${payload.items.length === 1 ? '' : 's'} available.`}>
              <View style={{ gap: 10 }}>
                {payload.items.length ? (
                  payload.items.map((item) => (
                    <DetailRow
                      key={item.recipientKey}
                      title={item.recipientName}
                      body={[
                        `${item.awardCount} award${item.awardCount === 1 ? '' : 's'}`,
                        formatCurrencyCompact(item.totalObligatedAmount),
                        item.lastAwardedOn ? formatDate(item.lastAwardedOn) : null
                      ]
                        .filter(Boolean)
                        .join(' • ') || item.summary}
                      meta="Open awardee profile"
                      onPress={() => router.push(buildArtemisAwardeeHref(item.slug) as Href)}
                    />
                  ))
                ) : (
                  <TextBlock value="No approved Artemis awardee profiles are currently available on mobile." />
                )}
              </View>
            </CustomerShellPanel>
          </>
        )
      })}
    </AppScreen>
  );
}

export function ArtemisAwardeeDetailScreen({ slug }: { slug: string }) {
  const router = useRouter();
  const detailQuery = useArtemisAwardeeDetailQuery(slug);

  return (
    <AppScreen testID="artemis-awardee-detail-screen">
      <CustomerShellHero
        eyebrow="Artemis Awardee"
        title={detailQuery.data?.title || 'Awardee profile'}
        description="Native recipient profile with mission alignment, tracked awards, and related awardees."
      />
      {renderQueryState(detailQuery, {
        emptyTitle: 'Awardee unavailable',
        emptyDescription: 'The requested Artemis awardee profile is not available on mobile.',
        render: (payload) => (
          <>
            <MetricsPanel
              title="Recipient snapshot"
              metrics={[
                { label: 'Awards', value: String(payload.profile.awardCount) },
                { label: 'Total', value: formatCurrencyCompact(payload.profile.totalObligatedAmount) },
                { label: 'Updated', value: payload.profile.lastUpdated ? formatDate(payload.profile.lastUpdated) : 'n/a' }
              ]}
            />

            <CustomerShellPanel title="Mission alignment" description={`${payload.profile.missionBreakdown.length} mission bucket${payload.profile.missionBreakdown.length === 1 ? '' : 's'} available.`}>
              <View style={{ gap: 10 }}>
                {payload.profile.missionBreakdown.length ? (
                  payload.profile.missionBreakdown.map((mission) => (
                    <DetailRow
                      key={`${payload.profile.recipientKey}:${mission.missionKey}`}
                      title={mission.label}
                      body={`${mission.awardCount} award${mission.awardCount === 1 ? '' : 's'} • ${formatCurrencyCompact(mission.obligatedAmount)}`}
                      meta={mission.missionKey !== 'program' ? 'Open mission hub' : null}
                      onPress={
                        mission.missionKey !== 'program'
                          ? () => router.push(buildArtemisMissionHref(mission.missionKey as ArtemisMissionKeyV1) as Href)
                          : undefined
                      }
                    />
                  ))
                ) : (
                  <TextBlock value="No mission alignment rows are currently available on mobile." />
                )}
              </View>
            </CustomerShellPanel>

            <CustomerShellPanel title="Tracked awards" description={`${payload.profile.awards.length} tracked award${payload.profile.awards.length === 1 ? '' : 's'} available.`}>
              <View style={{ gap: 10 }}>
                {payload.profile.awards.length ? (
                  payload.profile.awards.slice(0, 40).map((award, index) => {
                    const canOpenContract = Boolean(award.piid);
                    const canOpenSource = Boolean(award.sourceUrl);
                    return (
                      <DetailRow
                        key={`${award.awardId || award.title || 'award'}-${index}`}
                        title={award.title || award.awardId || 'Artemis award'}
                        body={[
                          artemisMissionOrProgramLabel(award.missionKey),
                          award.awardedOn ? formatDate(award.awardedOn) : null,
                          formatCurrency(award.obligatedAmount)
                        ]
                          .filter(Boolean)
                          .join(' • ') || 'Tracked award'}
                        meta={canOpenContract ? 'Open contract story' : canOpenSource ? 'Open source' : null}
                        onPress={
                          canOpenContract
                            ? () => router.push(buildArtemisContractHref(award.piid || '') as Href)
                            : canOpenSource
                              ? () => void Linking.openURL(award.sourceUrl || '')
                              : undefined
                        }
                      />
                    );
                  })
                ) : (
                  <TextBlock value="No tracked Artemis awards are currently available on mobile." />
                )}
              </View>
            </CustomerShellPanel>

            <CustomerShellPanel title="Related awardees" description={`${payload.related.length} related recipient${payload.related.length === 1 ? '' : 's'} available.`}>
              <View style={{ gap: 10 }}>
                {payload.related.length ? (
                  payload.related.map((item) => (
                    <DetailRow
                      key={item.recipientKey}
                      title={item.recipientName}
                      body={`${item.awardCount} award${item.awardCount === 1 ? '' : 's'} • ${formatCurrencyCompact(item.totalObligatedAmount)}`}
                      meta="Open awardee profile"
                      onPress={() => router.push(buildArtemisAwardeeHref(item.slug) as Href)}
                    />
                  ))
                ) : (
                  <TextBlock value="No related Artemis awardees are currently available on mobile." />
                )}
              </View>
            </CustomerShellPanel>
          </>
        )
      })}
    </AppScreen>
  );
}

export function ArtemisContentScreen() {
  const [mission, setMission] = useState<ArtemisContentMissionFilter>('all');
  const [kind, setKind] = useState<ArtemisContentKindFilter>('all');
  const [tier, setTier] = useState<ArtemisContentTierFilter>('all');
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const contentQuery = useArtemisContentQuery({ mission, kind, tier, cursor, limit: 24 });

  const resetCursor = () => {
    setCursor(null);
    setCursorHistory([]);
  };

  const loadOlder = () => {
    const nextCursor = contentQuery.data?.nextCursor || null;
    if (!nextCursor) return;
    setCursorHistory((previous) => [...previous, cursor || '']);
    setCursor(nextCursor);
  };

  const loadNewer = () => {
    if (!cursorHistory.length) return;
    const nextHistory = cursorHistory.slice(0, -1);
    const previousCursor = cursorHistory[cursorHistory.length - 1] || null;
    setCursorHistory(nextHistory);
    setCursor(previousCursor);
  };

  return (
    <AppScreen testID="artemis-content-screen">
      <CustomerShellHero
        eyebrow="Artemis"
        title="Content"
        description="Native Artemis content feed with mission, kind, and source-tier filters."
      />
      <CustomerShellPanel title="Kind" description="Filter the Artemis content feed by content type.">
        <FilterChips
          options={CONTENT_KIND_OPTIONS}
          value={kind}
          onChange={(value) => {
            setKind(value as ArtemisContentKindFilter);
            resetCursor();
          }}
        />
      </CustomerShellPanel>
      <CustomerShellPanel title="Tier" description="Filter by source tier.">
        <FilterChips
          options={CONTENT_TIER_OPTIONS}
          value={tier}
          onChange={(value) => {
            setTier(value as ArtemisContentTierFilter);
            resetCursor();
          }}
        />
      </CustomerShellPanel>
      <CustomerShellPanel title="Mission" description="Filter the Artemis content feed by mission.">
        <FilterChips
          options={CONTENT_MISSION_OPTIONS}
          value={mission}
          onChange={(value) => {
            setMission(value as ArtemisContentMissionFilter);
            resetCursor();
          }}
        />
      </CustomerShellPanel>
      {renderQueryState(contentQuery, {
        emptyTitle: 'No Artemis content',
        emptyDescription: 'No Artemis content items are currently available for the selected filters.',
        render: (payload) => (
          <>
            <MetricsPanel
              title="Feed coverage"
              metrics={[
                { label: 'Items', value: String(payload.items.length) },
                { label: 'Tier 1', value: String(payload.sourceCoverage.tier1Items) },
                { label: 'Tier 2', value: String(payload.sourceCoverage.tier2Items) }
              ]}
            />
            <CustomerShellPanel title="Content feed" description={`${payload.items.length} Artemis content item${payload.items.length === 1 ? '' : 's'} available.`}>
              <View style={{ gap: 10 }}>
                {payload.items.length ? (
                  payload.items.map((item) => (
                    <DetailRow
                      key={`${item.kind}:${item.id}`}
                      title={item.title}
                      body={[
                        item.missionLabel,
                        item.sourceLabel,
                        item.sourceTier.toUpperCase(),
                        item.publishedAt ? formatDate(item.publishedAt) : null
                      ]
                        .filter(Boolean)
                        .join(' • ') || item.summary || 'Artemis content item'}
                      meta="Open source"
                      onPress={() => void Linking.openURL(item.url)}
                    />
                  ))
                ) : (
                  <TextBlock value="No Artemis content items are currently available on mobile." />
                )}
              </View>
            </CustomerShellPanel>
            <CustomerShellPanel title="Pagination" description="Browse older or newer Artemis content pages.">
              <View style={{ gap: 10 }}>
                <DetailRow
                  title="Newer"
                  body={cursorHistory.length ? 'Load a newer page of content.' : 'No newer page is currently available.'}
                  meta={cursorHistory.length ? 'Open newer' : null}
                  onPress={cursorHistory.length ? loadNewer : undefined}
                />
                <DetailRow
                  title="Older"
                  body={payload.nextCursor ? 'Load an older page of content.' : 'No older page is currently available.'}
                  meta={payload.nextCursor ? 'Open older' : null}
                  onPress={payload.nextCursor ? loadOlder : undefined}
                />
              </View>
            </CustomerShellPanel>
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
    <CustomerShellPanel title={title} description="Snapshot fields available in the current native payload.">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {metrics.map((metric) => (
          <CustomerShellMetric key={metric.label} label={metric.label} value={metric.value} />
        ))}
      </View>
    </CustomerShellPanel>
  );
}

function FilterChips({
  options,
  value,
  onChange
}: {
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => ({
              borderRadius: 999,
              borderWidth: 1,
              borderColor: active ? theme.accent : theme.stroke,
              backgroundColor: active ? 'rgba(255,255,255,0.08)' : pressed ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.03)',
              paddingHorizontal: 12,
              paddingVertical: 8
            })}
          >
            <Text style={{ color: active ? theme.foreground : theme.muted, fontSize: 12, fontWeight: '700' }}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function DetailRow({
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

function formatCurrency(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);
}

function formatCurrencyCompact(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(value);
}

import { Pressable, Text, View } from 'react-native';
import type { LaunchJepScoreV1 } from '@tminuszero/api-client';
import type { MobileTheme } from '@tminuszero/design-tokens';
import {
  buildJepConfidenceLabel,
  buildJepObserverContext,
  buildJepPresentation,
  buildJepScenarioTimeline,
  buildJepVisibilityCallPresentation,
  type JepPresentationTone
} from '@tminuszero/domain';
import { CollapsibleCard } from '@/src/components/launch/CollapsibleSection';
import {
  useLaunchJepViewpoint,
  type MobileJepFallbackReason,
  type MobileJepViewpointPromptState
} from '@/src/hooks/useLaunchJepViewpoint';

type JepPanelProps = {
  launchId: string;
  hasJepScore: boolean;
  theme: MobileTheme;
};

export function JepPanel({ launchId, hasJepScore, theme }: JepPanelProps) {
  const {
    score,
    query,
    locationMode,
    fallbackReason,
    promptVisible,
    promptState,
    showLocationLoading,
    requestCurrentLocation,
    selectLaunchSiteReference
  } = useLaunchJepViewpoint({
    launchId,
    enabled: hasJepScore
  });

  if (!hasJepScore) {
    return (
      <Card theme={theme}>
        <Text style={eyebrowStyle(theme)}>Jellyfish Exposure Potential</Text>
        <Text style={titleStyle(theme)}>JEP visibility scoring is not available yet</Text>
        <Text style={bodyStyle(theme)}>
          Check back as launch timing, trajectory geometry, and forecast inputs refresh.
        </Text>
      </Card>
    );
  }

  if (query.isPending && !score) {
    return (
      <Card theme={theme}>
        <Text style={eyebrowStyle(theme)}>Jellyfish Exposure Potential</Text>
        <Text style={titleStyle(theme)}>Calculating your viewing setup</Text>
        <Text style={bodyStyle(theme)}>
          Loading the current JEP score, factor readout, and visibility guidance.
        </Text>
      </Card>
    );
  }

  if (!score) {
    return (
      <Card theme={theme}>
        <Text style={eyebrowStyle(theme)}>Jellyfish Exposure Potential</Text>
        <Text style={titleStyle(theme)}>JEP is temporarily unavailable</Text>
        <Text style={bodyStyle(theme)}>
          The launch detail is available, but the JEP explanation could not be loaded right now.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void query.refetch();
          }}
          style={({ pressed }) => ({
            marginTop: 4,
            alignSelf: 'flex-start',
            borderRadius: 999,
            borderWidth: 1,
            borderColor: theme.accent,
            backgroundColor: 'rgba(34, 211, 238, 0.1)',
            paddingHorizontal: 14,
            paddingVertical: 10,
            opacity: pressed ? 0.82 : 1
          })}
        >
          <Text style={{ color: theme.accent, fontSize: 13, fontWeight: '700' }}>Try again</Text>
        </Pressable>
      </Card>
    );
  }

  const presentation = buildJepPresentation(score);
  const observerContext = buildJepObserverContext(score.observer);
  const usesFallbackPresentation = locationMode === 'pad_fallback' || observerContext.launchAreaFallback;
  const visibilityCall = buildJepVisibilityCallPresentation(score, observerContext);
  const confidenceLabel = buildJepConfidenceLabel(score);
  const scenarioTimeline = buildJepScenarioTimeline(score);
  const probability = clampProbability(score.probability);
  const isProbabilityMode = score.mode === 'probability';
  const primaryValue = isProbabilityMode && probability != null ? formatProbability(probability) : `${score.score}/100`;
  const primaryLabel = isProbabilityMode
    ? usesFallbackPresentation
      ? 'Launch-area chance'
      : 'Chance to see it'
    : usesFallbackPresentation
      ? 'Launch-area score'
      : 'Visibility score';
  const scaleSummary = isProbabilityMode
    ? usesFallbackPresentation
      ? 'Reference only: high values mean launch-area conditions look favorable, not that it will be visible from you.'
      : '0% = almost no chance. 100% = very likely.'
    : usesFallbackPresentation
      ? 'Reference only: high values mean launch-area conditions look favorable, not that it will be visible from you.'
      : '0 = very unlikely to see it. 100 = best setup.';
  const locationLabel = usesFallbackPresentation ? 'Launch-area fallback' : observerContext.locationBadgeLabel;
  const fallbackReasonLabel = formatFallbackReason(fallbackReason);
  const updatedLabel = formatDateTime(score.computedAt);
  const hasGuidance =
    score.bestWindow != null || score.directionBand != null || score.elevationBand != null || score.solarWindowRange != null;

  return (
    <View style={{ gap: 16 }}>
      <Card theme={theme} accent>
        <View style={{ gap: 12 }}>
          <View style={{ gap: 6 }}>
            <Text style={eyebrowStyle(theme)}>Jellyfish Exposure Potential</Text>
            <Text style={titleStyle(theme)}>Why this launch is scoring this way</Text>
          </View>

          {promptVisible ? (
            <View
              style={{
                gap: 10,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: theme.stroke,
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                paddingHorizontal: 14,
                paddingVertical: 14
              }}
            >
              <Text style={eyebrowStyle(theme)}>Choose your viewpoint</Text>
              <Text style={{ color: theme.foreground, fontSize: 17, fontWeight: '700', lineHeight: 22 }}>
                {viewpointPromptTitle(promptState)}
              </Text>
              <Text style={bodyStyle(theme)}>{viewpointPromptBody(promptState)}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                <ActionButton
                  label={promptState === 'resolving' ? 'Checking your location...' : 'Use my location'}
                  onPress={() => {
                    void requestCurrentLocation();
                  }}
                  theme={theme}
                  emphasis="primary"
                  disabled={promptState === 'resolving'}
                />
                <ActionButton
                  label="Near launch site"
                  onPress={selectLaunchSiteReference}
                  theme={theme}
                  emphasis="secondary"
                  disabled={promptState === 'resolving'}
                />
              </View>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <TonePill label={locationLabel} tone={usesFallbackPresentation ? 'warning' : 'success'} theme={theme} />
            <TonePill label={visibilityCall.label} tone={visibilityCall.tone} theme={theme} />
            <TonePill label={confidenceLabelLabel(confidenceLabel)} tone={confidenceLabelTone(confidenceLabel)} theme={theme} />
            {usesFallbackPresentation ? <TonePill label="Not personalized" tone="warning" theme={theme} /> : null}
            <TonePill label={isProbabilityMode ? 'Chance mode' : 'Score mode'} tone={isProbabilityMode ? 'info' : 'neutral'} theme={theme} />
            {score.isSnapshot ? <TonePill label="Snapshot" tone="info" theme={theme} /> : null}
            {score.isStale ? <TonePill label="Stale" tone="warning" theme={theme} /> : null}
            {showLocationLoading ? <TonePill label="Refining for your location" tone="info" theme={theme} /> : query.isFetching ? <TonePill label="Refreshing" tone="info" theme={theme} /> : null}
            {fallbackReasonLabel ? <TonePill label={fallbackReasonLabel} tone="warning" theme={theme} /> : null}
          </View>

          {!promptVisible ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              <ActionButton
                label="From your location"
                onPress={() => {
                  void requestCurrentLocation();
                }}
                theme={theme}
                emphasis={locationMode === 'user' ? 'primary' : 'secondary'}
                disabled={promptState === 'resolving'}
              />
              <ActionButton
                label="Near launch site"
                onPress={selectLaunchSiteReference}
                theme={theme}
                emphasis={locationMode === 'pad_fallback' ? 'primary' : 'secondary'}
                disabled={promptState === 'resolving'}
              />
            </View>
          ) : null}

          <View style={{ gap: 6 }}>
            <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' }}>
              {primaryLabel}
            </Text>
            <Text style={{ color: theme.accent, fontSize: 42, fontWeight: '800', lineHeight: 48 }}>{primaryValue}</Text>
            <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '600', lineHeight: 21 }}>
              {primaryInterpretation(isProbabilityMode, score.score, probability, usesFallbackPresentation)}
            </Text>
            <Text style={bodyStyle(theme)}>{presentation.summary}</Text>
            <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>{scaleSummary}</Text>
            {usesFallbackPresentation ? (
              <Text style={{ color: '#f0bf66', fontSize: 12, lineHeight: 18 }}>
                This number is a launch-area reference score from the pad and ascent corridor. Your exact location can still be impossible.
              </Text>
            ) : null}
            {updatedLabel ? <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>Updated {updatedLabel}</Text> : null}
          </View>

          <View
            style={{
              gap: 8,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: theme.stroke,
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              paddingHorizontal: 14,
              paddingVertical: 14
            }}
          >
            <Text style={eyebrowStyle(theme)}>Visibility call</Text>
            <Text style={{ color: theme.foreground, fontSize: 17, fontWeight: '700', lineHeight: 22 }}>{visibilityCall.label}</Text>
            <Text style={bodyStyle(theme)}>{visibilityCall.detail}</Text>
          </View>

          {scenarioTimeline.length > 0 ? (
            <View
              style={{
                gap: 10,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: theme.stroke,
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                paddingHorizontal: 14,
                paddingVertical: 14
              }}
            >
              <Text style={eyebrowStyle(theme)}>Timing outlook</Text>
              {score.bestWindow ? (
                <Text style={bodyStyle(theme)}>
                  Best window: <Text style={{ color: theme.foreground, fontWeight: '700' }}>{score.bestWindow.label}</Text>. {score.bestWindow.reason}
                </Text>
              ) : null}
              <View style={{ gap: 8 }}>
                {scenarioTimeline.map((entry) => (
                  <View
                    key={entry.id}
                    style={{
                      gap: 8,
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: 'rgba(234, 240, 255, 0.1)',
                      backgroundColor: 'rgba(255, 255, 255, 0.025)',
                      paddingHorizontal: 12,
                      paddingVertical: 12
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{entry.label}</Text>
                      <Text style={{ color: theme.muted, fontSize: 13, fontWeight: '600' }}>{entry.score}/100</Text>
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {entry.current ? <TonePill label="Current" tone="info" theme={theme} /> : null}
                      <TonePill label={timelineTrendLabel(entry.delta, entry.trend)} tone={timelineTrendTone(entry.trend)} theme={theme} />
                      <TonePill label={visibilityCallLabel(entry.visibilityCall)} tone={entry.tone} theme={theme} />
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {hasGuidance ? (
            <View style={{ gap: 10 }}>
              <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>If conditions line up</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {score.bestWindow ? <MetricTile label="Best window" value={score.bestWindow.label} caption={score.bestWindow.reason} theme={theme} /> : null}
                {score.directionBand ? (
                  <MetricTile
                    label="Look toward"
                    value={score.directionBand.label}
                    caption={`${formatDegrees(score.directionBand.fromAzDeg)} to ${formatDegrees(score.directionBand.toAzDeg)}`}
                    theme={theme}
                  />
                ) : null}
                {score.elevationBand ? (
                  <MetricTile
                    label="Height"
                    value={score.elevationBand.label}
                    caption={`Usually needs about 5°+ above ${observerContext.horizonPhrase}.`}
                    theme={theme}
                  />
                ) : null}
                {score.solarWindowRange ? (
                  <MetricTile
                    label="NET sun angle"
                    value={formatSolarWindowRange(score.solarWindowRange)}
                    caption={formatSolarWindowRangeNote(score.solarWindowRange)}
                    theme={theme}
                  />
                ) : null}
              </View>
            </View>
          ) : null}
        </View>
      </Card>

      <Card theme={theme}>
        <View style={{ gap: 6 }}>
          <Text style={titleStyle(theme)}>Factor readout</Text>
          <Text style={bodyStyle(theme)}>Each factor shows what the model sees right now and the range or condition it wants.</Text>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {presentation.factorAssessments.map((item) => (
            <FactorCard key={item.key} item={item} theme={theme} />
          ))}
        </View>
      </Card>
      <CollapsibleCard title="Technical breakdown" defaultExpanded={false}>
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <MetricTile label="Sky clarity" value={formatFactor(score.factors.weather)} caption={buildWeatherCaption(score)} theme={theme} />
            <MetricTile label="Twilight timing" value={formatFactor(score.factors.darkness)} caption={formatSolarAngle(score.factors.solarDepressionDeg)} theme={theme} />
            <MetricTile label="Visible path" value={formatFactor(score.factors.lineOfSight)} caption={`${formatProbability(score.losVisibleFraction)} of useful path clears`} theme={theme} />
            <MetricTile label="Sunlit plume" value={formatFactor(score.factors.illumination)} caption={score.sunlitMarginKm != null ? `Margin ${formatKm(score.sunlitMarginKm)}` : 'Modeled ascent in sunlight'} theme={theme} />
            <MetricTile label="Total cloud" value={formatPct(score.factors.cloudCoverPct)} caption="All layers combined" theme={theme} />
            <MetricTile label="Low cloud" value={formatPct(score.factors.cloudCoverLowPct)} caption="Weighted most heavily" theme={theme} />
            <MetricTile label="Mid cloud" value={formatPct(score.factors.cloudCoverMidPct)} caption="Secondary weather drag" theme={theme} />
            <MetricTile label="High cloud" value={formatPct(score.factors.cloudCoverHighPct)} caption="Contrast drag more than hard block" theme={theme} />
          </View>
          <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
            Weather source: {formatWeatherSource(score.source.weather)}.
          </Text>
        </View>
      </CollapsibleCard>
    </View>
  );
}

function Card({ children, theme, accent = false }: { children: React.ReactNode; theme: MobileTheme; accent?: boolean }) {
  return (
    <View
      style={{
        gap: 14,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: accent ? 'rgba(34, 211, 238, 0.22)' : theme.stroke,
        backgroundColor: accent ? 'rgba(13, 34, 48, 0.78)' : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 18,
        paddingVertical: 18
      }}
    >
      {children}
    </View>
  );
}

function FactorCard({
  item,
  theme
}: {
  item: ReturnType<typeof buildJepPresentation>['factorAssessments'][number];
  theme: MobileTheme;
}) {
  return (
    <View
      style={{
        flexBasis: '47%',
        flexGrow: 1,
        minWidth: 0,
        gap: 10,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: 'rgba(234, 240, 255, 0.1)',
        backgroundColor: 'rgba(255, 255, 255, 0.025)',
        paddingHorizontal: 14,
        paddingVertical: 14
      }}
    >
      <View style={{ gap: 8 }}>
        <Text style={eyebrowStyle(theme)}>{item.label}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Text style={{ color: theme.foreground, fontSize: 22, fontWeight: '800' }}>{item.value}</Text>
          <TonePill label={item.status} tone={item.tone} theme={theme} />
        </View>
      </View>
      <Text style={bodyStyle(theme)}>{item.detail}</Text>
      {item.rangeNote ? <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>{item.rangeNote}</Text> : null}
    </View>
  );
}

function MetricTile({
  label,
  value,
  caption,
  theme
}: {
  label: string;
  value: string;
  caption?: string | null;
  theme: MobileTheme;
}) {
  return (
    <View
      style={{
        flexBasis: '47%',
        flexGrow: 1,
        minWidth: 0,
        gap: 6,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(234, 240, 255, 0.1)',
        backgroundColor: 'rgba(255, 255, 255, 0.025)',
        paddingHorizontal: 12,
        paddingVertical: 12
      }}
    >
      <Text style={eyebrowStyle(theme)}>{label}</Text>
      <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700', lineHeight: 18 }}>{value}</Text>
      {caption ? <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 17 }}>{caption}</Text> : null}
    </View>
  );
}

function TonePill({ label, tone, theme }: { label: string; tone: JepPresentationTone; theme: MobileTheme }) {
  const style = toneStyle(tone, theme);
  return (
    <View
      style={{
        borderRadius: 999,
        borderWidth: 1,
        borderColor: style.borderColor,
        backgroundColor: style.backgroundColor,
        paddingHorizontal: 10,
        paddingVertical: 6
      }}
    >
      <Text
        style={{
          color: style.color,
          fontSize: 10,
          fontWeight: '700',
          letterSpacing: 1,
          textTransform: 'uppercase'
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  theme,
  emphasis,
  disabled = false
}: {
  label: string;
  onPress: () => void;
  theme: MobileTheme;
  emphasis: 'primary' | 'secondary';
  disabled?: boolean;
}) {
  const primary = emphasis === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: 999,
        borderWidth: 1,
        borderColor: primary ? theme.accent : theme.stroke,
        backgroundColor: primary ? 'rgba(34, 211, 238, 0.16)' : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 14,
        paddingVertical: 10,
        opacity: disabled ? 0.6 : pressed ? 0.82 : 1
      })}
    >
      <Text
        style={{
          color: primary ? theme.accent : theme.foreground,
          fontSize: 13,
          fontWeight: '700'
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function toneStyle(tone: JepPresentationTone, theme: MobileTheme) {
  if (tone === 'success') {
    return {
      borderColor: 'rgba(52, 211, 153, 0.24)',
      backgroundColor: 'rgba(52, 211, 153, 0.12)',
      color: '#7ff0bc'
    };
  }
  if (tone === 'warning') {
    return {
      borderColor: 'rgba(251, 191, 36, 0.24)',
      backgroundColor: 'rgba(251, 191, 36, 0.12)',
      color: '#ffd36e'
    };
  }
  if (tone === 'danger') {
    return {
      borderColor: 'rgba(251, 113, 133, 0.26)',
      backgroundColor: 'rgba(251, 113, 133, 0.12)',
      color: '#ff9aab'
    };
  }
  if (tone === 'info') {
    return {
      borderColor: 'rgba(96, 165, 250, 0.24)',
      backgroundColor: 'rgba(96, 165, 250, 0.12)',
      color: '#9dc4ff'
    };
  }
  if (tone === 'primary') {
    return {
      borderColor: 'rgba(34, 211, 238, 0.24)',
      backgroundColor: 'rgba(34, 211, 238, 0.1)',
      color: theme.accent
    };
  }
  return {
    borderColor: 'rgba(234, 240, 255, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    color: theme.foreground
  };
}

function eyebrowStyle(theme: MobileTheme) {
  return {
    color: theme.muted,
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1.1,
    textTransform: 'uppercase' as const
  };
}

function titleStyle(theme: MobileTheme) {
  return {
    color: theme.foreground,
    fontSize: 18,
    fontWeight: '700' as const
  };
}

function bodyStyle(theme: MobileTheme) {
  return {
    color: theme.muted,
    fontSize: 14,
    lineHeight: 21
  };
}

function primaryInterpretation(
  isProbabilityMode: boolean,
  score: number,
  probability: number | null,
  usesFallbackPresentation = false
) {
  if (usesFallbackPresentation) {
    if (isProbabilityMode) {
      if ((probability ?? 0) >= 0.7) return 'Launch-area conditions look favorable, but this is not your personal visibility call.';
      if ((probability ?? 0) >= 0.3) return 'Launch-area conditions are mixed. Your exact location can still be impossible.';
      return 'Launch-area conditions look weak right now.';
    }

    if (score >= 70) return 'Launch-area conditions look favorable, but this is not your personal visibility call.';
    if (score >= 30) return 'Launch-area conditions are mixed. Your exact location can still be impossible.';
    return 'Launch-area conditions look weak right now.';
  }

  if (isProbabilityMode) {
    if ((probability ?? 0) >= 0.7) return 'Good setup for a visible jellyfish plume.';
    if ((probability ?? 0) >= 0.3) return 'You may see it, but conditions are mixed.';
    return 'A visible jellyfish plume is unlikely from this location.';
  }

  if (score >= 70) return 'Good setup for a visible jellyfish plume.';
  if (score >= 30) return 'You may see it, but conditions are mixed.';
  return 'A visible jellyfish plume is unlikely from this location.';
}

function confidenceLabelTone(value: ReturnType<typeof buildJepConfidenceLabel>): JepPresentationTone {
  if (value === 'high') return 'success';
  if (value === 'medium') return 'info';
  return 'warning';
}

function confidenceLabelLabel(value: ReturnType<typeof buildJepConfidenceLabel>) {
  if (value === 'high') return 'High confidence';
  if (value === 'medium') return 'Medium confidence';
  return 'Low confidence';
}

function timelineTrendTone(trend: 'better' | 'similar' | 'worse'): JepPresentationTone {
  if (trend === 'better') return 'success';
  if (trend === 'worse') return 'warning';
  return 'neutral';
}

function timelineTrendLabel(delta: number, trend: 'better' | 'similar' | 'worse') {
  if (trend === 'better' && delta > 0) return `+${delta}`;
  if (trend === 'worse' && delta < 0) return `${delta}`;
  if (trend === 'similar') return 'Flat';
  return delta > 0 ? `+${delta}` : `${delta}`;
}

function visibilityCallLabel(value: ReturnType<typeof buildJepScenarioTimeline>[number]['visibilityCall']) {
  if (value === 'not_expected') return 'Not expected';
  if (value === 'possible') return 'Possible';
  if (value === 'favorable') return 'Favorable';
  return 'Highly favorable';
}

function formatFallbackReason(reason: MobileJepFallbackReason) {
  if (reason === 'denied') return 'Location denied';
  if (reason === 'unsupported') return 'Location unavailable';
  if (reason === 'timeout') return 'Location timed out';
  if (reason === 'unavailable') return 'Location unavailable';
  if (reason === 'error') return 'Location failed';
  return null;
}

function viewpointPromptTitle(state: MobileJepViewpointPromptState) {
  if (state === 'resolving') return 'Checking your viewpoint';
  if (state === 'denied') return 'Location access was denied';
  if (state === 'unsupported') return 'Location is not available on this device';
  if (state === 'timeout') return 'Location lookup took too long';
  if (state === 'unavailable') return 'We could not resolve your location';
  if (state === 'error') return 'Location lookup failed';
  return 'Choose your viewpoint';
}

function viewpointPromptBody(state: MobileJepViewpointPromptState) {
  if (state === 'resolving') {
    return 'We are checking your current location so the JEP score reflects your actual viewing setup.';
  }
  if (state === 'denied') {
    return 'Without location access we can only show the launch-site reference. You can allow location and retry, or continue with the launch-site view.';
  }
  if (state === 'unsupported') {
    return 'This device cannot provide a usable location right now, so only the launch-site reference is available.';
  }
  if (state === 'timeout') {
    return 'We could not get a location fix quickly enough. You can retry or use the launch-site reference instead.';
  }
  if (state === 'unavailable') {
    return 'We did not get a usable personal JEP result from your current location, so the safe fallback is the launch-site reference.';
  }
  if (state === 'error') {
    return 'Something went wrong while checking your location. You can retry or use the launch-site reference instead.';
  }
  return 'Use your current location for a personal visibility answer, or switch to the launch-site reference view.';
}

function buildWeatherCaption(score: LaunchJepScoreV1 | undefined) {
  if (!score) return null;
  return `Low ${formatPct(score.factors.cloudCoverLowPct)} • Mid ${formatPct(score.factors.cloudCoverMidPct)} • High ${formatPct(score.factors.cloudCoverHighPct)}`;
}

function clampProbability(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function formatProbability(value: number | null) {
  const bounded = clampProbability(value);
  if (bounded == null) return '-';
  return `${Math.round(bounded * 100)}%`;
}

function formatFactor(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatPct(value: number | null) {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function formatKm(value: number | null) {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${(Math.round(value * 10) / 10).toFixed(1)} km`;
}

function formatDegrees(value: number | null) {
  if (value == null || !Number.isFinite(value)) return '-';
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toFixed(1)}°`;
}

function formatSolarAngle(value: number | null) {
  if (value == null || !Number.isFinite(value)) return '-';
  const rounded = Math.round(Math.abs(value) * 10) / 10;
  if (rounded < 0.05) return '0.0° on the horizon';
  return value >= 0 ? `${rounded.toFixed(1)}° below the horizon` : `${rounded.toFixed(1)}° above the horizon`;
}

function formatSolarWindowRange(
  range: LaunchJepScoreV1['solarWindowRange']
) {
  if (!range) return '-';
  if (range.windowStartDeg != null && range.windowEndDeg != null) {
    return `${formatSolarAngle(range.windowStartDeg)} to ${formatSolarAngle(range.windowEndDeg)}`;
  }
  if (range.netDeg != null) return formatSolarAngle(range.netDeg);
  if (range.minDeg != null && range.maxDeg != null) {
    return `${formatSolarAngle(range.minDeg)} to ${formatSolarAngle(range.maxDeg)}`;
  }
  return '-';
}

function formatSolarWindowRangeNote(
  range: LaunchJepScoreV1['solarWindowRange']
) {
  if (!range) return null;
  if (range.crossesTwilightSweetSpot) {
    return 'This NET window reaches the strongest twilight band at roughly 6° to 12° below the horizon.';
  }
  return 'Best contrast usually needs the Sun about 6° to 12° below the horizon.';
}

function formatDateTime(value: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(parsed));
}

function formatWeatherSource(source: string | null) {
  const normalized = (source || '').trim().toLowerCase();
  if (normalized === 'open_meteo') return 'Open-Meteo';
  if (normalized === 'nws') return 'NOAA NWS';
  if (normalized === 'mixed') return 'NOAA NWS + Open-Meteo';
  if (normalized === 'none') return 'None (geometry only)';
  return source || 'Unknown';
}

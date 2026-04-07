import React from 'react';
import { Text, View } from 'react-native';
import { formatMissionTimelineTimeLabel } from '@tminuszero/domain';
import type { MobileTheme } from '@tminuszero/design-tokens';

type MissionTimelinePhase = string | null | undefined;

export type MissionTimelineCardItem = {
  id: string;
  label: string;
  time?: string | null;
  description?: string | null;
  phase?: MissionTimelinePhase;
  sourceTitle?: string | null;
};

export function MissionTimelineCards({
  items,
  theme
}: {
  items: MissionTimelineCardItem[];
  theme: MobileTheme;
}) {
  return (
    <View style={{ gap: 12 }}>
      {items.map((item) => {
        const timeLabel = formatMissionTimelineTimeLabel(item.time, normalizePhase(item.phase));
        const tone = getPhaseTone(item.phase, theme);

        return (
          <View
            key={item.id}
            style={{
              overflow: 'hidden',
              borderRadius: 18,
              borderWidth: 1,
              borderColor: tone.borderColor,
              backgroundColor: tone.cardBackground,
              padding: 16
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <View
                style={{
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: tone.badgeBorderColor,
                  backgroundColor: tone.badgeBackground,
                  paddingHorizontal: 10,
                  paddingVertical: 6
                }}
              >
                <Text
                  style={{
                    color: tone.badgeTextColor,
                    fontSize: 11,
                    fontWeight: '700',
                    letterSpacing: 0.8,
                    textTransform: 'uppercase'
                  }}
                >
                  {formatTimelinePhaseLabel(item.phase)}
                </Text>
              </View>
              {timeLabel ? (
                <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '600', flexShrink: 1, textAlign: 'right' }}>
                  {timeLabel}
                </Text>
              ) : null}
            </View>

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
              <View style={{ width: 4, borderRadius: 999, backgroundColor: tone.railColor }} />
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{item.label}</Text>
                {item.sourceTitle ? <Text style={{ color: theme.muted, fontSize: 12 }}>{item.sourceTitle}</Text> : null}
                {item.description ? (
                  <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>{item.description}</Text>
                ) : null}
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function getPhaseTone(phase: MissionTimelinePhase, theme: MobileTheme) {
  if (phase === 'prelaunch') {
    return {
      borderColor: 'rgba(34, 211, 238, 0.22)',
      cardBackground: 'rgba(34, 211, 238, 0.08)',
      badgeBorderColor: 'rgba(34, 211, 238, 0.28)',
      badgeBackground: 'rgba(34, 211, 238, 0.12)',
      badgeTextColor: theme.accent,
      railColor: theme.accent
    };
  }

  if (phase === 'postlaunch') {
    return {
      borderColor: 'rgba(251, 191, 36, 0.22)',
      cardBackground: 'rgba(251, 191, 36, 0.08)',
      badgeBorderColor: 'rgba(251, 191, 36, 0.28)',
      badgeBackground: 'rgba(251, 191, 36, 0.12)',
      badgeTextColor: '#fbbf24',
      railColor: '#fbbf24'
    };
  }

  return {
    borderColor: theme.stroke,
    cardBackground: 'rgba(255, 255, 255, 0.03)',
    badgeBorderColor: theme.stroke,
    badgeBackground: 'rgba(255, 255, 255, 0.05)',
    badgeTextColor: theme.muted,
    railColor: 'rgba(255, 255, 255, 0.18)'
  };
}

function formatTimelinePhaseLabel(phase: MissionTimelinePhase) {
  if (phase === 'prelaunch') return 'Pre-launch';
  if (phase === 'postlaunch') return 'Post-launch';
  return 'Timeline';
}

function normalizePhase(phase: MissionTimelinePhase) {
  if (phase === 'prelaunch' || phase === 'postlaunch' || phase === 'timeline') return phase;
  return undefined;
}

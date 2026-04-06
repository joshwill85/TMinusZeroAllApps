import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { MobileTheme } from '@tminuszero/design-tokens';
import type { VehicleTabData } from '@tminuszero/launch-detail-ui';

type VehicleTabProps = {
  data: VehicleTabData;
  theme: MobileTheme;
};

export function VehicleTab({ data, theme }: VehicleTabProps) {
  const hasContent =
    data.vehicleConfig.family ||
    data.vehicleConfig.manufacturer ||
    data.stages.length > 0 ||
    data.recovery ||
    Boolean(data.missionStats?.cards.length || data.missionStats?.bonusInsights.length || data.missionStats?.boosterCards.length);

  if (!hasContent) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: theme.foreground, marginBottom: 8 }}>
          No vehicle details
        </Text>
        <Text style={{ fontSize: 14, color: theme.muted, textAlign: 'center', paddingHorizontal: 40 }}>
          Vehicle configuration, stage context, and mission stats are not yet available for this launch.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 24 }}>
      {(data.vehicleConfig.family || data.vehicleConfig.manufacturer) && (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>Vehicle profile</SectionTitle>
          {data.vehicleConfig.family ? (
            <View style={{ gap: 4 }}>
              <Text style={{ color: theme.foreground, fontSize: 22, fontWeight: '800' }}>{data.vehicleConfig.family}</Text>
              {data.vehicleConfig.variant ? <Text style={{ color: theme.accent, fontSize: 15, fontWeight: '700' }}>{data.vehicleConfig.variant}</Text> : null}
            </View>
          ) : null}
          {data.vehicleConfig.manufacturer ? (
            <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 20 }}>Built by {data.vehicleConfig.manufacturer}</Text>
          ) : null}
          <View style={{ gap: 10 }}>
            {data.vehicleConfig.specs.length != null ? <MetricRow label="Length" value={`${data.vehicleConfig.specs.length} m`} theme={theme} /> : null}
            {data.vehicleConfig.specs.diameter != null ? <MetricRow label="Diameter" value={`${data.vehicleConfig.specs.diameter} m`} theme={theme} /> : null}
            {data.vehicleConfig.specs.leoCapacity != null ? <MetricRow label="LEO capacity" value={`${data.vehicleConfig.specs.leoCapacity} kg`} theme={theme} /> : null}
            {data.vehicleConfig.specs.gtoCapacity != null ? <MetricRow label="GTO capacity" value={`${data.vehicleConfig.specs.gtoCapacity} kg`} theme={theme} /> : null}
          </View>
        </SectionCard>
      )}

      {(data.stages.length > 0 || data.recovery) ? (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>Stages & recovery</SectionTitle>
          {data.stages.length > 0 ? (
            <View style={{ gap: 12 }}>
              {data.stages.map((stage, index) => (
                <View
                  key={`${stage.name}:${stage.serialNumber ?? index}`}
                  style={{
                    gap: 10,
                    borderRadius: 18,
                    borderWidth: 1,
                    borderColor: theme.stroke,
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    padding: 16
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '700' }}>{stage.name || `Stage ${index + 1}`}</Text>
                      {stage.serialNumber ? <Text style={{ color: theme.muted, fontSize: 13 }}>{stage.serialNumber}</Text> : null}
                    </View>
                    {stage.reused ? <Badge label="Reused" theme={theme} accent /> : <Badge label="New core" theme={theme} />}
                  </View>
                  <View style={{ gap: 8 }}>
                    <MetricRow label="Previous flights" value={String(stage.previousFlights)} theme={theme} />
                    {stage.engine ? <MetricRow label="Engine" value={stage.engine} theme={theme} /> : null}
                    {stage.fuel ? <MetricRow label="Fuel" value={stage.fuel} theme={theme} /> : null}
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {data.recovery ? (
            <View style={{ gap: 12, marginTop: data.stages.length > 0 ? 6 : 0 }}>
              {data.recovery.booster ? (
                <RecoveryCard
                  title="Booster recovery"
                  summary={data.recovery.booster.type || 'Recovery status pending'}
                  detail={data.recovery.booster.location}
                  theme={theme}
                  accent
                />
              ) : null}
              {data.recovery.fairing ? (
                <RecoveryCard
                  title="Fairing recovery"
                  summary={data.recovery.fairing.recovery ? 'Recovery attempted' : 'Expended'}
                  detail={data.recovery.fairing.recovery ? 'Fairing recovery activity is expected for this mission.' : 'No fairing recovery attempt is listed.'}
                  theme={theme}
                />
              ) : null}
            </View>
          ) : null}
        </SectionCard>
      ) : null}

      {data.missionStats ? (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>Mission stats</SectionTitle>
          {data.missionStats.cards.length ? (
            <View style={{ gap: 12 }}>
              {data.missionStats.cards.map((card, index) => (
                <StoryCard key={card.id} card={card} theme={theme} accentIndex={index} />
              ))}
            </View>
          ) : null}

          {data.missionStats.bonusInsights.length ? (
            <View style={{ gap: 10, marginTop: data.missionStats.cards.length ? 6 : 0 }}>
              {data.missionStats.bonusInsights.map((insight) => (
                <View
                  key={insight.label}
                  style={{
                    gap: 6,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: theme.stroke,
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    padding: 14
                  }}
                >
                  <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>
                    {insight.label}
                  </Text>
                  <Text style={{ color: theme.foreground, fontSize: 18, fontWeight: '800' }}>{insight.value}</Text>
                  {insight.detail ? <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>{insight.detail}</Text> : null}
                </View>
              ))}
            </View>
          ) : null}

          {data.missionStats.boosterCards.length ? (
            <View style={{ gap: 12, marginTop: data.missionStats.cards.length || data.missionStats.bonusInsights.length ? 6 : 0 }}>
              {data.missionStats.boosterCards.map((card) => (
                <View
                  key={card.id}
                  style={{
                    gap: 8,
                    borderRadius: 18,
                    borderWidth: 1,
                    borderColor: theme.stroke,
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    padding: 16
                  }}
                >
                  <View style={{ gap: 4 }}>
                    <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '700' }}>{card.title}</Text>
                    {card.subtitle ? <Text style={{ color: theme.muted, fontSize: 13 }}>{card.subtitle}</Text> : null}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    <StatPill label={card.allTimeLabel} value={card.allTime == null ? 'TBD' : String(card.allTime)} theme={theme} />
                    <StatPill label={card.yearLabel} value={card.year == null ? 'TBD' : String(card.year)} theme={theme} />
                  </View>
                  {card.detailLines.map((line) => (
                    <Text key={`${card.id}:${line}`} style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
                      {line}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          ) : null}
        </SectionCard>
      ) : null}
    </ScrollView>
  );
}

function SectionCard({ children, theme }: { children: React.ReactNode; theme: MobileTheme }) {
  return (
    <View
      style={{
        padding: 20,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
        gap: 14
      }}
    >
      {children}
    </View>
  );
}

function SectionTitle({ children, theme }: { children: React.ReactNode; theme: MobileTheme }) {
  return (
    <Text
      style={{
        fontSize: 16,
        fontWeight: '700',
        color: theme.foreground,
        textTransform: 'uppercase',
        letterSpacing: 0.5
      }}
    >
      {children}
    </Text>
  );
}

function MetricRow({ label, value, theme }: { label: string; value: string; theme: MobileTheme }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text style={{ color: theme.muted, fontSize: 13, flex: 1 }}>{label}</Text>
      <Text style={{ color: theme.foreground, fontSize: 13, fontWeight: '700', flexShrink: 1, textAlign: 'right' }}>{value}</Text>
    </View>
  );
}

function Badge({
  label,
  theme,
  accent = false
}: {
  label: string;
  theme: MobileTheme;
  accent?: boolean;
}) {
  return (
    <View
      style={{
        borderRadius: 999,
        borderWidth: 1,
        borderColor: accent ? 'rgba(34, 211, 238, 0.28)' : theme.stroke,
        backgroundColor: accent ? 'rgba(34, 211, 238, 0.1)' : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 10,
        paddingVertical: 6
      }}
    >
      <Text
        style={{
          color: accent ? theme.accent : theme.foreground,
          fontSize: 10,
          fontWeight: '700',
          letterSpacing: 0.8,
          textTransform: 'uppercase'
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function RecoveryCard({
  title,
  summary,
  detail,
  theme,
  accent = false
}: {
  title: string;
  summary: string;
  detail: string | null;
  theme: MobileTheme;
  accent?: boolean;
}) {
  return (
    <View
      style={{
        gap: 6,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: accent ? 'rgba(34, 211, 238, 0.28)' : theme.stroke,
        backgroundColor: accent ? 'rgba(34, 211, 238, 0.08)' : 'rgba(255, 255, 255, 0.03)',
        padding: 16
      }}
    >
      <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>{title}</Text>
      <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '700' }}>{summary}</Text>
      {detail ? <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>{detail}</Text> : null}
    </View>
  );
}

function StoryCard({
  card,
  theme,
  accentIndex
}: {
  card: NonNullable<VehicleTabData['missionStats']>['cards'][number];
  theme: MobileTheme;
  accentIndex: number;
}) {
  const accentPalette = [
    'rgba(34, 211, 238, 0.08)',
    'rgba(52, 211, 153, 0.08)',
    'rgba(251, 146, 60, 0.08)'
  ];
  const borderPalette = [
    'rgba(34, 211, 238, 0.22)',
    'rgba(52, 211, 153, 0.22)',
    'rgba(251, 146, 60, 0.22)'
  ];

  return (
    <View
      style={{
        gap: 10,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: borderPalette[accentIndex % borderPalette.length],
        backgroundColor: accentPalette[accentIndex % accentPalette.length],
        padding: 16
      }}
    >
      <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>{card.eyebrow}</Text>
      <Text style={{ color: theme.foreground, fontSize: 18, fontWeight: '800' }}>{card.title}</Text>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <StatPill label={card.allTimeLabel} value={card.allTime == null ? 'TBD' : String(card.allTime)} theme={theme} />
        <StatPill label={card.yearLabel} value={card.year == null ? 'TBD' : String(card.year)} theme={theme} />
      </View>
      <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>{card.story}</Text>
    </View>
  );
}

function StatPill({ label, value, theme }: { label: string; value: string; theme: MobileTheme }) {
  return (
    <View
      style={{
        flex: 1,
        gap: 4,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(255, 255, 255, 0.04)',
        padding: 12
      }}
    >
      <Text style={{ color: theme.muted, fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' }}>{label}</Text>
      <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '800' }}>{value}</Text>
    </View>
  );
}

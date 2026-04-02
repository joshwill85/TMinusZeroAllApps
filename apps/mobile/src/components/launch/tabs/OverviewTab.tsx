import React from 'react';
import { View, Text, Image, ScrollView } from 'react-native';
import type { MobileTheme } from '@tminuszero/design-tokens';
import type { OverviewTabData } from '@tminuszero/launch-detail-ui';

type OverviewTabProps = {
  data: OverviewTabData;
  theme: MobileTheme;
};

export function OverviewTab({ data, theme }: OverviewTabProps) {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 24 }}>
      {/* Mission Brief */}
      {(data.missionBrief.name || data.missionBrief.description) && (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>Mission Brief</SectionTitle>
          {data.missionBrief.name && (
            <Text style={{ fontSize: 18, fontWeight: '700', color: theme.foreground, marginBottom: 8 }}>
              {data.missionBrief.name}
            </Text>
          )}
          {data.missionBrief.description && (
            <Text style={{ fontSize: 14, color: theme.muted, lineHeight: 20 }}>
              {data.missionBrief.description}
            </Text>
          )}
        </SectionCard>
      )}

      {/* Quick Stats Grid */}
      {data.quickStats.length > 0 && (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>Quick Facts</SectionTitle>
          <View style={{ gap: 4 }}>
            {data.quickStats.map((stat, idx) => (
              <View
                key={idx}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingVertical: 12,
                  borderBottomWidth: idx < data.quickStats.length - 1 ? 1 : 0,
                  borderBottomColor: 'rgba(255, 255, 255, 0.05)',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {stat.icon && <Text style={{ fontSize: 16 }}>{stat.icon}</Text>}
                  <Text style={{ fontSize: 14, color: theme.muted, fontWeight: '500' }}>
                    {stat.label}
                  </Text>
                </View>
                <Text style={{ fontSize: 14, fontWeight: '700', color: theme.foreground }}>
                  {stat.value}
                </Text>
              </View>
            ))}
          </View>
        </SectionCard>
      )}

      {/* Rocket Profile */}
      {data.rocketProfile.name && (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>Vehicle Profile</SectionTitle>

          {/* Rocket Image */}
          {data.rocketProfile.image && (
            <View
              style={{
                width: '100%',
                height: 200,
                borderRadius: 12,
                overflow: 'hidden',
                marginBottom: 16,
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
              }}
            >
              <Image
                source={{ uri: data.rocketProfile.image }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
              />
            </View>
          )}

          {/* Vehicle Name */}
          <Text style={{ fontSize: 18, fontWeight: '700', color: theme.foreground, marginBottom: 4 }}>
            {data.rocketProfile.name}
          </Text>

          {/* Manufacturer */}
          {data.rocketProfile.manufacturer && (
            <Text style={{ fontSize: 14, color: theme.accent, marginBottom: 16 }}>
              {data.rocketProfile.manufacturer}
            </Text>
          )}

          {/* Specs Grid */}
          <View style={{ gap: 8 }}>
            {data.rocketProfile.variant && (
              <SpecRow
                label="Variant"
                value={data.rocketProfile.variant}
                theme={theme}
              />
            )}
            {data.rocketProfile.specs.reusable !== null && (
              <SpecRow
                label="Reusable"
                value={data.rocketProfile.specs.reusable ? 'Yes' : 'No'}
                theme={theme}
              />
            )}
            {data.rocketProfile.specs.length && (
              <SpecRow
                label="Length"
                value={`${data.rocketProfile.specs.length}m`}
                theme={theme}
              />
            )}
            {data.rocketProfile.specs.diameter && (
              <SpecRow
                label="Diameter"
                value={`${data.rocketProfile.specs.diameter}m`}
                theme={theme}
              />
            )}
            {data.rocketProfile.specs.maidenFlight && (
              <SpecRow
                label="Maiden Flight"
                value={data.rocketProfile.specs.maidenFlight}
                theme={theme}
              />
            )}
          </View>
        </SectionCard>
      )}

      {/* Launch Info */}
      <SectionCard theme={theme}>
        <SectionTitle theme={theme}>Launch Information</SectionTitle>
        <View style={{ gap: 8 }}>
          {data.launchInfo.provider && (
            <InfoRow label="Provider" value={data.launchInfo.provider} theme={theme} />
          )}
          {data.launchInfo.vehicle && (
            <InfoRow label="Vehicle" value={data.launchInfo.vehicle} theme={theme} />
          )}
          {data.launchInfo.pad && (
            <InfoRow label="Pad" value={data.launchInfo.pad} theme={theme} />
          )}
          {data.launchInfo.location && (
            <InfoRow label="Location" value={data.launchInfo.location} theme={theme} />
          )}
          {data.launchInfo.windowStart && (
            <InfoRow label="Window Start" value={data.launchInfo.windowStart} theme={theme} />
          )}
          {data.launchInfo.windowEnd && (
            <InfoRow label="Window End" value={data.launchInfo.windowEnd} theme={theme} />
          )}
          {data.launchInfo.orbit && (
            <InfoRow label="Target Orbit" value={data.launchInfo.orbit} theme={theme} />
          )}
        </View>

        {/* Programs */}
        {data.launchInfo.programs.length > 0 && (
          <View style={{ marginTop: 16, gap: 8 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: theme.muted }}>
              Programs
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {data.launchInfo.programs.map((program) => (
                <View
                  key={program.id}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 999,
                    backgroundColor: 'rgba(34, 211, 238, 0.1)',
                    borderWidth: 1,
                    borderColor: 'rgba(34, 211, 238, 0.3)',
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '600', color: theme.accent }}>
                    {program.name}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </SectionCard>

      {/* Weather Summary */}
      {data.weather.summary && (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>Weather</SectionTitle>
          <Text style={{ fontSize: 14, color: theme.muted, lineHeight: 20 }}>
            {data.weather.summary}
          </Text>
          {data.weather.concerns.length > 0 && (
            <View style={{ marginTop: 12, gap: 8 }}>
              {data.weather.concerns.map((concern, idx) => (
                <View
                  key={idx}
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    backgroundColor: 'rgba(251, 191, 36, 0.1)',
                    borderLeftWidth: 3,
                    borderLeftColor: '#fcd34d',
                  }}
                >
                  <Text style={{ fontSize: 13, color: '#fcd34d', fontWeight: '600' }}>
                    ⚠️ {concern}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </SectionCard>
      )}
    </ScrollView>
  );
}

// Helper Components

function SectionCard({ children, theme }: { children: React.ReactNode; theme: MobileTheme }) {
  return (
    <View
      style={{
        padding: 20,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
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
        marginBottom: 16,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}
    >
      {children}
    </Text>
  );
}

function SpecRow({ label, value, theme }: { label: string; value: string; theme: MobileTheme }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 8,
      }}
    >
      <Text style={{ fontSize: 13, color: theme.muted }}>{label}</Text>
      <Text style={{ fontSize: 13, fontWeight: '600', color: theme.foreground }}>{value}</Text>
    </View>
  );
}

function InfoRow({ label, value, theme }: { label: string; value: string; theme: MobileTheme }) {
  return (
    <View
      style={{
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255, 255, 255, 0.05)',
      }}
    >
      <Text style={{ fontSize: 12, color: theme.muted, marginBottom: 4 }}>{label}</Text>
      <Text style={{ fontSize: 14, fontWeight: '600', color: theme.foreground }}>{value}</Text>
    </View>
  );
}

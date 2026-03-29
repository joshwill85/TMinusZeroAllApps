import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import type { VehicleTabData } from '@tminuszero/launch-detail-ui';

type VehicleTabProps = {
  data: VehicleTabData;
  theme: any;
};

export function VehicleTab({ data, theme }: VehicleTabProps) {
  const hasContent =
    data.vehicleConfig.family ||
    data.stages.length > 0 ||
    data.recovery ||
    data.missionStats;

  if (!hasContent) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60 }}>
        <Text style={{ fontSize: 48, marginBottom: 16 }}>🚀</Text>
        <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text, marginBottom: 8 }}>
          No Vehicle Details
        </Text>
        <Text style={{ fontSize: 14, color: theme.muted, textAlign: 'center', paddingHorizontal: 40 }}>
          Vehicle information not yet available
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 24 }}>
      {/* Vehicle Configuration */}
      {(data.vehicleConfig.family || data.vehicleConfig.manufacturer) && (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>Configuration</SectionTitle>

          {data.vehicleConfig.family && (
            <View style={{ marginBottom: 16 }}>
              <Text style={{ fontSize: 20, fontWeight: '700', color: theme.text }}>
                {data.vehicleConfig.family}
              </Text>
              {data.vehicleConfig.variant && (
                <Text style={{ fontSize: 16, color: theme.accent, marginTop: 4 }}>
                  {data.vehicleConfig.variant}
                </Text>
              )}
            </View>
          )}

          {data.vehicleConfig.manufacturer && (
            <View style={{ paddingVertical: 12, borderTopWidth: 1, borderTopColor: 'rgba(255, 255, 255, 0.05)' }}>
              <Text style={{ fontSize: 12, color: theme.muted, marginBottom: 4 }}>
                Manufacturer
              </Text>
              <Text style={{ fontSize: 14, fontWeight: '600', color: theme.text }}>
                {data.vehicleConfig.manufacturer}
              </Text>
            </View>
          )}

          {/* Additional Specs */}
          {Object.keys(data.vehicleConfig.specs).length > 0 && (
            <View style={{ gap: 8, marginTop: 12 }}>
              {data.vehicleConfig.specs.length && (
                <SpecRow label="Length" value={`${data.vehicleConfig.specs.length}m`} theme={theme} />
              )}
              {data.vehicleConfig.specs.diameter && (
                <SpecRow label="Diameter" value={`${data.vehicleConfig.specs.diameter}m`} theme={theme} />
              )}
              {data.vehicleConfig.specs.leoCapacity && (
                <SpecRow label="LEO Capacity" value={`${data.vehicleConfig.specs.leoCapacity} kg`} theme={theme} />
              )}
              {data.vehicleConfig.specs.gtoCapacity && (
                <SpecRow label="GTO Capacity" value={`${data.vehicleConfig.specs.gtoCapacity} kg`} theme={theme} />
              )}
            </View>
          )}
        </SectionCard>
      )}

      {/* Stages */}
      {data.stages.length > 0 && (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>
            Stages ({data.stages.length})
          </SectionTitle>
          <View style={{ gap: 16 }}>
            {data.stages.map((stage, idx) => (
              <View
                key={idx}
                style={{
                  padding: 16,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: theme.stroke,
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      backgroundColor: theme.accent + '20',
                      justifyContent: 'center',
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 16, fontWeight: '800', color: theme.accent }}>
                      {idx + 1}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: theme.text }}>
                    {stage.name || `Stage ${idx + 1}`}
                  </Text>
                </View>

                {stage.serialNumber && (
                  <View style={{ marginBottom: 8 }}>
                    <Text style={{ fontSize: 12, color: theme.muted }}>
                      Serial: <Text style={{ fontWeight: '600', color: theme.text }}>{stage.serialNumber}</Text>
                    </Text>
                  </View>
                )}

                {stage.reused && (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      paddingVertical: 6,
                      paddingHorizontal: 10,
                      borderRadius: 999,
                      backgroundColor: 'rgba(52, 211, 153, 0.1)',
                      alignSelf: 'flex-start',
                      marginBottom: 8,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#7ff0bc' }}>
                      ♻️ Reused
                    </Text>
                  </View>
                )}

                <View style={{ gap: 6 }}>
                  {stage.previousFlights > 0 && (
                    <StageDetail label="Previous Flights" value={stage.previousFlights.toString()} theme={theme} />
                  )}
                  {stage.engine && (
                    <StageDetail label="Engine" value={stage.engine} theme={theme} />
                  )}
                  {stage.fuel && (
                    <StageDetail label="Fuel" value={stage.fuel} theme={theme} />
                  )}
                </View>
              </View>
            ))}
          </View>
        </SectionCard>
      )}

      {/* Recovery */}
      {data.recovery && (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>Recovery</SectionTitle>

          {data.recovery.booster && (
            <View style={{ marginBottom: 16 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: theme.text, marginBottom: 8 }}>
                Booster
              </Text>
              <View
                style={{
                  padding: 14,
                  borderRadius: 10,
                  backgroundColor: getRecoveryColor(data.recovery.booster.type).bg,
                  borderWidth: 1,
                  borderColor: getRecoveryColor(data.recovery.booster.type).border,
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: theme.text }}>
                  {data.recovery.booster.type || 'Unknown'}
                </Text>
                {data.recovery.booster.location && (
                  <Text style={{ fontSize: 12, color: theme.muted, marginTop: 4 }}>
                    📍 {data.recovery.booster.location}
                  </Text>
                )}
              </View>
            </View>
          )}

          {data.recovery.fairing && (
            <View>
              <Text style={{ fontSize: 14, fontWeight: '600', color: theme.text, marginBottom: 8 }}>
                Fairing
              </Text>
              <View
                style={{
                  padding: 14,
                  borderRadius: 10,
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  borderWidth: 1,
                  borderColor: theme.stroke,
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: theme.text }}>
                  {data.recovery.fairing.recovery ? 'Recovery Attempted' : 'Expended'}
                </Text>
              </View>
            </View>
          )}
        </SectionCard>
      )}

      {/* Booster History */}
      {data.boosterHistory.length > 0 && (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>
            Booster History ({data.boosterHistory.length} flights)
          </SectionTitle>
          <View style={{ gap: 8 }}>
            {data.boosterHistory.map((flight, idx) => (
              <View
                key={idx}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  padding: 12,
                  borderRadius: 8,
                  backgroundColor: 'rgba(255, 255, 255, 0.02)',
                }}
              >
                <Text style={{ fontSize: 13, color: theme.text }}>
                  Flight {idx + 1}
                </Text>
                <Text style={{ fontSize: 12, color: theme.muted }}>
                  {flight.date}
                </Text>
              </View>
            ))}
          </View>
        </SectionCard>
      )}

      {/* Mission Statistics */}
      {data.missionStats && (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>Statistics</SectionTitle>

          <View style={{ gap: 16 }}>
            {data.missionStats.vehicleFlightCount && (
              <StatCard
                label="Vehicle Flights"
                value={data.missionStats.vehicleFlightCount.toString()}
                theme={theme}
              />
            )}
            {data.missionStats.providerFlightCount && (
              <StatCard
                label="Provider Launches"
                value={data.missionStats.providerFlightCount.toString()}
                theme={theme}
              />
            )}
            {data.missionStats.successRate && (
              <StatCard
                label="Success Rate"
                value={`${Math.round(data.missionStats.successRate * 100)}%`}
                theme={theme}
              />
            )}
          </View>
        </SectionCard>
      )}
    </ScrollView>
  );
}

// Helper Components

function SectionCard({ children, theme }: { children: React.ReactNode; theme: any }) {
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

function SectionTitle({ children, theme }: { children: React.ReactNode; theme: any }) {
  return (
    <Text
      style={{
        fontSize: 16,
        fontWeight: '700',
        color: theme.text,
        marginBottom: 16,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}
    >
      {children}
    </Text>
  );
}

function SpecRow({ label, value, theme }: { label: string; value: string; theme: any }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255, 255, 255, 0.05)',
      }}
    >
      <Text style={{ fontSize: 13, color: theme.muted }}>{label}</Text>
      <Text style={{ fontSize: 13, fontWeight: '600', color: theme.text }}>{value}</Text>
    </View>
  );
}

function StageDetail({ label, value, theme }: { label: string; value: string; theme: any }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Text style={{ fontSize: 12, color: theme.muted, minWidth: 110 }}>
        {label}:
      </Text>
      <Text style={{ fontSize: 12, color: theme.text, fontWeight: '600', flex: 1 }}>
        {value}
      </Text>
    </View>
  );
}

function StatCard({ label, value, theme }: { label: string; value: string; theme: any }) {
  return (
    <View style={{ alignItems: 'center', padding: 16, backgroundColor: 'rgba(255, 255, 255, 0.03)', borderRadius: 12 }}>
      <Text style={{ fontSize: 28, fontWeight: '800', color: theme.accent }}>
        {value}
      </Text>
      <Text style={{ fontSize: 12, color: theme.muted, marginTop: 4 }}>
        {label}
      </Text>
    </View>
  );
}

function getRecoveryColor(type: string | undefined) {
  switch (type?.toLowerCase()) {
    case 'rtls':
    case 'asds':
      return {
        bg: 'rgba(52, 211, 153, 0.1)',
        border: 'rgba(52, 211, 153, 0.3)',
      };
    case 'expended':
      return {
        bg: 'rgba(251, 113, 133, 0.1)',
        border: 'rgba(251, 113, 133, 0.3)',
      };
    default:
      return {
        bg: 'rgba(255, 255, 255, 0.03)',
        border: 'rgba(255, 255, 255, 0.1)',
      };
  }
}

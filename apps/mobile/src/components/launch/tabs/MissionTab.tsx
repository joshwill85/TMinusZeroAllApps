import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import type { MobileTheme } from '@tminuszero/design-tokens';
import type { MissionTabData } from '@tminuszero/launch-detail-ui';

type MissionTabProps = {
  data: MissionTabData;
  theme: MobileTheme;
};

export function MissionTab({ data, theme }: MissionTabProps) {
  const hasContent =
    data.missionOverview.description ||
    data.payloadManifest.length > 0 ||
    data.crew.length > 0 ||
    data.programs.length > 0 ||
    data.blueOriginDetails;

  if (!hasContent) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60 }}>
        <Text style={{ fontSize: 48, marginBottom: 16 }}>🛰️</Text>
        <Text style={{ fontSize: 16, fontWeight: '600', color: theme.foreground, marginBottom: 8 }}>
          No Mission Details
        </Text>
        <Text style={{ fontSize: 14, color: theme.muted, textAlign: 'center', paddingHorizontal: 40 }}>
          Mission information not yet available
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 24 }}>
      {/* Mission Overview */}
      {(data.missionOverview.description || data.missionOverview.customer) && (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>Mission Overview</SectionTitle>

          {data.missionOverview.customer && (
            <View style={{ marginBottom: 12 }}>
              <Text style={{ fontSize: 12, color: theme.muted, marginBottom: 4 }}>
                Customer
              </Text>
              <Text style={{ fontSize: 16, fontWeight: '700', color: theme.accent }}>
                {data.missionOverview.customer}
              </Text>
            </View>
          )}

          {data.missionOverview.description && (
            <Text style={{ fontSize: 14, color: theme.muted, lineHeight: 20 }}>
              {data.missionOverview.description}
            </Text>
          )}
        </SectionCard>
      )}

      {/* Payload Manifest */}
      {data.payloadManifest.length > 0 && (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>
            Payload Manifest ({data.payloadManifest.length})
          </SectionTitle>
          <View style={{ gap: 12 }}>
            {data.payloadManifest.map((payload, idx) => (
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
                <Text style={{ fontSize: 15, fontWeight: '700', color: theme.foreground, marginBottom: 8 }}>
                  {payload.name || `Payload ${idx + 1}`}
                </Text>

                <View style={{ gap: 6 }}>
                  {payload.type && (
                    <PayloadDetail label="Type" value={payload.type} theme={theme} />
                  )}
                  {payload.mass && (
                    <PayloadDetail label="Mass" value={`${payload.mass} kg`} theme={theme} />
                  )}
                  {payload.orbit && (
                    <PayloadDetail label="Orbit" value={payload.orbit} theme={theme} />
                  )}
                  {payload.operator && (
                    <PayloadDetail label="Operator" value={payload.operator} theme={theme} />
                  )}
                </View>

                {payload.description && (
                  <Text style={{ fontSize: 13, color: theme.muted, marginTop: 8, lineHeight: 18 }}>
                    {payload.description}
                  </Text>
                )}
              </View>
            ))}
          </View>
        </SectionCard>
      )}

      {/* Object Inventory */}
      {data.objectInventory && (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>Satellite Tracking</SectionTitle>

          <View style={{ gap: 12 }}>
            {data.objectInventory.manifestedCount > 0 && (
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  paddingVertical: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: 'rgba(255, 255, 255, 0.05)',
                }}
              >
                <Text style={{ fontSize: 14, color: theme.muted }}>
                  Manifested Objects
                </Text>
                <Text style={{ fontSize: 14, fontWeight: '700', color: theme.accent }}>
                  {data.objectInventory.manifestedCount}
                </Text>
              </View>
            )}

            {data.objectInventory.trackedCount > 0 && (
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  paddingVertical: 12,
                }}
              >
                <Text style={{ fontSize: 14, color: theme.muted }}>
                  Tracked Objects
                </Text>
                <Text style={{ fontSize: 14, fontWeight: '700', color: theme.foreground }}>
                  {data.objectInventory.trackedCount}
                </Text>
              </View>
            )}
          </View>
        </SectionCard>
      )}

      {/* Crew Roster */}
      {data.crew.length > 0 && (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>
            Crew ({data.crew.length})
          </SectionTitle>
          <View style={{ gap: 16 }}>
            {data.crew.map((member, idx) => (
              <View
                key={idx}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 16,
                  padding: 16,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: theme.stroke,
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                }}
              >
                {/* Avatar Placeholder */}
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    backgroundColor: theme.accent + '20',
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ fontSize: 24 }}>👨‍🚀</Text>
                </View>

                {/* Crew Info */}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: theme.foreground }}>
                    {member.name}
                  </Text>
                  <Text style={{ fontSize: 13, color: theme.accent, marginTop: 2 }}>
                    {member.role}
                  </Text>
                  {member.nationality && (
                    <Text style={{ fontSize: 12, color: theme.muted, marginTop: 4 }}>
                      {member.nationality}
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        </SectionCard>
      )}

      {/* Blue Origin Details */}
      {data.blueOriginDetails && (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>Blue Origin Details</SectionTitle>
          <View style={{ gap: 12 }}>
            {data.blueOriginDetails.travelers?.length > 0 && (
              <View>
                <Text style={{ fontSize: 14, fontWeight: '600', color: theme.foreground, marginBottom: 8 }}>
                  Travelers ({data.blueOriginDetails.travelers.length})
                </Text>
                {data.blueOriginDetails.travelers.map((traveler, idx) => (
                  <View
                    key={idx}
                    style={{
                      padding: 12,
                      borderRadius: 8,
                      backgroundColor: 'rgba(255, 255, 255, 0.02)',
                      marginBottom: 8,
                    }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: '600', color: theme.foreground }}>
                      {traveler.name}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {data.blueOriginDetails.payloadNotes && (
              <View>
                <Text style={{ fontSize: 14, fontWeight: '600', color: theme.foreground, marginBottom: 8 }}>
                  Payload Notes
                </Text>
                <Text style={{ fontSize: 13, color: theme.muted, lineHeight: 18 }}>
                  {data.blueOriginDetails.payloadNotes}
                </Text>
              </View>
            )}
          </View>
        </SectionCard>
      )}

      {/* Programs */}
      {data.programs.length > 0 && (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>Programs</SectionTitle>
          <View style={{ gap: 12 }}>
            {data.programs.map((program) => (
              <View
                key={program.id}
                style={{
                  padding: 16,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: theme.stroke,
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                }}
              >
                <Text style={{ fontSize: 15, fontWeight: '700', color: theme.foreground, marginBottom: 4 }}>
                  {program.name}
                </Text>
                {program.description && (
                  <Text style={{ fontSize: 13, color: theme.muted, lineHeight: 18 }}>
                    {program.description}
                  </Text>
                )}
              </View>
            ))}
          </View>
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

function PayloadDetail({ label, value, theme }: { label: string; value: string; theme: MobileTheme }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Text style={{ fontSize: 12, color: theme.muted, minWidth: 60 }}>
        {label}:
      </Text>
      <Text style={{ fontSize: 12, color: theme.foreground, fontWeight: '600', flex: 1 }}>
        {value}
      </Text>
    </View>
  );
}

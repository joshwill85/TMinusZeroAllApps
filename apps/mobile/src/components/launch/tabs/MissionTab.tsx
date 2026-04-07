import React from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import type { MobileTheme } from '@tminuszero/design-tokens';
import type {
  LaunchInventoryObjectSummary,
  LaunchPayloadListSummary,
  LaunchPayloadSummary,
  MissionTabData
} from '@tminuszero/launch-detail-ui';

type MissionTabProps = {
  data: MissionTabData;
  theme: MobileTheme;
};

export function MissionTab({ data, theme }: MissionTabProps) {
  const hasInventory = Boolean(data.objectInventory && data.showObjectInventory);
  const hasContent =
    data.missionOverview.description ||
    data.payloadManifest.length > 0 ||
    data.payloadSummary.length > 0 ||
    data.crew.length > 0 ||
    data.programs.length > 0 ||
    data.blueOriginDetails ||
    hasInventory;

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
      {(data.missionOverview.description || data.missionOverview.customer) && (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>Mission Overview</SectionTitle>

          {data.missionOverview.customer && (
            <View style={{ marginBottom: 12 }}>
              <Text style={{ fontSize: 12, color: theme.muted, marginBottom: 4 }}>Customer</Text>
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

      {data.payloadManifest.length > 0 && (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>Payload Manifest ({data.payloadManifest.length})</SectionTitle>
          <View style={{ gap: 12 }}>
            {data.payloadManifest.map((payload) => (
              <PayloadCard key={payload.id} payload={payload} theme={theme} />
            ))}
          </View>
        </SectionCard>
      )}

      {data.payloadManifest.length === 0 && data.payloadSummary.length > 0 && (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>Payloads ({data.payloadSummary.length})</SectionTitle>
          <View style={{ gap: 12 }}>
            {data.payloadSummary.map((payload) => (
              <PayloadSummaryCard key={payload.id} payload={payload} theme={theme} />
            ))}
          </View>
        </SectionCard>
      )}

      {data.objectInventory && hasInventory && (
        <>
          <SectionCard theme={theme}>
            <SectionTitle theme={theme}>Launch Object Inventory</SectionTitle>
            {data.objectInventory.status?.message ? (
              <Text style={{ fontSize: 13, color: theme.muted, lineHeight: 18 }}>
                {data.objectInventory.status.message}
              </Text>
            ) : null}
            {(data.objectInventory.status?.lastCheckedAt ||
              data.objectInventory.status?.lastNonEmptyAt ||
              data.objectInventory.status?.lastError) ? (
              <View style={{ gap: 4, marginTop: 12 }}>
                {data.objectInventory.status?.lastCheckedAt ? (
                  <Text style={{ fontSize: 12, color: theme.muted }}>
                    Last checked: {data.objectInventory.status.lastCheckedAt}
                  </Text>
                ) : null}
                {data.objectInventory.status?.lastNonEmptyAt ? (
                  <Text style={{ fontSize: 12, color: theme.muted }}>
                    Last non-empty: {data.objectInventory.status.lastNonEmptyAt}
                  </Text>
                ) : null}
                {data.objectInventory.status?.lastError ? (
                  <Text style={{ fontSize: 12, color: '#f87171' }}>
                    Error: {data.objectInventory.status.lastError}
                  </Text>
                ) : null}
              </View>
            ) : null}
            <View style={{ gap: 12 }}>
              {data.objectInventory.totalObjectCount > 0 && (
                <InventoryStatRow
                  label="Tracked objects"
                  value={String(data.objectInventory.totalObjectCount)}
                  theme={theme}
                  emphasize
                />
              )}
              {data.objectInventory.payloadObjectCount > 0 && (
                <InventoryStatRow
                  label="Payload objects"
                  value={String(data.objectInventory.payloadObjectCount)}
                  theme={theme}
                />
              )}
              {data.objectInventory.nonPayloadObjectCount > 0 && (
                <InventoryStatRow
                  label="Other objects"
                  value={String(data.objectInventory.nonPayloadObjectCount)}
                  theme={theme}
                />
              )}
            </View>

            {data.objectInventory.summaryBadges.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
                {data.objectInventory.summaryBadges.map((badge) => (
                  <InventoryBadge key={badge} label={badge} theme={theme} />
                ))}
              </View>
            )}
          </SectionCard>

          {data.objectInventory.payloadObjects.length > 0 && (
            <SectionCard theme={theme}>
              <SectionTitle theme={theme}>
                Tracked Payload Objects ({data.objectInventory.payloadObjects.length})
              </SectionTitle>
              <ObjectInventoryList items={data.objectInventory.payloadObjects} theme={theme} />
            </SectionCard>
          )}

          {data.objectInventory.nonPayloadObjects.length > 0 && (
            <SectionCard theme={theme}>
              <SectionTitle theme={theme}>
                Other Tracked Objects ({data.objectInventory.nonPayloadObjects.length})
              </SectionTitle>
              <ObjectInventoryList items={data.objectInventory.nonPayloadObjects} theme={theme} />
            </SectionCard>
          )}
        </>
      )}

      {data.crew.length > 0 && (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>Crew ({data.crew.length})</SectionTitle>
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
                  backgroundColor: 'rgba(255, 255, 255, 0.03)'
                }}
              >
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    backgroundColor: `${theme.accent}20`,
                    justifyContent: 'center',
                    alignItems: 'center'
                  }}
                >
                  <Text style={{ fontSize: 24 }}>👨‍🚀</Text>
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: theme.foreground }}>{member.name}</Text>
                  <Text style={{ fontSize: 13, color: theme.accent, marginTop: 2 }}>{member.role}</Text>
                  {member.nationality && (
                    <Text style={{ fontSize: 12, color: theme.muted, marginTop: 4 }}>{member.nationality}</Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        </SectionCard>
      )}

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
                      marginBottom: 8
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
                  backgroundColor: 'rgba(255, 255, 255, 0.03)'
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

function PayloadCard({ payload, theme }: { payload: LaunchPayloadSummary; theme: MobileTheme }) {
  const secondaryOperator =
    payload.manufacturer && payload.manufacturer !== payload.operator ? payload.manufacturer : null;

  return (
    <View
      style={{
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(255, 255, 255, 0.03)'
      }}
    >
      <Text style={{ fontSize: 15, fontWeight: '700', color: theme.foreground }}>{payload.name}</Text>
      {payload.subtitle ? (
        <Text style={{ fontSize: 13, color: theme.accent, marginTop: 4 }}>{payload.subtitle}</Text>
      ) : null}

      <View style={{ gap: 6, marginTop: 10 }}>
        {payload.destination ? <PayloadDetail label="Destination" value={payload.destination} theme={theme} /> : null}
        {payload.deploymentStatus ? (
          <PayloadDetail label="Deployment" value={formatDeploymentStatus(payload.deploymentStatus)} theme={theme} />
        ) : null}
        {payload.operator ? <PayloadDetail label="Operator" value={payload.operator} theme={theme} /> : null}
        {secondaryOperator ? <PayloadDetail label="Manufacturer" value={secondaryOperator} theme={theme} /> : null}
      </View>

      {payload.description ? (
        <Text style={{ fontSize: 13, color: theme.muted, marginTop: 10, lineHeight: 18 }}>
          {payload.description}
        </Text>
      ) : null}

      {payload.landingSummary ? (
        <Text style={{ fontSize: 12, color: theme.muted, marginTop: 10 }}>{payload.landingSummary}</Text>
      ) : null}

      {payload.dockingSummary ? (
        <Text style={{ fontSize: 12, color: theme.muted, marginTop: 4 }}>{payload.dockingSummary}</Text>
      ) : null}

      {(payload.infoUrl || payload.wikiUrl) && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
          {payload.infoUrl ? <LinkAction label="Mission info" href={payload.infoUrl} theme={theme} /> : null}
          {payload.wikiUrl ? <LinkAction label="Reference" href={payload.wikiUrl} theme={theme} muted /> : null}
        </View>
      )}
    </View>
  );
}

function PayloadSummaryCard({ payload, theme }: { payload: LaunchPayloadListSummary; theme: MobileTheme }) {
  return (
    <View
      style={{
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(255, 255, 255, 0.03)'
      }}
    >
      <Text style={{ fontSize: 15, fontWeight: '700', color: theme.foreground }}>{payload.name}</Text>
      {payload.subtitle ? (
        <Text style={{ fontSize: 13, color: theme.muted, marginTop: 4 }}>{payload.subtitle}</Text>
      ) : null}
    </View>
  );
}

function ObjectInventoryList({
  items,
  theme
}: {
  items: LaunchInventoryObjectSummary[];
  theme: MobileTheme;
}) {
  return (
    <View style={{ gap: 8 }}>
      {items.map((item) => (
        <View
          key={item.id}
          style={{
            borderRadius: 14,
            borderWidth: 1,
            borderColor: theme.stroke,
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            padding: 12,
            gap: 4
          }}
        >
          <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>{item.title}</Text>
          {item.subtitle ? <Text style={{ color: theme.muted, fontSize: 12 }}>{item.subtitle}</Text> : null}
          {item.lines.map((line) => (
            <Text key={`${item.id}:${line}`} style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
              {line}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function SectionCard({ children, theme }: { children: React.ReactNode; theme: MobileTheme }) {
  return (
    <View
      style={{
        padding: 20,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(255, 255, 255, 0.02)'
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
        letterSpacing: 0.5
      }}
    >
      {children}
    </Text>
  );
}

function PayloadDetail({ label, value, theme }: { label: string; value: string; theme: MobileTheme }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Text style={{ fontSize: 12, color: theme.muted, minWidth: 84 }}>{label}:</Text>
      <Text style={{ fontSize: 12, color: theme.foreground, fontWeight: '600', flex: 1 }}>{value}</Text>
    </View>
  );
}

function InventoryStatRow({
  label,
  value,
  theme,
  emphasize = false
}: {
  label: string;
  value: string;
  theme: MobileTheme;
  emphasize?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255, 255, 255, 0.05)'
      }}
    >
      <Text style={{ fontSize: 14, color: theme.muted }}>{label}</Text>
      <Text style={{ fontSize: 14, fontWeight: '700', color: emphasize ? theme.accent : theme.foreground }}>
        {value}
      </Text>
    </View>
  );
}

function InventoryBadge({ label, theme }: { label: string; theme: MobileTheme }) {
  return (
    <View
      style={{
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(255, 255, 255, 0.03)'
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: '600', color: theme.foreground }}>{label}</Text>
    </View>
  );
}

function LinkAction({
  label,
  href,
  theme,
  muted = false
}: {
  label: string;
  href: string;
  theme: MobileTheme;
  muted?: boolean;
}) {
  return (
    <Pressable
      onPress={() => {
        void Linking.openURL(href);
      }}
    >
      <Text style={{ color: muted ? theme.muted : theme.accent, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

function formatDeploymentStatus(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'confirmed') return 'Confirmed';
  if (normalized === 'unconfirmed') return 'Unconfirmed';
  if (normalized === 'unknown') return 'Unknown';
  return value;
}

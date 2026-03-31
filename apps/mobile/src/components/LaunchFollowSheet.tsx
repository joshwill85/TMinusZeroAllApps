import { type ReactNode, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

export type LaunchFollowSheetOption = {
  key: string;
  label: string;
  description: string;
  icon?: 'launch' | 'rocket' | 'provider' | 'pad' | 'launch_site' | 'state';
  active?: boolean;
  disabled?: boolean;
  locked?: boolean;
  onPress: () => void;
};

export function LaunchFollowSheet({
  launchName,
  open,
  options,
  activeCount = 0,
  capacityLabel,
  notificationsActive = false,
  notificationsContent,
  message,
  onClose
}: {
  launchName: string | null;
  open: boolean;
  options: LaunchFollowSheetOption[];
  activeCount?: number;
  capacityLabel?: string;
  notificationsActive?: boolean;
  notificationsContent?: ReactNode;
  message?: string | null;
  onClose: () => void;
}) {
  const { theme } = useMobileBootstrap();
  const [activeTab, setActiveTab] = useState<'following' | 'notifications'>('following');

  useEffect(() => {
    if (open) {
      setActiveTab('following');
    }
  }, [launchName, open]);

  if (!open) {
    return null;
  }

  return (
    <Modal visible transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.42)' }}>
        <Pressable onPress={onClose} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />
        <View
          style={{
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            borderTopWidth: 1,
            borderColor: theme.stroke,
            backgroundColor: theme.background,
            paddingHorizontal: 20,
            paddingTop: 14,
            paddingBottom: 28,
            gap: 14
          }}
        >
          <View style={{ alignItems: 'center' }}>
            <View
              style={{
                width: 44,
                height: 4,
                borderRadius: 999,
                backgroundColor: 'rgba(255, 255, 255, 0.18)'
              }}
            />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' }}>
                Follow and notifications
              </Text>
              <Text style={{ color: theme.foreground, fontSize: 21, fontWeight: '800', marginTop: 6 }}>{launchName || 'Launch'}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                <StatusBadge
                  label={capacityLabel || (activeCount > 0 ? `${activeCount} active follow${activeCount === 1 ? '' : 's'}` : 'No active follows')}
                  active={capacityLabel ? capacityLabel.startsWith('1/') : activeCount > 0}
                />
                <StatusBadge
                  label={notificationsActive ? 'Notifications on' : 'Notifications off'}
                  active={notificationsActive}
                  tone={notificationsActive ? 'accent' : 'neutral'}
                />
              </View>
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={{ color: theme.accent, fontSize: 13, fontWeight: '700' }}>Close</Text>
            </Pressable>
          </View>

          <View
            style={{
              flexDirection: 'row',
              gap: 8,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: theme.stroke,
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              padding: 4
            }}
          >
            <SheetTab
              label="Following"
              active={activeTab === 'following'}
              onPress={() => setActiveTab('following')}
              detail={capacityLabel || (activeCount > 0 ? String(activeCount) : undefined)}
            />
            <SheetTab
              label="Notifications"
              active={activeTab === 'notifications'}
              onPress={() => setActiveTab('notifications')}
              detail={notificationsActive ? 'On' : undefined}
            />
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ gap: 12, paddingBottom: 8 }}
            style={{ maxHeight: 430 }}
          >
            {activeTab === 'following' ? (
              <>
                <View style={{ gap: 10 }}>
                  {options.map((option) => (
                    <Pressable
                      key={option.key}
                      onPress={() => {
                        if (option.disabled) {
                          option.onPress();
                          return;
                        }
                        option.onPress();
                      }}
                      style={({ pressed }) => ({
                        borderRadius: 18,
                        borderWidth: 1,
                        borderColor: option.active ? theme.accent : option.locked ? 'rgba(255, 255, 255, 0.08)' : theme.stroke,
                        backgroundColor: option.active
                          ? 'rgba(34, 211, 238, 0.09)'
                          : option.locked
                            ? 'rgba(255, 255, 255, 0.02)'
                            : 'rgba(255, 255, 255, 0.03)',
                        paddingHorizontal: 16,
                        paddingVertical: 14,
                        opacity: option.disabled ? 0.52 : pressed ? 0.88 : 1
                      })}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                        <View style={{ flex: 1, flexDirection: 'row', gap: 12 }}>
                          <OptionGlyph kind={option.icon} active={option.active === true} locked={option.locked === true} />
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: option.active ? theme.accent : theme.foreground, fontSize: 15, fontWeight: '700' }}>{option.label}</Text>
                            <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18, marginTop: 4 }}>{option.description}</Text>
                          </View>
                        </View>
                        <StatePill active={option.active === true} locked={option.locked === true} />
                      </View>
                    </Pressable>
                  ))}
                </View>

                {message ? <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>{message}</Text> : null}
              </>
            ) : notificationsContent ? (
              notificationsContent
            ) : (
              <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
                Notification controls are unavailable for this launch right now.
              </Text>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function SheetTab({
  label,
  active,
  onPress,
  detail
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  detail?: string;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: active ? theme.accent : 'transparent',
        backgroundColor: active ? 'rgba(34, 211, 238, 0.12)' : pressed ? 'rgba(255, 255, 255, 0.04)' : 'transparent',
        paddingHorizontal: 12,
        paddingVertical: 10
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <Text style={{ color: active ? theme.accent : theme.foreground, fontSize: 13, fontWeight: '700' }}>{label}</Text>
        {detail ? (
          <View
            style={{
              borderRadius: 999,
              backgroundColor: active ? 'rgba(34, 211, 238, 0.18)' : 'rgba(255, 255, 255, 0.08)',
              paddingHorizontal: 8,
              paddingVertical: 2
            }}
          >
            <Text style={{ color: active ? theme.accent : theme.muted, fontSize: 11, fontWeight: '700' }}>{detail}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function StatusBadge({
  label,
  active,
  tone = 'accent'
}: {
  label: string;
  active: boolean;
  tone?: 'accent' | 'neutral';
}) {
  const { theme } = useMobileBootstrap();
  const activeColor = tone === 'accent' ? theme.accent : theme.foreground;

  return (
    <View
      style={{
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? `${activeColor}66` : 'rgba(255, 255, 255, 0.08)',
        backgroundColor: active ? `${activeColor}18` : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 10,
        paddingVertical: 5
      }}
    >
      <Text style={{ color: active ? activeColor : theme.muted, fontSize: 11, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

function StatePill({ active, locked }: { active: boolean; locked: boolean }) {
  const { theme } = useMobileBootstrap();
  const label = active ? 'On' : locked ? 'Premium' : 'Off';
  const color = active ? theme.accent : locked ? theme.muted : theme.foreground;

  return (
    <View
      style={{
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? `${theme.accent}66` : 'rgba(255, 255, 255, 0.08)',
        backgroundColor: active ? 'rgba(34, 211, 238, 0.14)' : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 9,
        paddingVertical: 4
      }}
    >
      <Text style={{ color, fontSize: 11, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

function OptionGlyph({
  kind,
  active,
  locked
}: {
  kind?: LaunchFollowSheetOption['icon'];
  active: boolean;
  locked: boolean;
}) {
  const { theme } = useMobileBootstrap();
  const stroke = active ? theme.accent : locked ? theme.muted : theme.foreground;
  const glyph =
    kind === 'rocket'
      ? 'R'
      : kind === 'provider'
        ? 'P'
        : kind === 'pad'
          ? 'Pad'
          : kind === 'launch_site'
            ? 'Site'
            : kind === 'state'
              ? 'ST'
              : 'L';

  return (
    <View
      style={{
        minWidth: 36,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: active ? `${theme.accent}66` : 'rgba(255, 255, 255, 0.08)',
        backgroundColor: active ? 'rgba(34, 211, 238, 0.12)' : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 8,
        paddingVertical: 9
      }}
    >
      <Text style={{ color: stroke, fontSize: 10, fontWeight: '800', letterSpacing: 0.6 }}>{glyph}</Text>
    </View>
  );
}

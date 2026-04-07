import { useState } from 'react';
import { Image, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { openExternalCustomerUrl } from '@/src/features/customerRoutes/shared';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

type LaunchMediaLightboxCardProps = {
  imageUrl: string;
  title: string;
  sourceUrl?: string | null;
  height?: number;
  accessibilityLabel?: string;
};

export function LaunchMediaLightboxCard({
  imageUrl,
  title,
  sourceUrl,
  height = 180,
  accessibilityLabel
}: LaunchMediaLightboxCardProps) {
  const [open, setOpen] = useState(false);
  const { theme } = useMobileBootstrap();
  const insets = useSafeAreaInsets();

  return (
    <>
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={accessibilityLabel || `Open ${title}`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          overflow: 'hidden',
          borderRadius: 18,
          borderWidth: 1,
          borderColor: theme.stroke,
          backgroundColor: 'rgba(255, 255, 255, 0.03)',
          opacity: pressed ? 0.92 : 1
        })}
      >
        <Image
          source={{ uri: imageUrl }}
          style={{ width: '100%', height, backgroundColor: 'rgba(255,255,255,0.04)' }}
          resizeMode="cover"
        />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={() => setOpen(false)}>
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(5, 6, 10, 0.96)',
            paddingTop: insets.top + 12,
            paddingRight: 12,
            paddingBottom: insets.bottom + 12,
            paddingLeft: 12
          }}
        >
          <Pressable onPress={() => setOpen(false)} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />

          <View style={{ zIndex: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginBottom: 12 }}>
            {sourceUrl ? (
              <ActionChip
                label="Open source"
                accent
                onPress={() => {
                  setOpen(false);
                  void openExternalCustomerUrl(sourceUrl);
                }}
              />
            ) : null}
            <ActionChip label="Close" onPress={() => setOpen(false)} />
          </View>

          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <Image source={{ uri: imageUrl }} accessibilityLabel={title} resizeMode="contain" style={{ width: '100%', height: '100%' }} />
          </View>
        </View>
      </Modal>
    </>
  );
}

function ActionChip({
  label,
  onPress,
  accent = false
}: {
  label: string;
  onPress: () => void;
  accent?: boolean;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: 999,
        borderWidth: 1,
        borderColor: accent ? theme.accent : theme.stroke,
        backgroundColor: accent ? 'rgba(34, 211, 238, 0.12)' : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 14,
        paddingVertical: 8,
        opacity: pressed ? 0.88 : 1
      })}
    >
      <Text style={{ color: accent ? theme.accent : theme.foreground, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

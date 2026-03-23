import { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, Share, Text, View } from 'react-native';
import { type Href, useRouter } from 'expo-router';
import type { LaunchCalendarLaunch } from '@/src/calendar/launchCalendar';
import { buildLaunchCalendarLinks } from '@/src/calendar/launchCalendar';
import { buildLaunchHref } from '@tminuszero/navigation';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

export function LaunchCalendarSheet({
  launch,
  open,
  onClose
}: {
  launch: LaunchCalendarLaunch | null;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { theme } = useMobileBootstrap();
  const [calendarImportPending, setCalendarImportPending] = useState(false);
  const [calendarImportError, setCalendarImportError] = useState<string | null>(null);

  useEffect(() => {
    setCalendarImportPending(false);
    setCalendarImportError(null);
  }, [launch?.id, open]);

  if (!open || !launch) {
    return null;
  }

  const activeLaunch = launch;
  const links = buildLaunchCalendarLinks(activeLaunch);

  async function handleCalendarImport() {
    if (calendarImportPending) {
      return;
    }

    setCalendarImportPending(true);
    setCalendarImportError(null);

    try {
      await Share.share({
        message: links.icsUrl,
        url: links.icsUrl
      });
      onClose();
    } catch {
      setCalendarImportError('Unable to prepare the calendar file right now.');
    } finally {
      setCalendarImportPending(false);
    }
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
                Add to calendar
              </Text>
              <Text style={{ color: theme.foreground, fontSize: 21, fontWeight: '800', marginTop: 6 }}>{activeLaunch.name}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={{ color: theme.accent, fontSize: 13, fontWeight: '700' }}>Close</Text>
            </Pressable>
          </View>

          <SheetButton
            label={calendarImportPending ? 'Preparing .ics...' : 'Add to Calendar'}
            onPress={() => {
              void handleCalendarImport();
            }}
            disabled={calendarImportPending}
          />
          <SheetButton
            label="Google Calendar"
            onPress={() => {
              void Linking.openURL(links.googleUrl);
              onClose();
            }}
          />
          <SheetButton
            label="Outlook Calendar"
            onPress={() => {
              void Linking.openURL(links.outlookUrl);
              onClose();
            }}
          />
          <SheetButton
            label="Launch details"
            onPress={() => {
              router.push(buildLaunchHref(activeLaunch.id) as Href);
              onClose();
            }}
            secondary
          />
          {calendarImportError ? (
            <Text style={{ color: '#ff9aab', fontSize: 13, lineHeight: 19 }}>{calendarImportError}</Text>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function SheetButton({
  label,
  onPress,
  secondary = false,
  disabled = false
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => ({
        borderRadius: 18,
        borderWidth: 1,
        borderColor: secondary ? theme.stroke : 'rgba(34, 211, 238, 0.22)',
        backgroundColor: secondary ? 'rgba(255, 255, 255, 0.03)' : 'rgba(34, 211, 238, 0.08)',
        paddingHorizontal: 16,
        paddingVertical: 14,
        opacity: disabled ? 0.6 : pressed ? 0.88 : 1
      })}
    >
      <Text style={{ color: secondary ? theme.foreground : theme.accent, fontSize: 15, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

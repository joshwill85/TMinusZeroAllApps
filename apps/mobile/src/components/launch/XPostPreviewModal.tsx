import { Modal, Pressable, Text, View } from 'react-native';
import { WebView } from '@expo/dom-webview';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { openExternalCustomerUrl } from '@/src/features/customerRoutes/shared';

export function XPostPreviewModal({
  open,
  postId,
  postUrl,
  title,
  subtitle,
  onClose
}: {
  open: boolean;
  postId: string | null | undefined;
  postUrl: string;
  title: string;
  subtitle?: string | null;
  onClose: () => void;
}) {
  const { theme } = useMobileBootstrap();

  if (!open || !postId) {
    return null;
  }

  const embedUrl = buildXTweetEmbedUrl(postId);

  return (
    <Modal visible transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(5, 6, 10, 0.92)', padding: 16, justifyContent: 'center' }}>
        <Pressable onPress={onClose} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />
        <View
          style={{
            maxHeight: '88%',
            borderRadius: 24,
            borderWidth: 1,
            borderColor: theme.stroke,
            backgroundColor: '#070913',
            overflow: 'hidden'
          }}
        >
          <View
            style={{
              paddingHorizontal: 16,
              paddingTop: 16,
              paddingBottom: 12,
              borderBottomWidth: 1,
              borderBottomColor: theme.stroke,
              gap: 10
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.foreground, fontSize: 18, fontWeight: '700' }}>{title}</Text>
                {subtitle ? <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20, marginTop: 4 }}>{subtitle}</Text> : null}
              </View>
              <Pressable onPress={onClose} hitSlop={8}>
                <Text style={{ color: theme.accent, fontSize: 13, fontWeight: '700' }}>Close</Text>
              </Pressable>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              <ActionChip
                label="Open on X"
                accent
                onPress={() => {
                  void openExternalCustomerUrl(postUrl);
                }}
              />
              <ActionChip label="Dismiss" onPress={onClose} />
            </View>
          </View>

          <View style={{ height: 560, backgroundColor: '#070913' }}>
            <WebView
              source={{ uri: embedUrl }}
              style={{ flex: 1, backgroundColor: '#070913' }}
              containerStyle={{ flex: 1, backgroundColor: '#070913' }}
              bounces={false}
              scrollEnabled
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator
              contentInsetAdjustmentBehavior="never"
            />
          </View>

          <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14 }}>
            <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
              This preview loads official X content inside the app. If the preview does not render, use Open on X instead.
            </Text>
          </View>
        </View>
      </View>
    </Modal>
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

function buildXTweetEmbedUrl(postId: string) {
  const params = [
    ['id', postId.trim()],
    ['theme', 'dark'],
    ['dnt', 'true'],
    ['conversation', 'none']
  ]
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

  return `https://platform.twitter.com/embed/Tweet.html?${params}`;
}

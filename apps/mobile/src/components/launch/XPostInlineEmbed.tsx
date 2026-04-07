import { Text, View } from 'react-native';
import { WebView } from '@expo/dom-webview';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

export function XPostInlineEmbed({ postId }: { postId: string }) {
  const { theme } = useMobileBootstrap();
  const safePostId = postId.trim();

  if (!safePostId) {
    return null;
  }

  return (
    <View style={{ gap: 10, marginTop: 4 }}>
      <View
        style={{
          height: 560,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: theme.stroke,
          backgroundColor: '#070913',
          overflow: 'hidden'
        }}
      >
        <WebView
          source={{ uri: buildXTweetEmbedUrl(safePostId) }}
          style={{ flex: 1, backgroundColor: '#070913' }}
          containerStyle={{ flex: 1, backgroundColor: '#070913' }}
          bounces={false}
          scrollEnabled
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator
          contentInsetAdjustmentBehavior="never"
        />
      </View>

      <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
        This embed loads official X content inside the app. Use Open on X if it does not render.
      </Text>
    </View>
  );
}

function buildXTweetEmbedUrl(postId: string) {
  const params = [
    ['id', postId],
    ['theme', 'dark'],
    ['dnt', 'true'],
    ['conversation', 'none']
  ]
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

  return `https://platform.twitter.com/embed/Tweet.html?${params}`;
}

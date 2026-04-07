import { Text, View } from 'react-native';
import { WebView } from '@expo/dom-webview';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

type LaunchVideoInlineEmbedProps = {
  src: string;
  providerLabel: string;
};

export function LaunchVideoInlineEmbed({ src, providerLabel }: LaunchVideoInlineEmbedProps) {
  const { theme } = useMobileBootstrap();

  return (
    <View style={{ gap: 10 }}>
      <View
        style={{
          aspectRatio: 16 / 9,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: theme.stroke,
          backgroundColor: '#070913',
          overflow: 'hidden'
        }}
      >
        <WebView
          source={{ uri: src }}
          style={{ flex: 1, backgroundColor: '#070913' }}
          containerStyle={{ flex: 1, backgroundColor: '#070913' }}
          bounces={false}
          scrollEnabled={false}
          nestedScrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          contentInsetAdjustmentBehavior="never"
        />
      </View>

      <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
        The {providerLabel} player loads in-app automatically. Use Open stream if playback does not start here.
      </Text>
    </View>
  );
}

import { Image, Pressable, Text, View } from 'react-native';
import type { MobileTheme } from '@tminuszero/design-tokens';
import { openExternalCustomerUrl } from '@/src/features/customerRoutes/shared';
import { formatTimestamp } from '@/src/utils/format';

export type LaunchNewsCardArticle = {
  title: string;
  summary?: string | null;
  url: string;
  source?: string | null;
  imageUrl?: string | null;
  publishedAt?: string | null;
  itemType?: 'article' | 'blog' | 'report' | string | null;
  authors?: string[] | null;
  featured?: boolean | null;
};

type LaunchNewsCardProps = {
  article: LaunchNewsCardArticle;
  theme: MobileTheme;
  onPress?: () => void;
};

export function LaunchNewsCard({ article, theme, onPress }: LaunchNewsCardProps) {
  const source = formatNewsSourceLabel(article.source, article.url);
  const publishedAt = article.publishedAt ? formatTimestamp(article.publishedAt) : null;
  const authors = formatNewsAuthors(article.authors);
  const typeLabel = formatNewsTypeLabel(article.itemType);
  const imageUrl = typeof article.imageUrl === 'string' && article.imageUrl.trim().length > 0 ? article.imageUrl.trim() : null;

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={article.title}
      onPress={() => {
        if (onPress) {
          onPress();
          return;
        }
        void openExternalCustomerUrl(article.url);
      }}
      style={({ pressed }) => ({
        overflow: 'hidden',
        borderRadius: 20,
        borderWidth: 1,
        borderColor: pressed ? theme.accent : theme.stroke,
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        opacity: pressed ? 0.94 : 1
      })}
    >
      <View style={{ height: 168, position: 'relative', backgroundColor: 'rgba(34, 211, 238, 0.08)' }}>
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
            resizeMode="cover"
          />
        ) : (
          <View
            style={{
              position: 'absolute',
              top: -36,
              right: -18,
              height: 120,
              width: 120,
              borderRadius: 60,
              backgroundColor: 'rgba(34, 211, 238, 0.14)'
            }}
          />
        )}
        <View
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: imageUrl ? 'rgba(4, 8, 18, 0.34)' : 'rgba(8, 13, 28, 0.72)'
          }}
        />
        <View
          style={{
            flex: 1,
            justifyContent: 'space-between',
            paddingHorizontal: 14,
            paddingVertical: 12
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, flex: 1 }}>
              <NewsPill label={typeLabel} theme={theme} />
              {article.featured ? <NewsPill label="Featured" theme={theme} subtle /> : null}
            </View>
          </View>
          <View style={{ gap: 6 }}>
            <Text style={{ color: 'rgba(255,255,255,0.82)', fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' }}>
              {source}
            </Text>
            <Text numberOfLines={2} style={{ color: '#f4f7fb', fontSize: 17, fontWeight: '800', lineHeight: 24 }}>
              {article.title}
            </Text>
          </View>
        </View>
      </View>

      <View style={{ gap: 10, paddingHorizontal: 16, paddingVertical: 14 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {publishedAt ? <MetaChip label={publishedAt} theme={theme} /> : null}
          {authors ? <MetaChip label={`By ${authors}`} theme={theme} /> : null}
        </View>
        {article.summary ? (
          <Text numberOfLines={4} style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>
            {article.summary}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Text numberOfLines={1} style={{ flex: 1, color: theme.muted, fontSize: 12 }}>
            {source}
          </Text>
          <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>Open source</Text>
        </View>
      </View>
    </Pressable>
  );
}

function NewsPill({ label, theme, subtle = false }: { label: string; theme: MobileTheme; subtle?: boolean }) {
  return (
    <View
      style={{
        borderRadius: 999,
        borderWidth: 1,
        borderColor: subtle ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.28)',
        backgroundColor: subtle ? 'rgba(10, 14, 24, 0.36)' : 'rgba(10, 14, 24, 0.48)',
        paddingHorizontal: 10,
        paddingVertical: 6
      }}
    >
      <Text style={{ color: subtle ? 'rgba(255,255,255,0.88)' : theme.accent, fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' }}>
        {label}
      </Text>
    </View>
  );
}

function MetaChip({ label, theme }: { label: string; theme: MobileTheme }) {
  return (
    <View
      style={{
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(255, 255, 255, 0.04)',
        paddingHorizontal: 10,
        paddingVertical: 6
      }}
    >
      <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

function formatNewsSourceLabel(source: string | null | undefined, url: string) {
  const normalizedSource = typeof source === 'string' && source.trim().length > 0 ? source.trim() : null;
  if (normalizedSource) return normalizedSource;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Launch coverage';
  }
}

function formatNewsTypeLabel(type: LaunchNewsCardArticle['itemType']) {
  if (!type) return 'Article';
  if (type === 'blog') return 'Blog';
  if (type === 'report') return 'Report';
  if (type === 'article') return 'Article';
  return type
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatNewsAuthors(authors: string[] | null | undefined) {
  if (!Array.isArray(authors)) return null;
  const cleaned = authors.map((author) => author.trim()).filter(Boolean);
  if (!cleaned.length) return null;
  if (cleaned.length <= 2) return cleaned.join(', ');
  return `${cleaned.slice(0, 2).join(', ')} +${cleaned.length - 2}`;
}

import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mobileColorTokens } from '@tminuszero/design-tokens';

export function ScreenShell({
  eyebrow,
  title,
  subtitle,
  children
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.safeArea}>
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + 20,
            paddingRight: insets.right + 20,
            paddingBottom: insets.bottom + 20,
            paddingLeft: insets.left + 20
          }
        ]}
      >
        <View style={styles.header}>
          {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {children}
      </ScrollView>
    </View>
  );
}

export function Card({
  title,
  children
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.card}>
      {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

export function EmptyState({
  title,
  body
}: {
  title: string;
  body: string;
}) {
  return (
    <Card>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </Card>
  );
}

export function MetaRow({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: mobileColorTokens.background
  },
  content: {
    gap: 16,
    backgroundColor: mobileColorTokens.background
  },
  header: {
    gap: 8
  },
  eyebrow: {
    color: mobileColorTokens.accent,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase'
  },
  title: {
    color: mobileColorTokens.foreground,
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 34
  },
  subtitle: {
    color: mobileColorTokens.muted,
    fontSize: 15,
    lineHeight: 22
  },
  card: {
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: mobileColorTokens.stroke,
    backgroundColor: mobileColorTokens.surface,
    padding: 16
  },
  cardTitle: {
    color: mobileColorTokens.foreground,
    fontSize: 16,
    fontWeight: '700'
  },
  emptyTitle: {
    color: mobileColorTokens.foreground,
    fontSize: 16,
    fontWeight: '700'
  },
  emptyBody: {
    color: mobileColorTokens.muted,
    fontSize: 14,
    lineHeight: 20
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12
  },
  metaLabel: {
    color: mobileColorTokens.muted,
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.8
  },
  metaValue: {
    color: mobileColorTokens.foreground,
    fontSize: 13,
    flexShrink: 1,
    textAlign: 'right'
  }
});

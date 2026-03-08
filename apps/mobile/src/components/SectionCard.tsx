import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useMobileBootstrap } from '@/src/providers/AppProviders';

type SectionCardProps = {
  title: string;
  description?: string;
  body?: string;
  compact?: boolean;
  children?: ReactNode;
};

export function SectionCard({ title, description, body, compact = false, children }: SectionCardProps) {
  const { theme } = useMobileBootstrap();

  return (
    <View
      style={{
        gap: compact ? 8 : 12,
        borderRadius: compact ? 16 : 20,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: theme.surface,
        padding: compact ? 14 : 18
      }}
    >
      <View style={{ gap: 6 }}>
        <Text style={{ color: theme.foreground, fontSize: compact ? 15 : 17, fontWeight: '700' }}>
          {title}
        </Text>
        {description ? (
          <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>{description}</Text>
        ) : null}
        {body ? <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>{body}</Text> : null}
      </View>
      {children}
    </View>
  );
}

type StateCardProps = {
  title: string;
  body: string;
};

export function LoadingStateCard({ title, body }: StateCardProps) {
  return <SectionCard title={title} body={body} />;
}

export function ErrorStateCard({ title, body }: StateCardProps) {
  return <SectionCard title={title} body={body} />;
}

export function EmptyStateCard({ title, body }: StateCardProps) {
  return <SectionCard title={title} body={body} />;
}

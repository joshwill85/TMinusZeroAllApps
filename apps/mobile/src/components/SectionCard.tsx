import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

type SectionCardProps = {
  title: string;
  description?: string;
  body?: string;
  compact?: boolean;
  testID?: string;
  titleTestID?: string;
  descriptionTestID?: string;
  bodyTestID?: string;
  children?: ReactNode;
};

export function SectionCard({
  title,
  description,
  body,
  compact = false,
  testID,
  titleTestID,
  descriptionTestID,
  bodyTestID,
  children
}: SectionCardProps) {
  const { theme } = useMobileBootstrap();

  return (
    <View
      testID={testID}
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
        <Text testID={titleTestID} style={{ color: theme.foreground, fontSize: compact ? 15 : 17, fontWeight: '700' }}>
          {title}
        </Text>
        {description ? (
          <Text testID={descriptionTestID} style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
            {description}
          </Text>
        ) : null}
        {body ? (
          <Text testID={bodyTestID} style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
            {body}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

type StateCardProps = {
  title: string;
  body: string;
  testID?: string;
  bodyTestID?: string;
};

export function LoadingStateCard({ title, body, testID, bodyTestID }: StateCardProps) {
  return <SectionCard title={title} body={body} testID={testID} bodyTestID={bodyTestID} />;
}

export function ErrorStateCard({ title, body, testID, bodyTestID }: StateCardProps) {
  return <SectionCard title={title} body={body} testID={testID} bodyTestID={bodyTestID} />;
}

export function EmptyStateCard({ title, body, testID, bodyTestID }: StateCardProps) {
  return <SectionCard title={title} body={body} testID={testID} bodyTestID={bodyTestID} />;
}

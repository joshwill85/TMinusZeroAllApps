import { Link } from 'expo-router';
import type { Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { LaunchCardV1 } from '@tminuszero/contracts';
import { mobileColorTokens } from '@tminuszero/design-tokens';
import { buildLaunchHref } from '@tminuszero/navigation';
import { buildCountdownSnapshot } from '@tminuszero/domain';
import { Card, EmptyState } from '@/src/components/ScreenShell';

function buildLaunchTimingLabel(net: string | null) {
  const snapshot = buildCountdownSnapshot(net);
  if (!snapshot || !net) return 'NET TBD';

  const absMinutes = Math.round(Math.abs(snapshot.totalMs) / 60_000);
  if (absMinutes >= 24 * 60) {
    const days = Math.round(absMinutes / (24 * 60));
    return snapshot.isPast ? `${days}d ago` : `T-${days}d`;
  }
  if (absMinutes >= 60) {
    const hours = Math.round(absMinutes / 60);
    return snapshot.isPast ? `${hours}h ago` : `T-${hours}h`;
  }
  return snapshot.isPast ? `${absMinutes}m ago` : `T-${absMinutes}m`;
}

export function LaunchList({
  launches,
  emptyTitle,
  emptyBody
}: {
  launches: LaunchCardV1[];
  emptyTitle: string;
  emptyBody: string;
}) {
  if (!launches.length) {
    return <EmptyState title={emptyTitle} body={emptyBody} />;
  }

  return (
    <View style={styles.list}>
      {launches.map((launch) => (
        <Link key={launch.id} href={buildLaunchHref(launch.id) as Href} asChild>
          <Pressable>
            <Card>
              <View style={styles.row}>
                <Text style={styles.name}>{launch.name}</Text>
                <Text style={styles.net}>{buildLaunchTimingLabel(launch.net)}</Text>
              </View>
              <Text style={styles.meta}>
                {[launch.provider, launch.status].filter(Boolean).join(' • ') || 'Launch detail'}
              </Text>
            </Card>
          </Pressable>
        </Link>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 12
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12
  },
  name: {
    color: mobileColorTokens.foreground,
    fontSize: 16,
    fontWeight: '700',
    flex: 1
  },
  net: {
    color: mobileColorTokens.accent,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8
  },
  meta: {
    color: mobileColorTokens.muted,
    fontSize: 14,
    lineHeight: 20
  }
});

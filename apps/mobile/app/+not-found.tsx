import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { mobileColorTokens } from '@tminuszero/design-tokens';

export default function NotFoundScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Screen not found</Text>
      <Link href="/" style={styles.link}>
        Return to shell
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    backgroundColor: mobileColorTokens.background
  },
  title: {
    color: mobileColorTokens.foreground,
    fontSize: 24,
    fontWeight: '700'
  },
  link: {
    color: mobileColorTokens.accent,
    fontSize: 16,
    fontWeight: '600'
  }
});

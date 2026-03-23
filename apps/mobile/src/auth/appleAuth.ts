import { Platform } from 'react-native';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/src/config/api';

type AppleAuthRevocationPlaceholderContext = {
  email: string | null;
  userId: string | null;
};

function readBooleanFlag(value: string | undefined) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function isMobileAppleAuthEnabled() {
  if (Platform.OS !== 'ios') {
    return false;
  }

  return readBooleanFlag(process.env.EXPO_PUBLIC_MOBILE_APPLE_AUTH_ENABLED) && Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

export async function captureAppleAuthRevocationPlaceholder(context: AppleAuthRevocationPlaceholderContext) {
  void context;

  // Placeholder boundary for future Apple token capture and deletion-time revocation.
  return {
    attempted: false as const,
    reason: 'apple_revocation_not_configured' as const
  };
}

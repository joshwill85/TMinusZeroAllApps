import { Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

export type AccountNoticeTone = 'info' | 'success' | 'warning' | 'error';

const NOTICE_COLORS: Record<AccountNoticeTone, { border: string; background: string; text: string }> = {
  info: {
    border: 'rgba(34, 211, 238, 0.22)',
    background: 'rgba(34, 211, 238, 0.1)',
    text: '#6fe8ff'
  },
  success: {
    border: 'rgba(52, 211, 153, 0.22)',
    background: 'rgba(52, 211, 153, 0.12)',
    text: '#7ff0bc'
  },
  warning: {
    border: 'rgba(251, 191, 36, 0.24)',
    background: 'rgba(251, 191, 36, 0.12)',
    text: '#ffd36e'
  },
  error: {
    border: 'rgba(251, 113, 133, 0.28)',
    background: 'rgba(251, 113, 133, 0.12)',
    text: '#ff9aa9'
  }
};

export function AccountNotice({
  message,
  tone = 'info'
}: {
  message: string | null | undefined;
  tone?: AccountNoticeTone;
}) {
  if (!message) {
    return null;
  }

  const colors = NOTICE_COLORS[tone];

  return (
    <View
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.background,
        paddingHorizontal: 14,
        paddingVertical: 12
      }}
    >
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700', lineHeight: 20 }}>{message}</Text>
    </View>
  );
}

export function AccountDetailRow({
  label,
  value,
  testID
}: {
  label: string;
  value: string;
  testID?: string;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(234, 240, 255, 0.08)',
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
        paddingHorizontal: 14,
        paddingVertical: 12
      }}
    >
      <Text style={{ color: theme.muted, fontSize: 14, fontWeight: '700', flex: 1 }}>{label}</Text>
      <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '600', flex: 1, textAlign: 'right' }}>{value}</Text>
    </View>
  );
}

export function AccountTextField({
  label,
  value,
  onChangeText,
  placeholder,
  testID,
  autoCapitalize = 'words',
  keyboardType = 'default',
  autoCorrect = false
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  testID?: string;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  keyboardType?: TextInputProps['keyboardType'];
  autoCorrect?: boolean;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' }}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        autoCorrect={autoCorrect}
        style={{
          borderRadius: 16,
          borderWidth: 1,
          borderColor: theme.stroke,
          backgroundColor: 'rgba(255, 255, 255, 0.03)',
          color: theme.foreground,
          fontSize: 15,
          paddingHorizontal: 14,
          paddingVertical: 12
        }}
      />
    </View>
  );
}

export function AccountToggleRow({
  label,
  description,
  enabled,
  disabled = false,
  onPress,
  testID
}: {
  label: string;
  description: string;
  enabled: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        gap: 10,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: pressed ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.03)',
        opacity: disabled ? 0.5 : 1,
        paddingHorizontal: 14,
        paddingVertical: 14
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700', flex: 1 }}>{label}</Text>
        <View
          style={{
            borderRadius: 999,
            borderWidth: 1,
            borderColor: enabled ? 'rgba(52, 211, 153, 0.26)' : theme.stroke,
            backgroundColor: enabled ? 'rgba(52, 211, 153, 0.12)' : 'rgba(255, 255, 255, 0.03)',
            paddingHorizontal: 10,
            paddingVertical: 6
          }}
        >
          <Text style={{ color: enabled ? '#7ff0bc' : theme.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' }}>
            {enabled ? 'On' : 'Off'}
          </Text>
        </View>
      </View>
      <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>{description}</Text>
    </Pressable>
  );
}

import { Link } from 'expo-router';
import type { Href } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { CustomerShellPanel } from '@/src/components/CustomerShell';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

type SignInPromptProps = {
  title?: string;
  body: string;
  actionLabel?: string;
  href?: Href;
};

export function SignInPrompt({
  title = 'Sign in to continue',
  body,
  actionLabel = 'Sign in',
  href = '/sign-in'
}: SignInPromptProps) {
  const { theme } = useMobileBootstrap();

  return (
    <CustomerShellPanel title={title} description={body}>
      <Link href={href} asChild>
        <Pressable
          testID="sign-in-prompt-action"
          style={({ pressed }) => ({
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 999,
            borderWidth: 1,
            borderColor: theme.accent,
            backgroundColor: theme.accent,
            paddingHorizontal: 18,
            paddingVertical: 14,
            opacity: pressed ? 0.86 : 1
          })}
        >
          <Text style={{ color: theme.background, fontSize: 15, fontWeight: '700' }}>{actionLabel}</Text>
        </Pressable>
      </Link>
    </CustomerShellPanel>
  );
}

import { Link } from 'expo-router';
import type { Href } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { buildMobileRoute } from '@tminuszero/navigation';
import { SectionCard } from '@/src/components/SectionCard';
import { useMobileBootstrap } from '@/src/providers/AppProviders';

type SignInPromptProps = {
  body: string;
  href?: Href;
};

export function SignInPrompt({ body, href = buildMobileRoute('authSignIn') as Href }: SignInPromptProps) {
  const { theme } = useMobileBootstrap();

  return (
    <SectionCard title="Sign-in required" body={body}>
      <Link href={href} asChild>
        <Pressable
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 999,
            backgroundColor: theme.accent,
            paddingHorizontal: 18,
            paddingVertical: 14
          }}
        >
          <Text style={{ color: theme.background, fontSize: 15, fontWeight: '700' }}>Open sign-in</Text>
        </Pressable>
      </Link>
    </SectionCard>
  );
}

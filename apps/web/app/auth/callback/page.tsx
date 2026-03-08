import { Suspense } from 'react';
import AuthCallbackClient from './AuthCallbackClient';

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<p className="text-sm text-text2">Signing you in…</p>}>
      <AuthCallbackClient />
    </Suspense>
  );
}


import { Suspense } from 'react';
import { SignUpPanel } from '@/components/SignUpPanel';

export default function SignUpPage() {
  return (
    <Suspense fallback={<div className="text-sm text-text3">Loading sign-up…</div>}>
      <SignUpPanel />
    </Suspense>
  );
}

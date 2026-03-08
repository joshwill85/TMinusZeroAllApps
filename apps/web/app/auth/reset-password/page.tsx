import { Suspense } from 'react';
import ResetPasswordClient from './ResetPasswordClient';

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<p className="text-sm text-text2">Validating your reset link...</p>}>
      <ResetPasswordClient />
    </Suspense>
  );
}

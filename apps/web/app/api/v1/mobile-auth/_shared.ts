import { NextResponse } from 'next/server';
import { MobileAuthRouteError } from '@/lib/server/mobileAuth';

export function mobileAuthJson(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      'Cache-Control': 'private, no-store'
    }
  });
}

export function handleMobileAuthError(scope: string, error: unknown) {
  if (error instanceof MobileAuthRouteError) {
    const response = mobileAuthJson(
      {
        error: error.code,
        message: error.message
      },
      error.status
    );
    if (error.retryAfterSeconds) {
      response.headers.set('Retry-After', String(error.retryAfterSeconds));
    }
    return response;
  }

  console.error(`${scope} failed`, error);
  return mobileAuthJson({ error: 'failed', message: 'Unable to complete this mobile auth request.' }, 500);
}

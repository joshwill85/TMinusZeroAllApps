'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('global error boundary', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          padding: '48px 16px',
          backgroundColor: '#05060A',
          color: '#EAF0FF',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif'
        }}
      >
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#7f8bb0' }}>
            Error
          </div>
          <h1 style={{ margin: '10px 0 0', fontSize: 32, lineHeight: 1.15 }}>Something went wrong</h1>
          <p style={{ margin: '12px 0 0', color: '#b9c6e8', lineHeight: 1.6 }}>
            The app hit an unexpected error. Try again, or return to the launch schedule.
          </p>
          {error.digest ? (
            <p style={{ margin: '12px 0 0', fontSize: 12, color: '#7f8bb0' }}>
              Error ID: <span style={{ color: '#b9c6e8', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{error.digest}</span>
            </p>
          ) : null}

          <div style={{ marginTop: 24, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                appearance: 'none',
                border: '1px solid rgba(234, 240, 255, 0.18)',
                background: 'rgba(34, 211, 238, 0.14)',
                color: '#EAF0FF',
                borderRadius: 14,
                padding: '10px 14px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Try again
            </button>
            <a
              href="/#schedule"
              style={{
                border: '1px solid rgba(234, 240, 255, 0.14)',
                background: 'rgba(255,255,255,0.04)',
                color: '#EAF0FF',
                borderRadius: 14,
                padding: '10px 14px',
                textDecoration: 'none',
                fontWeight: 600
              }}
            >
              Back to schedule
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}


'use client';

import { useEffect, useState } from 'react';

const DISMISS_KEY = 'ios_install_prompt_dismissed_at';
const DISMISS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function isIos() {
  if (typeof window === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

export function IOSInstallPrompt({ trigger }: { trigger?: boolean }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!trigger) return;
    if (!isIos()) return;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
    if (isStandalone) return;

    const lastDismiss = localStorage.getItem(DISMISS_KEY);
    if (lastDismiss && Date.now() - Number(lastDismiss) < DISMISS_WINDOW_MS) return;
    setVisible(true);
  }, [trigger]);

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 left-0 right-0 z-30 px-3 md:px-8">
      <div className="relative mx-auto max-w-xl rounded-2xl border border-stroke-strong bg-surface-1 px-4 py-4 shadow-glow">
        <div className="absolute -top-4 right-10 hidden h-8 w-8 rotate-12 rounded-full border border-stroke bg-[rgba(234,240,255,0.04)] md:block" aria-hidden />
        <div className="flex items-start gap-3">
          <div className="text-2xl">⬆️</div>
          <div className="flex-1 space-y-1 text-sm text-text2">
            <div className="text-base font-semibold text-text1">Add to Home Screen to enable real-time launch alerts.</div>
            <p>iOS push requires Home Screen install (iOS 16.4+). Tap the Share icon, then &quot;Add to Home Screen.&quot;</p>
            <div className="text-xs text-text3">We will remind you again in 7 days if dismissed.</div>
          </div>
          <button
            className="btn-secondary rounded-lg px-3 py-1 text-xs"
            onClick={() => {
              localStorage.setItem(DISMISS_KEY, Date.now().toString());
              setVisible(false);
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

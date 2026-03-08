'use client';

import Script from 'next/script';
import { useEffect, useMemo, useRef, useState } from 'react';

type CaptchaProvider = 'turnstile' | 'hcaptcha';

type CaptchaWidgetProps = {
  provider: CaptchaProvider;
  siteKey: string;
  onToken: (token: string | null) => void;
  resetKey?: number;
  className?: string;
};

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      remove?: (widgetId: string) => void;
      reset?: (widgetId: string) => void;
    };
    hcaptcha?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => number;
      remove?: (widgetId: number) => void;
      reset?: (widgetId: number) => void;
    };
  }
}

export function CaptchaWidget({ provider, siteKey, onToken, resetKey = 0, className }: CaptchaWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | number | null>(null);
  const [ready, setReady] = useState(false);

  const scriptSrc = useMemo(() => {
    if (provider === 'turnstile') return 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    return 'https://js.hcaptcha.com/1/api.js?render=explicit';
  }, [provider]);

  useEffect(() => {
    onToken(null);
  }, [onToken, resetKey]);

  useEffect(() => {
    if (provider === 'turnstile' && window.turnstile) setReady(true);
    if (provider === 'hcaptcha' && window.hcaptcha) setReady(true);
  }, [provider, resetKey]);

  useEffect(() => {
    if (provider === 'turnstile' && typeof widgetIdRef.current === 'string' && window.turnstile?.remove) {
      window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    }
    if (provider === 'hcaptcha' && typeof widgetIdRef.current === 'number' && window.hcaptcha?.remove) {
      window.hcaptcha.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    }
  }, [provider, resetKey]);

  useEffect(() => {
    if (!ready || !containerRef.current) return;

    const commonOptions = {
      sitekey: siteKey,
      theme: 'dark',
      callback: (token: string) => onToken(token),
      'error-callback': () => onToken(null),
      'expired-callback': () => onToken(null)
    };

    if (provider === 'turnstile' && window.turnstile) {
      widgetIdRef.current = window.turnstile.render(containerRef.current, commonOptions);
    }

    if (provider === 'hcaptcha' && window.hcaptcha) {
      widgetIdRef.current = window.hcaptcha.render(containerRef.current, commonOptions);
    }
  }, [onToken, provider, ready, siteKey, resetKey]);

  useEffect(() => {
    return () => {
      if (provider === 'turnstile' && typeof widgetIdRef.current === 'string' && window.turnstile?.remove) {
        window.turnstile.remove(widgetIdRef.current);
      }
      if (provider === 'hcaptcha' && typeof widgetIdRef.current === 'number' && window.hcaptcha?.remove) {
        window.hcaptcha.remove(widgetIdRef.current);
      }
    };
  }, [provider]);

  return (
    <div className={className}>
      <div ref={containerRef} key={`${provider}-${resetKey}`} />
      <Script src={scriptSrc} strategy="afterInteractive" onLoad={() => setReady(true)} />
    </div>
  );
}

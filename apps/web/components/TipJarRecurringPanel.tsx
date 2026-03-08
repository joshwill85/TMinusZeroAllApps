'use client';

import { useState } from 'react';
import { BRAND_NAME } from '@/lib/brand';

export function TipJarRecurringPanel() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const openPortal = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/tipjar/portal', { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.url) {
        if (json?.error === 'no_tipjar_customer') {
          setNotice('No monthly tip found yet. Start a monthly tip from the Tip Jar first.');
          return;
        }
        throw new Error(json?.error || 'portal_failed');
      }
      window.location.href = json.url;
    } catch (err) {
      console.error('tipjar portal error', err);
      setNotice('Unable to open the tip jar billing portal.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.1em] text-text3">Tip jar</div>
          <div className="mt-1 text-base font-semibold text-text1">Monthly tip (recurring)</div>
          <div className="mt-1 text-xs text-text3">
            Manage or cancel your monthly tip to support {BRAND_NAME}. (This is separate from Premium billing.)
          </div>
        </div>
        <button type="button" className="btn-secondary shrink-0 rounded-lg px-3 py-2 text-xs" onClick={openPortal} disabled={busy}>
          {busy ? 'Opening…' : 'Manage monthly tip'}
        </button>
      </div>
      {notice && <div className="mt-3 rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2 text-xs text-text2">{notice}</div>}
    </div>
  );
}


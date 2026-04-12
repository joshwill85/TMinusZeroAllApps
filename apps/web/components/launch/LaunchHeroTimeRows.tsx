'use client';

import { useMemo, useState } from 'react';
import type { Launch } from '@/lib/types/launch';
import { formatLaunchMoment, isDateOnlyNet } from '@/lib/time';
import { useResolvedTimeZone } from '@/lib/hooks/useResolvedTimeZone';

type LaunchHeroTimeRowsProps = {
  net: string | null;
  netPrecision?: Launch['netPrecision'];
  fallbackTimeZone?: string | null;
};

export function LaunchHeroTimeRows({
  net,
  netPrecision,
  fallbackTimeZone
}: LaunchHeroTimeRowsProps) {
  const localTimeZone = useResolvedTimeZone(fallbackTimeZone);
  const [showUtcFirst, setShowUtcFirst] = useState(false);

  const rows = useMemo(() => {
    if (!net) return [];

    if (isDateOnlyNet(net, netPrecision, localTimeZone)) {
      return [
        {
          id: 'net',
          label: 'NET',
          value: formatLaunchMoment(net, localTimeZone, netPrecision),
          emphasized: true
        }
      ];
    }

    const localRow = {
      id: 'local',
      label: 'Local',
      value: formatLaunchMoment(net, localTimeZone, netPrecision, { includeTimeTbd: false }),
      emphasized: !showUtcFirst
    };
    const utcRow = {
      id: 'utc',
      label: 'UTC',
      value: formatLaunchMoment(net, 'UTC', netPrecision, { includeTimeTbd: false }),
      emphasized: showUtcFirst
    };

    return showUtcFirst ? [utcRow, localRow] : [localRow, utcRow];
  }, [localTimeZone, net, netPrecision, showUtcFirst]);

  if (!rows.length) {
    return null;
  }

  const hasToggle = rows.length > 1;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text3">
                {row.label}
              </span>
              <span className={row.emphasized ? 'text-sm font-semibold text-text1' : 'text-sm text-text2'}>
                {row.value}
              </span>
            </div>
          ))}
        </div>
        {hasToggle ? (
          <button
            type="button"
            onClick={() => setShowUtcFirst((current) => !current)}
            className="rounded-full border border-white/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text2 transition hover:border-primary hover:text-primary"
            aria-pressed={showUtcFirst}
          >
            {showUtcFirst ? 'Show Local First' : 'Show UTC First'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

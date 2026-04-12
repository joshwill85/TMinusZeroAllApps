'use client';

import { useMemo } from 'react';
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
      emphasized: true
    };
    const utcRow = {
      id: 'utc',
      label: 'UTC',
      value: formatLaunchMoment(net, 'UTC', netPrecision, { includeTimeTbd: false }),
      emphasized: false
    };

    return [localRow, utcRow];
  }, [localTimeZone, net, netPrecision]);

  if (!rows.length) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
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
    </div>
  );
}

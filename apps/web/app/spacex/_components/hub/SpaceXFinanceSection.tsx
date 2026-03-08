import Link from 'next/link';
import { formatFinanceValue } from '@/lib/utils/spacexHub';
import type { SpaceXFinanceResponse } from '@/lib/types/spacexProgram';

export function SpaceXFinanceSection({ finance }: { finance: SpaceXFinanceResponse }) {
  return (
    <section id="finance" className="scroll-mt-24">
      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Investor and finance proxies</h2>
        <p className="mt-2 text-sm text-text2">{finance.disclaimer}</p>
        <ul className="mt-3 space-y-2 text-sm text-text2">
          {finance.items.map((item) => (
            <li key={item.id} className="rounded-lg border border-stroke bg-surface-0 p-3">
              <p className="font-semibold text-text1">{item.title}</p>
              <p className="mt-1 text-xs text-text3">
                {item.value != null ? formatFinanceValue(item.value, item.unit) : 'N/A'} • {item.period || 'Reference metric'}
              </p>
              <p className="mt-1 text-xs text-text3">{item.disclaimer}</p>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <Link href="/api/public/spacex/finance" className="text-xs uppercase tracking-[0.1em] text-primary hover:text-primary/80">
            Finance API
          </Link>
        </div>
      </section>
    </section>
  );
}

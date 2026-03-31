import type { ContractStoryDiscoveryItem } from '@/lib/types/contractsStory';
import { formatUsdAmount } from '@/lib/utils/formatters';

export function ProgramContractDiscoveryList({
  title,
  subtitle,
  items,
  emptyMessage,
  variant = 'card'
}: {
  title: string;
  subtitle?: string;
  items: ContractStoryDiscoveryItem[];
  emptyMessage: string;
  variant?: 'card' | 'plain';
}) {
  return (
    <section className={variant === 'plain' ? 'space-y-4' : 'rounded-2xl border border-stroke bg-surface-1 p-4'}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold text-text1">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-text3">{subtitle}</p> : null}
        </div>
        <span className="text-xs uppercase tracking-[0.08em] text-text3">
          {items.length} records
        </span>
      </div>

      {items.length ? (
        <ul className="mt-4 space-y-3">
          {items.map((item) => (
            <li key={item.discoveryKey} className="rounded-xl border border-stroke bg-surface-0 p-3">
              <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-text3">
                <span>{item.sourceType === 'sam-contract-award' ? 'SAM award' : 'SAM notice'}</span>
                <span className="rounded-full border border-stroke px-2 py-0.5">
                  {item.joinStatus === 'candidate' ? 'Possible match' : 'Unmatched'}
                </span>
                {item.noticeId || item.solicitationId || item.piid ? (
                  <span className="font-mono normal-case tracking-normal">
                    {item.noticeId || item.solicitationId || item.piid}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {item.sourceUrl ? (
                    <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="text-base font-semibold text-text1 hover:text-primary">
                      {item.title || item.summary || item.entityName || 'Source record'}
                    </a>
                  ) : (
                    <p className="text-base font-semibold text-text1">
                      {item.title || item.summary || item.entityName || 'Source record'}
                    </p>
                  )}
                  {item.summary ? <p className="mt-1 text-sm text-text2">{item.summary}</p> : null}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-text3">
                    {item.entityName ? <span>{item.entityName}</span> : null}
                    {item.agencyName ? <span>{item.agencyName}</span> : null}
                    {item.publishedAt ? <span>{formatDateLabel(item.publishedAt)}</span> : null}
                  </div>
                </div>
                <div className="text-right text-xs text-text3">
                  {item.amount != null ? (
                    <p className="font-mono text-sm font-semibold text-text1">{formatUsdAmount(item.amount)}</p>
                  ) : (
                    <p>N/A</p>
                  )}
                  <p className="mt-1">Relevance {Math.round(item.relevanceScore * 100)}%</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-text3">{emptyMessage}</p>
      )}
    </section>
  );
}

function formatDateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric'
  }).format(date);
}

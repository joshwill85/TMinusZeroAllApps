import { XTweetEmbed } from '@/components/XTweetEmbed';
import type {
  ArtemisMissionDataCoverage,
  ArtemisMissionEvidenceLink,
  ArtemisMissionNewsItem,
  ArtemisMissionSocialItem
} from '@/lib/types/artemis';
import { resolveXPostId } from '@/lib/utils/xSocial';

export type ArtemisMissionIntelPanelsProps = {
  missionLabel: string;
  evidenceLinks: ArtemisMissionEvidenceLink[];
  news: ArtemisMissionNewsItem[];
  social: ArtemisMissionSocialItem[];
  coverage: ArtemisMissionDataCoverage;
};

export function ArtemisMissionIntelPanels({
  missionLabel,
  evidenceLinks,
  news,
  social,
  coverage
}: ArtemisMissionIntelPanelsProps) {
  return (
    <>
      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Mission evidence links</h2>
        <p className="mt-1 text-xs text-text3">
          Coverage: streams {coverage.hasWatchLinks ? 'available' : 'sparse'} • references {coverage.hasEvidenceLinks ? 'available' : 'sparse'}
        </p>
        {evidenceLinks.length ? (
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {evidenceLinks.map((link) => (
              <li key={`${link.kind || 'reference'}:${link.url}`} className="rounded-lg border border-stroke bg-surface-0 p-3">
                {isExternalLink(link.url) ? (
                  <a href={link.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-primary hover:text-primary/80">
                    {link.label}
                  </a>
                ) : (
                  <span className="text-sm font-semibold text-text1">{link.label}</span>
                )}
                {link.detail ? <p className="mt-1 text-xs text-text2">{link.detail}</p> : null}
                <div className="mt-1 text-[11px] text-text3">
                  {link.source ? <span>{link.source}</span> : null}
                  {link.capturedAt ? <span>{link.source ? ' • ' : ''}{formatDateLabel(link.capturedAt)}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-text2">No mission evidence links are currently available for {missionLabel}.</p>
        )}
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold text-text1">Social Posts</h2>
          <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">{social.length} items</span>
        </div>
        <p className="mt-1 text-xs text-text3">Coverage: {coverage.hasSocial ? 'linked social posts available' : 'no linked social posts yet'}.</p>
        {social.length ? (
          <ul className="mt-3 space-y-2">
            {social.map((item) => {
              const platform = item.platform.trim().toLowerCase();
              const xPostId = platform === 'x' || platform === 'twitter' ? resolveXPostId(item.externalId, item.externalUrl) : null;

              return (
                <li key={item.id} className="rounded-lg border border-stroke bg-surface-0 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-text1">
                      {item.platform.toUpperCase()} • {item.postType.replace(/_/g, ' ')}
                    </div>
                    <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">{item.status}</span>
                  </div>

                  {item.launchName ? <p className="mt-1 text-xs text-text3">{item.launchName}</p> : null}

                  {xPostId ? (
                    <div className="mt-2 overflow-hidden rounded-lg border border-stroke bg-surface-1/40 p-1">
                      <XTweetEmbed tweetId={xPostId} tweetUrl={item.externalUrl || undefined} theme="dark" conversation="none" />
                    </div>
                  ) : (
                    <>
                      {item.text ? <p className="mt-2 text-sm text-text2">{truncate(item.text, 240)}</p> : null}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-text3">
                        {item.postedAt ? <span>Posted: {formatDateLabel(item.postedAt)}</span> : null}
                        {!item.postedAt && item.scheduledFor ? <span>Scheduled: {formatDateLabel(item.scheduledFor)}</span> : null}
                        {!item.postedAt && !item.scheduledFor ? <span>Updated: {formatDateLabel(item.updatedAt)}</span> : null}
                        {item.externalUrl ? (
                          <a href={item.externalUrl} target="_blank" rel="noreferrer" className="text-primary hover:text-primary/80">
                            Source
                          </a>
                        ) : null}
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-text2">No recent social updates are linked to this mission yet.</p>
        )}
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold text-text1">Mission news</h2>
          <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">{news.length} items</span>
        </div>
        <p className="mt-1 text-xs text-text3">Coverage combines launch-linked SNAPI joins and mission-keyword relevance.</p>
        {news.length ? (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {news.map((item) => (
              <a
                key={item.snapiUid}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="group flex h-full flex-col overflow-hidden rounded-xl border border-stroke bg-surface-0 transition hover:border-primary"
              >
                <div className="flex flex-1 flex-col gap-2 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text3">
                    <span className="uppercase tracking-[0.08em]">{item.newsSite || 'Spaceflight News'}</span>
                    <span>{item.publishedAt ? formatDateLabel(item.publishedAt) : 'Date TBD'}</span>
                  </div>
                  <div className="text-sm font-semibold text-text1 group-hover:text-primary">{item.title}</div>
                  {item.summary ? <p className="text-xs text-text2">{truncate(item.summary, 180)}</p> : null}
                  <div className="text-[11px] uppercase tracking-[0.08em] text-text3">
                    Relevance: {item.relevance === 'both' ? 'Launch + mission' : item.relevance === 'launch-join' ? 'Launch linked' : 'Mission keyword'}
                  </div>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-text2">No related mission news is currently linked for {missionLabel}.</p>
        )}
      </section>
    </>
  );
}

function formatDateLabel(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(parsed));
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function isExternalLink(value: string) {
  return /^https?:\/\//i.test(value);
}

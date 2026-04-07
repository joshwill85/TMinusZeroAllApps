'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import type { LiveTabData } from '@tminuszero/launch-detail-ui';
import { JepScoreClient } from '@/components/JepScoreClient';
import { XTweetEmbed } from '@/components/XTweetEmbed';
import type { LaunchJepScore } from '@/lib/types/jep';

type LiveTabProps = {
  data: LiveTabData;
  className?: string;
};

export function LiveTab({ data, className }: LiveTabProps) {
  const [isForecastExpanded, setIsForecastExpanded] = useState(false);
  const hasWeather = Boolean(data.weatherDetail?.summary || data.weatherDetail?.cards?.length || data.weatherDetail?.concerns?.length);
  const hasForecastOutlook = hasWeather || data.faaAdvisories.length > 0;
  const hasContent =
    hasForecastOutlook ||
    data.hasJepScore ||
    data.watchLinks.length > 0 ||
    data.socialPosts.length > 0 ||
    data.launchUpdates.length > 0;

  if (!hasContent) {
    return (
      <Section className={className} title="Live coverage">
        <EmptyState message="Forecasts, streams, provider posts, and FAA notices will appear here as launch-day data arrives." />
      </Section>
    );
  }

  const primaryWatchLink = data.watchLinks[0] ?? null;
  const matchedPost = data.socialPosts.find((post) => post.kind === 'matched') ?? null;
  const providerPosts = data.socialPosts.filter((post) => post.kind !== 'matched');

  return (
    <div className={clsx('space-y-8', className)}>
      {hasForecastOutlook ? (
        <section className="rounded-2xl border border-stroke bg-surface-1 p-6">
          <button
            type="button"
            onClick={() => setIsForecastExpanded((current) => !current)}
            className="flex w-full items-start justify-between gap-3 text-left"
          >
            <div className="min-w-0">
              <h2 className="text-base font-bold uppercase tracking-wider text-text1">Forecast outlook</h2>
              <p className="mt-2 text-sm leading-relaxed text-text3">
                {hasWeather
                  ? data.faaAdvisories.length > 0
                    ? 'Weather sources and matched FAA launch advisories for launch day.'
                    : 'Weather sources matched to this launch.'
                  : 'Matched FAA launch advisories and launch-day airspace notices.'}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {data.faaAdvisories.length > 0 ? (
                <Badge>{data.faaAdvisories.length} match{data.faaAdvisories.length === 1 ? '' : 'es'}</Badge>
              ) : null}
              <span className="rounded-full border border-stroke bg-surface-0 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text2">
                {isForecastExpanded ? 'Collapse' : 'Expand'}
              </span>
            </div>
          </button>

          {isForecastExpanded ? (
            <div className="mt-6">
              {hasWeather ? (
                <>
                  {data.weatherDetail?.summary ? (
                    <p className="text-base font-semibold leading-relaxed text-text1">{data.weatherDetail.summary}</p>
                  ) : null}

                  {data.weatherDetail?.concerns?.length ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {data.weatherDetail.concerns.map((concern) => (
                        <Badge key={concern} accent>
                          {concern}
                        </Badge>
                      ))}
                    </div>
                  ) : null}

                  {data.weatherDetail?.cards?.length ? (
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {data.weatherDetail.cards.map((card) => (
                        <article
                          key={card.id}
                          className="rounded-xl border border-stroke bg-surface-0 p-4"
                        >
                          <div className="text-xs uppercase tracking-[0.08em] text-text3">{card.title}</div>
                          {card.subtitle ? <div className="mt-1 text-sm text-text2">{card.subtitle}</div> : null}
                          {card.headline ? <div className="mt-3 text-lg font-semibold text-text1">{card.headline}</div> : null}
                          {card.badges.length ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {card.badges.map((badge) => (
                                <Badge key={`${card.id}:${badge}`}>{badge}</Badge>
                              ))}
                            </div>
                          ) : null}
                          {card.metrics.length ? (
                            <div className="mt-3 space-y-2">
                              {card.metrics.map((metric) => (
                                <MetricRow key={`${card.id}:${metric.label}`} label={metric.label} value={metric.value} />
                              ))}
                            </div>
                          ) : null}
                          {card.detail ? <p className="mt-3 text-sm leading-relaxed text-text2">{card.detail}</p> : null}
                          {card.actionUrl && card.actionLabel ? (
                            <a
                              className="mt-3 inline-flex text-sm font-semibold text-primary hover:text-primary/80"
                              href={card.actionUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {card.actionLabel}
                            </a>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}

              {data.faaAdvisories.length > 0 ? (
                <div className={clsx('space-y-3', hasWeather ? 'mt-6 border-t border-stroke/50 pt-4' : '')}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.08em] text-text3">FAA airspace</div>
                      <h3 className="mt-1 text-lg font-semibold text-text1">Launch advisories</h3>
                      <p className="mt-1 text-sm text-text3">Temporary flight restrictions and NOTAM matches tied to this launch.</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {data.faaAdvisories.map((advisory) => (
                      <article
                        key={advisory.matchId}
                        className={clsx(
                          'rounded-xl border p-4',
                          advisory.isActiveNow
                            ? 'border-warning/40 bg-warning/10'
                            : 'border-stroke bg-surface-0'
                        )}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-base font-semibold text-text1">{advisory.title}</div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Badge accent={advisory.isActiveNow}>{advisory.isActiveNow ? 'Active now' : formatStatusLabel(advisory.status)}</Badge>
                              <Badge>{advisory.matchStatus}</Badge>
                              {advisory.notamId ? <Badge>{advisory.notamId}</Badge> : null}
                              {advisory.type ? <Badge>{advisory.type}</Badge> : null}
                            </div>
                          </div>
                          {advisory.matchConfidence != null ? (
                            <div className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
                              Match {Math.round(advisory.matchConfidence)}%
                            </div>
                          ) : null}
                        </div>

                        <div className="mt-3 grid gap-3 text-sm text-text2 md:grid-cols-2">
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.08em] text-text3">Window</div>
                            <div className="mt-1">{formatFaaWindow(advisory.validStart, advisory.validEnd)}</div>
                          </div>
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.08em] text-text3">Summary</div>
                            <div className="mt-1">{buildFaaSummary(advisory)}</div>
                          </div>
                        </div>

                        {advisory.rawText ? (
                          <div className="mt-3 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
                            <div className="text-[11px] uppercase tracking-[0.08em] text-text3">Restriction summary</div>
                            <p className="mt-2 text-sm leading-relaxed text-text2">{buildFaaPreview(advisory.rawText)}</p>
                            <details className="mt-3 text-xs text-text3">
                              <summary className="cursor-pointer select-none text-text1">Official notice text</summary>
                              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-stroke bg-surface-0 p-3 text-xs leading-6 text-text2">
                                {advisory.rawText}
                              </pre>
                            </details>
                          </div>
                        ) : null}

                        {(advisory.sourceGraphicUrl || advisory.sourceUrl || advisory.sourceRawUrl) ? (
                          <div className="mt-3 flex flex-wrap gap-3 text-sm">
                            {advisory.sourceGraphicUrl || advisory.sourceUrl ? (
                              <a
                                className="font-semibold text-primary hover:text-primary/80"
                                href={advisory.sourceGraphicUrl || advisory.sourceUrl || undefined}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {advisory.sourceGraphicUrl ? 'Open FAA graphic page' : 'View FAA source'}
                              </a>
                            ) : null}
                            {advisory.sourceRawUrl && advisory.sourceRawUrl !== advisory.sourceGraphicUrl && advisory.sourceRawUrl !== advisory.sourceUrl ? (
                              <a
                                className="font-semibold text-text2 hover:text-text1"
                                href={advisory.sourceRawUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                View raw notice text
                              </a>
                            ) : null}
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <LiveTabJepSection launchId={data.launchId} hasJepScore={data.hasJepScore} padTimezone={data.padTimezone} />

      {primaryWatchLink ? (
        <Section title="Live coverage">
          <a
            href={primaryWatchLink.url}
            target="_blank"
            rel="noreferrer"
            className="block rounded-xl border border-primary/30 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.12),_transparent_70%)] p-4 transition hover:border-primary/60"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-lg font-semibold text-text1">{primaryWatchLink.title || primaryWatchLink.label}</div>
                {primaryWatchLink.meta ? <div className="mt-1 text-sm text-text2">{primaryWatchLink.meta}</div> : null}
              </div>
              <span className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-primary">
                Open stream
              </span>
            </div>
          </a>

          {data.watchLinks.length > 1 ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {data.watchLinks.slice(1).map((link) => (
                <LinkCard
                  key={link.url}
                  href={link.url}
                  title={link.title || link.label}
                  subtitle={link.meta || link.host || 'Launch coverage'}
                />
              ))}
            </div>
          ) : null}
        </Section>
      ) : null}

      {matchedPost || providerPosts.length > 0 || data.launchUpdates.length > 0 ? (
        <Section title="Social & updates">
          {matchedPost ? (
            <div className="rounded-xl border border-primary/30 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_75%)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold text-text1">{matchedPost.title}</h3>
                    <Badge accent>Matched on X</Badge>
                  </div>
                  {matchedPost.subtitle ? <div className="mt-1 text-sm text-text2">{matchedPost.subtitle}</div> : null}
                  {matchedPost.description ? <p className="mt-3 text-sm leading-relaxed text-text2">{matchedPost.description}</p> : null}
                  {matchedPost.matchedAt ? <div className="mt-2 text-xs text-text3">Matched {formatTimestamp(matchedPost.matchedAt)}</div> : null}
                </div>
                <a
                  href={matchedPost.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-primary"
                >
                  Open on X
                </a>
              </div>

              {matchedPost.postId ? (
                <div className="mt-4 overflow-hidden rounded-xl border border-stroke bg-surface-0">
                  <XTweetEmbed tweetId={matchedPost.postId} tweetUrl={matchedPost.url} conversation="none" />
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-stroke bg-surface-0 px-4 py-3 text-sm text-text3">
                  A matched source URL is available, but no X status ID could be extracted for inline embed rendering.
                </div>
              )}
            </div>
          ) : null}

          {providerPosts.length > 0 ? (
            <div className={clsx('grid gap-3', matchedPost ? 'mt-4 md:grid-cols-2' : 'md:grid-cols-2')}>
              {providerPosts.map((post) => (
                <LinkCard
                  key={post.id}
                  href={post.url}
                  title={post.title}
                  subtitle={[post.subtitle, post.handle, post.platform.toUpperCase()].filter(Boolean).join(' • ')}
                  detail={post.description ?? undefined}
                />
              ))}
            </div>
          ) : null}

          {data.launchUpdates.length > 0 ? (
            <div className={clsx('grid gap-3', matchedPost || providerPosts.length > 0 ? 'mt-4 md:grid-cols-2' : 'md:grid-cols-2')}>
              {data.launchUpdates.map((update) => (
                <article
                  key={update.id}
                  className="rounded-xl border border-stroke bg-surface-0 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-text1">{update.field}</div>
                      {update.newValue ? <p className="mt-2 text-sm leading-relaxed text-text2">{update.newValue}</p> : null}
                    </div>
                    {update.timestamp ? <div className="text-xs text-text3">{formatTimestamp(update.timestamp)}</div> : null}
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </Section>
      ) : null}
    </div>
  );
}

function LiveTabJepSection({
  launchId,
  hasJepScore,
  padTimezone
}: {
  launchId: string;
  hasJepScore: boolean;
  padTimezone: string;
}) {
  const [score, setScore] = useState<LaunchJepScore | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>(() => (hasJepScore ? 'loading' : 'missing'));

  useEffect(() => {
    if (!hasJepScore) {
      setState('missing');
      setScore(null);
      return;
    }

    let isCancelled = false;
    const controller = new AbortController();

    const run = async () => {
      setState('loading');
      try {
        const response = await fetch(`/api/public/launches/${encodeURIComponent(launchId)}/jep`, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal
        });

        if (response.status === 404) {
          if (!isCancelled) {
            setScore(null);
            setState('missing');
          }
          return;
        }

        if (!response.ok) {
          throw new Error(`jep_fetch_${response.status}`);
        }

        const payload = (await response.json()) as LaunchJepScore;
        if (!isCancelled) {
          setScore(payload);
          setState('ready');
        }
      } catch (error) {
        if (isCancelled) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setScore(null);
        setState('error');
      }
    };

    void run();

    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [hasJepScore, launchId]);

  if (state === 'ready' && score) {
    return <JepScoreClient launchId={launchId} initialScore={score} padTimezone={padTimezone} />;
  }

  if (state === 'loading') {
    return (
      <Section title="Jellyfish Exposure Potential">
        <div className="animate-pulse space-y-3">
          <div className="h-5 w-32 rounded bg-surface-0" />
          <div className="h-12 rounded-xl bg-surface-0" />
          <div className="grid gap-3 md:grid-cols-3">
            <div className="h-20 rounded-xl bg-surface-0" />
            <div className="h-20 rounded-xl bg-surface-0" />
            <div className="h-20 rounded-xl bg-surface-0" />
          </div>
        </div>
      </Section>
    );
  }

  return (
    <Section title="Jellyfish Exposure Potential">
      <p className="text-sm leading-relaxed text-text3">
        {state === 'error'
          ? 'Visibility scoring is temporarily unavailable for this launch. Check back as launch timing and forecast inputs refresh.'
          : 'Visibility scoring is not available for this launch yet. Check back as launch timing and forecast inputs refresh.'}
      </p>
    </Section>
  );
}

function Section({
  title,
  children,
  className
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx('rounded-2xl border border-stroke bg-surface-1 p-6', className)}>
      <h2 className="mb-6 text-base font-bold uppercase tracking-wider text-text1">{title}</h2>
      {children}
    </section>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-12 text-center">
      <p className="text-sm text-text2">{message}</p>
    </div>
  );
}

function LinkCard({
  href,
  title,
  subtitle,
  detail
}: {
  href: string;
  title: string;
  subtitle: string;
  detail?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="rounded-xl border border-stroke bg-surface-0 p-4 transition hover:border-primary"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text1">{title}</div>
          <div className="mt-1 text-xs text-text3">{subtitle}</div>
        </div>
        <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-primary">Open</span>
      </div>
      {detail ? <p className="mt-3 text-sm leading-relaxed text-text2">{detail}</p> : null}
    </a>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-stroke/50 py-2 last:border-0">
      <span className="text-xs text-text3">{label}</span>
      <span className="text-right text-sm font-semibold text-text1">{value}</span>
    </div>
  );
}

function Badge({
  children,
  accent = false
}: {
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <span
      className={clsx(
        'rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]',
        accent ? 'border-primary/40 bg-primary/10 text-primary' : 'border-stroke bg-surface-0 text-text2'
      )}
    >
      {children}
    </span>
  );
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function formatFaaWindow(validStart: string | null | undefined, validEnd: string | null | undefined) {
  const start = formatTimestamp(validStart);
  const end = formatTimestamp(validEnd);
  if (start && end) return `${start} to ${end}`;
  if (start) return `Starts ${start}`;
  if (end) return `Ends ${end}`;
  return 'Official schedule pending';
}

function formatStatusLabel(status: string | null | undefined) {
  if (status === 'expired') return 'Expired';
  if (status === 'manual') return 'Manual';
  return 'Scheduled';
}

function buildFaaSummary(advisory: LiveTabData['faaAdvisories'][number]) {
  const parts = [
    advisory.facility,
    advisory.type,
    advisory.shapeCount > 0 ? `${advisory.shapeCount} shape${advisory.shapeCount === 1 ? '' : 's'}` : null
  ].filter(Boolean);
  return parts.join(' • ') || 'Launch-linked airspace notice';
}

function buildFaaPreview(rawText: string | null | undefined) {
  if (!rawText) return '';
  const normalized = rawText.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > 320 ? `${normalized.slice(0, 317)}...` : normalized;
}

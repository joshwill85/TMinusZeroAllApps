import clsx from 'clsx';
import type { RelatedTabData } from '@tminuszero/launch-detail-ui';
import { ChronoHelixTimeline } from '@/components/ChronoHelixTimeline';
import { LaunchMediaLightboxCard } from '@/components/launch/LaunchMediaLightboxCard';
import { MissionTimelineCards } from '@/components/launch/MissionTimelineCards';

type RelatedTabProps = {
  data: RelatedTabData;
  className?: string;
};

export function RelatedTab({ data, className }: RelatedTabProps) {
  const mediaItems = data.media.filter((item) => item.url);
  const hasContent =
    data.vehicleTimeline.length > 0 ||
    data.news.length > 0 ||
    data.events.length > 0 ||
    mediaItems.length > 0 ||
    data.missionTimeline.length > 0 ||
    Boolean(data.resources?.pressKit || data.resources?.missionPage);

  if (!hasContent) {
    return (
      <Section className={className} title="Related coverage">
        <EmptyState message="Related coverage, linked resources, and vehicle history are not available yet." />
      </Section>
    );
  }

  const initialLaunchId =
    data.vehicleTimeline.find((item) => item.isCurrent)?.launchId || data.vehicleTimeline[0]?.launchId || '';
  const vehicleLabel =
    data.vehicleTimeline.find((item) => item.isCurrent)?.vehicleName || data.vehicleTimeline[0]?.vehicleName || undefined;

  return (
    <div className={clsx('space-y-8', className)}>
      {data.vehicleTimeline.length > 0 ? (
        <ChronoHelixTimeline
          nodes={data.vehicleTimeline.map((item) => ({
            id: item.launchId,
            date: item.date || '',
            status: item.status,
            vehicleName: item.vehicleName || vehicleLabel || 'Launch vehicle',
            missionName: item.missionName,
            isCurrent: Boolean(item.isCurrent),
            statusLabel: item.statusLabel ?? undefined
          }))}
          initialLaunchId={initialLaunchId}
          vehicleLabel={vehicleLabel || undefined}
        />
      ) : null}

      {data.news.length > 0 ? (
        <Section title="Launch news">
          <div className="grid gap-3 md:grid-cols-2">
            {data.news.map((item) => (
              <a
                key={item.id || item.url}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="group flex h-full flex-col overflow-hidden rounded-xl border border-stroke bg-surface-0 transition hover:border-primary"
              >
                <div className="relative h-36 w-full overflow-hidden">
                  {item.image ? (
                    <img
                      src={item.image}
                      alt=""
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="h-full w-full bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.24),_transparent_68%)]" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                  <div className="absolute left-3 top-3 flex flex-wrap gap-2">
                    <span className="rounded-full border border-white/20 bg-black/40 px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-white">
                      {formatNewsType(item.itemType)}
                    </span>
                    {item.featured ? (
                      <span className="rounded-full border border-white/20 bg-black/40 px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-white">
                        Featured
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text3">
                    <span className="uppercase tracking-[0.08em]">{item.source}</span>
                    {item.date ? <span>{formatTimestamp(item.date)}</span> : null}
                  </div>
                  <div className="text-base font-semibold text-text1">{item.title}</div>
                  {item.summary ? <p className="text-sm leading-relaxed text-text2">{item.summary}</p> : null}
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-[11px] text-text3">
                    {item.authors.length > 0 ? <span>By {formatNewsAuthors(item.authors)}</span> : <span>{item.source}</span>}
                    <span className="font-semibold uppercase tracking-[0.08em] text-primary">Open source</span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </Section>
      ) : null}

      {data.events.length > 0 ? (
        <Section title="Related events">
          <ol className="relative border-l border-stroke pl-5">
            {data.events.map((event) => (
              <li key={`${event.name}:${event.date || ''}`} className="relative pb-4 last:pb-0">
                <span className="absolute -left-[26px] top-3 h-3 w-3 rounded-full border border-primary/40 bg-primary/20" />
                <div className="rounded-xl border border-stroke bg-surface-0 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-base font-semibold text-text1">{event.name}</div>
                    {event.date ? <div className="text-xs text-text3">{formatTimestamp(event.date)}</div> : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {event.type ? <Badge>{event.type}</Badge> : null}
                    {event.location ? <Badge>{event.location}</Badge> : null}
                    {event.webcastLive ? <Badge accent>Live</Badge> : null}
                  </div>
                  {event.url ? (
                    <a
                      className="mt-3 inline-flex text-sm font-semibold text-primary hover:text-primary/80"
                      href={event.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Event details
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {mediaItems.length > 0 ? (
        <Section title="Official media">
          <div className="grid gap-3 md:grid-cols-2">
            {mediaItems.map((item, index) => (
              <MediaCard
                key={`${item.url}:${index}`}
                href={item.url || '#'}
                title={item.title || item.name || 'Media link'}
                subtitle={[formatMediaKind(item.kind ?? item.type), item.host].filter(Boolean).join(' • ') || 'Official media'}
                detail={item.description || (item.name && item.name !== item.title ? item.name : undefined)}
                imageUrl={item.imageUrl ?? undefined}
              />
            ))}
          </div>
        </Section>
      ) : null}

      {data.missionTimeline.length > 0 ? (
        <Section title="Mission timeline">
          <MissionTimelineCards items={data.missionTimeline} />
        </Section>
      ) : null}

      {data.resources?.pressKit || data.resources?.missionPage ? (
        <Section title="Resources">
          <div className="grid gap-3 md:grid-cols-2">
            {data.resources?.missionPage ? (
              <LinkCard
                href={data.resources.missionPage}
                title="Mission page"
                subtitle="Official program or launch page"
              />
            ) : null}
            {data.resources?.pressKit ? (
              <LinkCard
                href={data.resources.pressKit}
                title="Press kit"
                subtitle="Official media or press resource"
              />
            ) : null}
          </div>
        </Section>
      ) : null}
    </div>
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

function MediaCard({
  href,
  title,
  subtitle,
  detail,
  imageUrl
}: {
  href: string;
  title: string;
  subtitle: string;
  detail?: string;
  imageUrl?: string;
}) {
  if (imageUrl) {
    return (
      <LaunchMediaLightboxCard
        imageUrl={imageUrl}
        alt={title}
        href={href}
        buttonLabel={`Open ${title}`}
      />
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="group overflow-hidden rounded-xl border border-stroke bg-surface-0 transition hover:border-primary"
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-text1">{title}</div>
            <div className="mt-1 text-xs text-text3">{subtitle}</div>
          </div>
          <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-primary">Open</span>
        </div>
        {detail ? <p className="mt-3 text-sm leading-relaxed text-text2">{detail}</p> : null}
      </div>
    </a>
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
  if (!value) return 'Schedule pending';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Schedule pending';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

function formatNewsType(type: RelatedTabData['news'][number]['itemType']) {
  if (type === 'blog') return 'Blog';
  if (type === 'report') return 'Report';
  return 'Article';
}

function formatNewsAuthors(authors: RelatedTabData['news'][number]['authors']) {
  if (!Array.isArray(authors) || authors.length === 0) return '';
  if (authors.length <= 2) return authors.join(', ');
  return `${authors.slice(0, 2).join(', ')} +${authors.length - 2}`;
}

function formatMediaKind(kind: string | null | undefined) {
  if (kind === 'page') return 'Launch page';
  if (kind === 'infographic') return 'Infographic';
  if (kind === 'webcast') return 'Webcast';
  if (kind === 'image') return 'Image';
  if (kind === 'video') return 'Video';
  if (kind === 'document') return 'Document';
  if (kind === 'timeline') return 'Timeline';
  return kind ?? 'Resource';
}

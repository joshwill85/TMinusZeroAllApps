import clsx from 'clsx';
import type { VehicleTabData } from '@tminuszero/launch-detail-ui';

type VehicleTabProps = {
  data: VehicleTabData;
  className?: string;
};

const STORY_ACCENTS = [
  'from-cyan-400/30 via-sky-400/15 to-transparent',
  'from-emerald-400/25 via-teal-400/12 to-transparent',
  'from-amber-400/22 via-orange-400/10 to-transparent'
];

export function VehicleTab({ data, className }: VehicleTabProps) {
  const missionStats = data.missionStats;
  const hasProfile = Boolean(
    data.vehicleConfig.family ||
      data.vehicleConfig.variant ||
      data.vehicleConfig.manufacturer ||
      data.vehicleConfig.specs.length ||
      data.vehicleConfig.specs.diameter ||
      data.vehicleConfig.specs.leoCapacity ||
      data.vehicleConfig.specs.gtoCapacity
  );
  const hasStages = data.stages.length > 0;
  const hasRecovery = Boolean(data.recovery?.booster || data.recovery?.fairing);
  const hasMissionStats = Boolean(
    missionStats?.cards?.length || missionStats?.bonusInsights?.length || missionStats?.boosterCards?.length
  );

  if (!hasProfile && !hasStages && !hasRecovery && !hasMissionStats) {
    return (
      <Section className={className} title="Vehicle details">
        <EmptyState message="Vehicle details, recovery planning, and mission stats are not available yet." />
      </Section>
    );
  }

  return (
    <div className={clsx('space-y-8', className)}>
      {hasProfile ? (
        <Section title="Vehicle profile">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ProfileCard label="Family" value={data.vehicleConfig.family} />
            <ProfileCard label="Variant" value={data.vehicleConfig.variant} />
            <ProfileCard label="Manufacturer" value={data.vehicleConfig.manufacturer} />
            <ProfileCard
              label="Specs"
              value={[
                data.vehicleConfig.specs.length ? `${data.vehicleConfig.specs.length}m long` : null,
                data.vehicleConfig.specs.diameter ? `${data.vehicleConfig.specs.diameter}m wide` : null
              ].filter(Boolean).join(' • ') || null}
            />
          </div>

          {(data.vehicleConfig.specs.leoCapacity || data.vehicleConfig.specs.gtoCapacity) ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {data.vehicleConfig.specs.leoCapacity ? (
                <CapacityCard
                  label="LEO capability"
                  value={`${data.vehicleConfig.specs.leoCapacity.toLocaleString()} kg`}
                  detail="Published payload performance to low Earth orbit."
                />
              ) : null}
              {data.vehicleConfig.specs.gtoCapacity ? (
                <CapacityCard
                  label="GTO capability"
                  value={`${data.vehicleConfig.specs.gtoCapacity.toLocaleString()} kg`}
                  detail="Published payload performance to geostationary transfer orbit."
                />
              ) : null}
            </div>
          ) : null}
        </Section>
      ) : null}

      {hasStages || hasRecovery ? (
        <Section title="Stages & recovery">
          {hasStages ? (
            <div className="grid gap-3 md:grid-cols-2">
              {data.stages.map((stage) => (
                <article
                  key={`${stage.name}:${stage.serialNumber || 'stage'}`}
                  className="rounded-xl border border-stroke bg-surface-0 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold text-text1">{stage.name}</div>
                      {stage.serialNumber ? <div className="mt-1 text-sm text-text2">Serial {stage.serialNumber}</div> : null}
                    </div>
                    <span
                      className={clsx(
                        'rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]',
                        stage.reused ? 'border-primary/40 bg-primary/10 text-primary' : 'border-stroke bg-surface-1 text-text2'
                      )}
                    >
                      {stage.reused ? 'Flight-proven' : 'Fresh stack'}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <Metric label="Previous flights" value={String(stage.previousFlights)} />
                    {stage.engine ? <Metric label="Engine" value={stage.engine} /> : null}
                    {stage.fuel ? <Metric label="Fuel" value={stage.fuel} /> : null}
                  </div>
                </article>
              ))}
            </div>
          ) : null}

          {hasRecovery ? (
            <div className={clsx('grid gap-3', hasStages ? 'mt-4 md:grid-cols-2' : 'md:grid-cols-2')}>
              {data.recovery?.booster ? (
                <RecoveryCard
                  title="Booster recovery"
                  value={data.recovery.booster.type || 'Recovery planned'}
                  detail={data.recovery.booster.location || 'Recovery zone pending'}
                />
              ) : null}
              {data.recovery?.fairing ? (
                <RecoveryCard
                  title="Fairing recovery"
                  value={data.recovery.fairing.recovery ? 'Recovery attempt planned' : 'No recovery attempt listed'}
                  detail="Recovery posture sourced from launch enrichment."
                />
              ) : null}
            </div>
          ) : null}
        </Section>
      ) : null}

      {hasMissionStats ? (
        <Section title="Mission stats">
          {missionStats?.cards?.length ? (
            <div className="grid gap-3 xl:grid-cols-3">
              {missionStats.cards.map((card, index) => (
                <article
                  key={card.id}
                  className="overflow-hidden rounded-2xl border border-stroke bg-surface-0"
                >
                  <div className={clsx('bg-gradient-to-br p-4', STORY_ACCENTS[index % STORY_ACCENTS.length])}>
                    <div className="text-[11px] uppercase tracking-[0.08em] text-text3">{card.eyebrow}</div>
                    <div className="mt-2 text-xl font-semibold text-text1">{card.title}</div>
                    <p className="mt-3 text-sm leading-relaxed text-text2">{card.story}</p>
                  </div>
                  <div className="grid gap-px border-t border-stroke bg-stroke/40 sm:grid-cols-2">
                    <div className="bg-surface-0 p-4">
                      <div className="text-[11px] uppercase tracking-[0.08em] text-text3">{card.allTimeLabel}</div>
                      <div className="mt-2 text-2xl font-semibold text-text1">{card.allTime == null ? 'TBD' : card.allTime}</div>
                    </div>
                    <div className="bg-surface-0 p-4">
                      <div className="text-[11px] uppercase tracking-[0.08em] text-text3">{card.yearLabel}</div>
                      <div className="mt-2 text-2xl font-semibold text-text1">{card.year == null ? 'TBD' : card.year}</div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : null}

          {missionStats?.bonusInsights?.length ? (
            <div className={clsx('grid gap-3 md:grid-cols-3', missionStats.cards.length ? 'mt-4' : '')}>
              {missionStats.bonusInsights.map((insight) => (
                <article
                  key={insight.label}
                  className="rounded-xl border border-stroke bg-surface-0 p-4"
                >
                  <div className="text-[11px] uppercase tracking-[0.08em] text-text3">{insight.label}</div>
                  <div className="mt-2 text-2xl font-semibold text-text1">{insight.value}</div>
                  {insight.detail ? <p className="mt-2 text-sm leading-relaxed text-text2">{insight.detail}</p> : null}
                </article>
              ))}
            </div>
          ) : null}

          {missionStats?.boosterCards?.length ? (
            <div className={clsx('grid gap-3 md:grid-cols-2', missionStats.cards.length || missionStats.bonusInsights.length ? 'mt-4' : '')}>
              {missionStats.boosterCards.map((card) => (
                <article
                  key={card.id}
                  className="rounded-xl border border-stroke bg-surface-0 p-4"
                >
                  <div className="text-base font-semibold text-text1">{card.title}</div>
                  {card.subtitle ? <div className="mt-1 text-sm text-text2">{card.subtitle}</div> : null}
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Pill label={card.allTimeLabel} value={card.allTime == null ? 'TBD' : String(card.allTime)} />
                    <Pill label={card.yearLabel} value={card.year == null ? 'TBD' : String(card.year)} />
                  </div>
                  {card.detailLines.length ? (
                    <div className="mt-4 space-y-2">
                      {card.detailLines.map((line) => (
                        <p key={`${card.id}:${line}`} className="text-sm leading-relaxed text-text2">
                          {line}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
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

function ProfileCard({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-xl border border-stroke bg-surface-0 p-4">
      <div className="text-[11px] uppercase tracking-[0.08em] text-text3">{label}</div>
      <div className="mt-2 text-lg font-semibold text-text1">{value || 'TBD'}</div>
    </div>
  );
}

function CapacityCard({
  label,
  value,
  detail
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="rounded-xl border border-stroke bg-surface-0 p-4">
      <div className="text-[11px] uppercase tracking-[0.08em] text-text3">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-text1">{value}</div>
      <p className="mt-2 text-sm leading-relaxed text-text2">{detail}</p>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
      <div className="text-[11px] uppercase tracking-[0.08em] text-text3">{label}</div>
      <div className="mt-2 text-sm font-semibold text-text1">{value}</div>
    </div>
  );
}

function RecoveryCard({
  title,
  value,
  detail
}: {
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="rounded-xl border border-stroke bg-surface-0 p-4">
      <div className="text-[11px] uppercase tracking-[0.08em] text-text3">{title}</div>
      <div className="mt-2 text-lg font-semibold text-text1">{value}</div>
      <p className="mt-2 text-sm leading-relaxed text-text2">{detail}</p>
    </article>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-full border border-stroke bg-[rgba(255,255,255,0.02)] px-4 py-2">
      <div className="text-[10px] uppercase tracking-[0.08em] text-text3">{label}</div>
      <div className="mt-1 text-sm font-semibold text-text1">{value}</div>
    </div>
  );
}

import clsx from 'clsx';
import Image from 'next/image';
import type { OverviewTabData } from '@tminuszero/launch-detail-ui';

type OverviewTabProps = {
  data: OverviewTabData;
  className?: string;
};

export function OverviewTab({ data, className }: OverviewTabProps) {
  return (
    <div className={clsx('space-y-8', className)}>
      {/* Mission Brief */}
      {(data.missionBrief.name || data.missionBrief.description) && (
        <Section title="Mission Brief">
          {data.missionBrief.name && (
            <h3 className="text-2xl font-bold text-text1 mb-3">
              {data.missionBrief.name}
            </h3>
          )}
          {data.missionBrief.description && (
            <p className="text-base text-text2 leading-relaxed">
              {data.missionBrief.description}
            </p>
          )}
        </Section>
      )}

      {/* Quick Stats Grid */}
      {data.quickStats.length > 0 && (
        <Section title="Quick Facts">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {data.quickStats.map((stat, idx) => (
              <StatCard
                key={idx}
                icon={stat.icon}
                label={stat.label}
                value={String(stat.value)}
              />
            ))}
          </div>
        </Section>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Rocket Profile */}
        {data.rocketProfile.name && (
          <Section title="Vehicle Profile">
            {data.rocketProfile.image && (
              <div className="relative w-full h-64 rounded-xl overflow-hidden mb-6 bg-surface-1">
                <Image
                  src={data.rocketProfile.image}
                  alt={data.rocketProfile.name}
                  fill
                  className="object-cover"
                />
              </div>
            )}

            <h3 className="text-xl font-bold text-text1 mb-2">
              {data.rocketProfile.name}
            </h3>

            {data.rocketProfile.manufacturer && (
              <p className="text-sm text-primary font-semibold mb-6">
                {data.rocketProfile.manufacturer}
              </p>
            )}

            <div className="space-y-2">
              {data.rocketProfile.variant && (
                <InfoRow label="Variant" value={data.rocketProfile.variant} />
              )}
              {data.rocketProfile.specs.reusable !== null && (
                <InfoRow
                  label="Reusable"
                  value={data.rocketProfile.specs.reusable ? 'Yes' : 'No'}
                />
              )}
              {data.rocketProfile.specs.length && (
                <InfoRow
                  label="Length"
                  value={`${data.rocketProfile.specs.length}m`}
                />
              )}
              {data.rocketProfile.specs.diameter && (
                <InfoRow
                  label="Diameter"
                  value={`${data.rocketProfile.specs.diameter}m`}
                />
              )}
              {data.rocketProfile.specs.maidenFlight && (
                <InfoRow
                  label="Maiden Flight"
                  value={data.rocketProfile.specs.maidenFlight}
                />
              )}
            </div>
          </Section>
        )}

        {/* Launch Info */}
        <Section title="Launch Information">
          <div className="space-y-3">
            {data.launchInfo.provider && (
              <InfoRow label="Provider" value={data.launchInfo.provider} />
            )}
            {data.launchInfo.vehicle && (
              <InfoRow label="Vehicle" value={data.launchInfo.vehicle} />
            )}
            {data.launchInfo.pad && (
              <InfoRow label="Pad" value={data.launchInfo.pad} />
            )}
            {data.launchInfo.location && (
              <InfoRow label="Location" value={data.launchInfo.location} />
            )}
            {data.launchInfo.windowStart && (
              <InfoRow label="Window Start" value={data.launchInfo.windowStart} />
            )}
            {data.launchInfo.windowEnd && (
              <InfoRow label="Window End" value={data.launchInfo.windowEnd} />
            )}
            {data.launchInfo.orbit && (
              <InfoRow label="Target Orbit" value={data.launchInfo.orbit} />
            )}
          </div>

          {data.launchInfo.programs.length > 0 && (
            <div className="mt-6">
              <p className="text-sm font-semibold text-text2 mb-3">Programs</p>
              <div className="flex flex-wrap gap-2">
                {data.launchInfo.programs.map((program) => (
                  <span
                    key={program.id}
                    className="px-3 py-1.5 text-xs font-semibold rounded-full border border-primary/30 bg-primary/10 text-primary"
                  >
                    {program.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Section>
      </div>

      {/* Weather Summary */}
      {data.weather.summary && (
        <Section title="Weather">
          <p className="text-base text-text2 leading-relaxed mb-4">
            {data.weather.summary}
          </p>
          {data.weather.concerns.length > 0 && (
            <div className="space-y-2">
              {data.weather.concerns.map((concern, idx) => (
                <div
                  key={idx}
                  className="p-4 rounded-lg bg-yellow-500/10 border-l-4 border-yellow-500"
                >
                  <p className="text-sm font-semibold text-yellow-400">
                    ⚠️ {concern}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

// Helper Components

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-stroke bg-surface-1 p-6">
      <h2 className="text-base font-bold uppercase tracking-wider text-text1 mb-6">
        {title}
      </h2>
      {children}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon?: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-stroke bg-surface-0 p-4 text-center">
      {icon && <div className="text-2xl mb-2">{icon}</div>}
      <p className="text-xs text-text2 font-medium mb-1">{label}</p>
      <p className="text-lg font-bold text-text1">{value}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-3 border-b border-stroke/50 last:border-0">
      <span className="text-sm text-text2">{label}</span>
      <span className="text-sm font-semibold text-text1">{value}</span>
    </div>
  );
}

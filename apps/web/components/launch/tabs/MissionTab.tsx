import clsx from 'clsx';
import type {
  LaunchInventoryObjectSummary,
  LaunchPayloadSummary,
  MissionTabData
} from '@tminuszero/launch-detail-ui';

type MissionTabProps = {
  data: MissionTabData;
  className?: string;
};

export function MissionTab({ data, className }: MissionTabProps) {
  const hasInventory = Boolean(
    data.objectInventory &&
      (data.objectInventory.summaryBadges.length > 0 ||
        data.objectInventory.payloadObjects.length > 0 ||
        data.objectInventory.nonPayloadObjects.length > 0)
  );
  const hasContent =
    Boolean(data.missionOverview.description) ||
    Boolean(data.missionOverview.customer) ||
    data.payloadManifest.length > 0 ||
    data.crew.length > 0 ||
    data.programs.length > 0 ||
    Boolean(data.blueOriginDetails) ||
    hasInventory;

  if (!hasContent) {
    return (
      <Section className={className} title="Mission Details">
        <EmptyState message="Mission details not yet available" />
      </Section>
    );
  }

  return (
    <div className={clsx('space-y-8', className)}>
      {(data.missionOverview.description || data.missionOverview.customer) && (
        <Section title="Mission Overview">
          {data.missionOverview.customer && (
            <div className="mb-4">
              <div className="text-xs uppercase tracking-[0.08em] text-text3">Customer</div>
              <div className="mt-1 text-base font-semibold text-primary">{data.missionOverview.customer}</div>
            </div>
          )}
          {data.missionOverview.description && (
            <p className="text-base leading-relaxed text-text2">{data.missionOverview.description}</p>
          )}
        </Section>
      )}

      {data.payloadManifest.length > 0 && (
        <Section title={`Payload Manifest (${data.payloadManifest.length})`}>
          <div className="space-y-4">
            {data.payloadManifest.map((payload) => (
              <PayloadCard key={payload.id} payload={payload} />
            ))}
          </div>
        </Section>
      )}

      {data.objectInventory && hasInventory && (
        <>
          <Section title="Launch Object Inventory">
            <div className="grid gap-4 sm:grid-cols-3">
              {data.objectInventory.totalObjectCount > 0 && (
                <StatCard label="Tracked Objects" value={String(data.objectInventory.totalObjectCount)} highlight />
              )}
              {data.objectInventory.payloadObjectCount > 0 && (
                <StatCard label="Payload Objects" value={String(data.objectInventory.payloadObjectCount)} />
              )}
              {data.objectInventory.nonPayloadObjectCount > 0 && (
                <StatCard label="Other Objects" value={String(data.objectInventory.nonPayloadObjectCount)} />
              )}
            </div>

            {data.objectInventory.summaryBadges.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-2">
                {data.objectInventory.summaryBadges.map((badge) => (
                  <Badge key={badge} label={badge} />
                ))}
              </div>
            )}
          </Section>

          {data.objectInventory.payloadObjects.length > 0 && (
            <Section title={`Tracked Payload Objects (${data.objectInventory.payloadObjects.length})`}>
              <ObjectInventoryGrid items={data.objectInventory.payloadObjects} />
            </Section>
          )}

          {data.objectInventory.nonPayloadObjects.length > 0 && (
            <Section title={`Other Tracked Objects (${data.objectInventory.nonPayloadObjects.length})`}>
              <ObjectInventoryGrid items={data.objectInventory.nonPayloadObjects} />
            </Section>
          )}
        </>
      )}

      {data.crew.length > 0 && (
        <Section title={`Crew (${data.crew.length})`}>
          <div className="grid gap-4 md:grid-cols-2">
            {data.crew.map((member, idx) => (
              <div key={`${member.name}:${idx}`} className="rounded-xl border border-stroke bg-surface-0 p-4">
                <div className="text-base font-semibold text-text1">{member.name}</div>
                <div className="mt-1 text-sm font-medium text-primary">{member.role}</div>
                <div className="mt-2 text-sm text-text2">{member.nationality}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {data.blueOriginDetails && (
        <Section title="Blue Origin Details">
          <div className="space-y-4">
            {data.blueOriginDetails.travelers.length > 0 && (
              <div>
                <div className="text-sm font-semibold text-text1">
                  Travelers ({data.blueOriginDetails.travelers.length})
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {data.blueOriginDetails.travelers.map((traveler, idx) => (
                    <Badge key={`${traveler.name}:${idx}`} label={traveler.name} />
                  ))}
                </div>
              </div>
            )}

            {data.blueOriginDetails.payloadNotes && (
              <div>
                <div className="text-sm font-semibold text-text1">Payload Notes</div>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-text2">
                  {data.blueOriginDetails.payloadNotes}
                </p>
              </div>
            )}
          </div>
        </Section>
      )}

      {data.programs.length > 0 && (
        <Section title="Programs">
          <div className="grid gap-4 md:grid-cols-2">
            {data.programs.map((program) => (
              <div key={program.id} className="rounded-xl border border-stroke bg-surface-0 p-4">
                <div className="text-base font-semibold text-text1">{program.name}</div>
                {program.description && <p className="mt-2 text-sm leading-relaxed text-text2">{program.description}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function PayloadCard({ payload }: { payload: LaunchPayloadSummary }) {
  const secondaryOperator =
    payload.manufacturer && payload.manufacturer !== payload.operator ? payload.manufacturer : null;

  return (
    <article className="rounded-xl border border-stroke bg-surface-0 p-4">
      <div className="text-lg font-semibold text-text1">{payload.name}</div>
      {payload.subtitle && <div className="mt-1 text-sm font-medium text-primary">{payload.subtitle}</div>}

      <div className="mt-4 space-y-2">
        {payload.destination && <InfoRow label="Destination" value={payload.destination} />}
        {payload.deploymentStatus && <InfoRow label="Deployment" value={formatDeploymentStatus(payload.deploymentStatus)} />}
        {payload.operator && <InfoRow label="Operator" value={payload.operator} />}
        {secondaryOperator && <InfoRow label="Manufacturer" value={secondaryOperator} />}
      </div>

      {payload.description && <p className="mt-4 text-sm leading-relaxed text-text2">{payload.description}</p>}
      {payload.landingSummary && <p className="mt-3 text-sm text-text2">{payload.landingSummary}</p>}
      {payload.dockingSummary && <p className="mt-1 text-sm text-text2">{payload.dockingSummary}</p>}

      {(payload.infoUrl || payload.wikiUrl) && (
        <div className="mt-4 flex flex-wrap gap-3 text-sm font-medium">
          {payload.infoUrl && (
            <a className="text-primary hover:underline" href={payload.infoUrl} target="_blank" rel="noreferrer">
              Mission info
            </a>
          )}
          {payload.wikiUrl && (
            <a className="text-text2 hover:text-text1 hover:underline" href={payload.wikiUrl} target="_blank" rel="noreferrer">
              Reference
            </a>
          )}
        </div>
      )}
    </article>
  );
}

function ObjectInventoryGrid({ items }: { items: LaunchInventoryObjectSummary[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {items.map((item) => (
        <article key={item.id} className="rounded-xl border border-stroke bg-surface-0 p-4">
          <div className="text-base font-semibold text-text1">{item.title}</div>
          {item.subtitle && <div className="mt-1 text-sm text-text2">{item.subtitle}</div>}
          {item.lines.length > 0 && (
            <div className="mt-3 space-y-1">
              {item.lines.map((line) => (
                <div key={`${item.id}:${line}`} className="text-sm text-text2">
                  {line}
                </div>
              ))}
            </div>
          )}
        </article>
      ))}
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
    <div className={clsx('rounded-2xl border border-stroke bg-surface-1 p-6', className)}>
      <h2 className="mb-6 text-base font-bold uppercase tracking-wider text-text1">{title}</h2>
      {children}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-12 text-center">
      <p className="text-sm text-text2">{message}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-stroke/50 py-3 last:border-0">
      <span className="text-sm text-text2">{label}</span>
      <span className="text-right text-sm font-semibold text-text1">{value}</span>
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight = false
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-xl border border-stroke bg-surface-0 p-4">
      <div className="text-xs uppercase tracking-[0.08em] text-text3">{label}</div>
      <div className={clsx('mt-2 text-2xl font-semibold text-text1', highlight && 'text-primary')}>{value}</div>
    </div>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-stroke bg-surface-0 px-3 py-1.5 text-xs font-semibold text-text1">
      {label}
    </span>
  );
}

function formatDeploymentStatus(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'confirmed') return 'Confirmed';
  if (normalized === 'unconfirmed') return 'Unconfirmed';
  if (normalized === 'unknown') return 'Unknown';
  return value;
}

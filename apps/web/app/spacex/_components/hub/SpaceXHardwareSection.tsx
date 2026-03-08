import Link from 'next/link';
import type { SpaceXEngine, SpaceXVehicle } from '@/lib/types/spacexProgram';

export function SpaceXHardwareSection({
  vehicles,
  engines
}: {
  vehicles: SpaceXVehicle[];
  engines: SpaceXEngine[];
}) {
  return (
    <section id="hardware" className="scroll-mt-24">
      <section className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xl font-semibold text-text1">Vehicles</h2>
            <Link
              href="/spacex/vehicles"
              className="text-xs uppercase tracking-[0.1em] text-primary hover:text-primary/80"
            >
              Open catalog
            </Link>
          </div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {vehicles.map((vehicle) => (
              <li key={vehicle.id} className="rounded-lg border border-stroke bg-surface-0 px-3 py-2">
                <Link
                  href={`/spacex/vehicles/${vehicle.vehicleSlug}`}
                  className="text-sm font-semibold text-text1 hover:text-primary"
                >
                  {vehicle.displayName}
                </Link>
                <p className="mt-1 text-xs text-text3">{vehicle.status || 'Status TBD'}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xl font-semibold text-text1">Engines</h2>
            <Link
              href="/spacex/engines"
              className="text-xs uppercase tracking-[0.1em] text-primary hover:text-primary/80"
            >
              Open catalog
            </Link>
          </div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {engines.map((engine) => (
              <li key={engine.id} className="rounded-lg border border-stroke bg-surface-0 px-3 py-2">
                <Link
                  href={`/spacex/engines/${engine.engineSlug}`}
                  className="text-sm font-semibold text-text1 hover:text-primary"
                >
                  {engine.displayName}
                </Link>
                <p className="mt-1 text-xs text-text3">{engine.status || 'Status TBD'}</p>
              </li>
            ))}
          </ul>
        </section>
      </section>
    </section>
  );
}

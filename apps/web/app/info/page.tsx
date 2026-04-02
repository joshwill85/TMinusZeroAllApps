import type { Metadata } from 'next';
import { BRAND_NAME } from '@/lib/brand';
import { fetchSpaceXDroneShipCoverageSummary } from '@/lib/server/spacexDroneShips';
import { CommandDeckTile } from './CommandDeckTile';

export const metadata: Metadata = {
  title: `Info | ${BRAND_NAME}`,
  description: `Browse agencies, astronauts, vehicles, stations, pads, and more sourced from Launch Library 2.`,
  alternates: { canonical: '/info' }
};

export const revalidate = 60 * 10;

export default async function InfoPage() {
  const droneShipCoverage = await fetchSpaceXDroneShipCoverageSummary();

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 md:px-8">
      <header className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-text3">Info</p>
          <h1 className="text-3xl font-semibold text-text1">The Command Deck</h1>
        </div>
        <p className="max-w-3xl text-sm text-text2">
          A mission-control style dashboard for Launch Library 2 reference data—hardware, players, places, and deep telemetry.
        </p>
      </header>

      <section className="mt-8 space-y-10">
        <DeckSector
          indexLabel="Sector 01"
          title="The Hardware"
          subtitle="The machinery of spaceflight—start with the biggest systems."
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-6 md:auto-rows-[190px] xl:grid-cols-12 xl:auto-rows-[220px]">
            <CommandDeckTile
              type="launcher_configurations"
              size="hero"
              className="md:col-span-3 md:row-span-1 xl:col-span-4 xl:row-span-1"
            />
            <CommandDeckTile
              type="spacecraft_configurations"
              size="tall"
              className="md:col-span-3 md:row-span-1 xl:col-span-2 xl:row-span-1"
            />
            <CommandDeckTile type="starship" size="standard" className="md:col-span-2 xl:col-span-2" />
            <CommandDeckTile
              type="spacex_drone_ships"
              size="standard"
              className="md:col-span-2 xl:col-span-2"
              metaOverride={{
                kind: 'stat',
                tone: 'secondary',
                value: `${droneShipCoverage.coveragePercent.toFixed(1)}%`,
                label: 'Coverage'
              }}
            />
            <CommandDeckTile type="catalog" size="standard" className="md:col-span-2 xl:col-span-2" />
          </div>
        </DeckSector>

        <DeckSector
          indexLabel="Sector 02"
          title="The Players & Places"
          subtitle="Who flies, who builds, and where the missions actually happen."
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:auto-rows-[190px]">
            <CommandDeckTile type="agencies" size="medium" />
            <CommandDeckTile type="astronauts" size="medium" />
            <CommandDeckTile type="locations" size="medium" />
          </div>
        </DeckSector>

        <DeckSector
          indexLabel="Sector 03"
          title="The Deep Data"
          subtitle="The technical tiles for power users—status-style, fast to scan."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <CommandDeckTile type="pads" size="system" />
            <CommandDeckTile type="launchers" size="system" />
            <CommandDeckTile type="space_stations" size="system" />
            <CommandDeckTile type="expeditions" size="system" />
            <CommandDeckTile type="docking_events" size="system" />
            <CommandDeckTile type="events" size="system" />
          </div>
        </DeckSector>

        <DeckSector
          indexLabel="Sector 04"
          title="Guides & Resources"
          subtitle="Visual phenomena, viewing tips, and planning tools."
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:auto-rows-[170px]">
            <CommandDeckTile type="jellyfish_effect" size="standard" />
          </div>
        </DeckSector>
      </section>

      <p className="mt-8 text-xs text-text4">Data provided by The Space Devs - Launch Library 2.</p>
    </div>
  );
}

function DeckSector({
  indexLabel,
  title,
  subtitle,
  children
}: {
  indexLabel: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <div className="text-[10px] uppercase tracking-[0.28em] text-text4">{indexLabel}</div>
          <div className="h-px flex-1 bg-stroke" />
          <h2 className="text-[10px] uppercase tracking-[0.28em] text-text4">{title}</h2>
        </div>
        <p className="text-xs text-text3">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

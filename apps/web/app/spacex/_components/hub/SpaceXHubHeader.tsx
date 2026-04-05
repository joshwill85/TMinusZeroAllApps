import Image from 'next/image';
import { ProgramHubHero } from '@/components/program-hubs/ProgramHubHero';

export function SpaceXHubHeader({
  lastUpdated,
  flightsCount,
  vehiclesCount,
  enginesCount,
  passengersCount,
  payloadsCount,
  contractsCount,
  droneShipCoveragePercent,
  usaspendingRows
}: {
  lastUpdated: string;
  flightsCount: number;
  vehiclesCount: number;
  enginesCount: number;
  passengersCount: number;
  payloadsCount: number;
  contractsCount: number;
  droneShipCoveragePercent: number;
  usaspendingRows: number;
}) {
  return (
    <ProgramHubHero
      theme="spacex"
      eyebrow="Program Hub"
      title="SpaceX"
      description="Mission, flight, recovery, and contract coverage across Starship, Falcon, and Dragon with source-linked pages that feel like a real mission-control surface on web."
      logo={
        <Image
          src="/assets/program-logos/spacex-official.png"
          alt="SpaceX official logo"
          width={176}
          height={56}
          className="h-auto w-auto max-w-[8.75rem] object-contain sm:max-w-[10rem]"
        />
      }
      badges={[
        { label: 'Web mission control', tone: 'accent' },
        { label: `Updated ${lastUpdated}` }
      ]}
      metrics={[
        {
          label: 'Flights tracked',
          value: flightsCount.toLocaleString(),
          detail: 'Upcoming and recent launch coverage in one index.'
        },
        {
          label: 'Hardware',
          value: `${(vehiclesCount + enginesCount).toLocaleString()}`,
          detail: `${vehiclesCount} vehicles and ${enginesCount} engines.`
        },
        {
          label: 'Crew + payloads',
          value: `${(passengersCount + payloadsCount).toLocaleString()}`,
          detail: `${passengersCount} passenger records and ${payloadsCount} payload records.`
        },
        {
          label: 'Contracts',
          value: contractsCount.toLocaleString(),
          detail: `${usaspendingRows.toLocaleString()} related USAspending rows and ${droneShipCoveragePercent.toFixed(1)}% drone-ship coverage.`
        }
      ]}
      routes={[
        {
          href: '/spacex/missions',
          label: 'Mission hubs',
          description: 'Starship, Falcon 9, Falcon Heavy, and Dragon mission workbenches.',
          eyebrow: 'Primary routes'
        },
        {
          href: '/spacex/flights',
          label: 'Flight index',
          description: 'Tracked flights with launch context, recovery links, and mission cadence.',
          eyebrow: 'Operations'
        },
        {
          href: '/spacex/drone-ships',
          label: 'Recovery fleet',
          description: 'Drone-ship assets, assignments, and recovery-specific detail pages.',
          eyebrow: 'Recovery'
        },
        {
          href: '/spacex/contracts',
          label: 'Contracts',
          description: 'Government awards, in-house contract pages, and unmatched source records.',
          eyebrow: 'Records'
        }
      ]}
      secondaryLinks={[
        { href: '/starship', label: 'Starship' },
        { href: '/spacex/vehicles', label: 'Vehicles' },
        { href: '/spacex/engines', label: 'Engines' }
      ]}
      footnote={
        <span>
          Recovery coverage currently spans <span className="font-semibold text-text1">{droneShipCoveragePercent.toFixed(1)}%</span> of tracked flights, so the hub can move smoothly between launch, mission, and ship-level context.
        </span>
      }
    />
  );
}

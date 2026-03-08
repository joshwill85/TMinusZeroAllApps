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
    <header className="space-y-4">
      <p className="text-xs uppercase tracking-[0.14em] text-text3">Program Dashboard</p>
      <h1 className="text-3xl font-semibold text-text1">SpaceX Program</h1>
      <p className="max-w-4xl text-sm text-text2">
        SpaceX systems dashboard for Starship, Falcon, and Dragon with mission pages, structured flight records, contract intelligence, and investor-oriented proxy signals.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
        <span className="rounded-full border border-stroke px-3 py-1">Last updated: {lastUpdated}</span>
        <span className="rounded-full border border-stroke px-3 py-1">Flights tracked: {flightsCount}</span>
        <span className="rounded-full border border-stroke px-3 py-1">Vehicles: {vehiclesCount}</span>
        <span className="rounded-full border border-stroke px-3 py-1">Engines: {enginesCount}</span>
        <span className="rounded-full border border-stroke px-3 py-1">Passengers: {passengersCount}</span>
        <span className="rounded-full border border-stroke px-3 py-1">Payloads: {payloadsCount}</span>
        <span className="rounded-full border border-stroke px-3 py-1">Contracts: {contractsCount}</span>
        <span className="rounded-full border border-stroke px-3 py-1">
          Drone-ship coverage: {droneShipCoveragePercent.toFixed(1)}%
        </span>
        <span className="rounded-full border border-stroke px-3 py-1">USASpending rows: {usaspendingRows}</span>
      </div>
    </header>
  );
}

import { fetchBlueOriginPassengersDatabaseOnly } from '@/lib/server/blueOriginPeoplePayloads';

type FlightStats = {
  count: number;
  image: number;
  profile: number;
  rows: Array<{ name: string; image: boolean; profile: boolean; source: string | null }>;
};

async function main() {
  const payload = await fetchBlueOriginPassengersDatabaseOnly('all');
  const byFlight = new Map<string, FlightStats>();

  for (const row of payload.items) {
    const code = (row.flightCode || '').trim().toLowerCase();
    if (!/^ns-\d{1,3}$/.test(code)) continue;

    const stats = byFlight.get(code) || { count: 0, image: 0, profile: 0, rows: [] };
    stats.count += 1;
    if (row.imageUrl) stats.image += 1;
    if (row.profileUrl) stats.profile += 1;
    stats.rows.push({
      name: row.name,
      image: Boolean(row.imageUrl),
      profile: Boolean(row.profileUrl),
      source: row.source || null
    });
    byFlight.set(code, stats);
  }

  const flights = [...byFlight.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' })
  );

  const summary = flights.map(([flightCode, stats]) => ({
    flightCode,
    travelers: stats.count,
    withImage: stats.image,
    withProfile: stats.profile,
    missingImage: Math.max(0, stats.count - stats.image),
    missingProfile: Math.max(0, stats.count - stats.profile)
  }));

  const missingImageFlights = summary.filter((row) => row.travelers > 0 && row.withImage < row.travelers);
  const missingProfileFlights = summary.filter((row) => row.travelers > 0 && row.withProfile < row.travelers);

  console.log(JSON.stringify({
    generatedAt: payload.generatedAt,
    flightsScanned: summary.length,
    missingImageFlights: missingImageFlights.length,
    missingProfileFlights: missingProfileFlights.length,
    summary,
    samples: {
      firstMissingImage: missingImageFlights[0]
        ? {
            flightCode: missingImageFlights[0].flightCode,
            rows: byFlight.get(missingImageFlights[0].flightCode)?.rows.slice(0, 10) || []
          }
        : null,
      firstMissingProfile: missingProfileFlights[0]
        ? {
            flightCode: missingProfileFlights[0].flightCode,
            rows: byFlight.get(missingProfileFlights[0].flightCode)?.rows.slice(0, 10) || []
          }
        : null
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

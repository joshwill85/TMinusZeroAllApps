import { fetchBlueOriginPassengersDatabaseOnly } from '@/lib/server/blueOriginPeoplePayloads';

async function main() {
  const target = (process.argv[2] || '').trim().toLowerCase();
  if (!target) throw new Error('usage: ts-node tmp/inspect-flight-passengers.ts ns-37');

  const payload = await fetchBlueOriginPassengersDatabaseOnly('all');
  const rows = payload.items
    .filter((row) => (row.flightCode || '').toLowerCase() === target)
    .map((row) => ({
      name: row.name,
      role: row.role,
      source: row.source,
      confidence: row.confidence,
      profileUrl: row.profileUrl,
      imageUrl: row.imageUrl,
      travelerSlug: row.travelerSlug
    }));

  console.log(JSON.stringify({
    flightCode: target,
    count: rows.length,
    withImage: rows.filter((r) => Boolean(r.imageUrl)).length,
    withProfile: rows.filter((r) => Boolean(r.profileUrl)).length,
    rows
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

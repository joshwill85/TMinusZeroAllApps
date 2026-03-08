import { fetchBlueOriginPassengersDatabaseOnly } from '@/lib/server/blueOriginPeoplePayloads';

async function main() {
  const payload = await fetchBlueOriginPassengersDatabaseOnly('all');
  const rows = payload.items.filter((row) => (row.flightCode || '').toLowerCase() === 'ns-7');
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

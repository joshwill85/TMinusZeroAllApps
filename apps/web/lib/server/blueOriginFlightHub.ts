import { cache } from 'react';
import { fetchBlueOriginContracts } from '@/lib/server/blueOriginContracts';
import { fetchBlueOriginFlightSnapshotBySlug } from '@/lib/server/blueOrigin';
import { fetchBlueOriginPassengers, fetchBlueOriginPayloads } from '@/lib/server/blueOriginPeoplePayloads';

export const fetchBlueOriginFlightHubData = cache(async (flightSlug: string) => {
  const snapshot = await fetchBlueOriginFlightSnapshotBySlug(flightSlug);
  if (!snapshot) return null;

  const [passengers, payloads, contracts] = await Promise.all([
    fetchBlueOriginPassengers(snapshot.missionKey),
    fetchBlueOriginPayloads(snapshot.missionKey),
    fetchBlueOriginContracts(snapshot.missionKey)
  ]);

  const flightPassengers = passengers.items.filter((entry) => entry.flightSlug === snapshot.flightSlug || entry.flightCode === snapshot.flightCode);
  const flightPayloads = payloads.items.filter((entry) => entry.flightSlug === snapshot.flightSlug || entry.flightCode === snapshot.flightCode);

  return {
    snapshot,
    passengers: flightPassengers,
    payloads: flightPayloads,
    contracts: contracts.items
  };
});

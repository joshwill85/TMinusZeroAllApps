import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildManifestSeats,
  getCircularIndex,
  resolveMediaPreview,
  sortByDateAsc,
  sortByDateDesc
} from '@/lib/utils/blueOriginDossier';

const manifest = buildManifestSeats(
  [
    { id: 'p2', name: 'Beta', role: 'Passenger', seatIndex: 2, confidence: 'medium' },
    { id: 'p1', name: 'Alpha', role: 'Passenger', seatIndex: 1, confidence: 'high' },
    { id: 'p3', name: 'Gamma', role: 'Mission Specialist', confidence: 'low' }
  ],
  [{ id: 'payload-1', name: 'Lunar Sensor', payloadType: 'Science' }],
  4
);

assert.equal(manifest.hasExplicitSeatAssignments, true);
assert.equal(manifest.seats[0]?.traveler?.name, 'Alpha');
assert.equal(manifest.seats[1]?.traveler?.name, 'Beta');
assert.equal(manifest.seats[2]?.traveler?.name, 'Gamma');
assert.equal(manifest.seats[3]?.payload?.name, 'Lunar Sensor');

const rosterOnly = buildManifestSeats(
  [
    { id: 'z', name: 'Zulu', role: 'Passenger' },
    { id: 'a', name: 'Alpha', role: 'Passenger' }
  ],
  [],
  2
);
assert.equal(rosterOnly.hasExplicitSeatAssignments, false);
assert.equal(rosterOnly.seats[0]?.traveler?.name, 'Alpha');
assert.equal(rosterOnly.seats[1]?.traveler?.name, 'Zulu');

const sortedEntries = sortByDateDesc(
  [
    { id: 'missing', postedDate: '' },
    { id: 'old', postedDate: '2024-01-10T00:00:00Z' },
    { id: 'new', postedDate: '2025-01-10T00:00:00Z' }
  ],
  (entry) => entry.postedDate,
  (entry) => entry.id
);
assert.deepEqual(
  sortedEntries.map((entry) => entry.id),
  ['new', 'old', 'missing']
);

const manifestsAsc = sortByDateAsc(
  [
    { id: 'b', net: '2025-06-01T00:00:00Z' },
    { id: 'a', net: '2024-06-01T00:00:00Z' },
    { id: 'c', net: '' }
  ],
  (entry) => entry.net,
  (entry) => entry.id
);
assert.deepEqual(manifestsAsc.map((entry) => entry.id), ['a', 'b', 'c']);
assert.equal(getCircularIndex(0, -1, 5), 4);
assert.equal(getCircularIndex(4, 1, 5), 0);
assert.equal(getCircularIndex(2, 3, 5), 0);

const videoWithoutThumbnail = resolveMediaPreview({
  type: 'video',
  url: 'https://www.youtube.com/watch?v=abc123'
});
assert.equal(videoWithoutThumbnail.kind, 'video-placeholder');

const videoWithThumbnail = resolveMediaPreview({
  type: 'video',
  url: 'https://www.youtube.com/watch?v=abc123',
  thumbnailUrl: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg'
});
assert.equal(videoWithThumbnail.kind, 'image');

const imageWithFormatHint = resolveMediaPreview({
  type: 'image',
  url: 'https://pbs.twimg.com/media/HBdLs-aW8AAmuxj?format=jpg'
});
assert.equal(imageWithFormatHint.kind, 'image');

const repoRoot = path.resolve(__dirname, '..');
const webRoot = path.join(repoRoot, 'apps/web');
const manifestPath = path.join(webRoot, 'app/blue-origin/_components/BlueOriginManifestCapsule.tsx');
const mediaPath = path.join(webRoot, 'app/blue-origin/_components/BlueOriginMediaArchive.tsx');
const procurementPath = path.join(webRoot, 'app/blue-origin/_components/BlueOriginProcurementLedger.tsx');
const pagePath = path.join(webRoot, 'app/blue-origin/page.tsx');

const manifestSource = fs.readFileSync(manifestPath, 'utf8');
const mediaSource = fs.readFileSync(mediaPath, 'utf8');
const procurementSource = fs.readFileSync(procurementPath, 'utf8');
const pageSource = fs.readFileSync(pagePath, 'utf8');

assert(!manifestSource.includes('group-hover:block'), 'Manifest capsule must not rely on hover-only tooltips.');
assert(manifestSource.includes('aria-pressed'), 'Manifest seat controls should expose selected state for accessibility.');
assert(!manifestSource.includes('Status / Role'), 'Manifest roster must not render Status/Role column.');
assert(!manifestSource.includes('Position</span>'), 'Manifest roster must not render Position column.');
assert(!mediaSource.includes('group-hover:opacity-100'), 'Media metadata should remain visible on touch devices.');
assert(!procurementSource.includes("href={entry.url || '#'}"), 'Procurement entries must not render empty # links.');
assert(pageSource.includes('BlueOriginManifestCarousel'), 'Manifest section should render the carousel component.');

// eslint-disable-next-line no-console
console.log('blue-origin-dossier-smoke: ok');

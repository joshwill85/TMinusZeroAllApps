import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '..');
const webRoot = path.join(repoRoot, 'apps/web');

const pagePath = path.join(webRoot, 'app/spacex/page.tsx');
const jumpRailPath = path.join(webRoot, 'app/spacex/_components/SpaceXJumpRail.tsx');
const missionPath = path.join(webRoot, 'app/spacex/_components/hub/SpaceXMissionSection.tsx');
const recoveryPath = path.join(webRoot, 'app/spacex/_components/hub/SpaceXRecoverySection.tsx');
const hardwarePath = path.join(webRoot, 'app/spacex/_components/hub/SpaceXHardwareSection.tsx');
const mediaPath = path.join(webRoot, 'app/spacex/_components/hub/SpaceXMediaSection.tsx');
const flightsPath = path.join(webRoot, 'app/spacex/_components/hub/SpaceXFlightsSection.tsx');
const contractsPath = path.join(webRoot, 'app/spacex/_components/hub/SpaceXContractsSection.tsx');
const financePath = path.join(webRoot, 'app/spacex/_components/hub/SpaceXFinanceSection.tsx');
const faqPath = path.join(webRoot, 'app/spacex/_components/hub/SpaceXFaqSection.tsx');

const pageSource = fs.readFileSync(pagePath, 'utf8');
const jumpRailSource = fs.readFileSync(jumpRailPath, 'utf8');

assert(pageSource.includes('SpaceXJumpRail counts={navCounts} variant="desktop"'), 'Desktop jump rail should render on /spacex.');
assert(pageSource.includes('SpaceXJumpRail counts={navCounts} variant="mobile"'), 'Mobile jump rail should render on /spacex.');
assert(pageSource.includes('SpaceXUsaspendingAwardsPanel'), 'SpaceX USASpending panel should remain on /spacex.');

for (const label of ['01 MISSION', '02 RECOVERY', '03 HARDWARE', '04 MEDIA', '05 FLIGHTS', '06 CONTRACTS', '07 FINANCE', '08 FAQ']) {
  assert(jumpRailSource.includes(label), `SpaceX jump rail should include ${label}.`);
}

for (const [filePath, sectionId] of [
  [missionPath, 'mission'],
  [recoveryPath, 'recovery'],
  [hardwarePath, 'hardware'],
  [mediaPath, 'media'],
  [flightsPath, 'flights'],
  [contractsPath, 'contracts'],
  [financePath, 'finance'],
  [faqPath, 'faq']
] as const) {
  const source = fs.readFileSync(filePath, 'utf8');
  assert(
    source.includes(`id="${sectionId}"`) || source.includes(`id='${sectionId}'`),
    `${path.relative(webRoot, filePath)} should expose id=\"${sectionId}\" for jump navigation.`
  );
}

for (const filePath of [
  pagePath,
  jumpRailPath,
  missionPath,
  recoveryPath,
  hardwarePath,
  mediaPath,
  flightsPath,
  contractsPath,
  financePath,
  faqPath
]) {
  const source = fs.readFileSync(filePath, 'utf8');
  assert(!source.includes("href={'#'}"), `${path.relative(webRoot, filePath)} must not include empty hash hrefs.`);
  assert(!source.includes('href="#"'), `${path.relative(webRoot, filePath)} must not include empty hash hrefs.`);
}

// eslint-disable-next-line no-console
console.log('spacex-program-hub-smoke: ok');

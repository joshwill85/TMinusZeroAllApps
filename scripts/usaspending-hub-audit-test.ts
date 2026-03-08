import {
  classifyUsaspendingAwardForScope,
  type ProgramScope,
  type ProgramUsaspendingAuditTier
} from '@/lib/usaspending/hubAudit';

type Fixture = {
  name: string;
  scope: ProgramScope;
  input: {
    awardId?: string | null;
    title?: string | null;
    recipient?: string | null;
    awardedOn?: string | null;
    metadata?: Record<string, unknown> | null;
    storyLinked?: boolean;
  };
  expected: ProgramUsaspendingAuditTier;
};

const fixtures: Fixture[] = [
  {
    name: 'Blue Origin hay contract is excluded',
    scope: 'blue-origin',
    input: {
      awardId: 'CONT_AWD_127EAY26P0013_12C2_-NONE-_-NONE-',
      title: '720 TON (1,440,000 LBS.) OF 6 STRING RECTANGLE BALES OF GRASS HAY',
      recipient: 'KENDAL ALDINE HORST',
      metadata: { keyword: 'Blue Origin' }
    },
    expected: 'excluded'
  },
  {
    name: 'Blue Moon catering is excluded',
    scope: 'blue-origin',
    input: {
      title: 'Conference catering services for Blue Moon event',
      recipient: 'BLUE MOON CATERING INC',
      metadata: { awardFamily: 'contracts' }
    },
    expected: 'excluded'
  },
  {
    name: 'Canonical Blue Origin recipient is exact',
    scope: 'blue-origin',
    input: {
      title: 'BE-4 propulsion component contract',
      recipient: 'BLUE ORIGIN, LLC',
      metadata: { awardFamily: 'contracts' }
    },
    expected: 'exact'
  },
  {
    name: 'Canonical Blue Origin grant is candidate',
    scope: 'blue-origin',
    input: {
      title: 'Blue Origin lunar research grant',
      recipient: 'BLUE ORIGIN, LLC',
      metadata: { awardFamily: 'grants' }
    },
    expected: 'candidate'
  },
  {
    name: 'Blue Origin New Shepard support contract is exact',
    scope: 'blue-origin',
    input: {
      title: 'Integration and ground processing for flight on Blue Origin New Shepard vehicle',
      recipient: 'NANORACKS, LLC',
      metadata: { awardFamily: 'contracts' }
    },
    expected: 'exact'
  },
  {
    name: 'Blue Origin Blue Moon grant stays candidate',
    scope: 'blue-origin',
    input: {
      title: 'Blue Origin Blue Moon lunar lander risk reduction study',
      recipient: 'TRANS ASTRONAUTICA CORPORATION',
      metadata: { awardFamily: 'grants' }
    },
    expected: 'candidate'
  },
  {
    name: 'Blue Origin explicit support contract is exact',
    scope: 'blue-origin',
    input: {
      title: 'Blue Origin pad safety support',
      recipient: 'AXIENT LLC',
      metadata: { awardFamily: 'contracts' }
    },
    expected: 'exact'
  },
  {
    name: 'Generic dragon vendor is excluded for SpaceX',
    scope: 'spacex',
    input: {
      title: 'Wildland support services',
      recipient: 'DRAGON ASSASSINS LLC',
      metadata: { keyword: 'Dragon' }
    },
    expected: 'excluded'
  },
  {
    name: 'SpaceX Dragon trunk support contract is exact',
    scope: 'spacex',
    input: {
      title: 'Dragon trunk acoustic test',
      recipient: 'CALIFORNIA INSTITUTE OF TECHNOLOGY',
      metadata: { awardFamily: 'contracts' }
    },
    expected: 'exact'
  },
  {
    name: 'SpaceX Falcon 9 launch support contract is exact',
    scope: 'spacex',
    input: {
      title: 'California Highway Patrol support for Falcon 9 launch',
      recipient: 'CALIFORNIA SECRETARY OF STATE',
      metadata: { awardFamily: 'contracts' }
    },
    expected: 'exact'
  },
  {
    name: 'SpaceX Starlink service contract is exact',
    scope: 'spacex',
    input: {
      title: 'Starlink hardware kit and service',
      recipient: 'KDDI CORPORATION',
      metadata: { awardFamily: 'contracts' }
    },
    expected: 'exact'
  },
  {
    name: 'SpaceX Starlink mention without service context is excluded',
    scope: 'spacex',
    input: {
      title: 'PC FIRE STATIONS STARLINK',
      recipient: 'STARLINK TECHNOLOGIES LLC',
      metadata: { awardFamily: 'contracts' }
    },
    expected: 'excluded'
  },
  {
    name: 'Unrelated Starlink product line is excluded',
    scope: 'spacex',
    input: {
      title: 'Receiver, DGPS, Starlink 210',
      recipient: 'RAVEN INDUSTRIES, INC.',
      metadata: { awardFamily: 'contracts' }
    },
    expected: 'excluded'
  },
  {
    name: 'SpaceX model reference is excluded',
    scope: 'spacex',
    input: {
      title: 'SpaceX Falcon 9 1.1 model with Dragon capsule',
      recipient: 'PROACH MODELS',
      metadata: { awardFamily: 'contracts' }
    },
    expected: 'excluded'
  },
  {
    name: 'Canonical SpaceX recipient is exact',
    scope: 'spacex',
    input: {
      title: 'Launch vehicle integration services',
      recipient: 'SPACE EXPLORATION TECHNOLOGIES CORP.',
      metadata: { awardFamily: 'contracts' }
    },
    expected: 'exact'
  },
  {
    name: 'Explicit SpaceX support contract is exact',
    scope: 'spacex',
    input: {
      title: 'Task coordination for SpaceX support at NASA Ames Research Center',
      recipient: 'VALADOR INC',
      metadata: { awardFamily: 'contracts' }
    },
    expected: 'exact'
  },
  {
    name: 'Canonical SpaceX direct payment is excluded from company hub exacts',
    scope: 'spacex',
    input: {
      title: 'Emergency provider payment',
      recipient: 'SPACE EXPLORATION TECHNOLOGIES CORP.',
      metadata: { awardFamily: 'direct_payments' }
    },
    expected: 'excluded'
  },
  {
    name: 'Artemis HLS title is exact',
    scope: 'artemis',
    input: {
      title: 'NASA Artemis Human Landing System mission support'
    },
    expected: 'exact'
  },
  {
    name: 'Artemis weak lunar support is candidate',
    scope: 'artemis',
    input: {
      title: 'Lunar cargo operations planning services'
    },
    expected: 'candidate'
  },
  {
    name: 'Artemis astronomy collision is excluded',
    scope: 'artemis',
    input: {
      title: 'Artemis ultraviolet astronomy spectrograph concept study'
    },
    expected: 'excluded'
  },
  {
    name: 'Story-linked Artemis award is exact',
    scope: 'artemis',
    input: {
      title: 'Program logistics contract',
      storyLinked: true
    },
    expected: 'exact'
  }
];

function main() {
  const failures: string[] = [];

  for (const fixture of fixtures) {
    const actual = classifyUsaspendingAwardForScope(fixture.input, fixture.scope);
    const ok = actual.tier === fixture.expected;

    if (!ok) {
      failures.push(
        `${fixture.name}: expected ${fixture.expected}, got ${actual.tier} (${actual.reasonCodes.join(', ') || 'no reasons'})`
      );
    }
  }

  if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked: fixtures.length
      },
      null,
      2
    )
  );
}

main();

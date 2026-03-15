import assert from 'node:assert/strict';
import { buildCountdownSnapshot } from '../packages/domain/src/index.ts';
import {
  getTierCapabilities,
  getTierLimits,
  getTierRefreshSeconds,
  resolveViewerTier,
  tierToMode
} from '../packages/domain/src/viewer.ts';
import {
  parseSiteSearchInput,
  parseSiteSearchTypesParam
} from '../packages/domain/src/search.ts';
import {
  buildAuthCallbackHref,
  buildAuthHref,
  buildLaunchHref,
  buildPreferencesHref,
  buildPrivacyChoicesHref,
  buildProfileHref,
  buildSavedHref,
  buildSearchHref,
  buildUpgradeHref,
  readAuthIntent,
  readReturnTo,
  resolvePushHref,
  sanitizeReturnTo
} from '../packages/navigation/src/index.ts';
import {
  applyTrajectoryMilestoneProjection,
  buildTrajectoryCompatibilityEvents,
  buildTrajectoryMilestoneTrackWindows,
  resolveTrajectoryMilestones
} from '../packages/domain/src/trajectory/milestones.ts';
import {
  buildTrajectoryContract,
  buildTrajectoryPublicV2Response
} from '../packages/domain/src/trajectory/contract.ts';
import { deriveTrajectoryEvidenceView } from '../packages/domain/src/trajectory/evidence.ts';
import { deriveTrajectoryFieldAuthorityProfile } from '../packages/domain/src/trajectory/fieldAuthority.ts';
import { deriveTrajectoryPublishPolicy } from '../packages/domain/src/trajectory/publishPolicy.ts';
import { trajectoryPublicV2ResponseSchemaV1 } from '../packages/contracts/src/index.ts';

const launchId = '11111111-1111-4111-8111-111111111111';

const countdown = buildCountdownSnapshot('2026-03-08T12:05:00.000Z', Date.parse('2026-03-08T12:00:00.000Z'));
assert.ok(countdown, 'countdown snapshot should build');
assert.equal(countdown?.isPast, false);
assert.equal(countdown?.totalMs, 300_000);

assert.equal(resolveViewerTier({ isAuthed: false, isPaid: false }), 'anon');
assert.equal(resolveViewerTier({ isAuthed: true, isPaid: false }), 'free');
assert.equal(resolveViewerTier({ isAuthed: true, isPaid: true }), 'premium');
assert.equal(tierToMode('premium'), 'live');
assert.equal(getTierRefreshSeconds('premium'), 15);
assert.equal(getTierLimits('free').watchlistRuleLimit, 0);
assert.equal(getTierCapabilities('anon').canUseSavedItems, false);

const parsedSearch = parseSiteSearchInput('type:launch provider:SpaceX -status:scrubbed "Starlink 12"');
assert.equal(parsedSearch.query, 'SpaceX -scrubbed "Starlink 12"');
assert.deepEqual(parsedSearch.types, ['launch']);
assert.equal(parsedSearch.hasPositiveTerms, true);
assert.deepEqual(parseSiteSearchTypesParam('launch,people,guide,launch'), ['launch', 'person', 'guide']);

assert.equal(sanitizeReturnTo('/account?tab=billing'), '/account?tab=billing');
assert.equal(sanitizeReturnTo('https://bad.example/path', '/fallback'), '/fallback');
assert.equal(
  readReturnTo({
    get(key) {
      if (key === 'return_to') return '/launches/abc';
      return null;
    }
  }),
  '/launches/abc'
);
assert.equal(
  readAuthIntent({
    get(key) {
      if (key === 'intent') return 'upgrade';
      return null;
    }
  }),
  'upgrade'
);
assert.equal(buildLaunchHref(launchId), `/launches/${launchId}`);
assert.equal(buildSearchHref('starlink'), '/search?q=starlink');
assert.equal(buildProfileHref(), '/account');
assert.equal(buildSavedHref(), '/account/saved');
assert.equal(buildPreferencesHref(), '/me/preferences');
assert.equal(buildPrivacyChoicesHref(), '/legal/privacy-choices');
assert.equal(buildUpgradeHref({ returnTo: '/account', autostart: true }), '/upgrade?return_to=%2Faccount&autostart=1');
assert.equal(buildAuthHref('sign-in', { returnTo: '/account', intent: 'upgrade' }), '/auth/sign-in?return_to=%2Faccount&intent=upgrade');
assert.equal(buildAuthCallbackHref({ returnTo: '/upgrade', intent: 'upgrade' }), '/auth/callback?return_to=%2Fupgrade&intent=upgrade');
assert.equal(resolvePushHref({ launchId }), `/launches/${launchId}`);
assert.equal(resolvePushHref({ url: '/me/preferences' }), '/me/preferences');

const milestones = resolveTrajectoryMilestones({
  ll2Timeline: [
    {
      name: 'Max-Q',
      relative_time: 'T+01:10'
    }
  ],
  providerExternalContent: [
    {
      source: 'provider',
      sourceId: 'press-kit',
      contentType: 'timeline',
      fetchedAt: '2026-03-08T12:00:00.000Z',
      confidence: 0.92,
      timelineEvents: [
        {
          label: 'Liftoff',
          time: 'T+00:00',
          phase: 'timeline'
        }
      ]
    }
  ],
  rocketFamily: 'Falcon 9'
});

assert.equal(milestones.some((entry) => entry.key === 'LIFTOFF'), true);
assert.equal(milestones.some((entry) => entry.key === 'MAXQ'), true);

const projected = applyTrajectoryMilestoneProjection({
  milestones,
  trackWindows: buildTrajectoryMilestoneTrackWindows([
    {
      trackKind: 'core_up',
      samples: [{ tPlusSec: 0 }, { tPlusSec: 600 }]
    }
  ])
});

assert.equal(projected.summary.total >= 2, true);
assert.equal(projected.summary.projectableCount >= 1, true);
assert.equal(buildTrajectoryCompatibilityEvents(projected.milestones).length >= 1, true);

const publishPolicy = deriveTrajectoryPublishPolicy({
  quality: 1,
  qualityLabel: 'landing_constrained',
  freshnessState: 'fresh',
  lineageComplete: true,
  sourceSufficiency: {
    status: 'pass',
    missingFields: [],
    blockingReasons: []
  }
});
assert.equal(publishPolicy.allowPrecision, true);
assert.equal(publishPolicy.enforcePadOnly, false);

const evidenceView = deriveTrajectoryEvidenceView({
  confidenceTier: 'A',
  qualityLabel: 'landing_constrained',
  sourceSufficiency: {
    sourceSummary: {
      code: 'partner_feed'
    }
  },
  lineageComplete: true
});
assert.equal(evidenceView.confidenceBadge, 'high');
assert.equal(evidenceView.sourceSummaryCode, 'partner_feed');

const authorityProfile = deriveTrajectoryFieldAuthorityProfile({
  field: 'azimuth',
  authorityTier: 'partner_feed',
  summary: 'Partner feed with directional constraints',
  qualityState: 'precision',
  freshnessState: 'fresh',
  lineageComplete: true,
  safeModeActive: false,
  publishPadOnly: false,
  hasDirectionalConstraint: true,
  hasMissionNumericOrbit: true
});
assert.equal(authorityProfile.confidenceLabel, 'strong');
assert.equal(authorityProfile.precisionEligible, true);

const trajectoryRow = {
  launch_id: launchId,
  version: 'trajectory-v1',
  quality: 1,
  generated_at: '2026-03-08T12:05:00.000Z',
  confidence_tier: 'A',
  freshness_state: 'fresh',
  lineage_complete: true,
  source_sufficiency: {
    status: 'pass',
    freshnessState: 'fresh',
    sourceSummary: {
      code: 'partner_feed',
      label: 'Partner feed'
    },
    signalSummary: {
      hasLicensedTrajectoryFeed: true,
      hasDirectionalConstraint: true,
      hasLandingDirectional: false,
      hasHazardDirectional: false,
      hasMissionNumericOrbit: false,
      hasSupgpConstraint: false
    },
    sourceFreshness: {
      latestSignalAt: '2026-03-08T12:04:00.000Z'
    }
  },
  product: {
    version: 'model-1',
    qualityLabel: 'landing_constrained',
    tracks: [
      {
        trackKind: 'core_up',
        samples: [
          {
            tPlusSec: 0,
            ecef: [1, 2, 3],
            sigmaDeg: 0.7
          },
          {
            tPlusSec: 120,
            ecef: [2, 3, 4],
            sigmaDeg: 0.9
          }
        ]
      }
    ],
    milestones: [
      {
        key: 'LIFTOFF',
        label: 'Liftoff',
        tPlusSec: 0,
        phase: 'core_ascent',
        sourceType: 'provider_timeline',
        sourceRefIds: ['provider:press-kit'],
        estimated: false,
        projectable: true
      }
    ],
    milestoneSummary: {
      fromTimeline: 1,
      sourceCounts: {
        provider_timeline: 1
      }
    }
  }
} as const;

const contract = buildTrajectoryContract(trajectoryRow);
assert.ok(contract, 'trajectory contract should build');
assert.equal(contract?.qualityState, 'precision');
assert.equal(contract?.authorityTier, 'partner_feed');
assert.equal(contract?.tracks.length, 1);

const publicV2 = buildTrajectoryPublicV2Response(trajectoryRow);
assert.ok(publicV2, 'trajectory public v2 payload should build');
trajectoryPublicV2ResponseSchemaV1.parse(publicV2);

console.log('shared-domain-smoke: ok');

export type FaqSurfaceId =
  | 'docs-faq'
  | 'home'
  | 'artemis-program'
  | 'artemis-mission'
  | 'artemis-workbench-artemis-i'
  | 'artemis-workbench-artemis-iii'
  | 'artemis-i-page'
  | 'artemis-iii-page'
  | 'starship-program'
  | 'starship-flight'
  | 'contracts-canonical-index'
  | 'contracts-canonical-detail';

export type FaqTopic =
  | 'refresh-cadence'
  | 'data-sources'
  | 'location-coverage'
  | 'net-time-precision'
  | 'timezone-display'
  | 'launch-state-changes'
  | 'notification-availability'
  | 'notification-quiet-hours'
  | 'sms-terms'
  | 'sms-guardrails'
  | 'net-definition'
  | 'launch-time-variability'
  | 'watch-links'
  | 'launch-window-definition'
  | 'alerts-access'
  | 'artemis-overview'
  | 'artemis-vs-apollo'
  | 'artemis-schedule-tracking'
  | 'artemis-name-variant'
  | 'artemis-ii-date'
  | 'artemis-ii-watch'
  | 'artemis-ii-crew'
  | 'artemis-i-crewed'
  | 'artemis-i-page-purpose'
  | 'artemis-follow-up'
  | 'artemis-iii-overview'
  | 'artemis-iii-date-certainty'
  | 'artemis-iii-near-term'
  | 'artemis-iii-workbench-role'
  | 'starship-program-overview'
  | 'starship-route-canonical'
  | 'starship-cadence'
  | 'starship-flight-alias'
  | 'starship-flight-schedule'
  | 'starship-flight-empty-state'
  | 'contracts-data-sources'
  | 'contracts-canonical-routing'
  | 'contracts-identifier-search'
  | 'contracts-update-cadence'
  | 'contracts-award-amount-variance'
  | 'contracts-sam-vs-usaspending'
  | 'contracts-piid-definition'
  | 'contracts-evidence-links'
  | 'contracts-empty-signals'
  | 'contracts-program-overlap';

export type FaqClaimClass = 'static_fact' | 'code_behavior' | 'policy' | 'time_sensitive';
export type FaqVerificationStatus = 'verified' | 'partially_verified' | 'unverified' | 'contradicted';
export type FaqRisk = 'low' | 'medium' | 'high';

export type FaqVerificationSource = {
  kind: 'internal' | 'external';
  ref: string;
  note?: string;
};

export type FaqCanonicalEntry = {
  id: string;
  question: string;
  answer: string;
  surfaces: readonly FaqSurfaceId[];
  topic: FaqTopic;
  claimClass: FaqClaimClass;
  verificationStatus: FaqVerificationStatus;
  risk: FaqRisk;
  verificationSources: readonly FaqVerificationSource[];
  lastVerifiedAt: string;
  owner: string;
  order: number;
};

export type FaqTemplateContext = {
  flightNumber?: number;
};

export type FaqRenderItem = {
  id: string;
  question: string;
  answer: string;
};

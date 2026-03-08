import type { JepReadiness, JepReadinessReason } from '@/lib/types/jep';

export type JepReadinessSettings = {
  publicEnabled: boolean;
  validationReady: boolean;
  modelCardPublished: boolean;
  labeledOutcomes: number | null;
  minLabeledOutcomes: number | null;
  currentEce: number | null;
  maxEce: number | null;
  currentBrier: number | null;
  maxBrier: number | null;
};

export function deriveJepReadiness(settings: JepReadinessSettings): JepReadiness {
  const reasons: JepReadinessReason[] = [];
  const publicVisible = settings.publicEnabled;

  const outcomesMet =
    settings.minLabeledOutcomes != null &&
    settings.labeledOutcomes != null &&
    settings.labeledOutcomes >= settings.minLabeledOutcomes;
  const eceMet = settings.maxEce != null && settings.currentEce != null && settings.currentEce <= settings.maxEce;
  const brierMet =
    settings.maxBrier != null && settings.currentBrier != null && settings.currentBrier <= settings.maxBrier;

  if (!settings.publicEnabled) reasons.push('public_release_disabled');
  if (!settings.validationReady) reasons.push('validation_incomplete');
  if (!settings.modelCardPublished) reasons.push('model_card_unpublished');

  if (settings.minLabeledOutcomes == null) {
    reasons.push('labeled_outcome_threshold_unconfigured');
  } else if (settings.labeledOutcomes == null) {
    reasons.push('labeled_outcome_count_unreported');
  } else if (!outcomesMet) {
    reasons.push('insufficient_labeled_outcomes');
  }

  if (settings.maxEce == null) {
    reasons.push('ece_threshold_unconfigured');
  } else if (settings.currentEce == null) {
    reasons.push('ece_unreported');
  } else if (!eceMet) {
    reasons.push('ece_above_threshold');
  }

  if (settings.maxBrier == null) {
    reasons.push('brier_threshold_unconfigured');
  } else if (settings.currentBrier == null) {
    reasons.push('brier_unreported');
  } else if (!brierMet) {
    reasons.push('brier_above_threshold');
  }

  const probabilityReady = reasons.every((reason) => reason === 'public_release_disabled');

  return {
    publicVisible,
    probabilityReady,
    probabilityPublicEligible: publicVisible && probabilityReady,
    validationReady: settings.validationReady,
    modelCardPublished: settings.modelCardPublished,
    labeledOutcomes: settings.labeledOutcomes,
    minLabeledOutcomes: settings.minLabeledOutcomes,
    currentEce: settings.currentEce,
    maxEce: settings.maxEce,
    currentBrier: settings.currentBrier,
    maxBrier: settings.maxBrier,
    reasons
  };
}

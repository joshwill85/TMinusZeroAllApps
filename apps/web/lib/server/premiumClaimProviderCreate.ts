import type { PremiumOnboardingProviderV1 } from '@tminuszero/contracts';

export type PremiumClaimProviderCreateReservation = {
  provider: PremiumOnboardingProviderV1;
  email: string;
  usedAt: string | null;
};

function asMetadataRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? ({ ...(value as Record<string, unknown>) }) : {};
}

function normalizeReservationEmail(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized || null;
}

export function readPremiumClaimProviderCreateReservation(metadata: unknown): PremiumClaimProviderCreateReservation | null {
  const record = asMetadataRecord(metadata);
  const value = record.provider_create;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const provider = candidate.provider === 'google' || candidate.provider === 'apple' ? candidate.provider : null;
  const email = normalizeReservationEmail(candidate.email);
  const usedAt = typeof candidate.usedAt === 'string' ? candidate.usedAt.trim() || null : null;

  if (!provider || !email) {
    return null;
  }

  return {
    provider,
    email,
    usedAt
  };
}

export function writePremiumClaimProviderCreateReservation(
  metadata: unknown,
  reservation: PremiumClaimProviderCreateReservation | null
) {
  const nextMetadata = asMetadataRecord(metadata);

  if (!reservation) {
    delete nextMetadata.provider_create;
    return nextMetadata;
  }

  nextMetadata.provider_create = {
    provider: reservation.provider,
    email: reservation.email,
    usedAt: reservation.usedAt
  };

  return nextMetadata;
}

'use client';

import type { PrivacyPreferencesUpdateV1, ProfileUpdateV1 } from '@tminuszero/api-client';
import { accountExportSchemaV1, privacyPreferencesSchemaV1, profileSchemaV1 } from '@tminuszero/contracts';
import { z } from 'zod';
import { browserApiClient } from '@/lib/api/client';

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
};

const legacyProfileSchema = {
  parse(value: unknown) {
    const payload = value as {
      profile?: {
        user_id: string;
        email?: string | null;
        role?: string | null;
        first_name?: string | null;
        last_name?: string | null;
        timezone?: string | null;
        created_at?: string | null;
        email_confirmed_at?: string | null;
      } | null;
    };
    return {
      profile: payload?.profile ?? null
    };
  }
} as const;

const legacyPrivacyPreferencesSchema = {
  parse(value: unknown) {
    const payload = value as {
      preferences?: {
        opt_out_sale_share?: boolean;
        limit_sensitive?: boolean;
        block_third_party_embeds?: boolean;
        gpc_enabled?: boolean;
        created_at?: string | null;
        updated_at?: string | null;
      } | null;
    };
    return {
      preferences: payload?.preferences ?? null
    };
  }
} as const;

const legacyProfilePayloadSchema = {
  profile: z
    .object({
      user_id: z.string(),
      email: z.string().nullable().optional(),
      role: z.string().nullable().optional(),
      first_name: z.string().nullable().optional(),
      last_name: z.string().nullable().optional(),
      timezone: z.string().nullable().optional(),
      created_at: z.string().nullable().optional(),
      email_confirmed_at: z.string().nullable().optional()
    })
    .nullable()
} as const;

const legacyPrivacyPreferencesPayloadSchema = {
  preferences: z
    .object({
      opt_out_sale_share: z.boolean().optional(),
      limit_sensitive: z.boolean().optional(),
      block_third_party_embeds: z.boolean().optional(),
      gpc_enabled: z.boolean().optional(),
      created_at: z.string().nullable().optional(),
      updated_at: z.string().nullable().optional()
    })
    .nullable()
} as const;

export const WEB_USE_LEGACY_ACCOUNT_PRIVACY_ADAPTERS = process.env.NEXT_PUBLIC_ACCOUNT_PRIVACY_LEGACY_ADAPTERS === '1';

export class WebAccountAdapterError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(path: string, status: number, code: string | null) {
    super(code ? `Web route failed for ${path} (${status}: ${code})` : `Web route failed for ${path} (${status})`);
    this.name = 'WebAccountAdapterError';
    this.status = status;
    this.code = code;
  }
}

async function requestJson<T>(
  path: string,
  schema: { parse: (value: unknown) => T },
  options: RequestOptions = {}
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    cache: 'no-store',
    headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      json && typeof json === 'object' && typeof (json as { error?: unknown }).error === 'string'
        ? (json as { error: string }).error
        : null;
    throw new WebAccountAdapterError(path, response.status, code);
  }

  return schema.parse(json);
}

function mapLegacyProfilePayload(value: z.infer<(typeof legacyProfilePayloadSchema)['profile']>) {
  if (!value) {
    throw new WebAccountAdapterError('/api/me/profile', 401, 'unauthorized');
  }

  return profileSchemaV1.parse({
    viewerId: value.user_id,
    email: value.email ?? '',
    role: value.role ?? null,
    firstName: value.first_name ?? null,
    lastName: value.last_name ?? null,
    timezone: value.timezone ?? null,
    emailConfirmedAt: value.email_confirmed_at ?? null,
    createdAt: value.created_at ?? null
  });
}

function mapLegacyPrivacyPreferencesPayload(
  value: z.infer<(typeof legacyPrivacyPreferencesPayloadSchema)['preferences']>
) {
  return privacyPreferencesSchemaV1.parse({
    optOutSaleShare: value?.opt_out_sale_share === true,
    limitSensitive: value?.limit_sensitive === true,
    blockThirdPartyEmbeds: value?.block_third_party_embeds === true,
    gpcEnabled: value?.gpc_enabled === true,
    createdAt: value?.created_at ?? null,
    updatedAt: value?.updated_at ?? null
  });
}

export async function getLegacyProfile() {
  const payload = await requestJson('/api/me/profile', legacyProfileSchema);
  return mapLegacyProfilePayload(payload.profile);
}

export async function updateLegacyProfile(payload: ProfileUpdateV1) {
  const body: Record<string, string> = {};
  if (payload.firstName !== undefined) body.first_name = payload.firstName;
  if (payload.lastName !== undefined) body.last_name = payload.lastName;
  if (payload.timezone !== undefined) body.timezone = payload.timezone;
  const response = await requestJson('/api/me/profile', legacyProfileSchema, {
    method: 'POST',
    body
  });
  return mapLegacyProfilePayload(response.profile);
}

export async function getSharedProfile() {
  return WEB_USE_LEGACY_ACCOUNT_PRIVACY_ADAPTERS ? getLegacyProfile() : browserApiClient.getProfile();
}

export async function updateSharedProfile(payload: ProfileUpdateV1) {
  return WEB_USE_LEGACY_ACCOUNT_PRIVACY_ADAPTERS ? updateLegacyProfile(payload) : browserApiClient.updateProfile(payload);
}

export async function getLegacyPrivacyPreferences() {
  const payload = await requestJson('/api/me/privacy/preferences', legacyPrivacyPreferencesSchema);
  return mapLegacyPrivacyPreferencesPayload(payload.preferences);
}

export async function updateLegacyPrivacyPreferences(payload: PrivacyPreferencesUpdateV1) {
  const body: Record<string, boolean> = {};
  if (payload.optOutSaleShare !== undefined) body.opt_out_sale_share = payload.optOutSaleShare;
  if (payload.limitSensitive !== undefined) body.limit_sensitive = payload.limitSensitive;
  if (payload.blockThirdPartyEmbeds !== undefined) body.block_third_party_embeds = payload.blockThirdPartyEmbeds;
  if (payload.gpcEnabled !== undefined) body.gpc_enabled = payload.gpcEnabled;
  const response = await requestJson('/api/me/privacy/preferences', legacyPrivacyPreferencesSchema, {
    method: 'POST',
    body
  });
  return mapLegacyPrivacyPreferencesPayload(response.preferences);
}

export async function getSharedPrivacyPreferences() {
  return WEB_USE_LEGACY_ACCOUNT_PRIVACY_ADAPTERS ? getLegacyPrivacyPreferences() : browserApiClient.getPrivacyPreferences();
}

export async function updateSharedPrivacyPreferences(payload: PrivacyPreferencesUpdateV1) {
  return WEB_USE_LEGACY_ACCOUNT_PRIVACY_ADAPTERS
    ? updateLegacyPrivacyPreferences(payload)
    : browserApiClient.updatePrivacyPreferences(payload);
}

export async function getLegacyAccountExport() {
  return requestJson('/api/me/export', accountExportSchemaV1);
}

export async function getSharedAccountExport() {
  return WEB_USE_LEGACY_ACCOUNT_PRIVACY_ADAPTERS ? getLegacyAccountExport() : browserApiClient.getAccountExport();
}

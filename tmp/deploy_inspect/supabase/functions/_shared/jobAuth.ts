import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getSettings, readStringSetting } from './settings.ts';

function timingSafeEqual(a: string, b: string) {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  const len = Math.max(aBytes.length, bBytes.length);

  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < len; i += 1) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

function parseExpectedTokens(value: unknown): string[] {
  const raw = readStringSetting(value, '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
}

function readProvidedToken(req: Request): string | null {
  const tokenHeader = req.headers.get('x-job-token')?.trim();
  if (tokenHeader) return tokenHeader;

  const authHeader = req.headers.get('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  const token = bearer.trim();
  return token ? token : null;
}

export async function requireJobAuth(req: Request, supabase: SupabaseClient) {
  const provided = readProvidedToken(req);
  if (!provided) return false;

  const settings = await getSettings(supabase, ['jobs_auth_token']);
  const expectedTokens = parseExpectedTokens(settings.jobs_auth_token);
  if (!expectedTokens.length) return false;

  return expectedTokens.some((expected) => timingSafeEqual(provided, expected));
}


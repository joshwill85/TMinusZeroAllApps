import type { PrivacyCookieName } from './choices';

export function readCookie(name: PrivacyCookieName) {
  if (typeof document === 'undefined') return null;
  const parts = document.cookie.split(';').map((part) => part.trim());
  for (const part of parts) {
    if (!part.startsWith(`${encodeURIComponent(name)}=`)) continue;
    return decodeURIComponent(part.slice(name.length + 1));
  }
  return null;
}

export function setCookie(name: PrivacyCookieName, value: string, options?: { maxAgeDays?: number }) {
  if (typeof document === 'undefined') return;
  const maxAgeDays = options?.maxAgeDays ?? 365;
  const maxAge = Math.max(0, Math.floor(maxAgeDays * 24 * 60 * 60));
  const secure = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const pieces = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'SameSite=Lax',
    secure ? 'Secure' : null
  ].filter(Boolean);
  document.cookie = pieces.join('; ');
}

export function deleteCookie(name: PrivacyCookieName) {
  setCookie(name, '', { maxAgeDays: 0 });
}

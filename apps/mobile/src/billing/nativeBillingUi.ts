import type { Href } from 'expo-router';

export function buildClaimAuthHref(
  pathname: '/sign-in' | '/sign-up',
  claimToken: string | null | undefined,
  returnTo: string | null | undefined
) {
  const params = new URLSearchParams();
  if (claimToken) {
    params.set('claim_token', claimToken);
  }
  if (returnTo) {
    params.set('return_to', returnTo);
  }
  params.set('intent', 'upgrade');
  return `${pathname}?${params.toString()}` as Href;
}

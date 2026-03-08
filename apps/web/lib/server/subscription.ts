type SubscriptionSnapshot = {
  status?: string | null;
  current_period_end?: string | null;
};

export function isSubscriptionActive(subscription?: SubscriptionSnapshot | null) {
  const status = String(subscription?.status || '').trim().toLowerCase();
  return status === 'active' || status === 'trialing';
}

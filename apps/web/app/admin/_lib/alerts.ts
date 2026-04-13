export const OPS_ALERT_EXPIRY_HOURS = 72;

export function buildOpsAlertExpiryCutoffIso(now = Date.now()) {
  return new Date(now - OPS_ALERT_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();
}

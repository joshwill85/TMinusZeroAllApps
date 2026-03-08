export const SMS_STOP_KEYWORDS: readonly string[] = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'optout', 'revoke'];
export const SMS_START_KEYWORDS: readonly string[] = ['start', 'unstop'];
export const SMS_HELP_KEYWORDS: readonly string[] = ['help', 'info'];

export function normalizeSmsKeyword(value: string) {
  const firstToken = value.trim().toLowerCase().split(/\s+/)[0] || '';
  return firstToken.replace(/[^a-z0-9]/g, '');
}

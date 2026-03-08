export type UsPhoneParseResult = {
  digits10: string;
  e164: `+1${string}`;
};

export function parseUsPhone(input: string): UsPhoneParseResult | null {
  const digitsOnly = input.replace(/\D/g, '');

  const digits10 =
    digitsOnly.length === 10 ? digitsOnly : digitsOnly.length === 11 && digitsOnly.startsWith('1') ? digitsOnly.slice(1) : null;

  if (!digits10) return null;
  return { digits10, e164: `+1${digits10}` };
}

export function formatUsPhoneDigits(digits10: string): string {
  const digitsOnly = digits10.replace(/\D/g, '');
  if (digitsOnly.length !== 10) return digits10;
  return `(${digitsOnly.slice(0, 3)}) ${digitsOnly.slice(3, 6)}-${digitsOnly.slice(6)}`;
}

export function formatUsPhoneForDisplay(input: string): string {
  const parsed = parseUsPhone(input);
  if (!parsed) return input;
  return formatUsPhoneDigits(parsed.digits10);
}


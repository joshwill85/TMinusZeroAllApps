export const PASSWORD_POLICY_HINT = 'Minimum 12 characters with uppercase, lowercase, number, and symbol.';
export const PASSWORD_POLICY_ERROR =
  'Password must be at least 12 characters and include uppercase, lowercase, number, and symbol.';

const PASSWORD_REQUIREMENTS_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;

export function isPasswordPolicyCompliant(password: string) {
  return PASSWORD_REQUIREMENTS_PATTERN.test(password);
}

export function assertPasswordPolicy(password: string) {
  if (!isPasswordPolicyCompliant(password)) {
    throw new Error(PASSWORD_POLICY_ERROR);
  }
}

export const MOBILE_DOCK_HEIGHT = 66;
export const MOBILE_DOCK_SIDE_INSET = 16;
export const MOBILE_DOCK_BOTTOM_OFFSET = 6;
export const MOBILE_DOCK_CONTENT_GAP = 28;

const CUSTOMER_DOCK_HIDDEN_ROOT_SEGMENTS = new Set([
  '+not-found',
  'admin',
  'auth',
  'forgot-password',
  'index',
  'sign-in',
  'sign-up'
]);

export function shouldShowCustomerDock(segments: string[]) {
  const first = segments[0] ?? '';

  if (!first) {
    return false;
  }

  if (first === '(tabs)') {
    return true;
  }

  if (CUSTOMER_DOCK_HIDDEN_ROOT_SEGMENTS.has(first)) {
    return false;
  }

  // Keep the dock off native AR so the camera/runtime stays full-screen.
  if (first === 'launches' && segments.includes('ar')) {
    return false;
  }

  return true;
}

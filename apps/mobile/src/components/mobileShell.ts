export const MOBILE_DOCK_HEIGHT = 66;
export const MOBILE_DOCK_SIDE_INSET = 16;
export const MOBILE_DOCK_BOTTOM_OFFSET = 12;
export const MOBILE_DOCK_CONTENT_GAP = 28;

const CUSTOMER_SHELL_REDIRECT_SEGMENTS = new Set(['feed', 'search', 'saved', 'preferences', 'profile', 'account']);

export function shouldShowCustomerDock(segments: string[]) {
  const first = segments[0] ?? '';

  if (first === '(tabs)') {
    return true;
  }

  if (first === 'launches' && Boolean(segments[1]) && segments.length === 2) {
    return true;
  }

  if (first === 'blue-origin') {
    return true;
  }

  return CUSTOMER_SHELL_REDIRECT_SEGMENTS.has(first);
}

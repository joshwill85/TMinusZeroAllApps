const LAUNCH_UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function parseLaunchParam(value: string) {
  const raw = safeDecode(value).trim();
  if (!raw) return null;
  if (LAUNCH_UUID_PATTERN.test(raw) && raw.match(new RegExp(`^${LAUNCH_UUID_PATTERN.source}$`, 'i'))) {
    return { launchId: raw, raw };
  }
  const slugMatch = raw.match(new RegExp(`^(.+)-(${LAUNCH_UUID_PATTERN.source})$`, 'i'));
  if (slugMatch) {
    return { launchId: slugMatch[2], raw };
  }
  return null;
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

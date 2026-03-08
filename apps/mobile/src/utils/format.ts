export function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return 'TBD';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

export function formatBooleanState(value: boolean) {
  return value ? 'Enabled' : 'Disabled';
}

export function formatRoleLabel(value: string | null | undefined) {
  if (!value) {
    return 'Guest';
  }

  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function formatSearchResultLabel(value: string) {
  return value
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

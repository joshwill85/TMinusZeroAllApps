import { ApiClientError } from '@tminuszero/api-client';

const WATCHLISTS_PATH = '/api/v1/me/watchlists';

type WatchlistCreateLimitError = ApiClientError & {
  code: 'limit_reached';
  path: typeof WATCHLISTS_PATH;
};

export function isWatchlistCreateLimitError(
  error: unknown
): error is WatchlistCreateLimitError {
  return (
    error instanceof ApiClientError &&
    error.code === 'limit_reached' &&
    error.path === WATCHLISTS_PATH
  );
}

export function buildWatchlistCreateLimitMessage() {
  return 'Watchlist limit reached. Remove an older watchlist before creating another.';
}

export function buildWatchlistCreateErrorMessage(error: unknown) {
  if (isWatchlistCreateLimitError(error)) {
    return buildWatchlistCreateLimitMessage();
  }

  if (error instanceof ApiClientError) {
    if (error.message) {
      return error.message;
    }
    if (error.code) {
      return `My Launches error: ${error.code}`;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unable to create My Launches.';
}

export function buildWatchlistRuleErrorMessage(
  error: unknown,
  label: string,
  ruleLimit?: number | null
) {
  if (isWatchlistCreateLimitError(error)) {
    return buildWatchlistCreateLimitMessage();
  }

  if (error instanceof ApiClientError) {
    if (error.code === 'limit_reached') {
      return ruleLimit
        ? `My Launches limit reached (${ruleLimit} rules).`
        : 'My Launches limit reached.';
    }
    if (error.code) {
      return `${label} error: ${error.code}`;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return `Unable to update ${label.toLowerCase()}.`;
}

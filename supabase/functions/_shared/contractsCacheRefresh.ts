const CONTRACTS_REVALIDATE_TIMEOUT_MS = 15_000;

export type CanonicalContractsRevalidateResult = {
  ok: boolean;
  status: number | null;
  error: string | null;
};

export async function requestCanonicalContractsRevalidate({
  source,
  reason
}: {
  source: string;
  reason?: string | null;
}): Promise<CanonicalContractsRevalidateResult> {
  const callbackUrl = normalizeOptionalText(Deno.env.get('TMZ_REVALIDATE_CONTRACTS_URL'));
  const callbackToken = normalizeOptionalText(Deno.env.get('TMZ_REVALIDATE_CONTRACTS_TOKEN'));
  if (!callbackUrl || !callbackToken) {
    return {
      ok: false,
      status: null,
      error: 'revalidate_not_configured'
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(callbackUrl);
  } catch {
    return {
      ok: false,
      status: null,
      error: 'revalidate_url_invalid'
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('timeout'), CONTRACTS_REVALIDATE_TIMEOUT_MS);

  try {
    const response = await fetch(parsedUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${callbackToken}`
      },
      body: JSON.stringify({
        source,
        reason: normalizeOptionalText(reason)
      }),
      signal: controller.signal
    });

    if (response.ok) {
      return { ok: true, status: response.status, error: null };
    }

    const bodyText = (await response.text()).slice(0, 260);
    return {
      ok: false,
      status: response.status,
      error: `revalidate_http_${response.status}${bodyText ? `:${bodyText}` : ''}`
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: `revalidate_request_failed:${stringifyError(error)}`
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeOptionalText(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function stringifyError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

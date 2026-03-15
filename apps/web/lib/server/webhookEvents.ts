import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';

type QueryClient = Pick<ReturnType<typeof createSupabaseAdminClient>, 'from'>;

type WebhookEventRecord = {
  id: number | null;
  supportsEventId: boolean;
};

function isMissingEventIdColumn(error: unknown) {
  const message = String((error as { message?: unknown })?.message || '').toLowerCase();
  return message.includes('column') && message.includes('event_id') && message.includes('does not exist');
}

export async function logWebhookEventFailure(
  admin: QueryClient,
  {
    source,
    payloadHash,
    error,
    eventId
  }: {
    source: string;
    payloadHash: string;
    error: string;
    eventId?: string | null;
  }
) {
  const insertResult = await admin.from('webhook_events').insert({
    source,
    event_id: eventId ?? null,
    payload_hash: payloadHash,
    processed: false,
    error
  });

  if (!insertResult.error) {
    return;
  }

  if (!isMissingEventIdColumn(insertResult.error)) {
    console.error('webhook_events failure insert error', insertResult.error);
    return;
  }

  const legacyInsertResult = await admin.from('webhook_events').insert({
    source,
    payload_hash: payloadHash,
    processed: false,
    error
  });

  if (legacyInsertResult.error) {
    console.error('webhook_events legacy failure insert error', legacyInsertResult.error);
  }
}

export async function createOrGetWebhookEventRecord(
  admin: QueryClient,
  {
    source,
    eventId,
    payloadHash
  }: {
    source: string;
    eventId: string;
    payloadHash: string;
  }
): Promise<WebhookEventRecord> {
  const insertResult = await admin
    .from('webhook_events')
    .insert({
      source,
      event_id: eventId,
      payload_hash: payloadHash,
      processed: false
    })
    .select('id')
    .maybeSingle();

  if (!insertResult.error && insertResult.data?.id != null) {
    return {
      id: Number(insertResult.data.id),
      supportsEventId: true
    };
  }

  if (insertResult.error && isMissingEventIdColumn(insertResult.error)) {
    const legacyInsertResult = await admin
      .from('webhook_events')
      .insert({
        source,
        payload_hash: payloadHash,
        processed: false
      })
      .select('id')
      .maybeSingle();

    if (legacyInsertResult.error) {
      console.error('webhook_events legacy insert error', legacyInsertResult.error);
      return {
        id: null,
        supportsEventId: false
      };
    }

    return {
      id: legacyInsertResult.data?.id != null ? Number(legacyInsertResult.data.id) : null,
      supportsEventId: false
    };
  }

  const code = String((insertResult.error as { code?: unknown })?.code || '');
  const isDuplicate = code === '23505' || String(insertResult.error?.message || '').toLowerCase().includes('duplicate');
  if (!isDuplicate) {
    console.error('webhook_events insert error', insertResult.error);
    return {
      id: null,
      supportsEventId: true
    };
  }

  const existingResult = await admin.from('webhook_events').select('id').eq('source', source).eq('event_id', eventId).maybeSingle();
  if (existingResult.error) {
    console.error('webhook_events lookup error', existingResult.error);
    return {
      id: null,
      supportsEventId: true
    };
  }

  return {
    id: existingResult.data?.id != null ? Number(existingResult.data.id) : null,
    supportsEventId: true
  };
}

export async function wasWebhookEventProcessed(
  admin: QueryClient,
  {
    source,
    eventId
  }: {
    source: string;
    eventId: string;
  }
) {
  const result = await admin.from('webhook_events').select('processed').eq('source', source).eq('event_id', eventId).maybeSingle();
  if (result.error) {
    console.warn('webhook_events processed lookup warning', result.error);
    return false;
  }

  return result.data?.processed === true;
}

export async function markWebhookEventProcessed(
  admin: QueryClient,
  {
    id
  }: {
    id: number;
  }
) {
  const result = await admin.from('webhook_events').update({ processed: true, error: null }).eq('id', id);
  if (result.error) {
    throw result.error;
  }
}

export async function markWebhookEventFailed(
  admin: QueryClient,
  {
    id,
    error
  }: {
    id: number;
    error: string;
  }
) {
  const result = await admin.from('webhook_events').update({ processed: false, error }).eq('id', id);
  if (result.error) {
    console.error('webhook_events failure update error', result.error);
  }
}

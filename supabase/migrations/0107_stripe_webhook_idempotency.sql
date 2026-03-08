-- Add Stripe event id to webhook_events for idempotent processing.

alter table public.webhook_events
  add column if not exists event_id text;

create unique index if not exists webhook_events_source_event_id_key
  on public.webhook_events(source, event_id);


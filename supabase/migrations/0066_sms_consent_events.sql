create table if not exists public.sms_consent_events (
  id bigserial primary key,
  user_id uuid references public.profiles(user_id) on delete set null,
  phone_e164 text not null,
  action text not null check (
    action in (
      'web_opt_in',
      'web_opt_out',
      'verify_requested',
      'verify_approved',
      'keyword_stop',
      'keyword_start',
      'keyword_help',
      'twilio_opt_out_error'
    )
  ),
  source text,
  consent_version text,
  ip inet,
  user_agent text,
  request_url text,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sms_consent_events_user_id_idx on public.sms_consent_events(user_id);
create index if not exists sms_consent_events_phone_e164_idx on public.sms_consent_events(phone_e164);
create index if not exists sms_consent_events_created_at_idx on public.sms_consent_events(created_at desc);

alter table public.sms_consent_events enable row level security;

do $$
begin
  create policy "user owns sms consent events"
    on public.sms_consent_events
    for select
    using (auth.uid() = user_id);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create policy "user inserts sms consent events"
    on public.sms_consent_events
    for insert
    with check (auth.uid() = user_id);
exception
  when duplicate_object then null;
end $$;


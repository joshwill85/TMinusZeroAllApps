create table if not exists public.billing_events (
  id bigserial primary key,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists billing_events_user_id_idx on public.billing_events(user_id);
create index if not exists billing_events_type_idx on public.billing_events(event_type);

alter table public.billing_events enable row level security;
create policy "admin read billing events" on public.billing_events for select using (public.is_admin());

-- Named calendar feeds (per-feed tokens) for Premium calendar subscriptions.

create table if not exists public.calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  name text not null,
  token uuid not null default gen_random_uuid(),
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists calendar_feeds_user_idx
  on public.calendar_feeds(user_id, created_at desc);

create unique index if not exists calendar_feeds_token_key
  on public.calendar_feeds(token);

alter table public.calendar_feeds enable row level security;

create policy "user owns calendar feeds"
  on public.calendar_feeds
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


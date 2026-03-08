-- Named RSS feeds (per-feed tokens) for Premium.

create table if not exists public.rss_feeds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  name text not null,
  token uuid not null default gen_random_uuid(),
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rss_feeds_user_idx
  on public.rss_feeds(user_id, created_at desc);

create unique index if not exists rss_feeds_token_key
  on public.rss_feeds(token);

alter table public.rss_feeds enable row level security;

create policy "user owns rss feeds"
  on public.rss_feeds
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- Named embed widgets (per-widget tokens) for Premium embeds.

-- Watchlists were removed in migration 0050 but are required again for Premium features
-- (My Launches feed + widget scoping).
create table if not exists public.watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  name text not null default 'My Launches',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists watchlists_user_idx
  on public.watchlists(user_id, created_at asc);

create table if not exists public.watchlist_rules (
  id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references public.watchlists(id) on delete cascade,
  rule_type text not null check (rule_type in ('launch','pad','provider','tier')),
  rule_value text not null,
  created_at timestamptz not null default now()
);

create index if not exists watchlist_rules_watchlist_idx
  on public.watchlist_rules(watchlist_id);

create unique index if not exists watchlist_rules_unique_idx
  on public.watchlist_rules(watchlist_id, rule_type, rule_value);

alter table public.watchlists enable row level security;
alter table public.watchlist_rules enable row level security;

drop policy if exists "user owns watchlists" on public.watchlists;
create policy "user owns watchlists"
  on public.watchlists
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user owns watchlist rules" on public.watchlist_rules;
create policy "user owns watchlist rules"
  on public.watchlist_rules
  for all
  using (
    exists (select 1 from public.watchlists w where w.id = watchlist_id and w.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.watchlists w where w.id = watchlist_id and w.user_id = auth.uid())
  );

create table if not exists public.embed_widgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  name text not null,
  token uuid not null default gen_random_uuid(),
  widget_type text not null default 'next_launch_card' check (widget_type in ('next_launch_card')),
  filters jsonb not null default '{}'::jsonb,
  preset_id uuid references public.launch_filter_presets(id) on delete set null,
  watchlist_id uuid references public.watchlists(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint embed_widgets_scope_one check (((preset_id is not null)::int + (watchlist_id is not null)::int) <= 1)
);

create index if not exists embed_widgets_user_idx
  on public.embed_widgets(user_id, created_at desc);

create unique index if not exists embed_widgets_token_key
  on public.embed_widgets(token);

alter table public.embed_widgets enable row level security;

create policy "user owns embed widgets"
  on public.embed_widgets
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

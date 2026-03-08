-- Saved filter presets (Premium-only feature).

create table if not exists public.launch_filter_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists launch_filter_presets_user_idx
  on public.launch_filter_presets(user_id, created_at desc);

create unique index if not exists launch_filter_presets_default_one_per_user
  on public.launch_filter_presets(user_id)
  where is_default;

alter table public.launch_filter_presets enable row level security;

create policy "user owns filter presets"
  on public.launch_filter_presets
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


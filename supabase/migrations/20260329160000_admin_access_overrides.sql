create table if not exists public.admin_access_overrides (
  user_id uuid primary key references auth.users(id) on delete cascade,
  effective_tier_override text check (effective_tier_override in ('anon', 'premium')),
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references public.profiles(user_id)
);

create index if not exists admin_access_overrides_updated_at_idx
  on public.admin_access_overrides(updated_at desc);

alter table public.admin_access_overrides enable row level security;

drop policy if exists "user reads own admin access override" on public.admin_access_overrides;
create policy "user reads own admin access override"
  on public.admin_access_overrides
  for select
  using (auth.uid() = user_id);

create table if not exists public.admin_access_override_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  updated_by uuid references public.profiles(user_id),
  previous_override text check (previous_override in ('anon', 'premium')),
  next_override text check (next_override in ('anon', 'premium')),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists admin_access_override_events_user_created_at_idx
  on public.admin_access_override_events(user_id, created_at desc);

alter table public.admin_access_override_events enable row level security;

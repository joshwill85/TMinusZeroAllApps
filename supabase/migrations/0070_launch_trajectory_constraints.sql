-- Store external/internal constraints to improve AR trajectory predictions.

create table if not exists public.launch_trajectory_constraints (
  id bigserial primary key,
  launch_id uuid not null references public.launches(id) on delete cascade,
  source text not null,
  source_id text,
  constraint_type text not null,
  data jsonb not null,
  geometry jsonb,
  confidence double precision,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (launch_id, source, constraint_type, source_id)
);

create index if not exists launch_trajectory_constraints_launch_idx
  on public.launch_trajectory_constraints (launch_id);

alter table if exists public.launch_trajectory_constraints enable row level security;

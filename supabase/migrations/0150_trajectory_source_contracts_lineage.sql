-- Trajectory v2.1 source sufficiency contracts + lineage foundation.
-- Adds machine-enforced contract evaluation artifacts and lineage metadata.

create table if not exists public.trajectory_source_contracts (
  id bigserial primary key,
  launch_id uuid not null references public.launches(id) on delete cascade,
  product_version text not null default 'traj_v2',
  contract_version text not null default 'source_contract_v2_1',
  confidence_tier text not null check (confidence_tier in ('A', 'B', 'C', 'D')),
  status text not null check (status in ('pass', 'fail')),
  source_sufficiency jsonb not null default '{}'::jsonb,
  required_fields jsonb not null default '{}'::jsonb,
  missing_fields text[] not null default '{}'::text[],
  blocking_reasons text[] not null default '{}'::text[],
  freshness_state text not null default 'unknown' check (freshness_state in ('fresh', 'stale', 'unknown')),
  lineage_complete boolean not null default false,
  evaluated_at timestamptz not null default now(),
  ingestion_run_id bigint references public.ingestion_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trajectory_source_contracts_launch_eval_idx
  on public.trajectory_source_contracts (launch_id, evaluated_at desc);

create index if not exists trajectory_source_contracts_status_idx
  on public.trajectory_source_contracts (status, confidence_tier, freshness_state);

create table if not exists public.trajectory_product_lineage (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.launches(id) on delete cascade,
  product_version text not null,
  generated_at timestamptz not null,
  source_ref_id text not null,

  source text not null,
  source_id text,
  source_kind text,
  license_class text,

  constraint_id bigint references public.launch_trajectory_constraints(id) on delete set null,
  source_document_id uuid references public.trajectory_source_documents(id) on delete set null,

  source_url text,
  source_hash text,
  parser_version text,
  parse_rule_id text,
  extracted_field_map jsonb,
  fetched_at timestamptz,

  weight_used double precision,
  confidence double precision,
  ingestion_run_id bigint references public.ingestion_runs(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (launch_id, product_version, generated_at, source_ref_id)
);

create index if not exists trajectory_product_lineage_launch_generated_idx
  on public.trajectory_product_lineage (launch_id, generated_at desc);

create index if not exists trajectory_product_lineage_constraint_idx
  on public.trajectory_product_lineage (constraint_id);

create index if not exists trajectory_product_lineage_doc_idx
  on public.trajectory_product_lineage (source_document_id);

alter table if exists public.launch_trajectory_constraints
  add column if not exists ingestion_run_id bigint references public.ingestion_runs(id) on delete set null,
  add column if not exists source_hash text,
  add column if not exists extracted_field_map jsonb,
  add column if not exists parse_rule_id text,
  add column if not exists parser_version text,
  add column if not exists license_class text;

create index if not exists launch_trajectory_constraints_run_idx
  on public.launch_trajectory_constraints (ingestion_run_id);

alter table if exists public.launch_trajectory_products
  add column if not exists ingestion_run_id bigint references public.ingestion_runs(id) on delete set null,
  add column if not exists confidence_tier text check (confidence_tier is null or confidence_tier in ('A', 'B', 'C', 'D')),
  add column if not exists source_sufficiency jsonb,
  add column if not exists freshness_state text check (freshness_state is null or freshness_state in ('fresh', 'stale', 'unknown')),
  add column if not exists lineage_complete boolean not null default false;

create index if not exists launch_trajectory_products_quality_idx
  on public.launch_trajectory_products (confidence_tier, freshness_state, generated_at desc);

alter table if exists public.ar_camera_guide_sessions
  add column if not exists confidence_tier_seen text check (confidence_tier_seen is null or confidence_tier_seen in ('A', 'B', 'C', 'D')),
  add column if not exists contract_tier text check (contract_tier is null or contract_tier in ('A', 'B', 'C', 'D')),
  add column if not exists render_tier text check (render_tier is null or render_tier in ('high', 'medium', 'low', 'unknown')),
  add column if not exists dropped_frame_bucket text;

alter table public.trajectory_source_contracts enable row level security;
alter table public.trajectory_product_lineage enable row level security;

drop policy if exists "admin read trajectory source contracts" on public.trajectory_source_contracts;
create policy "admin read trajectory source contracts"
  on public.trajectory_source_contracts
  for select
  using (public.is_admin());

drop policy if exists "admin read trajectory product lineage" on public.trajectory_product_lineage;
create policy "admin read trajectory product lineage"
  on public.trajectory_product_lineage
  for select
  using (public.is_admin());

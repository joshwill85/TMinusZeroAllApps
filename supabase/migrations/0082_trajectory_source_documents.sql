-- Cache fetched mission documents (press kits, mission overviews, etc.) for trajectory/orbit parsing.
-- These documents can be updated; we store each distinct version historically (by sha256).

create table if not exists public.trajectory_source_documents (
  id uuid primary key default gen_random_uuid(),

  kind text not null default 'orbit_doc',
  url text not null,

  fetched_at timestamptz not null default now(),
  http_status int,
  etag text,
  last_modified timestamptz,
  sha256 text not null,
  bytes int,
  content_type text,

  title text,
  extracted_text text,

  raw jsonb,
  error text,
  parse_version text not null default 'v1',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (url, sha256)
);

create index if not exists trajectory_source_documents_url_idx on public.trajectory_source_documents(url);
create index if not exists trajectory_source_documents_fetched_at_idx on public.trajectory_source_documents(fetched_at desc);

alter table public.trajectory_source_documents enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'trajectory_source_documents' and policyname = 'admin read trajectory source documents'
  ) then
    create policy "admin read trajectory source documents" on public.trajectory_source_documents
      for select using (public.is_admin());
  end if;
end $$;


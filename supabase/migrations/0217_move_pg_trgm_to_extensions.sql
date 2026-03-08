-- Keep pg_trgm out of public schema per security linter guidance.
-- No-op if pg_trgm is already installed in extensions.

create schema if not exists extensions;

do $$
declare
  ext_schema text;
begin
  select n.nspname
    into ext_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_trgm';

  if ext_schema is null then
    create extension if not exists pg_trgm with schema extensions;
  elsif ext_schema <> 'extensions' then
    alter extension pg_trgm set schema extensions;
  end if;
end $$;

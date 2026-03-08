-- Lock search_path for LL2 burst scheduler functions to avoid role-mutable lookup.
-- Handles both canonical and legacy/drifted function names if present.

do $$
declare
  fn record;
begin
  for fn in
    select
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('invoke_ll2_incremental_burst', 'll2_incremental_burst_guarded')
  loop
    execute format(
      'alter function %I.%I(%s) set search_path = pg_catalog, public',
      fn.schema_name,
      fn.function_name,
      fn.identity_args
    );
  end loop;
end $$;

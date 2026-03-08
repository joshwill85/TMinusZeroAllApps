-- Canonical compatibility wrapper for environments that invoke
-- `public.ll2_incremental_burst_guarded()` from scheduler jobs.
-- Intentionally excludes remote-only extension/managed-storage drift.

create or replace function public.ll2_incremental_burst_guarded()
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not pg_try_advisory_lock(hashtext('ll2_incremental_burst')::bigint) then
    return;
  end if;

  begin
    perform public.invoke_ll2_incremental_burst();
  exception
    when others then
      perform pg_advisory_unlock(hashtext('ll2_incremental_burst')::bigint);
      raise;
  end;

  perform pg_advisory_unlock(hashtext('ll2_incremental_burst')::bigint);
end;
$$;

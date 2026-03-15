create extension if not exists "hypopg" with schema "extensions";
create extension if not exists "index_advisor" with schema "extensions";
set check_function_bodies = off;
CREATE OR REPLACE FUNCTION public.ll2_incremental_burst_guarded()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  begin
    if not pg_try_advisory_lock(hashtext('ll2_incremental_burst')::bigint) then
      return;
    end if;

    begin
      perform public.invoke_ll2_incremental_burst();
    exception when others then
      perform pg_advisory_unlock(hashtext('ll2_incremental_burst')::bigint);
      raise;
    end;

    perform pg_advisory_unlock(hashtext('ll2_incremental_burst')::bigint);
  end;
  $function$;

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'storage'
      and p.proname = 'protect_delete'
  ) then
    if exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'storage'
        and c.relname = 'buckets'
  ) then
      drop trigger if exists protect_buckets_delete on storage.buckets;
      create trigger protect_buckets_delete
        before delete on storage.buckets
        for each statement
        execute function storage.protect_delete();
    end if;

    if exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'storage'
        and c.relname = 'objects'
    ) then
      drop trigger if exists protect_objects_delete on storage.objects;
      create trigger protect_objects_delete
        before delete on storage.objects
        for each statement
        execute function storage.protect_delete();
    end if;
  end if;
end
$$;

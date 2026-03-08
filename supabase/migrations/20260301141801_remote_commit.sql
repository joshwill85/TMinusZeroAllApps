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
CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();
CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();

-- Recompute FAA launch matches when safe trajectory-direction evidence changes.

create or replace function public.mark_launch_trajectory_constraint_dirty_for_faa_match()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_launch_id uuid := coalesce(new.launch_id, old.launch_id);
  v_constraint_type text := coalesce(new.constraint_type, old.constraint_type, '');
  v_source text := coalesce(new.source, old.source, '');
  v_orbit_type text := coalesce(new.data ->> 'orbitType', old.data ->> 'orbitType', '');
  v_reason text := null;
begin
  if v_launch_id is null then
    return coalesce(new, old);
  end if;

  if v_constraint_type = 'landing' then
    if v_source <> 'll2' then
      return coalesce(new, old);
    end if;
    v_reason := 'trajectory_landing';
  elsif v_constraint_type = 'target_orbit' then
    if v_source in ('faa_tfr', 'navcen_bnm', 'trajectory_templates_v1') then
      return coalesce(new, old);
    end if;
    if v_orbit_type = 'hazard_azimuth_estimate' then
      return coalesce(new, old);
    end if;
    v_reason := 'trajectory_target_orbit';
  else
    return coalesce(new, old);
  end if;

  perform public.enqueue_faa_launch_match_dirty_launch(v_launch_id, array[v_reason]);
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_mark_launch_trajectory_constraint_dirty_for_faa_match
on public.launch_trajectory_constraints;

create trigger trg_mark_launch_trajectory_constraint_dirty_for_faa_match
after insert or update or delete
on public.launch_trajectory_constraints
for each row
execute function public.mark_launch_trajectory_constraint_dirty_for_faa_match();

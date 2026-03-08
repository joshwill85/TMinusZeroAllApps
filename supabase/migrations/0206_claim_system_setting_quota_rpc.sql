-- Atomic system_settings quota claim helper for SAM/API quota accounting.
-- This keeps concurrent function runs from racing on a shared state key.

create or replace function public.claim_system_setting_quota(
  p_state_key text,
  p_requested int,
  p_limit int,
  p_reserve int
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_today text := to_char(current_date, 'YYYY-MM-DD');
  v_requested int := greatest(0, coalesce(p_requested, 0));
  v_limit int := greatest(0, coalesce(p_limit, 0));
  v_reserve int := greatest(0, coalesce(p_reserve, 0));
  v_state_date text := null;
  v_state_used text;
  v_state_limit text;
  v_state_reserve text;
  v_used int := 0;
  v_used_after int := 0;
  v_max_usable int;
  v_available int;
  v_granted int;
  v_remaining int;
  v_effective_limit int;
  v_effective_reserve int;
begin
  insert into public.system_settings (key, value, updated_at)
  values (p_state_key, jsonb_build_object('date', v_today, 'used', 0, 'limit', v_limit, 'reserve', v_reserve), now())
  on conflict (key) do nothing;

  select
    nullif(s.value->>'date', ''),
    s.value->>'used',
    s.value->>'limit',
    s.value->>'reserve'
  into
    v_state_date,
    v_state_used,
    v_state_limit,
    v_state_reserve
  from public.system_settings s
  where s.key = p_state_key
  for update;

  v_effective_limit := case
    when v_state_limit ~ '^-?\\d+(\\.\\d+)?$' then floor(v_state_limit::numeric)::int
    else v_limit
  end;
  v_effective_reserve := case
    when v_state_reserve ~ '^-?\\d+(\\.\\d+)?$' then floor(v_state_reserve::numeric)::int
    else v_reserve
  end;
  v_used := case
    when v_state_used ~ '^-?\\d+(\\.\\d+)?$' then floor(v_state_used::numeric)::int
    else 0
  end;
  if v_state_date is null or v_state_date <> v_today then
    v_used := 0;
  end if;

  v_limit := greatest(0, v_effective_limit);
  v_reserve := greatest(0, v_effective_reserve);
  v_max_usable := greatest(0, v_limit - v_reserve);
  v_available := greatest(0, v_max_usable - v_used);
  v_granted := least(v_requested, v_available);
  v_used_after := v_used + v_granted;
  v_remaining := greatest(0, v_max_usable - v_used_after);

  update public.system_settings
  set
    value = jsonb_build_object(
      'date', v_today,
      'used', v_used_after,
      'limit', v_limit,
      'reserve', v_reserve,
      'updatedAt', now()
    ),
    updated_at = now()
  where key = p_state_key;

  return jsonb_build_object(
    'date', v_today,
    'requested', v_requested,
    'granted', v_granted,
    'used', v_used_after,
    'limit', v_limit,
    'reserve', v_reserve,
    'available', v_available,
    'remaining', v_remaining
  );
end;
$$;

alter function public.claim_system_setting_quota(text, int, int, int) set search_path = public;
revoke execute on function public.claim_system_setting_quota(text, int, int, int) from public;
grant execute on function public.claim_system_setting_quota(text, int, int, int) to service_role;

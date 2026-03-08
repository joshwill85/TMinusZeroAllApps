-- Raise the default LL2 rate limit now that we use an authenticated (premium) key.
-- Only bumps the setting if it is missing or still below the minimum needed for 15s cadence (~240/hr).

do $$
declare
  current_limit int := null;
begin
  select
    case
      when jsonb_typeof(value) = 'number' then (value::text)::int
      when jsonb_typeof(value) = 'string' then nullif(trim(both '"' from value::text), '')::int
      else null
    end
  into current_limit
  from public.system_settings
  where key = 'll2_rate_limit_per_hour';

  if current_limit is null or current_limit < 240 then
    insert into public.system_settings (key, value, updated_at)
    values ('ll2_rate_limit_per_hour', '300'::jsonb, now())
    on conflict (key) do update
      set value = excluded.value,
          updated_at = excluded.updated_at;
  end if;
end $$;


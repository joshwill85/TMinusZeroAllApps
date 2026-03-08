-- Atomic rate limiting helper: increments the counter and returns whether the call is allowed.
-- This avoids race conditions where multiple workers exceed the hourly bucket.

create or replace function public.try_increment_api_rate(
  provider_name text,
  window_start_in timestamptz,
  window_seconds_in int,
  limit_in int
)
returns boolean
language plpgsql
as $$
declare
  new_count int;
begin
  insert into public.api_rate_counters(provider, window_start, window_seconds, count)
  values (provider_name, window_start_in, window_seconds_in, 1)
  on conflict (provider, window_start) do update
    set count = public.api_rate_counters.count + 1
  returning count into new_count;

  return new_count <= limit_in;
end;
$$;


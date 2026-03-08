-- Backfill launches_public_cache.pad_state from legacy pad_state_code values.
-- Filter RPCs read pad_state, so this keeps existing rows queryable immediately.

alter table public.launches_public_cache
  add column if not exists pad_state text;

update public.launches_public_cache
set pad_state = pad_state_code
where (pad_state is null or pad_state = '')
  and pad_state_code is not null
  and pad_state_code <> '';

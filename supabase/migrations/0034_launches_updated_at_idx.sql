-- Speed up incremental public cache refreshes.

create index if not exists launches_updated_at_idx on public.launches(updated_at);

insert into public.system_settings (key, value)
values ('jobs_ignore', '[]'::jsonb)
on conflict (key) do nothing;

-- Public read policy for LL2 launchers (used by launch-detail booster cards).

do $$
begin
  if to_regclass('public.ll2_launchers') is not null then
    alter table public.ll2_launchers enable row level security;

    drop policy if exists "public read ll2 launchers" on public.ll2_launchers;
    create policy "public read ll2 launchers"
      on public.ll2_launchers
      for select
      to public
      using (true);
  end if;
end $$;

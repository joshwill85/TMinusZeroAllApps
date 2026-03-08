create table if not exists public.feedback_submissions (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  user_id uuid references public.profiles(user_id) on delete set null,
  name text,
  email text not null,
  message text not null,
  page_path text not null,
  source text not null check (source in ('launch_card', 'launch_details')),
  launch_id text,
  check (char_length(email) <= 320),
  check (name is null or char_length(name) <= 120),
  check (char_length(message) between 5 and 5000),
  check (char_length(page_path) between 1 and 300),
  check (launch_id is null or char_length(launch_id) <= 128)
);

create index if not exists feedback_submissions_created_at_idx on public.feedback_submissions(created_at desc);
create index if not exists feedback_submissions_lower_email_idx on public.feedback_submissions(lower(email));
create index if not exists feedback_submissions_launch_id_idx on public.feedback_submissions(launch_id);

alter table public.feedback_submissions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'feedback_submissions' and policyname = 'admin read feedback submissions'
  ) then
    create policy "admin read feedback submissions" on public.feedback_submissions
      for select using (public.is_admin());
  end if;
end;
$$;

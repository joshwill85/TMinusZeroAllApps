alter table public.mobile_auth_risk_sessions
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists mobile_auth_risk_sessions_user_created_at_idx
  on public.mobile_auth_risk_sessions (user_id, created_at desc);

alter table public.user_sign_in_events
  add column if not exists risk_session_id uuid references public.mobile_auth_risk_sessions(id) on delete set null;

create index if not exists user_sign_in_events_risk_session_created_at_idx
  on public.user_sign_in_events (risk_session_id, created_at desc);

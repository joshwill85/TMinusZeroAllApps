create table if not exists public.apple_sign_in_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  client_id text not null check (char_length(client_id) between 1 and 255),
  apple_user_id text,
  token_kind text not null check (token_kind in ('refresh_token', 'access_token')),
  token_value text,
  email text,
  email_is_private_relay boolean not null default false,
  capture_source text not null check (capture_source in ('ios_native_code', 'web_provider_refresh', 'web_provider_access')),
  last_captured_at timestamptz not null default timezone('utc', now()),
  last_revoked_at timestamptz,
  last_revocation_status text,
  last_revocation_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.apple_sign_in_tokens enable row level security;

revoke all on table public.apple_sign_in_tokens from public;
revoke all on table public.apple_sign_in_tokens from anon, authenticated;

create or replace function public.premium_onboarding_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return jsonb_build_object(
    'error',
    jsonb_build_object(
      'message', 'Complete Premium purchase verification before creating a new account.',
      'http_code', 403,
      'code', 'premium_onboarding_required'
    )
  );
end;
$$;

grant execute on function public.premium_onboarding_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.premium_onboarding_before_user_created(jsonb) from authenticated, anon, public;

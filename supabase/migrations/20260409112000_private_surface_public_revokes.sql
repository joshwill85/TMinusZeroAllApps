-- Revoke direct Data API access to internal-only billing and notification
-- tables. These surfaces are now expected to be accessed only through
-- service-role-owned server paths.

revoke all on table public.notification_push_destinations_v3 from public;
revoke all on table public.notification_push_destinations_v3 from anon, authenticated;

revoke all on table public.notification_rules_v3 from public;
revoke all on table public.notification_rules_v3 from anon, authenticated;

revoke all on table public.premium_claims from public;
revoke all on table public.premium_claims from anon, authenticated;

grant all on table public.notification_push_destinations_v3 to service_role;
grant all on table public.notification_rules_v3 to service_role;
grant all on table public.premium_claims to service_role;

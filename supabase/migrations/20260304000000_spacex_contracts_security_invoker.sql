-- Lint 0010: avoid SECURITY DEFINER semantics on externally readable views.
-- Ensure callers query through their own table privileges + RLS context.
alter view if exists public.spacex_contracts
set (security_invoker = true);

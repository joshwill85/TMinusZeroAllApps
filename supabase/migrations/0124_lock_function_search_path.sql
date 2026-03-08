-- Lock function search_path to avoid role-mutable lookup.

alter function public.block_profile_role_change() set search_path = pg_catalog, public;
alter function public.is_paid_user() set search_path = pg_catalog, public;
alter function public.get_launch_filter_options_non_us() set search_path = pg_catalog, public;
alter function public.invoke_ll2_incremental_burst() set search_path = pg_catalog, public;
alter function public.get_launch_filter_options_all() set search_path = pg_catalog, public;
alter function public.get_launch_filter_options() set search_path = pg_catalog, public;

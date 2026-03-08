-- Remove obsolete Blue Origin fallback contract seed/event replaced by NASA VIPER entry.

delete from public.blue_origin_contracts
where contract_key = 'NASA-CLPS-2024-12-04';

delete from public.blue_origin_timeline_events
where event_key = 'blue-origin:contract:NASA-CLPS-2024-12-04';

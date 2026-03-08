-- Supabase performance advisor follow-up (phase 4):
-- add covering indexes for unindexed foreign keys.
-- Focus: high ROI query performance with predictable FK enforcement costs.

create index if not exists artemis_mission_components_source_document_id_idx
  on public.artemis_mission_components(source_document_id);

create index if not exists artemis_people_source_document_id_idx
  on public.artemis_people(source_document_id);

create index if not exists blue_origin_contract_actions_source_document_id_idx
  on public.blue_origin_contract_actions(source_document_id);

create index if not exists blue_origin_contract_vehicle_map_engine_slug_idx
  on public.blue_origin_contract_vehicle_map(engine_slug);

create index if not exists blue_origin_contract_vehicle_map_vehicle_slug_idx
  on public.blue_origin_contract_vehicle_map(vehicle_slug);

create index if not exists blue_origin_contracts_source_document_id_idx
  on public.blue_origin_contracts(source_document_id);

create index if not exists blue_origin_engines_source_document_id_idx
  on public.blue_origin_engines(source_document_id);

create index if not exists blue_origin_opportunity_notices_source_document_id_idx
  on public.blue_origin_opportunity_notices(source_document_id);

create index if not exists blue_origin_passengers_source_document_id_idx
  on public.blue_origin_passengers(source_document_id);

create index if not exists blue_origin_payloads_source_document_id_idx
  on public.blue_origin_payloads(source_document_id);

create index if not exists blue_origin_timeline_events_source_document_id_idx
  on public.blue_origin_timeline_events(source_document_id);

create index if not exists blue_origin_vehicles_source_document_id_idx
  on public.blue_origin_vehicles(source_document_id);

-- Phase 3 index fixes (safe / targeted).
-- Focus: covering indexes for foreign keys flagged by Supabase linter.

-- Artemis FK lookups.
create index if not exists artemis_budget_lines_source_document_id_idx
  on public.artemis_budget_lines(source_document_id);

create index if not exists artemis_procurement_awards_source_document_id_idx
  on public.artemis_procurement_awards(source_document_id);

create index if not exists artemis_timeline_events_source_document_id_idx
  on public.artemis_timeline_events(source_document_id);

-- FAA FK lookups.
create index if not exists faa_launch_matches_faa_tfr_shape_id_idx
  on public.faa_launch_matches(faa_tfr_shape_id);

create index if not exists faa_notam_details_faa_tfr_record_id_idx
  on public.faa_notam_details(faa_tfr_record_id);

-- Trajectory lineage FK lookups.
create index if not exists launch_trajectory_products_ingestion_run_id_idx
  on public.launch_trajectory_products(ingestion_run_id);

create index if not exists trajectory_product_lineage_ingestion_run_id_idx
  on public.trajectory_product_lineage(ingestion_run_id);

create index if not exists trajectory_source_contracts_ingestion_run_id_idx
  on public.trajectory_source_contracts(ingestion_run_id);


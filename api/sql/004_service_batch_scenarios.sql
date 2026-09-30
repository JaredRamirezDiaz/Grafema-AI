-- Ejecutar una vez después de 003_service_training_drafts.sql.
-- La identidad estable evita volver a guardar una misma solicitud automática.
alter table public.service_training_drafts
  add column if not exists batch_scenario_id text;
create unique index if not exists service_training_drafts_batch_scenario_idx
  on public.service_training_drafts (batch_scenario_id)
  where batch_scenario_id is not null;

-- Ejecutar una vez en el mismo proyecto Supabase del catálogo.
create table if not exists public.service_training_drafts (
  id uuid primary key,
  edit_token_hash text not null,
  status text not null default 'draft' check (status in ('draft', 'reviewed')),
  request jsonb not null,
  original jsonb not null,
  curated jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists service_training_drafts_status_idx on public.service_training_drafts (status, created_at);
alter table public.service_training_drafts enable row level security;
revoke all on public.service_training_drafts from anon, authenticated;
grant select, insert, update on public.service_training_drafts to service_role;

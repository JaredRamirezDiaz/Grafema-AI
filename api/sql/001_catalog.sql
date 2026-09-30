-- Ejecutar una vez en SQL Editor de Supabase.
create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create table if not exists public.songs (
  id text primary key,
  title text not null,
  artist text,
  lyrics text not null,
  embedding extensions.vector(1024) not null,
  updated_at timestamptz not null default now()
);

-- Sin políticas de lectura pública: el navegador solo habla con FastAPI.
alter table public.songs enable row level security;

create or replace function public.search_songs(
  query_embedding extensions.vector(1024),
  match_count integer default 8
)
returns table(id text, title text, artist text, lyrics text, similarity double precision)
language sql
stable
set search_path = public, extensions
as $$
  select s.id, s.title, s.artist, s.lyrics,
         (1 - (s.embedding <=> query_embedding))::double precision as similarity
  from public.songs as s
  order by s.embedding <=> query_embedding, s.id
  limit least(greatest(match_count, 1), 20);
$$;

revoke all on function public.search_songs(extensions.vector, integer) from public, anon, authenticated;
grant execute on function public.search_songs(extensions.vector, integer) to service_role;

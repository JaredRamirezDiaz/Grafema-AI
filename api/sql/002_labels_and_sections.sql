-- Ejecutar después de 001_catalog.sql. La demo actual y sus 550 embeddings permanecen.
create table if not exists public.song_labels (
  song_id text primary key references public.songs(id) on delete cascade,
  scores jsonb not null,
  ontology_version text not null,
  provider text not null,
  model text not null,
  updated_at timestamptz not null default now(),
  constraint song_labels_scores_object check (jsonb_typeof(scores) = 'object')
);

create table if not exists public.song_sections (
  song_id text not null references public.songs(id) on delete cascade,
  section_index integer not null check (section_index >= 0),
  section_order integer not null,
  section_type text not null,
  lines jsonb not null,
  content text not null,
  content_hash text not null,
  scores jsonb not null,
  ontology_version text not null,
  provider text not null,
  model text not null,
  embedding extensions.vector(1024),
  embedding_hash text,
  updated_at timestamptz not null default now(),
  primary key(song_id, section_index),
  constraint section_lines_array check (jsonb_typeof(lines) = 'array'),
  constraint section_scores_object check (jsonb_typeof(scores) = 'object'),
  constraint embedding_has_hash check (embedding is null or embedding_hash is not null)
);

create index if not exists song_sections_embedding_cosine_idx
  on public.song_sections using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null;

alter table public.song_labels enable row level security;
alter table public.song_sections enable row level security;
revoke all on public.song_labels, public.song_sections from anon, authenticated;
grant all on public.song_labels, public.song_sections to service_role;

-- Solo la API con service role consulta estas funciones; no se exponen al navegador.
create or replace function public.search_songs_labeled(
  query_embedding extensions.vector(1024), match_count integer default 80,
  eligible_ids text[] default null
)
returns table (id text, title text, artist text, lyrics text, similarity double precision, scores jsonb)
language sql stable
set search_path = public, extensions
as $$
  select s.id, s.title, s.artist, s.lyrics,
         (1 - (s.embedding <=> query_embedding))::double precision,
         l.scores
  from public.songs s
  left join public.song_labels l on l.song_id = s.id
  where eligible_ids is null or s.id = any(eligible_ids)
  order by s.embedding <=> query_embedding, s.id
  limit least(greatest(match_count, 1), 200);
$$;

create or replace function public.search_song_sections(
  query_embedding extensions.vector(1024), match_count integer default 120,
  eligible_ids text[] default null
)
returns table (
  song_id text, title text, artist text, lyrics text,
  section_index integer, section_order integer, section_type text, section_text text,
  similarity double precision, scores jsonb, song_scores jsonb
)
language sql stable
set search_path = public, extensions
as $$
  select sec.song_id, s.title, s.artist, s.lyrics,
         sec.section_index, sec.section_order, sec.section_type, sec.content,
         (1 - (sec.embedding <=> query_embedding))::double precision,
         sec.scores, sl.scores
  from public.song_sections sec
  join public.songs s on s.id = sec.song_id
  left join public.song_labels sl on sl.song_id = sec.song_id
  where sec.embedding is not null and sec.embedding_hash = sec.content_hash
    and (eligible_ids is null or sec.song_id = any(eligible_ids))
  order by sec.embedding <=> query_embedding, sec.song_id, sec.section_index
  limit least(greatest(match_count, 1), 250);
$$;

revoke all on function public.search_songs_labeled(extensions.vector, integer, text[]) from public, anon, authenticated;
revoke all on function public.search_song_sections(extensions.vector, integer, text[]) from public, anon, authenticated;
grant execute on function public.search_songs_labeled(extensions.vector, integer, text[]) to service_role;
grant execute on function public.search_song_sections(extensions.vector, integer, text[]) to service_role;

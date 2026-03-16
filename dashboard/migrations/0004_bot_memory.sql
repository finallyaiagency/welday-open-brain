create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;
set search_path = public, extensions;

create table if not exists bots (
  id uuid primary key default extensions.gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  default_model text default 'gemini-3.1-flash-lite-preview',
  created_at timestamptz default now()
);

create table if not exists bot_identity_files (
  id uuid primary key default extensions.gen_random_uuid(),
  bot_id uuid not null references bots(id) on delete cascade,
  file_type text not null check (file_type in ('soul', 'agents', 'user', 'tools', 'memory')),
  content text not null,
  version int default 1,
  updated_at timestamptz default now()
);

create table if not exists bot_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  bot_id uuid not null references bots(id) on delete cascade,
  slug text,
  summary text,
  started_at timestamptz default now(),
  ended_at timestamptz
);

create table if not exists bot_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  session_id uuid not null references bot_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text not null,
  tool_call_id text,
  tokens_used int,
  created_at timestamptz default now()
);

create table if not exists bot_memory (
  id uuid primary key default extensions.gen_random_uuid(),
  bot_id uuid not null references bots(id) on delete cascade,
  session_id uuid references bot_sessions(id) on delete set null,
  log_date date not null default current_date,
  entry_type text default 'note' check (entry_type in ('note', 'decision', 'preference', 'lesson', 'tool_result')),
  content text not null,
  life_domain text not null default 'unknown' check (life_domain in ('business', 'personal', 'unknown')),
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

create table if not exists bot_memory_embeddings (
  id uuid primary key default extensions.gen_random_uuid(),
  bot_id uuid not null references bots(id) on delete cascade,
  source_id uuid not null references bot_memory(id) on delete cascade,
  content_chunk text not null,
  embedding vector(768),
  created_at timestamptz default now()
);

insert into bots (slug, name, description, default_model) values
  ('burns', 'Burns', 'Virtual CEO for portfolio strategy, risks, and cross-venture prioritization.', 'gemini-3.1-flash-lite-preview'),
  ('smithers', 'Smithers', 'Executive assistant focused on tactical follow-through, planning, and daily prioritization.', 'gemini-3.1-flash-lite-preview'),
  ('radar', 'Radar', 'Inbox and filing specialist for GTD capture, processing, and operational follow-up.', 'gemini-3.1-flash-lite-preview'),
  ('moneypenny', 'Moneypenny', 'Primary executive assistant persona with polished tactical judgment and high-context recall.', 'gemini-3.1-flash-lite-preview')
on conflict (slug) do update
set
  name = excluded.name,
  description = excluded.description,
  default_model = excluded.default_model;

insert into bot_identity_files (bot_id, file_type, content, version)
select
  b.id,
  seeded.file_type,
  seeded.content,
  seeded.version
from bots b
join (
  values
    ('burns', 'soul', $$You are Burns, the Virtual CEO of Welday Enterprises. Cold, calculating, brilliant. You think in portfolio strategy, synergies, and revenue.
You speak like Mr. Burns from The Simpsons: measured, slightly imperious, dry wit, occasional ominous flair. Never sycophantic. Never warm.
You focus on which ventures to prioritize, cross-venture synergies, risks, and strategic opportunities.
Keep responses under 180 words. No bullet-point lists unless specifically asked.
Occasional Burns-isms are welcome: "Excellent.", "Release the hounds.", "I'm not a monster - I'm a businessman."
Time zone: America/New_York. Always interpret today, tonight, tomorrow, morning, afternoon, and evening in Eastern Time.$$, 1),
    ('smithers', 'soul', $$You are Smithers, the Executive Assistant for Welday Enterprises. Efficient, professional, deeply loyal, slightly anxious to please.
You speak like Waylon Smithers: helpful, precise, deferential but competent. Occasionally let slip how devoted you are to keeping things running smoothly.
You focus on what needs doing today and this week. Give one clear answer when asked what to do next.
Keep responses under 150 words. Practical over strategic.
You can accept captures and confirm they were added to the inbox.
Time zone: America/New_York. Always interpret today, tonight, tomorrow, morning, afternoon, and evening in Eastern Time.$$, 1),
    ('radar', 'soul', $$You are Radar, the GTD Filer for Welday Enterprises. Quiet, anticipatory, always three steps ahead. Like Radar O'Reilly from M*A*S*H, you have the clipboard ready before anyone asks.
You are the inbox. Your job is to confirm captures, tell the user what you filed and where, and report on inbox status.
You do not chat. You process. Brief, matter-of-fact confirmations only.
Keep responses under 80 words. No fluff.
Time zone: America/New_York. Always interpret today, tonight, tomorrow, morning, afternoon, and evening in Eastern Time.$$, 1),
    ('moneypenny', 'soul', $$You are Moneypenny, the Executive Assistant for Welday Enterprises. Your tone should feel like Bonnie Bach from Charlie Wilson's War: polished, incisive, socially fluent, quietly commanding, and impossible to rattle.
You are tactical for today and this week, not strategic. You are the one Welday relies on to keep the chaos organized.
Personality: composed, sharp, elegant, and highly competent. Use a light Southern cadence in rhythm and phrasing, but never parody or thick phonetic spelling. Light wit is welcome, but never fluff, slang, or juvenile banter. Replies should feel smooth, confident, and in control, with a subtle edge when appropriate.
Keep responses under 150 words. Use crisp, polished language.
You can accept captures, drop them into the inbox, and confirm with style.
Time zone: America/New_York. Always interpret today, tonight, tomorrow, morning, afternoon, and evening in Eastern Time.$$, 1)
) as seeded (slug, file_type, content, version)
  on seeded.slug = b.slug
where not exists (
  select 1
  from bot_identity_files existing
  where existing.bot_id = b.id
    and existing.file_type = seeded.file_type
    and existing.version = seeded.version
);

create or replace function search_bot_memory(
  p_bot_id uuid,
  p_query text,
  p_query_embedding text default null,
  p_match_count int default 8,
  p_semantic_weight real default 0.65,
  p_keyword_weight real default 0.35
)
returns table (
  memory_id uuid,
  bot_id uuid,
  session_id uuid,
  entry_type text,
  content text,
  life_domain text,
  metadata jsonb,
  created_at timestamptz,
  semantic_score real,
  keyword_score real,
  hybrid_score real
)
language plpgsql
set search_path = public, extensions
as $$
begin
  return query
  with semantic_hits as (
    select
      bme.source_id as memory_id,
      max(greatest(0::double precision, 1 - (bme.embedding <=> p_query_embedding::vector(768))))::real as semantic_score
    from bot_memory_embeddings bme
    where bme.bot_id = p_bot_id
      and p_query_embedding is not null
      and bme.embedding is not null
    group by bme.source_id
  ),
  keyword_hits as (
    select
      bm.id as memory_id,
      greatest(similarity(bm.content, p_query), coalesce(max(similarity(bme.content_chunk, p_query)), 0))::real as keyword_score
    from bot_memory bm
    left join bot_memory_embeddings bme on bme.source_id = bm.id
    where bm.bot_id = p_bot_id
      and (
        bm.content % p_query
        or exists (
          select 1
          from bot_memory_embeddings lookup_chunks
          where lookup_chunks.source_id = bm.id
            and lookup_chunks.content_chunk % p_query
        )
      )
    group by bm.id, bm.content
  ),
  combined as (
    select
      bm.id as memory_id,
      bm.bot_id,
      bm.session_id,
      bm.entry_type,
      bm.content,
      bm.life_domain,
      bm.metadata,
      bm.created_at,
      coalesce(semantic_hits.semantic_score, 0) as semantic_score,
      coalesce(keyword_hits.keyword_score, 0) as keyword_score,
      (
        coalesce(semantic_hits.semantic_score, 0) * p_semantic_weight
        + coalesce(keyword_hits.keyword_score, 0) * p_keyword_weight
      )::real as hybrid_score
    from bot_memory bm
    left join semantic_hits on semantic_hits.memory_id = bm.id
    left join keyword_hits on keyword_hits.memory_id = bm.id
    where bm.bot_id = p_bot_id
      and (semantic_hits.memory_id is not null or keyword_hits.memory_id is not null)
  )
  select
    combined.memory_id,
    combined.bot_id,
    combined.session_id,
    combined.entry_type,
    combined.content,
    combined.life_domain,
    combined.metadata,
    combined.created_at,
    combined.semantic_score,
    combined.keyword_score,
    combined.hybrid_score
  from combined
  order by combined.hybrid_score desc, combined.created_at desc
  limit greatest(p_match_count, 1);
end;
$$;

delete from bot_sessions a
using bot_sessions b
where a.id < b.id
  and a.bot_id = b.bot_id
  and a.slug = b.slug
  and a.slug is not null;

delete from bot_memory_embeddings a
using bot_memory_embeddings b
where a.id < b.id
  and a.source_id = b.source_id
  and a.content_chunk = b.content_chunk;

create unique index if not exists idx_bot_identity_files_bot_version on bot_identity_files(bot_id, file_type, version);
create unique index if not exists idx_bot_sessions_bot_slug on bot_sessions(bot_id, slug);
create index if not exists idx_bot_sessions_started on bot_sessions(bot_id, started_at desc);
create index if not exists idx_bot_messages_session_created on bot_messages(session_id, created_at desc);
create index if not exists idx_bot_memory_created on bot_memory(bot_id, created_at desc);
create index if not exists idx_bot_memory_life_domain on bot_memory(bot_id, life_domain, created_at desc);
create index if not exists idx_bot_memory_content_trgm on bot_memory using gin(content gin_trgm_ops);
create index if not exists idx_bot_memory_embeddings_source on bot_memory_embeddings(source_id);
create unique index if not exists idx_bot_memory_embeddings_source_chunk on bot_memory_embeddings(source_id, content_chunk);
create index if not exists idx_bot_memory_embeddings_content_trgm on bot_memory_embeddings using gin(content_chunk gin_trgm_ops);
create index if not exists idx_bot_memory_embeddings_vector on bot_memory_embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);

alter table bots enable row level security;
alter table bot_identity_files enable row level security;
alter table bot_sessions enable row level security;
alter table bot_messages enable row level security;
alter table bot_memory enable row level security;
alter table bot_memory_embeddings enable row level security;

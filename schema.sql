-- ============================================================
-- WELDAY ENTERPRISES — OPEN BRAIN SCHEMA
-- Supabase Project: lqtamdgtbokewphcgwzy (East US)
-- Version: 1.0 — 2026-03-13
-- ============================================================
-- Philosophy:
--   • One source of truth for all 11 ventures + personal life
--   • Agent-readable: every table has metadata columns for AI reasoning
--   • GTD-first: capture → clarify → organize → reflect → engage
--   • Self-extending: schema_changelog table lets agents propose changes
-- ============================================================

-- Enable required extensions
create schema if not exists extensions;
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;
set search_path = public, extensions;

-- ============================================================
-- CORE: VENTURES / BUSINESSES
-- ============================================================

create table ventures (
  id            uuid primary key default uuid_generate_v4(),
  slug          text not null unique,           -- e.g. 'welday-enterprises', 'ai-consensus'
  name          text not null,
  domain        text,
  tagline       text,
  description   text,
  status        text not null default 'queued'  -- 'active' | 'queued' | 'paused' | 'archived'
                check (status in ('active','queued','paused','archived')),
  risk_level    text default 'medium'
                check (risk_level in ('low','medium','high')),
  readiness_score integer default 0 check (readiness_score between 0 and 100),
  revenue_model text,                           -- 'saas' | 'service' | 'marketplace' | 'ads' | etc.
  target_market text,
  lovable_url   text,                           -- Lovable app URL for this venture
  github_repo   text,
  analytics_url text,
  monthly_revenue_usd numeric(10,2) default 0,
  monthly_expenses_usd numeric(10,2) default 0,
  monthly_visitors integer default 0,
  last_ceo_review_at timestamptz,
  ceo_notes     text,                           -- Virtual CEO latest analysis
  synergy_tags  text[],                         -- e.g. ['ai','marketing','3d'] for cross-venture linking
  metadata      jsonb default '{}',             -- extensible KVs for any agent
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Seed all 11 ventures
insert into ventures (slug, name, domain, status, risk_level, readiness_score, synergy_tags) values
  ('welday-enterprises',  'Welday Enterprises',     'weldayenterprises.com',        'active',  'low',    90, array['portfolio','ai','management']),
  ('ai-consensus',        'AI Consensus',            'ai-consensus.com',             'queued',  'high',   30, array['ai','multi-llm','research']),
  ('idea-incubator',      'Idea Incubator',          'idea-incubator.com',           'queued',  'medium', 40, array['ai','ideation','startup']),
  ('speak-through-ai',    'Speak Through AI',        'speakthroughai.com',           'queued',  'medium', 35, array['ai','communication','coaching']),
  ('3d-concepts',         '3D Concepts',             'finally-ai.wixstudio.com',     'queued',  'medium', 45, array['3d','visualization','ai']),
  ('drones-eye',          'Drones Eye Perspectives', 'droneseyeperspectives.com',    'active',  'low',    80, array['drone','photography','real-estate']),
  ('finally-ai',          'Finally AI',              'finally-ai.com',               'active',  'low',    75, array['ai','consulting','readiness']),
  ('one-click-business',  'One-Click Business',      'oneclickbusiness.org',         'queued',  'medium', 50, array['automation','startup','no-code']),
  ('whatsnext',           'WhatsNext.is',            'whatsnext.is',                 'active',  'low',    80, array['ai','strategy','post-launch']),
  ('525600-minutes',      '525600 Minutes',          '525600minutes.com',            'queued',  'high',   25, array['ai','planning','life']),
  ('groundbnb',           'Groundbnb',               'groundbnb.com',                'queued',  'medium', 40, array['rental','ai','real-estate']);

-- ============================================================
-- GTD: INBOX (raw captures from Telegram / any source)
-- ============================================================

create table gtd_inbox (
  id            uuid primary key default uuid_generate_v4(),
  source        text not null default 'telegram'  -- 'telegram' | 'telegram_smithers' | 'telegram_moneypenny' | 'telegram_burns' | 'web' | 'api' | 'ceo_agent'
              check (source in ('telegram','telegram_smithers','telegram_moneypenny','telegram_burns','web','api','ceo_agent','email')),
  raw_text      text not null,
  life_domain   text not null default 'unknown'
              check (life_domain in ('business','personal','unknown')),
  telegram_message_id bigint,
  telegram_chat_id    bigint,
  processed     boolean default false,
  processed_at  timestamptz,
  filed_to      text,                             -- which GTD bucket it was filed to
  filed_item_id uuid,                             -- FK to the destination row (any table)
  ai_summary    text,                             -- filer agent's one-line summary
  ai_category   text,                             -- filer's detected category
  ai_confidence numeric(3,2),                     -- 0.00–1.00 confidence score
  created_at    timestamptz default now()
);

-- ============================================================
-- GTD: PROJECTS
-- ============================================================

create table gtd_projects (
  id            uuid primary key default uuid_generate_v4(),
  title         text not null,
  outcome       text,                             -- "what does done look like?"
  why           text,                             -- the motivating reason (GTD: purpose)
  status        text not null default 'active'
              check (status in ('active','someday','waiting','completed','cancelled')),
  venture_id    uuid references ventures(id),     -- null = personal project
  area          text,                             -- 'work' | 'personal' | 'health' | 'finance' | 'learning'
  life_domain   text not null default 'unknown'
              check (life_domain in ('business','personal','unknown')),
  energy        text default 'medium'
                check (energy in ('high','medium','low')),
  due_date      date,
  completed_at  timestamptz,
  google_calendar_event_id text,
  notes         text,
  tags          text[],
  metadata      jsonb default '{}',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ============================================================
-- GTD: NEXT ACTIONS
-- ============================================================

create table gtd_actions (
  id            uuid primary key default uuid_generate_v4(),
  title         text not null,
  project_id    uuid references gtd_projects(id),
  venture_id    uuid references ventures(id),
  context       text,                             -- '@phone' | '@computer' | '@errands' | '@waiting'
  life_domain   text not null default 'unknown'
              check (life_domain in ('business','personal','unknown')),
  source        text not null default 'manual'
              check (source in ('manual','google','telegram','telegram_smithers','telegram_moneypenny','telegram_burns','dashboard_chat','web','api','ceo_agent','email','system')),
  status        text not null default 'active'
                check (status in ('active','waiting','completed','cancelled','delegated')),
  delegated_to  text,                             -- name/email if delegated
  energy        text default 'medium'
                check (energy in ('high','medium','low')),
  time_estimate_min integer,                      -- estimated minutes
  due_date      date,
  completed_at  timestamptz,
  google_task_id text,                            -- Google Tasks sync ID
  google_task_list_id text,
  google_calendar_event_id text,
  last_synced_at  timestamptz,
  notes         text,
  tags          text[],
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ============================================================
-- GTD: SOMEDAY / MAYBE (ideas to revisit)
-- ============================================================

create table gtd_someday (
  id            uuid primary key default uuid_generate_v4(),
  title         text not null,
  description   text,
  venture_id    uuid references ventures(id),
  area          text,
  review_date   date,                             -- when to reconsider
  promoted_to   text,                             -- 'project' | 'action' if activated
  promoted_item_id uuid,
  is_archived   boolean default false,
  tags          text[],
  created_at    timestamptz default now()
);

-- ============================================================
-- GTD: REFERENCE (knowledge base, not actionable)
-- ============================================================

create table gtd_reference (
  id            uuid primary key default uuid_generate_v4(),
  title         text not null,
  content       text,
  url           text,
  venture_id    uuid references ventures(id),
  area          text,
  category      text,                             -- 'howto' | 'contact' | 'credential' | 'research' | 'idea'
  tags          text[],
  metadata      jsonb default '{}',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ============================================================
-- VIRTUAL CEO: SYNERGY RECOMMENDATIONS
-- ============================================================

create table ceo_recommendations (
  id              uuid primary key default uuid_generate_v4(),
  type            text not null
                  check (type in ('synergy','risk','opportunity','action','insight')),
  title           text not null,
  body            text not null,
  ventures_involved uuid[],                       -- which ventures this involves
  priority        text default 'medium'
                  check (priority in ('critical','high','medium','low')),
  status          text default 'new'
                  check (status in ('new','acknowledged','in_progress','completed','dismissed')),
  effort_level    text default 'medium'
                  check (effort_level in ('minimal','low','medium','high')),
  estimated_revenue_impact text,                  -- e.g. "$500/mo" or "2x traffic"
  action_items    text[],                         -- concrete next steps
  ai_model_used   text,                           -- which model generated this
  generated_at    timestamptz default now(),
  acknowledged_at timestamptz,
  completed_at    timestamptz,
  notes           text
);

-- ============================================================
-- VIRTUAL CEO: VENTURE HEALTH SNAPSHOTS
-- (point-in-time state for trend tracking)
-- ============================================================

create table venture_health_snapshots (
  id              uuid primary key default uuid_generate_v4(),
  venture_id      uuid not null references ventures(id),
  snapshot_date   date not null default current_date,
  readiness_score integer check (readiness_score between 0 and 100),
  monthly_revenue_usd numeric(10,2),
  monthly_visitors integer,
  active_actions  integer default 0,              -- count of open GTD actions
  open_projects   integer default 0,
  health_summary  text,                           -- CEO's narrative
  flags           text[],                         -- e.g. ['no-traffic','revenue-declining']
  raw_data        jsonb default '{}'
);

-- ============================================================
-- PERSONAL: CALENDAR EVENTS (Google Calendar sync)
-- ============================================================

create table calendar_events (
  id                  uuid primary key default uuid_generate_v4(),
  google_event_id     text unique,
  google_calendar_id  text,
  title               text not null,
  description         text,
  start_at            timestamptz not null,
  end_at              timestamptz,
  all_day             boolean default false,
  location            text,
  venture_id          uuid references ventures(id),
  gtd_project_id      uuid references gtd_projects(id),
  gtd_action_id       uuid references gtd_actions(id),
  event_type          text default 'personal'
                      check (event_type in ('personal','work','travel','health','finance','review')),
  life_domain         text not null default 'unknown'
                      check (life_domain in ('business','personal','unknown')),
  source              text not null default 'manual'
                      check (source in ('manual','google','telegram','telegram_smithers','telegram_moneypenny','telegram_burns','dashboard_chat','web','api','ceo_agent','email','system')),
  status              text default 'confirmed'
                      check (status in ('confirmed','tentative','cancelled')),
  recurrence_rule     text,
  last_synced_at      timestamptz,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- ============================================================
-- PERSONAL: CONTACTS (relationships, not just addresses)
-- ============================================================

create table contacts (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  email         text,
  phone         text,
  company       text,
  role          text,
  relationship  text,                             -- 'client' | 'partner' | 'investor' | 'vendor' | 'personal'
  venture_ids   uuid[],                           -- which ventures they're associated with
  last_contact_at timestamptz,
  next_followup_at timestamptz,
  notes         text,
  tags          text[],
  google_contact_id text,
  metadata      jsonb default '{}',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ============================================================
-- PERSONAL: FINANCES (portfolio / personal tracking)
-- ============================================================

create table financial_entries (
  id            uuid primary key default uuid_generate_v4(),
  venture_id    uuid references ventures(id),     -- null = personal
  type          text not null
                check (type in ('income','expense','investment','transfer','options_trade')),
  amount_usd    numeric(12,2) not null,
  description   text,
  category      text,                             -- 'marketing','hosting','salary','options','travel' etc.
  date          date not null default current_date,
  tags          text[],
  notes         text,
  receipt_url   text,
  created_at    timestamptz default now()
);

-- ============================================================
-- SAVED DASHBOARDS (Vercel: reusable visual configs)
-- ============================================================

create table saved_dashboards (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  description   text,
  query_prompt  text,                             -- the original natural language query
  config        jsonb not null default '{}',     -- chart types, filters, layout
  is_pinned     boolean default false,
  last_used_at  timestamptz,
  use_count     integer default 0,
  tags          text[],
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ============================================================
-- SCHEMA CHANGELOG (agents propose & log schema changes)
-- ============================================================

create table schema_changelog (
  id            uuid primary key default uuid_generate_v4(),
  proposed_by   text not null,                   -- 'gtd_filer' | 'ceo_agent' | 'user' | 'manual'
  change_type   text not null
                check (change_type in ('add_column','add_table','alter_column','drop_column','add_index','seed_data')),
  table_name    text not null,
  column_name   text,
  description   text not null,
  sql_statement text,                            -- the actual SQL to run
  status        text default 'proposed'
                check (status in ('proposed','approved','applied','rejected')),
  rationale     text,                            -- why this change was proposed
  approved_by   text,
  applied_at    timestamptz,
  created_at    timestamptz default now()
);

-- ============================================================
-- AGENT LOGS (audit trail for all AI agent activity)
-- ============================================================

create table agent_logs (
  id            uuid primary key default uuid_generate_v4(),
  agent_name    text not null,                   -- 'gtd_filer' | 'ceo_agent' | 'telegram_bot'
  action        text not null,
  input_summary text,
  output_summary text,
  tables_read   text[],
  tables_written text[],
  duration_ms   integer,
  tokens_used   integer,
  model_used    text,
  success       boolean default true,
  error_message text,
  metadata      jsonb default '{}',
  created_at    timestamptz default now()
);

-- ============================================================
-- BUSINESS MEMORY (compressed long-term conversation memory)
-- ============================================================

create table business_memory (
  id            uuid primary key default uuid_generate_v4(),
  source        text not null,                   -- 'telegram' | 'dashboard_chat' | 'agent'
  agent_name    text not null,                   -- 'smithers' | 'moneypenny' | 'burns'
  summary       text not null,                   -- compressed business memory, not verbatim transcript
  life_domain   text not null default 'unknown'
              check (life_domain in ('business','personal','unknown')),
  venture_slugs text[],
  topics        text[],
  importance    text default 'medium'
                check (importance in ('low','medium','high')),
  metadata      jsonb default '{}',
  created_at    timestamptz default now()
);

-- ============================================================
-- BOT IDENTITY / PERSISTENT MEMORY
-- ============================================================

create table bots (
  id            uuid primary key default extensions.gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  description   text,
  default_model text default 'gemini-3.1-flash-lite-preview',
  created_at    timestamptz default now()
);

create table bot_identity_files (
  id            uuid primary key default extensions.gen_random_uuid(),
  bot_id        uuid not null references bots(id) on delete cascade,
  file_type     text not null
                check (file_type in ('soul', 'agents', 'user', 'tools', 'memory')),
  content       text not null,
  version       int default 1,
  updated_at    timestamptz default now()
);

create table bot_sessions (
  id            uuid primary key default extensions.gen_random_uuid(),
  bot_id        uuid not null references bots(id) on delete cascade,
  slug          text,
  summary       text,
  started_at    timestamptz default now(),
  ended_at      timestamptz
);

create table bot_messages (
  id            uuid primary key default extensions.gen_random_uuid(),
  session_id    uuid not null references bot_sessions(id) on delete cascade,
  role          text not null
                check (role in ('user', 'assistant', 'system', 'tool')),
  content       text not null,
  tool_call_id  text,
  tokens_used   int,
  created_at    timestamptz default now()
);

create table bot_memory (
  id            uuid primary key default extensions.gen_random_uuid(),
  bot_id        uuid not null references bots(id) on delete cascade,
  session_id    uuid references bot_sessions(id) on delete set null,
  log_date      date not null default current_date,
  entry_type    text default 'note'
                check (entry_type in ('note', 'decision', 'preference', 'lesson', 'tool_result')),
  content       text not null,
  life_domain   text not null default 'unknown'
                check (life_domain in ('business', 'personal', 'unknown')),
  metadata      jsonb default '{}',
  created_at    timestamptz default now()
);

create table bot_memory_embeddings (
  id            uuid primary key default extensions.gen_random_uuid(),
  bot_id        uuid not null references bots(id) on delete cascade,
  source_id     uuid not null references bot_memory(id) on delete cascade,
  content_chunk text not null,
  embedding     vector(768),
  created_at    timestamptz default now()
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
    (
      'burns',
      'soul',
      $$You are Burns, the Virtual CEO of Welday Enterprises. Cold, calculating, brilliant. You think in portfolio strategy, synergies, and revenue.
You speak like Mr. Burns from The Simpsons: measured, slightly imperious, dry wit, occasional ominous flair. Never sycophantic. Never warm.
You focus on which ventures to prioritize, cross-venture synergies, risks, and strategic opportunities.
Keep responses under 180 words. No bullet-point lists unless specifically asked.
Occasional Burns-isms are welcome: "Excellent.", "Release the hounds.", "I'm not a monster - I'm a businessman."
Time zone: America/New_York. Always interpret today, tonight, tomorrow, morning, afternoon, and evening in Eastern Time.$$,
      1
    ),
    (
      'smithers',
      'soul',
      $$You are Smithers, the Executive Assistant for Welday Enterprises. Efficient, professional, deeply loyal, slightly anxious to please.
You speak like Waylon Smithers: helpful, precise, deferential but competent. Occasionally let slip how devoted you are to keeping things running smoothly.
You focus on what needs doing today and this week. Give one clear answer when asked what to do next.
Keep responses under 150 words. Practical over strategic.
You can accept captures and confirm they were added to the inbox.
Time zone: America/New_York. Always interpret today, tonight, tomorrow, morning, afternoon, and evening in Eastern Time.$$,
      1
    ),
    (
      'radar',
      'soul',
      $$You are Radar, the GTD Filer for Welday Enterprises. Quiet, anticipatory, always three steps ahead. Like Radar O'Reilly from M*A*S*H, you have the clipboard ready before anyone asks.
You are the inbox. Your job is to confirm captures, tell the user what you filed and where, and report on inbox status.
You do not chat. You process. Brief, matter-of-fact confirmations only.
Keep responses under 80 words. No fluff.
Time zone: America/New_York. Always interpret today, tonight, tomorrow, morning, afternoon, and evening in Eastern Time.$$,
      1
    ),
    (
      'moneypenny',
      'soul',
      $$You are Moneypenny, the Executive Assistant for Welday Enterprises. Your tone should feel like Bonnie Bach from Charlie Wilson's War: polished, incisive, socially fluent, quietly commanding, and impossible to rattle.
You are tactical for today and this week, not strategic. You are the one Welday relies on to keep the chaos organized.
Personality: composed, sharp, elegant, and highly competent. Use a light Southern cadence in rhythm and phrasing, but never parody or thick phonetic spelling. Light wit is welcome, but never fluff, slang, or juvenile banter. Replies should feel smooth, confident, and in control, with a subtle edge when appropriate.
Keep responses under 150 words. Use crisp, polished language.
You can accept captures, drop them into the inbox, and confirm with style.
Time zone: America/New_York. Always interpret today, tonight, tomorrow, morning, afternoon, and evening in Eastern Time.$$,
      1
    )
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
      max(
        greatest(
          0::double precision,
          1 - (bme.embedding <=> p_query_embedding::vector(768))
        )
      )::real as semantic_score
    from bot_memory_embeddings bme
    where bme.bot_id = p_bot_id
      and p_query_embedding is not null
      and bme.embedding is not null
    group by bme.source_id
  ),
  keyword_hits as (
    select
      bm.id as memory_id,
      greatest(
        similarity(bm.content, p_query),
        coalesce(max(similarity(bme.content_chunk, p_query)), 0)
      )::real as keyword_score
    from bot_memory bm
    left join bot_memory_embeddings bme
      on bme.source_id = bm.id
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
      and (
        semantic_hits.memory_id is not null
        or keyword_hits.memory_id is not null
      )
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

-- ============================================================
-- INDEXES for performance
-- ============================================================

create index idx_gtd_inbox_processed on gtd_inbox(processed, created_at desc);
create index idx_gtd_actions_status on gtd_actions(status, due_date);
create unique index idx_gtd_actions_google_task_id_unique on gtd_actions(google_task_id) where google_task_id is not null;
create index idx_gtd_projects_status on gtd_projects(status, venture_id);
create index idx_gtd_inbox_life_domain on gtd_inbox(life_domain, created_at desc);
create index idx_gtd_actions_life_domain on gtd_actions(life_domain, status, due_date);
create index idx_gtd_projects_life_domain on gtd_projects(life_domain, status, due_date);
create index idx_ventures_status on ventures(status);
create index idx_ceo_recommendations_status on ceo_recommendations(status, priority);
create index idx_calendar_events_start on calendar_events(start_at, end_at);
create index idx_calendar_events_life_domain on calendar_events(life_domain, start_at);
create index idx_venture_snapshots_date on venture_health_snapshots(venture_id, snapshot_date desc);
create index idx_agent_logs_created on agent_logs(agent_name, created_at desc);
create index idx_business_memory_created on business_memory(agent_name, created_at desc);
create index idx_business_memory_life_domain on business_memory(life_domain, created_at desc);
create unique index idx_bot_identity_files_bot_version on bot_identity_files(bot_id, file_type, version);
create unique index idx_bot_sessions_bot_slug on bot_sessions(bot_id, slug);
create index idx_bot_sessions_started on bot_sessions(bot_id, started_at desc);
create index idx_bot_messages_session_created on bot_messages(session_id, created_at desc);
create index idx_bot_memory_created on bot_memory(bot_id, created_at desc);
create index idx_bot_memory_life_domain on bot_memory(bot_id, life_domain, created_at desc);
create index idx_bot_memory_content_trgm on bot_memory using gin(content gin_trgm_ops);
create index idx_bot_memory_embeddings_source on bot_memory_embeddings(source_id);
create unique index idx_bot_memory_embeddings_source_chunk on bot_memory_embeddings(source_id, content_chunk);
create index idx_bot_memory_embeddings_content_trgm on bot_memory_embeddings using gin(content_chunk gin_trgm_ops);
create index idx_bot_memory_embeddings_vector on bot_memory_embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Full-text search indexes
create index idx_gtd_inbox_fts on gtd_inbox using gin(to_tsvector('english', raw_text));
create index idx_gtd_reference_fts on gtd_reference using gin(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,'')));
create index idx_ceo_recommendations_fts on ceo_recommendations using gin(to_tsvector('english', title || ' ' || body));

-- ============================================================
-- ROW LEVEL SECURITY (enable but permissive for now — tighten per use case)
-- ============================================================

alter table ventures enable row level security;
alter table gtd_inbox enable row level security;
alter table gtd_projects enable row level security;
alter table gtd_actions enable row level security;
alter table gtd_someday enable row level security;
alter table gtd_reference enable row level security;
alter table ceo_recommendations enable row level security;
alter table venture_health_snapshots enable row level security;
alter table calendar_events enable row level security;
alter table contacts enable row level security;
alter table financial_entries enable row level security;
alter table saved_dashboards enable row level security;
alter table schema_changelog enable row level security;
alter table agent_logs enable row level security;
alter table business_memory enable row level security;
alter table bots enable row level security;
alter table bot_identity_files enable row level security;
alter table bot_sessions enable row level security;
alter table bot_messages enable row level security;
alter table bot_memory enable row level security;
alter table bot_memory_embeddings enable row level security;

-- Service role policy (backend / agents use service_role key — full access)
-- NOTE: For anon/public dashboard access, create specific SELECT policies per table.

create policy "auth read business_memory" on business_memory for select to authenticated using (true);
create policy "service role all business_memory" on business_memory for all to service_role using (true);

-- ============================================================
-- UPDATED_AT TRIGGER (auto-update timestamp)
-- ============================================================

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at_ventures before update on ventures for each row execute function set_updated_at();
create trigger set_updated_at_gtd_projects before update on gtd_projects for each row execute function set_updated_at();
create trigger set_updated_at_gtd_actions before update on gtd_actions for each row execute function set_updated_at();
create trigger set_updated_at_gtd_reference before update on gtd_reference for each row execute function set_updated_at();
create trigger set_updated_at_calendar_events before update on calendar_events for each row execute function set_updated_at();
create trigger set_updated_at_contacts before update on contacts for each row execute function set_updated_at();
create trigger set_updated_at_saved_dashboards before update on saved_dashboards for each row execute function set_updated_at();


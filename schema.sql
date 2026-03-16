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
create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm"; -- fuzzy search
create extension if not exists "vector";  -- embeddings for semantic search (future)

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
  status        text not null default 'active'
                check (status in ('active','waiting','completed','cancelled','delegated')),
  delegated_to  text,                             -- name/email if delegated
  energy        text default 'medium'
                check (energy in ('high','medium','low')),
  time_estimate_min integer,                      -- estimated minutes
  due_date      date,
  completed_at  timestamptz,
  google_task_id text,                            -- Google Tasks sync ID
  google_calendar_event_id text,
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
  venture_slugs text[],
  topics        text[],
  importance    text default 'medium'
                check (importance in ('low','medium','high')),
  metadata      jsonb default '{}',
  created_at    timestamptz default now()
);

-- ============================================================
-- INDEXES for performance
-- ============================================================

create index idx_gtd_inbox_processed on gtd_inbox(processed, created_at desc);
create index idx_gtd_actions_status on gtd_actions(status, due_date);
create index idx_gtd_projects_status on gtd_projects(status, venture_id);
create index idx_ventures_status on ventures(status);
create index idx_ceo_recommendations_status on ceo_recommendations(status, priority);
create index idx_calendar_events_start on calendar_events(start_at, end_at);
create index idx_venture_snapshots_date on venture_health_snapshots(venture_id, snapshot_date desc);
create index idx_agent_logs_created on agent_logs(agent_name, created_at desc);
create index idx_business_memory_created on business_memory(agent_name, created_at desc);

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

-- Service role policy (backend / agents use service_role key — full access)
-- NOTE: For anon/public dashboard access, create specific SELECT policies per table.

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


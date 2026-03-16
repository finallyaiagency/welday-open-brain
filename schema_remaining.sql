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

-- ============================================================
-- GTD: INBOX (raw captures from Telegram / any source)
-- ============================================================

create table if not exists gtd_inbox (
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

create table if not exists gtd_projects (
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

create table if not exists gtd_actions (
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

create table if not exists gtd_someday (
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

create table if not exists gtd_reference (
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

create table if not exists ceo_recommendations (
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

create table if not exists venture_health_snapshots (
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

create table if not exists calendar_events (
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

create table if not exists contacts (
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

create table if not exists financial_entries (
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

create table if not exists saved_dashboards (
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

create table if not exists schema_changelog (
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

create table if not exists agent_logs (
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

create table if not exists business_memory (
  id            uuid primary key default uuid_generate_v4(),
  source        text not null,
  agent_name    text not null,
  summary       text not null,
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

create index idx_ceo_recommendations_status on ceo_recommendations(status, priority);

create index idx_calendar_events_start on calendar_events(start_at, end_at);

create index idx_venture_snapshots_date on venture_health_snapshots(venture_id, snapshot_date desc);

create index idx_agent_logs_created on agent_logs(agent_name, created_at desc);
create index idx_business_memory_created on business_memory(agent_name, created_at desc);

-- Full-text search indexes
create index idx_gtd_inbox_fts on gtd_inbox using gin(to_tsvector('english', raw_text));

create index idx_gtd_reference_fts on gtd_reference using gin(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,'')));

create index idx_ceo_recommendations_fts on ceo_recommendations using gin(to_tsvector('english', title || ' ' || body));

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

create trigger set_updated_at_gtd_projects before update on gtd_projects for each row execute function set_updated_at();

create trigger set_updated_at_gtd_actions before update on gtd_actions for each row execute function set_updated_at();

create trigger set_updated_at_gtd_reference before update on gtd_reference for each row execute function set_updated_at();

create trigger set_updated_at_calendar_events before update on calendar_events for each row execute function set_updated_at();

create trigger set_updated_at_contacts before update on contacts for each row execute function set_updated_at();

create trigger set_updated_at_saved_dashboards before update on saved_dashboards for each row execute function set_updated_at();
-- ============================================================
-- RLS POLICIES — remaining tables
-- (ventures, gtd_actions, gtd_inbox, gtd_projects, gtd_someday,
--  gtd_reference, ceo_recommendations already have policies)
-- ============================================================

create policy "auth read venture_health_snapshots" on venture_health_snapshots for select to authenticated using (true);
create policy "auth read calendar_events"          on calendar_events          for select to authenticated using (true);
create policy "auth read contacts"                 on contacts                 for select to authenticated using (true);
create policy "auth read financial_entries"        on financial_entries        for select to authenticated using (true);
create policy "auth read saved_dashboards"         on saved_dashboards         for select to authenticated using (true);
create policy "auth read schema_changelog"         on schema_changelog         for select to authenticated using (true);
create policy "auth read agent_logs"               on agent_logs               for select to authenticated using (true);

create policy "auth write venture_health_snapshots" on venture_health_snapshots for insert to authenticated with check (true);
create policy "auth write calendar_events"          on calendar_events          for insert to authenticated with check (true);
create policy "auth write contacts"                 on contacts                 for insert to authenticated with check (true);
create policy "auth write financial_entries"        on financial_entries        for insert to authenticated with check (true);
create policy "auth write saved_dashboards"         on saved_dashboards         for insert to authenticated with check (true);
create policy "auth write agent_logs"               on agent_logs               for insert to authenticated with check (true);

create policy "auth update saved_dashboards"        on saved_dashboards         for update to authenticated using (true);
create policy "auth update contacts"                on contacts                 for update to authenticated using (true);
create policy "auth update calendar_events"         on calendar_events          for update to authenticated using (true);
create policy "auth update ceo_recommendations"     on ceo_recommendations      for update to authenticated using (true);

-- Service role bypass (for agents/server-side)
create policy "service role all ventures"           on ventures                 for all to service_role using (true);
create policy "service role all gtd_inbox"          on gtd_inbox                for all to service_role using (true);
create policy "service role all gtd_actions"        on gtd_actions              for all to service_role using (true);
create policy "service role all gtd_projects"       on gtd_projects             for all to service_role using (true);
create policy "service role all gtd_someday"        on gtd_someday              for all to service_role using (true);
create policy "service role all gtd_reference"      on gtd_reference            for all to service_role using (true);
create policy "service role all ceo_recommendations" on ceo_recommendations     for all to service_role using (true);
create policy "service role all agent_logs"         on agent_logs               for all to service_role using (true);

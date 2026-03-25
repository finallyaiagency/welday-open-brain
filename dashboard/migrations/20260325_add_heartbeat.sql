-- Update existing heartbeat table
alter table brain_heartbeat add column if not exists id uuid default uuid_generate_v4();
-- Wait, if primary key already exists, skip it. If not, set it.
-- But the existing structure doesn't have id?
-- The information_schema didn't show it.

alter table brain_heartbeat add column if not exists status text default 'active' check (status in ('active', 'paused', 'failed'));
alter table brain_heartbeat add column if not exists cron_expression text;
alter table brain_heartbeat add column if not exists last_error text;
alter table brain_heartbeat add column if not exists metadata jsonb default '{}';
alter table brain_heartbeat add column if not exists created_at timestamptz default now();
alter table brain_heartbeat add column if not exists updated_at timestamptz default now();

-- Ensure module_name has a unique constraint
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'brain_heartbeat_module_name_unique') then
    alter table brain_heartbeat add constraint brain_heartbeat_module_name_unique unique (module_name);
  end if;
end;
$$;

create table if not exists brain_pulse (
  id uuid primary key default uuid_generate_v4(),
  last_pulse_at timestamptz default now(),
  status text default 'healthy' check (status in ('healthy', 'unhealthy', 'maintenance'))
);

-- Seed with a row if not exists
insert into brain_pulse (status) select 'healthy' where not exists (select 1 from brain_pulse);

-- Seed some initial modules
insert into brain_heartbeat (module_name, cron_expression, next_run_at) values
  ('inbox_filer', '*/5 * * * *', now() + interval '5 minutes'),
  ('moneypenny_briefing', '0 7 * * *', (current_date + interval '1 day') + interval '7 hours'),
  ('portfolio_audit', '0 0 * * 1', (current_date + interval '1 week') - interval '1 day')
on conflict (module_name) do update
set
  cron_expression = excluded.cron_expression,
  next_run_at = excluded.next_run_at
where brain_heartbeat.cron_expression is null;

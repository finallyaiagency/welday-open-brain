alter table gtd_inbox
  add column if not exists life_domain text not null default 'unknown';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'gtd_inbox_life_domain_check'
  ) then
    alter table gtd_inbox
      add constraint gtd_inbox_life_domain_check
      check (life_domain in ('business','personal','unknown'));
  end if;
end $$;

alter table gtd_projects
  add column if not exists life_domain text not null default 'unknown';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'gtd_projects_life_domain_check'
  ) then
    alter table gtd_projects
      add constraint gtd_projects_life_domain_check
      check (life_domain in ('business','personal','unknown'));
  end if;
end $$;

alter table gtd_actions
  add column if not exists life_domain text not null default 'unknown';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'gtd_actions_life_domain_check'
  ) then
    alter table gtd_actions
      add constraint gtd_actions_life_domain_check
      check (life_domain in ('business','personal','unknown'));
  end if;
end $$;

alter table calendar_events
  add column if not exists life_domain text not null default 'unknown';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'calendar_events_life_domain_check'
  ) then
    alter table calendar_events
      add constraint calendar_events_life_domain_check
      check (life_domain in ('business','personal','unknown'));
  end if;
end $$;

alter table business_memory
  add column if not exists life_domain text not null default 'unknown';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'business_memory_life_domain_check'
  ) then
    alter table business_memory
      add constraint business_memory_life_domain_check
      check (life_domain in ('business','personal','unknown'));
  end if;
end $$;

update gtd_inbox
set life_domain = case
  when ai_category = 'business' then 'business'
  when ai_category = 'personal' then 'personal'
  else 'unknown'
end
where life_domain = 'unknown';

update gtd_projects
set life_domain = case
  when venture_id is not null then 'business'
  when area = 'personal' then 'personal'
  else 'unknown'
end
where life_domain = 'unknown';

update gtd_actions
set life_domain = case
  when venture_id is not null then 'business'
  when exists (
    select 1
    from gtd_projects p
    where p.id = gtd_actions.project_id
      and p.life_domain = 'personal'
  ) then 'personal'
  when exists (
    select 1
    from gtd_projects p
    where p.id = gtd_actions.project_id
      and p.life_domain = 'business'
  ) then 'business'
  else 'unknown'
end
where life_domain = 'unknown';

update calendar_events
set life_domain = case
  when venture_id is not null then 'business'
  when event_type = 'personal' then 'personal'
  when event_type = 'work' then 'business'
  else 'unknown'
end
where life_domain = 'unknown';

update business_memory
set life_domain = case
  when coalesce(array_length(venture_slugs, 1), 0) > 0 then 'business'
  else 'unknown'
end
where life_domain = 'unknown';

create index if not exists idx_gtd_inbox_life_domain on gtd_inbox(life_domain, created_at desc);
create index if not exists idx_gtd_actions_life_domain on gtd_actions(life_domain, status, due_date);
create index if not exists idx_gtd_projects_life_domain on gtd_projects(life_domain, status, due_date);
create index if not exists idx_calendar_events_life_domain on calendar_events(life_domain, start_at);
create index if not exists idx_business_memory_life_domain on business_memory(life_domain, created_at desc);

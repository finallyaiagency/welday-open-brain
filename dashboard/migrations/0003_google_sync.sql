alter table gtd_actions
  add column if not exists source text not null default 'manual';

alter table gtd_actions
  add column if not exists google_task_list_id text;

alter table gtd_actions
  add column if not exists last_synced_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'gtd_actions_source_check'
  ) then
    alter table gtd_actions
      add constraint gtd_actions_source_check
      check (source in ('manual','google','telegram','telegram_smithers','telegram_moneypenny','telegram_burns','dashboard_chat','web','api','ceo_agent','email','system'));
  end if;
end $$;

alter table calendar_events
  add column if not exists source text not null default 'manual';

alter table calendar_events
  add column if not exists google_event_id text;

alter table calendar_events
  add column if not exists google_calendar_id text;

alter table calendar_events
  add column if not exists last_synced_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'calendar_events_source_check'
  ) then
    alter table calendar_events
      add constraint calendar_events_source_check
      check (source in ('manual','google','telegram','telegram_smithers','telegram_moneypenny','telegram_burns','dashboard_chat','web','api','ceo_agent','email','system'));
  end if;
end $$;

update gtd_actions
set source = 'manual'
where source is null;

update calendar_events
set source = 'manual'
where source is null;

create unique index if not exists idx_gtd_actions_google_task_id_unique
  on gtd_actions(google_task_id)
  where google_task_id is not null;

create unique index if not exists idx_calendar_events_google_event_id_unique
  on calendar_events(google_event_id)
  where google_event_id is not null;

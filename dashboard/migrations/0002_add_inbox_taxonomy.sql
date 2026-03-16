alter table gtd_inbox
  add column if not exists tags text[],
  add column if not exists project_id uuid references gtd_projects(id);

create index if not exists idx_gtd_inbox_project_id on gtd_inbox(project_id, created_at desc);
create index if not exists idx_gtd_inbox_tags on gtd_inbox using gin(tags);

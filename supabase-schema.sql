-- ============================================
-- יומן המשימות של אופיר — טבלאות סנכרון בענן
-- להריץ פעם אחת ב-Supabase SQL Editor
-- ============================================

create table if not exists journal_tasks (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists journal_meta (
  key text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table journal_tasks enable row level security;
alter table journal_meta enable row level security;

-- יומן אישי ללא התחברות: מפתח anon מקבל גישה מלאה
drop policy if exists "journal_tasks_all" on journal_tasks;
create policy "journal_tasks_all" on journal_tasks
  for all using (true) with check (true);

drop policy if exists "journal_meta_all" on journal_meta;
create policy "journal_meta_all" on journal_meta
  for all using (true) with check (true);

-- סנכרון בזמן אמת בין מכשירים
alter publication supabase_realtime add table journal_tasks;
alter publication supabase_realtime add table journal_meta;

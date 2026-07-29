-- ============================================================
-- יומן המשימות של אופיר — אוטומציות מתוזמנות
-- בריף בוקר · סיכום שבועי · משימות תקועות · גיבוי יומי
--
-- לפני ההרצה:
--   1. ודא שהתוספים pg_cron ו-pg_net מופעלים (Database → Extensions)
--   2. החלף בקובץ הזה את כל המופעים של __CRON_SECRET__
--      בערך האמיתי של CRON_SECRET מ-Vercel (Ctrl+H בעורך)
--
-- כל השעות ב-UTC. ישראל היא UTC+3 בקיץ (ובחורף UTC+2,
-- ואז כל ההתראות יגיעו שעה מוקדם יותר).
-- ============================================================

-- יומן ריצות + בקרת תדירות של התראות
create table if not exists automation_log (
  key text primary key,
  last_run_at timestamptz default now(),
  detail jsonb
);

-- תמונות מצב יומיות של היומן
create table if not exists journal_backups (
  id bigserial primary key,
  created_at timestamptz default now(),
  task_count int,
  payload jsonb not null
);

create index if not exists journal_backups_created_idx on journal_backups (created_at desc);

alter table automation_log enable row level security;
alter table journal_backups enable row level security;

drop policy if exists automation_log_all on automation_log;
create policy automation_log_all on automation_log for all using (true) with check (true);

drop policy if exists journal_backups_all on journal_backups;
create policy journal_backups_all on journal_backups for all using (true) with check (true);

-- ------------------------------------------------------------
-- המשימות המתוזמנות
-- ------------------------------------------------------------

select cron.unschedule('ofir-morning-brief') where exists (select 1 from cron.job where jobname = 'ofir-morning-brief');
select cron.unschedule('ofir-weekly-digest') where exists (select 1 from cron.job where jobname = 'ofir-weekly-digest');
select cron.unschedule('ofir-stuck-watch')   where exists (select 1 from cron.job where jobname = 'ofir-stuck-watch');
select cron.unschedule('ofir-backup')        where exists (select 1 from cron.job where jobname = 'ofir-backup');

-- בריף בוקר — כל יום ב-07:00 שעון ישראל
select cron.schedule('ofir-morning-brief', '0 4 * * *', $$
  select net.http_post(
    url     := 'https://ofir-task-journal.vercel.app/api/scheduled?job=morning-brief',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','__CRON_SECRET__')
  );
$$);

-- סיכום שבועי — כל יום חמישי ב-16:00 שעון ישראל
select cron.schedule('ofir-weekly-digest', '0 13 * * 4', $$
  select net.http_post(
    url     := 'https://ofir-task-journal.vercel.app/api/scheduled?job=weekly-digest',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','__CRON_SECRET__')
  );
$$);

-- משימות תקועות — כל יום ראשון ב-08:00 שעון ישראל
select cron.schedule('ofir-stuck-watch', '0 5 * * 0', $$
  select net.http_post(
    url     := 'https://ofir-task-journal.vercel.app/api/scheduled?job=stuck-watch',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','__CRON_SECRET__')
  );
$$);

-- גיבוי — כל לילה ב-02:00 שעון ישראל
select cron.schedule('ofir-backup', '0 23 * * *', $$
  select net.http_post(
    url     := 'https://ofir-task-journal.vercel.app/api/scheduled?job=backup',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','__CRON_SECRET__')
  );
$$);

-- בדיקה: אמורות להופיע כאן חמש משימות (כולל ofir-reminders)
select jobname, schedule, active from cron.job order by jobname;

-- ------------------------------------------------------------
-- שחזור מגיבוי (להריץ ידנית רק בעת הצורך)
-- ------------------------------------------------------------
-- 1. לראות את הגיבויים הזמינים:
--      select id, created_at, task_count from journal_backups order by created_at desc limit 20;
-- 2. לשחזר גיבוי מסוים (החלף 123 ב-id הרצוי):
--      begin;
--      delete from journal_tasks;
--      insert into journal_tasks (id, payload)
--      select (t->>'id')::text, t->'payload'
--      from journal_backups b, jsonb_array_elements(b.payload->'tasks') t
--      where b.id = 123;
--      commit;

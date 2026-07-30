-- ============================================================
-- יומן המשימות של אופיר — כל המשימות המתוזמנות בקובץ אחד
--
-- מחליף את supabase-reminders.sql ו-supabase-automations.sql.
-- בטוח להריץ שוב ושוב (idempotent), וגם אם כבר הרצת אותם בעבר.
--
-- דרישה מוקדמת: התוספים pg_cron ו-pg_net מופעלים
-- (Dashboard → Database → Extensions)
--
-- ✏️ הדבר היחיד לשנות בקובץ: השורה המסומנת ב-שלב 2.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- שלב 1: טבלאות
-- ────────────────────────────────────────────────────────────

-- מנויי הדפדפנים שקיבלו הרשאת התראות
create table if not exists push_subscriptions (
  endpoint text primary key,
  subscription jsonb not null,
  created_at timestamptz default now()
);

-- תזכורות שכבר נשלחו (מונע כפילויות) + דופק ה-cron
create table if not exists reminders_sent (
  reminder_id text primary key,
  sent_at timestamptz default now()
);

-- יומן ריצות של האוטומציות + בקרת תדירות התראות
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

alter table push_subscriptions enable row level security;
alter table reminders_sent    enable row level security;
alter table automation_log    enable row level security;
alter table journal_backups   enable row level security;

drop policy if exists push_all on push_subscriptions;
create policy push_all on push_subscriptions for all using (true) with check (true);

drop policy if exists sent_all on reminders_sent;
create policy sent_all on reminders_sent for all using (true) with check (true);

drop policy if exists automation_log_all on automation_log;
create policy automation_log_all on automation_log for all using (true) with check (true);

drop policy if exists journal_backups_all on journal_backups;
create policy journal_backups_all on journal_backups for all using (true) with check (true);


-- ────────────────────────────────────────────────────────────
-- שלב 2: הסוד — המקום היחיד שבו הוא נשמר  ✏️
--
-- החלף את PASTE_YOUR_CRON_SECRET_HERE בערך של CRON_SECRET מ-Vercel.
-- הטבלה הזו מוגנת: RLS מופעל ובלי אף policy, ולכן מפתח ה-anon
-- הציבורי לא יכול לקרוא אותה. רק ה-cron (שרץ כ-postgres) קורא ממנה.
-- ────────────────────────────────────────────────────────────

create table if not exists app_config (
  key text primary key,
  value text not null
);
alter table app_config enable row level security;
revoke all on app_config from anon, authenticated;

insert into app_config (key, value)
values ('cron_secret', 'PASTE_YOUR_CRON_SECRET_HERE')   -- ✏️ כאן, ורק כאן
on conflict (key) do update set value = excluded.value;


-- ────────────────────────────────────────────────────────────
-- שלב 3: תזמון — כל השעות ב-UTC.
-- ישראל היא UTC+3 בקיץ; בחורף (UTC+2) ההתראות יגיעו שעה מוקדם יותר.
-- ────────────────────────────────────────────────────────────

select cron.unschedule(jobname) from cron.job
 where jobname in ('ofir-reminders','ofir-morning-brief','ofir-weekly-digest','ofir-stuck-watch','ofir-backup');

-- תזכורות — כל דקה
select cron.schedule('ofir-reminders', '* * * * *', $$
  select net.http_post(
    url     := 'https://ofir-task-journal.vercel.app/api/send-reminders',
    headers := jsonb_build_object('Content-Type','application/json',
                 'x-cron-secret',(select value from app_config where key='cron_secret'))
  );
$$);

-- בריף בוקר — כל יום ב-07:00 שעון ישראל
select cron.schedule('ofir-morning-brief', '0 4 * * *', $$
  select net.http_post(
    url     := 'https://ofir-task-journal.vercel.app/api/scheduled?job=morning-brief',
    headers := jsonb_build_object('Content-Type','application/json',
                 'x-cron-secret',(select value from app_config where key='cron_secret'))
  );
$$);

-- סיכום שבועי — כל יום חמישי ב-16:00 שעון ישראל
select cron.schedule('ofir-weekly-digest', '0 13 * * 4', $$
  select net.http_post(
    url     := 'https://ofir-task-journal.vercel.app/api/scheduled?job=weekly-digest',
    headers := jsonb_build_object('Content-Type','application/json',
                 'x-cron-secret',(select value from app_config where key='cron_secret'))
  );
$$);

-- משימות תקועות — כל יום ראשון ב-08:00 שעון ישראל
select cron.schedule('ofir-stuck-watch', '0 5 * * 0', $$
  select net.http_post(
    url     := 'https://ofir-task-journal.vercel.app/api/scheduled?job=stuck-watch',
    headers := jsonb_build_object('Content-Type','application/json',
                 'x-cron-secret',(select value from app_config where key='cron_secret'))
  );
$$);

-- גיבוי — כל לילה ב-02:00 שעון ישראל
select cron.schedule('ofir-backup', '0 23 * * *', $$
  select net.http_post(
    url     := 'https://ofir-task-journal.vercel.app/api/scheduled?job=backup',
    headers := jsonb_build_object('Content-Type','application/json',
                 'x-cron-secret',(select value from app_config where key='cron_secret'))
  );
$$);


-- ────────────────────────────────────────────────────────────
-- שלב 4: בדיקה — אמורות להופיע 5 שורות, כולן active = true
-- ────────────────────────────────────────────────────────────

select jobname, schedule, active from cron.job
 where jobname like 'ofir-%' order by jobname;

-- ודא שהסוד נשמר (לא מדפיס אותו, רק את אורכו)
select key, length(value) as secret_length from app_config where key = 'cron_secret';


-- ────────────────────────────────────────────────────────────
-- כלי עזר (להריץ ידנית בעת הצורך)
-- ────────────────────────────────────────────────────────────

-- הרצה מיידית של אוטומציה, בלי לחכות לשעה שלה:
--   select net.http_post(
--     url     := 'https://ofir-task-journal.vercel.app/api/scheduled?job=morning-brief',
--     headers := jsonb_build_object('Content-Type','application/json',
--                  'x-cron-secret',(select value from app_config where key='cron_secret')));

-- מה רץ לאחרונה ומה התוצאה:
--   select key, last_run_at, detail from automation_log order by last_run_at desc;

-- הריצות האחרונות של ה-cron עצמו (כולל שגיאות):
--   select jobname, status, return_message, start_time
--     from cron.job_run_details d join cron.job j using (jobid)
--    order by start_time desc limit 20;

-- הגיבויים הזמינים:
--   select id, created_at, task_count from journal_backups order by created_at desc limit 20;

-- שחזור מגיבוי (החלף 123 ב-id הרצוי):
--   begin;
--   delete from journal_tasks;
--   insert into journal_tasks (id, payload)
--   select (t->>'id')::text, t->'payload'
--     from journal_backups b, jsonb_array_elements(b.payload->'tasks') t
--    where b.id = 123;
--   commit;

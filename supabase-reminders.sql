-- ============================================================
-- יומן המשימות של אופיר — התראות שרת (Web Push)
-- להריץ ב-Supabase SQL Editor אחרי supabase-schema.sql
--
-- דרישה מוקדמת: להפעיל את התוספים pg_cron ו-pg_net
-- (Dashboard → Database → Extensions → חפש והפעל את שניהם)
-- ============================================================

-- טבלת מנויי הדפדפנים שקיבלו הרשאת התראות
create table if not exists push_subscriptions (
  endpoint text primary key,
  subscription jsonb not null,
  created_at timestamptz default now()
);

-- מעקב אחרי תזכורות שכבר נשלחו (מונע כפילויות)
create table if not exists reminders_sent (
  reminder_id text primary key,
  sent_at timestamptz default now()
);

alter table push_subscriptions enable row level security;
alter table reminders_sent enable row level security;

drop policy if exists push_all on push_subscriptions;
create policy push_all on push_subscriptions for all using (true) with check (true);

drop policy if exists sent_all on reminders_sent;
create policy sent_all on reminders_sent for all using (true) with check (true);

-- משימה מתוזמנת: כל דקה קורא לנתיב השרת ששולח תזכורות שהגיע זמנן
select cron.unschedule('ofir-reminders') where exists (select 1 from cron.job where jobname = 'ofir-reminders');

select cron.schedule('ofir-reminders', '* * * * *', $$
  select net.http_post(
    url     := 'https://ofir-task-journal.vercel.app/api/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '18b6380f5abac69a273037a2601c2cbd8d9a25581fcad8c1'
    )
  );
$$);

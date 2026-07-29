import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/server/automation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// דופק ציבורי — בוליאנים ומספרים בלבד, בלי ערכים רגישים.
// שומר חיצוני (GitHub Actions) מושך את זה כל רבע שעה.
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const config = {
    supabase: !!url && !!key,
    vapidPublic: !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    vapidPrivate: !!process.env.VAPID_PRIVATE_KEY,
    cronSecret: !!process.env.CRON_SECRET,
    email: !!process.env.RESEND_API_KEY && !!process.env.ALERT_EMAIL_TO,
  };
  if (!url || !key) {
    return NextResponse.json({ ok: false, reason: "missing-env", config }, { status: 503 });
  }

  const sb = createClient(url, key);
  const problems: string[] = [];

  // תופס מפתח VAPID שהוקלד שגוי — אחרת התזכורות פשוט שותקות בלי סיבה נראית
  const env = requireEnv();
  if (!env.ok) problems.push(`bad-config: ${env.reason}`);

  const [hb, subs, backup] = await Promise.all([
    sb.from("reminders_sent").select("sent_at").eq("reminder_id", "__cron_heartbeat__").maybeSingle(),
    sb.from("push_subscriptions").select("endpoint", { count: "exact", head: true }),
    sb.from("journal_backups").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const hbTs = hb.data?.sent_at ? new Date(hb.data.sent_at).getTime() : NaN;
  const cronAgeMinutes = isNaN(hbTs) ? null : Math.round((Date.now() - hbTs) / 60000);
  if (cronAgeMinutes === null) problems.push("cron-never-ran");
  else if (cronAgeMinutes > 10) problems.push("cron-stale");

  const subscriptions = subs.error ? null : (subs.count ?? 0);
  if (subscriptions === null) problems.push("subscriptions-unreadable");
  else if (subscriptions === 0) problems.push("no-devices");

  const backupTs = backup.data?.created_at ? new Date(backup.data.created_at).getTime() : NaN;
  const backupAgeHours = isNaN(backupTs) ? null : Math.round((Date.now() - backupTs) / 3600000);
  if (backupAgeHours !== null && backupAgeHours > 48) problems.push("backup-stale");

  const ok = problems.length === 0;
  return NextResponse.json(
    { ok, problems, cronAgeMinutes, subscriptions, backupAgeHours, config },
    { status: ok ? 200 : 503 }
  );
}

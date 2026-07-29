import { NextResponse } from "next/server";
import { requireEnv, db, notify, emailShell, record, shouldAlert } from "@/lib/server/automation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROBLEM_TEXT: Record<string, string> = {
  "cron-never-ran": "משימת התזכורות ב-Supabase מעולם לא רצה",
  "cron-stale": "משימת התזכורות הפסיקה לרוץ — תזכורות לא יישלחו",
  "no-devices": "אין אף מכשיר רשום להתראות",
  "subscriptions-unreadable": "לא ניתן לקרוא את טבלת המנויים ב-Supabase",
  "backup-stale": "לא נשמר גיבוי מעל 48 שעות",
};

// נקרא ע"י השומר החיצוני. אין צורך בסוד: הנתיב בודק את הבריאות בעצמו
// ומתריע רק כשבאמת יש תקלה, ולכל היותר פעם ב-6 שעות.
export async function POST(req: Request) {
  const env = requireEnv();
  if (!env.ok) return NextResponse.json({ error: "bad-config", detail: env.reason }, { status: 500 });
  const sb = db(env.url, env.key);

  const origin = new URL(req.url).origin;
  let health: { ok: boolean; problems?: string[] } | null = null;
  try {
    const res = await fetch(`${origin}/api/health`, { cache: "no-store" });
    health = await res.json();
  } catch {
    return NextResponse.json({ error: "health-unreachable" }, { status: 502 });
  }

  if (!health || health.ok) return NextResponse.json({ ok: true, alerted: false });

  const problems = health.problems ?? [];
  if (!(await shouldAlert(sb, "alert:watchdog", 6 * 60))) {
    return NextResponse.json({ ok: false, problems, alerted: false, reason: "cooldown" });
  }

  const readable = problems.map((p) => PROBLEM_TEXT[p] ?? p);
  const out = await notify(
    sb,
    { title: "🚨 תקלה ביומן המשימות", body: readable.join(" · "), tag: "watchdog" },
    {
      subject: "🚨 תקלה ביומן המשימות של אופיר",
      html: emailShell("🚨 זוהתה תקלה", [
        ...readable.map((r) => `<span style="color:#DC2626">${r}</span>`),
        `<br><span style="color:#7C8DA4">אם מדובר בתזכורות שנעצרו — יש לבדוק את המשימה <b>ofir-reminders</b> ב-Supabase (Database → Cron).</span>`,
      ]),
    }
  );

  await record(sb, "alert:watchdog", { problems });
  return NextResponse.json({ ok: false, problems, alerted: true, ...out });
}

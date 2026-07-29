import webpush from "web-push";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// תשתית משותפת לאוטומציות השרת (בריף בוקר, סיכום שבועי,
// משימות תקועות, גיבוי, שומר התראות)
// ============================================================

export type Reminder = { id: string; datetime: string; note: string; fired?: boolean };

export type Task = {
  id: string;
  title: string;
  description?: string;
  notes?: string;
  categoryId?: string | null;
  nature?: string | null;
  critical?: boolean;
  status?: "todo" | "in_progress" | "done";
  createdAt?: string;
  dueDate?: string | null;
  endDate?: string | null;
  reminders?: Reminder[];
  subtasks?: Task[];
};

export type Category = { id: string; name: string; color: string; parentId?: string | null };

export const TZ = "Asia/Jerusalem";

export type EnvResult =
  | { ok: true; url: string; key: string }
  | { ok: false; reason: string };

// setVapidDetails זורק על מפתח פגום. בלי הלכידה כאן כל אוטומציה הייתה
// מחזירה 500 ריק בלי רמז לסיבה — בדיוק התקלה השקטה שקשה לאבחן.
export function requireEnv(): EnvResult {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;

  const missing = [
    !url && "NEXT_PUBLIC_SUPABASE_URL",
    !key && "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    !vapidPublic && "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
    !vapidPrivate && "VAPID_PRIVATE_KEY",
  ].filter(Boolean);
  if (missing.length) return { ok: false, reason: `missing env: ${missing.join(", ")}` };

  // מפתח anon הוא JWT (eyJ…) או מפתח publishable (sb_…). התקלה שכבר קרתה
  // בפועל הייתה הדבקת ה-URL בשדה המפתח — הבדיקה הזו תופסת אותה מיד.
  if (!/^(eyJ|sb_)/.test(key!)) {
    return { ok: false, reason: "NEXT_PUBLIC_SUPABASE_ANON_KEY does not look like a Supabase key (expected eyJ… or sb_…)" };
  }

  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:reminders@ofir-task-journal.app",
      vapidPublic!,
      vapidPrivate!
    );
  } catch (e) {
    return { ok: false, reason: `invalid VAPID keys: ${e instanceof Error ? e.message : String(e)}` };
  }

  return { ok: true, url: url!, key: key! };
}

export function db(url: string, key: string): SupabaseClient {
  return createClient(url, key);
}

export function flatten(tasks: Task[]): Task[] {
  const out: Task[] = [];
  const walk = (list: Task[]) => {
    for (const t of list) { out.push(t); if (t.subtasks) walk(t.subtasks); }
  };
  walk(tasks);
  return out;
}

// מפתח תאריך "YYYY-MM-DD" לפי שעון ישראל — לא לפי UTC של השרת
export function dateKey(d: Date = new Date(), offsetDays = 0): string {
  const shifted = new Date(d.getTime() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(shifted);
}

export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

export const isDone = (t: Task) => t.status === "done";

export async function loadJournal(sb: SupabaseClient): Promise<{ tasks: Task[]; categories: Category[] }> {
  const [tasksRes, metaRes] = await Promise.all([
    sb.from("journal_tasks").select("id,payload"),
    sb.from("journal_meta").select("key,payload"),
  ]);
  if (tasksRes.error) throw tasksRes.error;
  const tasks = ((tasksRes.data ?? []) as { payload: Task }[]).map((r) => r.payload).filter(Boolean);
  const catsRow = (metaRes.data ?? []).find((r: { key: string }) => r.key === "categories");
  return { tasks, categories: (catsRow?.payload as Category[]) ?? [] };
}

// ---- מסירה ----

export type Delivery = { title: string; body: string; url?: string; tag?: string };

export async function pushToAll(sb: SupabaseClient, d: Delivery): Promise<number> {
  const { data } = await sb.from("push_subscriptions").select("endpoint,subscription");
  const subs = (data ?? []) as { endpoint: string; subscription: webpush.PushSubscription }[];
  const payload = JSON.stringify({ title: d.title, body: d.body, tag: d.tag, url: d.url || "/" });
  const stale: string[] = [];
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(s.subscription, payload);
      sent++;
    } catch (e: unknown) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) stale.push(s.endpoint);
    }
  }
  if (stale.length) await sb.from("push_subscriptions").delete().in("endpoint", stale);
  return sent;
}

// שליחת מייל דרך Resend — אופציונלי לגמרי; בלי מפתח פשוט מדלגים
export async function sendEmail(subject: string, html: string): Promise<"sent" | "skipped" | "failed"> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL_TO;
  if (!apiKey || !to) return "skipped";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || "יומן המשימות <onboarding@resend.dev>",
        to: to.split(",").map((s) => s.trim()).filter(Boolean),
        subject,
        html,
      }),
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

export function emailShell(heading: string, lines: string[], cta = true): string {
  const items = lines.map((l) => `<li style="margin:0 0 8px">${l}</li>`).join("");
  return `<div dir="rtl" style="font-family:system-ui,Arial,sans-serif;background:#F2F5F9;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;border:1px solid rgba(23,43,77,.12)">
    <h1 style="margin:0 0 4px;font-size:19px;color:#15253F">${heading}</h1>
    <p style="margin:0 0 16px;font-size:12px;color:#7C8DA4">יומן המשימות של אופיר</p>
    <ul style="margin:0;padding-inline-start:18px;font-size:14px;color:#15253F;line-height:1.6">${items}</ul>
    ${cta ? `<a href="https://ofir-task-journal.vercel.app" style="display:inline-block;margin-top:18px;background:#1D4FD7;color:#fff;text-decoration:none;border-radius:99px;padding:10px 20px;font-size:13px;font-weight:700">פתיחת היומן</a>` : ""}
  </div>
</div>`;
}

export async function notify(
  sb: SupabaseClient,
  d: Delivery,
  email?: { subject: string; html: string }
): Promise<{ pushed: number; email: string }> {
  const pushed = await pushToAll(sb, d);
  const mail = email ? await sendEmail(email.subject, email.html) : "skipped";
  return { pushed, email: mail };
}

// ---- יומן ריצות + מניעת הצפה בהתראות ----

// רישום הוא נלווה בלבד — לעולם לא מפיל את המשימה עצמה, ובעיקר לא את
// מסלול הטיפול בשגיאה שקורא לו כשמסד הנתונים כבר לא זמין.
export async function record(sb: SupabaseClient, key: string, detail: unknown): Promise<void> {
  try {
    await sb.from("automation_log").upsert(
      { key, last_run_at: new Date().toISOString(), detail: detail as object },
      { onConflict: "key" }
    );
  } catch {
    /* best-effort */
  }
}

export async function lastRunAt(sb: SupabaseClient, key: string): Promise<number | null> {
  try {
    const { data } = await sb.from("automation_log").select("last_run_at").eq("key", key).maybeSingle();
    const ts = data?.last_run_at ? new Date(data.last_run_at).getTime() : NaN;
    return isNaN(ts) ? null : ts;
  } catch {
    return null;
  }
}

// מחזיר true רק אם עברו לפחות minIntervalMinutes מההתראה הקודמת מאותו סוג
export async function shouldAlert(sb: SupabaseClient, key: string, minIntervalMinutes: number): Promise<boolean> {
  const last = await lastRunAt(sb, key);
  return last === null || Date.now() - last >= minIntervalMinutes * 60000;
}

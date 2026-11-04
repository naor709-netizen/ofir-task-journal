import webpush from "web-push";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  MANAGER_ID, MANAGER_NAME, META, DEFAULT_PREFS, journalOfPayload, journalPath, metaKey, normalizeRoster,
  type TeamRoster, type NotifyPrefs,
} from "@/lib/journals";
import { telegramToJournal, tgConfigured, type TgButton } from "./telegram";
import { smsToJournal, smsConfigured, smsText } from "./sms";

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
  assignedBy?: string | null;
  journalId?: string;
};

export type Category = { id: string; name: string; color: string; parentId?: string | null };

export const TZ = "Asia/Jerusalem";

// כתובת האתר בפרודקשן — לקישורים בהתראות, במיילים ובטלגרם
export function appUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "https://ofir-task-journal.vercel.app";
}

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

export async function loadRoster(sb: SupabaseClient): Promise<TeamRoster> {
  const { data } = await sb.from("journal_meta").select("payload").eq("key", META.team).maybeSingle();
  return normalizeRoster(data?.payload);
}

export async function loadPrefs(sb: SupabaseClient): Promise<NotifyPrefs> {
  const { data } = await sb.from("journal_meta").select("payload").eq("key", META.prefs).maybeSingle();
  return { ...DEFAULT_PREFS, ...((data?.payload as Partial<NotifyPrefs>) ?? {}) };
}

export interface JournalView {
  id: string;
  name: string;
  tasks: Task[]; // משימות שורש
  categories: Category[];
}

// כל היומנים: של אופיר + של כל אנשי הצוות ברשימה
export async function loadJournals(sb: SupabaseClient): Promise<{ roster: TeamRoster; journals: JournalView[] }> {
  const [tasksRes, metaRes, roster] = await Promise.all([
    sb.from("journal_tasks").select("id,payload"),
    sb.from("journal_meta").select("key,payload").like("key", "categories%"),
    loadRoster(sb),
  ]);
  if (tasksRes.error) throw tasksRes.error;
  const cats = new Map(((metaRes.data ?? []) as { key: string; payload: Category[] }[]).map((r) => [r.key, r.payload]));
  const people = [{ id: MANAGER_ID, name: MANAGER_NAME }, ...roster.members.map((m) => ({ id: m.id, name: m.name }))];
  const journals: JournalView[] = people.map((p) => ({
    ...p,
    tasks: [],
    categories: cats.get(metaKey("categories", p.id)) ?? [],
  }));
  const byId = new Map(journals.map((j) => [j.id, j]));
  for (const r of (tasksRes.data ?? []) as { payload: Task }[]) {
    if (!r.payload) continue;
    byId.get(journalOfPayload(r.payload))?.tasks.push(r.payload);
  }
  return { roster, journals };
}

// היומן של אופיר בלבד (תאימות לקוד קיים)
export async function loadJournal(sb: SupabaseClient): Promise<{ tasks: Task[]; categories: Category[] }> {
  const { journals } = await loadJournals(sb);
  const j = journals.find((x) => x.id === MANAGER_ID)!;
  return { tasks: j.tasks, categories: j.categories };
}

// ---- מסירה ----

export type Delivery = { title: string; body: string; url?: string; tag?: string };

type SubRow = { endpoint: string; subscription: webpush.PushSubscription & { journalId?: string } };

// המכשירים של יומן מסוים. מנויים ישנים בלי שיוך שייכים לאופיר.
export async function journalSubscriptions(sb: SupabaseClient, journalId: string): Promise<SubRow[]> {
  const { data } = await sb.from("push_subscriptions").select("endpoint,subscription");
  return ((data ?? []) as SubRow[]).filter((s) => (s.subscription?.journalId || MANAGER_ID) === journalId);
}

export async function pushToJournal(sb: SupabaseClient, journalId: string, d: Delivery): Promise<number> {
  const subs = await journalSubscriptions(sb, journalId);
  const payload = JSON.stringify({ title: d.title, body: d.body, tag: d.tag, url: d.url || journalPath(journalId) });
  const stale: string[] = [];
  const failures: { status: number | null; host: string; body: string }[] = [];
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(s.subscription, payload, { TTL: 60 * 60 * 12, urgency: "high" });
      sent++;
    } catch (e: unknown) {
      const err = e as { statusCode?: number; body?: string; message?: string };
      const code = err.statusCode ?? null;
      if (code === 404 || code === 410) stale.push(s.endpoint);
      else {
        let host = "";
        try { host = new URL(s.endpoint).host; } catch { /* ignore */ }
        failures.push({ status: code, host, body: String(err.body ?? err.message ?? "").slice(0, 200) });
      }
    }
  }
  if (stale.length) await sb.from("push_subscriptions").delete().in("endpoint", stale);
  // כשל מסירה שקט הוא בדיוק התקלה "ההתראות לא מגיעות" — נרשם כדי שהאבחון יראה אותו
  if (failures.length) await record(sb, "push:errors", { at: new Date().toISOString(), journalId, failures });
  else if (sent) await record(sb, "push:last-ok", { at: new Date().toISOString(), journalId, sent });
  return sent;
}

// תאימות: "לכל המכשירים" היה עד היום = המכשירים של אופיר
export async function pushToAll(sb: SupabaseClient, d: Delivery): Promise<number> {
  return pushToJournal(sb, MANAGER_ID, d);
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
    ${cta ? `<a href="${appUrl()}" style="display:inline-block;margin-top:18px;background:#1D4FD7;color:#fff;text-decoration:none;border-radius:99px;padding:10px 20px;font-size:13px;font-weight:700">פתיחת היומן</a>` : ""}
  </div>
</div>`;
}

type ChannelResult = "sent" | "skipped" | "failed";
export type DeliveryResult = { pushed: number; sms: ChannelResult; telegram: ChannelResult; email: string };

// מסירה ליומן אחד: SMS לטלפון (אם חובר) + פוש לכל המכשירים שלו + טלגרם (אם חובר)
// + מייל (לאופיר בלבד). כל ערוץ עצמאי — כשל באחד לא עוצר את האחרים.
export async function notifyJournal(
  sb: SupabaseClient,
  journalId: string,
  d: Delivery,
  opts: {
    email?: { subject: string; html: string };
    telegram?: { html: string; buttons?: TgButton[][] };
    sms?: string; // טקסט ייעודי ל-SMS; ברירת מחדל: כותרת + גוף, מקוצר ל-2 חלקים
  } = {}
): Promise<DeliveryResult> {
  const tgHtml = opts.telegram?.html ?? `<b>${escHtml(d.title)}</b>\n${escHtml(d.body)}`;
  const [pushed, sms, telegram] = await Promise.all([
    pushToJournal(sb, journalId, d).catch(() => 0),
    smsConfigured() ? smsToJournal(sb, journalId, opts.sms ?? smsText(d.title, d.body)).catch(() => "failed" as const) : Promise.resolve("skipped" as const),
    tgConfigured() ? telegramToJournal(sb, journalId, tgHtml, opts.telegram?.buttons) : Promise.resolve("skipped" as const),
  ]);
  const mail = opts.email && journalId === MANAGER_ID ? await sendEmail(opts.email.subject, opts.email.html) : "skipped";
  return { pushed, sms, telegram, email: mail };
}

export async function notify(
  sb: SupabaseClient,
  d: Delivery,
  email?: { subject: string; html: string }
): Promise<DeliveryResult> {
  return notifyJournal(sb, MANAGER_ID, d, { email });
}

export function escHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}

// ---- יומן ריצות + מניעת הצפה בהתראות ----

// רישום לא מפיל את המשימה, אבל כן מדווח אם נכשל: מנגנון ההשתקה של ההתראות
// מסתמך עליו, ובלי הידיעה הזו השומר היה מתריע שוב ושוב בלי סוף.
export async function record(sb: SupabaseClient, key: string, detail: unknown): Promise<boolean> {
  try {
    const { error } = await sb.from("automation_log").upsert(
      { key, last_run_at: new Date().toISOString(), detail: detail as object },
      { onConflict: "key" }
    );
    return !error;
  } catch {
    return false;
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

// "2026-11-04" → "4.11"
export function formatDue(key: string | null | undefined): string {
  if (!key) return "";
  const [, m, d] = key.split("-");
  return m && d ? `${parseInt(d, 10)}.${parseInt(m, 10)}` : key;
}

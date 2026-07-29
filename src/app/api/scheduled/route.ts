import { NextResponse } from "next/server";
import {
  requireEnv, db, loadJournal, flatten, dateKey, daysSince, isDone,
  notify, emailShell, record, type Task,
} from "@/lib/server/automation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Job = "morning-brief" | "weekly-digest" | "stuck-watch" | "backup";
const JOBS: Job[] = ["morning-brief", "weekly-digest", "stuck-watch", "backup"];

const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const job = (url.searchParams.get("job") || "") as Job;
  if (!JOBS.includes(job)) {
    return NextResponse.json({ error: "unknown-job", allowed: JOBS }, { status: 400 });
  }

  const env = requireEnv();
  if (!env.ok) return NextResponse.json({ error: "bad-config", detail: env.reason }, { status: 500 });
  const sb = db(env.url, env.key);

  try {
    const result = await run(job, sb);
    await record(sb, `job:${job}`, result);
    return NextResponse.json({ job, ...result });
  } catch (e) {
    // שגיאות Supabase אינן Error — בלי זה ההודעה הייתה "[object Object]"
    const message =
      e instanceof Error ? e.message
      : typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message)
      : String(e);
    await record(sb, `job:${job}:error`, { message });
    return NextResponse.json({ job, error: message }, { status: 500 });
  }
}

type Sb = ReturnType<typeof db>;

async function run(job: Job, sb: Sb) {
  if (job === "backup") return backup(sb);

  const { tasks, categories } = await loadJournal(sb);
  const all = flatten(tasks);
  const today = dateKey();
  const catName = (id?: string | null) => categories.find((c) => c.id === id)?.name ?? "";

  if (job === "morning-brief") return morningBrief(sb, all, today, catName);
  if (job === "weekly-digest") return weeklyDigest(sb, all, today);
  return stuckWatch(sb, all, today, catName);
}

// ---- בריף בוקר ----
async function morningBrief(sb: Sb, all: Task[], today: string, catName: (id?: string | null) => string) {
  const open = all.filter((t) => !isDone(t));
  const dueToday = open.filter((t) => t.dueDate === today);
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today);
  const critical = open.filter((t) => t.critical);

  if (dueToday.length === 0 && overdue.length === 0 && critical.length === 0) {
    return { sent: false, reason: "nothing-today" };
  }

  const bits: string[] = [];
  if (dueToday.length) bits.push(`${plural(dueToday.length, "משימה אחת להיום", "משימות להיום")}`);
  if (critical.length) bits.push(`${critical.length} קריטיות`);
  if (overdue.length) bits.push(`${overdue.length} באיחור`);

  const headline = dueToday[0] ?? critical[0] ?? overdue[0];
  const body = `${bits.join(" · ")}${headline?.title ? ` — הכי דחוף: ${headline.title}` : ""}`;

  const lines = [
    ...dueToday.slice(0, 8).map((t) => `<b>${esc(t.title)}</b>${catName(t.categoryId) ? ` <span style="color:#7C8DA4">· ${esc(catName(t.categoryId))}</span>` : ""}`),
    ...overdue.slice(0, 5).map((t) => `<span style="color:#DC2626">באיחור:</span> ${esc(t.title)}`),
  ];
  if (lines.length === 0) lines.push("אין משימות עם תאריך יעד להיום.");

  const out = await notify(
    sb,
    { title: "☀️ הבריף של היום", body, tag: `brief-${today}` },
    { subject: `הבריף של היום — ${bits.join(" · ")}`, html: emailShell("☀️ הבריף של היום", lines) }
  );
  return { sent: true, dueToday: dueToday.length, overdue: overdue.length, critical: critical.length, ...out };
}

// ---- סיכום שבועי ----
async function weeklyDigest(sb: Sb, all: Task[], today: string) {
  const weekAgo = dateKey(new Date(), -7);
  const doneThisWeek = all.filter((t) => isDone(t) && t.endDate && t.endDate >= weekAgo && t.endDate <= today);
  const open = all.filter((t) => !isDone(t));
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today);
  const nextWeek = dateKey(new Date(), 7);
  const upcoming = open.filter((t) => t.dueDate && t.dueDate > today && t.dueDate <= nextWeek);
  const pct = all.length ? Math.round((all.filter(isDone).length / all.length) * 100) : 0;

  const body = `הושלמו ${doneThisWeek.length} השבוע · ${open.length} פתוחות · ${overdue.length} באיחור`;
  const lines = [
    `<b>הושלמו השבוע:</b> ${doneThisWeek.length}`,
    `<b>נותרו פתוחות:</b> ${open.length}`,
    `<b>באיחור:</b> <span style="color:${overdue.length ? "#DC2626" : "#0FA47E"}">${overdue.length}</span>`,
    `<b>לשבוע הבא:</b> ${upcoming.length}`,
    `<b>התקדמות כוללת:</b> ${pct}%`,
    ...(doneThisWeek.length
      ? [`<br><b>מה נסגר השבוע:</b>`, ...doneThisWeek.slice(0, 10).map((t) => `✓ ${esc(t.title)}`)]
      : []),
  ];

  const out = await notify(
    sb,
    { title: "📊 סיכום השבוע", body, tag: `digest-${today}` },
    { subject: `סיכום שבועי — ${doneThisWeek.length} משימות הושלמו`, html: emailShell("📊 סיכום השבוע", lines) }
  );
  return { sent: true, doneThisWeek: doneThisWeek.length, open: open.length, overdue: overdue.length, pct, ...out };
}

// ---- משימות תקועות ----
async function stuckWatch(sb: Sb, all: Task[], today: string, catName: (id?: string | null) => string) {
  const STUCK_DAYS = 14;
  const open = all.filter((t) => !isDone(t));
  const stuck = open.filter((t) => {
    const age = daysSince(t.createdAt);
    return t.status === "in_progress" && age !== null && age >= STUCK_DAYS;
  });
  const longOverdue = open.filter((t) => {
    if (!t.dueDate || t.dueDate >= today) return false;
    const days = Math.floor((Date.parse(today) - Date.parse(t.dueDate)) / 86400000);
    return days >= 7;
  });

  if (stuck.length === 0 && longOverdue.length === 0) {
    return { sent: false, reason: "nothing-stuck" };
  }

  const body = [
    stuck.length ? `${stuck.length} תקועות ב"בתהליך"` : "",
    longOverdue.length ? `${longOverdue.length} באיחור מעל שבוע` : "",
  ].filter(Boolean).join(" · ");

  const label = (t: Task) => `${esc(t.title)}${catName(t.categoryId) ? ` <span style="color:#7C8DA4">· ${esc(catName(t.categoryId))}</span>` : ""}`;
  const lines = [
    ...(stuck.length ? [`<b>תקועות ב"בתהליך" מעל שבועיים:</b>`, ...stuck.slice(0, 10).map(label)] : []),
    ...(longOverdue.length ? [`<br><b>באיחור מעל שבוע:</b>`, ...longOverdue.slice(0, 10).map(label)] : []),
  ];

  const out = await notify(
    sb,
    { title: "🕸️ משימות שנתקעו", body, tag: `stuck-${today}` },
    { subject: `משימות שנתקעו — ${body}`, html: emailShell("🕸️ משימות שנתקעו", lines) }
  );
  return { sent: true, stuck: stuck.length, longOverdue: longOverdue.length, ...out };
}

// ---- גיבוי ----
async function backup(sb: Sb) {
  const [tasksRes, metaRes] = await Promise.all([
    sb.from("journal_tasks").select("id,payload"),
    sb.from("journal_meta").select("key,payload"),
  ]);
  if (tasksRes.error) throw tasksRes.error;
  const tasks = tasksRes.data ?? [];
  const meta = metaRes.data ?? [];

  // גיבוי ריק כשיש נתונים קודמים הוא כמעט תמיד תקלה — לא דורסים איתו את ההיסטוריה
  if (tasks.length === 0) {
    const { count } = await sb.from("journal_backups").select("id", { count: "exact", head: true });
    if ((count ?? 0) > 0) return { saved: false, reason: "refused-empty-snapshot" };
  }

  const { error } = await sb.from("journal_backups").insert({
    task_count: tasks.length,
    payload: { tasks, meta },
  });
  if (error) throw error;

  // שמירת 30 הגיבויים האחרונים בלבד
  const { data: old } = await sb
    .from("journal_backups").select("id").order("created_at", { ascending: false }).range(30, 200);
  const ids = (old ?? []).map((r: { id: number }) => r.id);
  if (ids.length) await sb.from("journal_backups").delete().in("id", ids);

  return { saved: true, taskCount: tasks.length, pruned: ids.length };
}

function esc(s: string): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}

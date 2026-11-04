import { NextResponse } from "next/server";
import {
  requireEnv, db, loadJournals, loadPrefs, dateKey, notifyJournal, emailShell, record, appUrl, escHtml,
  type Task, type JournalView,
} from "@/lib/server/automation";
import { summarize, personLine, taskBullets, todayHtml, plural } from "@/lib/server/briefs";
import { MANAGER_ID, journalPath } from "@/lib/journals";
import type { TgButton } from "@/lib/server/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Job = "morning-brief" | "weekly-digest" | "stuck-watch" | "backup";
const JOBS: Job[] = ["morning-brief", "weekly-digest", "stuck-watch", "backup"];

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

  const [{ journals }, prefs] = await Promise.all([loadJournals(sb), loadPrefs(sb)]);
  const today = dateKey();
  const members = journals.filter((j) => j.id !== MANAGER_ID);

  if (job === "morning-brief") return morningBrief(sb, journals, members, today, prefs.teamBrief);
  if (job === "weekly-digest") return weeklyDigest(sb, journals, members, today, prefs.teamBrief);
  return stuckWatch(sb, journals, members, today, prefs.teamBrief);
}

const openBtn = (j: JournalView): TgButton[][] => [[{ text: "פתיחת היומן", url: `${appUrl()}${journalPath(j.id)}` }]];
const teamBtn: TgButton[][] = [[{ text: "דשבורד הצוות", url: `${appUrl()}/?view=team` }]];

function catLabel(j: JournalView, t: Task): string {
  const name = j.categories.find((c) => c.id === t.categoryId)?.name;
  return name ? ` <span style="color:#7C8DA4">· ${escHtml(name)}</span>` : "";
}

// ---- בריף בוקר ----
async function morningBrief(sb: Sb, journals: JournalView[], members: JournalView[], today: string, teamBrief: boolean) {
  const results: Record<string, unknown> = {};

  for (const j of journals) {
    const s = summarize(j.tasks, today);
    if (s.dueToday.length === 0 && s.overdue.length === 0 && s.critical.length === 0) {
      results[j.id] = { sent: false, reason: "nothing-today" };
      continue;
    }
    const bits: string[] = [];
    if (s.dueToday.length) bits.push(plural(s.dueToday.length, "משימה אחת להיום", "משימות להיום"));
    if (s.critical.length) bits.push(`${s.critical.length} קריטיות`);
    if (s.overdue.length) bits.push(`${s.overdue.length} באיחור`);
    const headline = s.dueToday[0] ?? s.critical[0] ?? s.overdue[0];
    const body = `${bits.join(" · ")}${headline?.title ? ` — הכי דחוף: ${headline.title}` : ""}`;

    const lines = [
      ...s.dueToday.slice(0, 8).map((t) => `<b>${escHtml(t.title)}</b>${catLabel(j, t)}`),
      ...s.overdue.slice(0, 5).map((t) => `<span style="color:#DC2626">באיחור:</span> ${escHtml(t.title)}`),
    ];
    if (lines.length === 0) lines.push("אין משימות עם תאריך יעד להיום.");

    results[j.id] = await notifyJournal(
      sb, j.id,
      { title: "☀️ הבריף של היום", body, tag: `brief-${today}` },
      {
        email: { subject: `הבריף של היום — ${bits.join(" · ")}`, html: emailShell("☀️ הבריף של היום", lines) },
        telegram: { html: todayHtml(j.name, s), buttons: openBtn(j) },
      }
    );
  }

  // תמונת מצב הצוות — לאופיר בלבד
  if (teamBrief && members.length) {
    const rows = members.map((m) => personLine(m, summarize(m.tasks, today)));
    if (rows.some((r) => r.active)) {
      results.team = await notifyJournal(
        sb, MANAGER_ID,
        { title: "👥 הצוות היום", body: rows.map((r) => r.text).join(" · "), tag: `team-brief-${today}`, url: "/?view=team" },
        { telegram: { html: ["<b>👥 הצוות היום</b>", "", ...rows.map((r) => r.html)].join("\n"), buttons: teamBtn } }
      );
    }
  }
  return { sent: true, results };
}

// ---- סיכום שבועי ----
async function weeklyDigest(sb: Sb, journals: JournalView[], members: JournalView[], today: string, teamBrief: boolean) {
  const results: Record<string, unknown> = {};
  for (const j of journals) {
    const s = summarize(j.tasks, today);
    const body = `הושלמו ${s.doneThisWeek.length} השבוע · ${s.open.length} פתוחות · ${s.overdue.length} באיחור`;
    const lines = [
      `<b>הושלמו השבוע:</b> ${s.doneThisWeek.length}`,
      `<b>נותרו פתוחות:</b> ${s.open.length}`,
      `<b>באיחור:</b> <span style="color:${s.overdue.length ? "#DC2626" : "#0FA47E"}">${s.overdue.length}</span>`,
      `<b>לשבוע הבא:</b> ${s.upcoming.length}`,
      `<b>התקדמות כוללת:</b> ${s.pct}%`,
      ...(s.doneThisWeek.length
        ? [`<br><b>מה נסגר השבוע:</b>`, ...s.doneThisWeek.slice(0, 10).map((t) => `✓ ${escHtml(t.title)}`)]
        : []),
    ];
    const tgHtml = [
      `<b>📊 סיכום השבוע — ${escHtml(j.name)}</b>`,
      "",
      `✅ הושלמו: <b>${s.doneThisWeek.length}</b>`,
      `📋 פתוחות: <b>${s.open.length}</b>`,
      `⏰ באיחור: <b>${s.overdue.length}</b>`,
      `📅 לשבוע הבא: <b>${s.upcoming.length}</b>`,
      `📈 התקדמות כוללת: <b>${s.pct}%</b>`,
      ...(s.doneThisWeek.length ? ["", "<b>מה נסגר:</b>", ...taskBullets(s.doneThisWeek, 8, "✓")] : []),
    ].join("\n");
    results[j.id] = await notifyJournal(
      sb, j.id,
      { title: "📊 סיכום השבוע", body, tag: `digest-${today}` },
      {
        email: { subject: `סיכום שבועי — ${s.doneThisWeek.length} משימות הושלמו`, html: emailShell("📊 סיכום השבוע", lines) },
        telegram: { html: tgHtml, buttons: openBtn(j) },
      }
    );
  }

  if (teamBrief && members.length) {
    const rows = members.map((m) => {
      const s = summarize(m.tasks, today);
      return {
        text: `${m.name}: ${s.doneThisWeek.length} הושלמו, ${s.open.length} פתוחות`,
        html: `<b>${escHtml(m.name)}</b> — ✅ ${s.doneThisWeek.length} הושלמו · 📋 ${s.open.length} פתוחות · ⏰ ${s.overdue.length} באיחור · ${s.pct}%`,
      };
    });
    results.team = await notifyJournal(
      sb, MANAGER_ID,
      { title: "👥 הצוות השבוע", body: rows.map((r) => r.text).join(" · "), tag: `team-digest-${today}`, url: "/?view=team" },
      { telegram: { html: ["<b>👥 הצוות השבוע</b>", "", ...rows.map((r) => r.html)].join("\n"), buttons: teamBtn } }
    );
  }
  return { sent: true, results };
}

// ---- משימות תקועות ----
async function stuckWatch(sb: Sb, journals: JournalView[], members: JournalView[], today: string, teamBrief: boolean) {
  const results: Record<string, unknown> = {};
  for (const j of journals) {
    const s = summarize(j.tasks, today);
    if (s.stuck.length === 0 && s.longOverdue.length === 0) {
      results[j.id] = { sent: false, reason: "nothing-stuck" };
      continue;
    }
    const body = [
      s.stuck.length ? `${s.stuck.length} תקועות ב"בתהליך"` : "",
      s.longOverdue.length ? `${s.longOverdue.length} באיחור מעל שבוע` : "",
    ].filter(Boolean).join(" · ");
    const label = (t: Task) => `${escHtml(t.title)}${catLabel(j, t)}`;
    const lines = [
      ...(s.stuck.length ? [`<b>תקועות ב"בתהליך" מעל שבועיים:</b>`, ...s.stuck.slice(0, 10).map(label)] : []),
      ...(s.longOverdue.length ? [`<br><b>באיחור מעל שבוע:</b>`, ...s.longOverdue.slice(0, 10).map(label)] : []),
    ];
    const tgHtml = [
      `<b>🕸️ משימות שנתקעו — ${escHtml(j.name)}</b>`,
      ...(s.stuck.length ? ["", "<b>ב\"בתהליך\" מעל שבועיים:</b>", ...taskBullets(s.stuck, 8)] : []),
      ...(s.longOverdue.length ? ["", "<b>באיחור מעל שבוע:</b>", ...taskBullets(s.longOverdue, 8, "⏰")] : []),
    ].join("\n");
    results[j.id] = await notifyJournal(
      sb, j.id,
      { title: "🕸️ משימות שנתקעו", body, tag: `stuck-${today}` },
      {
        email: { subject: `משימות שנתקעו — ${body}`, html: emailShell("🕸️ משימות שנתקעו", lines) },
        telegram: { html: tgHtml, buttons: openBtn(j) },
      }
    );
  }

  if (teamBrief && members.length) {
    const rows = members
      .map((m) => ({ m, s: summarize(m.tasks, today) }))
      .filter(({ s }) => s.stuck.length || s.longOverdue.length);
    if (rows.length) {
      const html = [
        "<b>🕸️ תקוע אצל הצוות</b>",
        ...rows.flatMap(({ m, s }) => [
          "",
          `<b>${escHtml(m.name)}</b>`,
          ...taskBullets([...s.stuck, ...s.longOverdue.filter((t) => !s.stuck.includes(t))], 6),
        ]),
      ].join("\n");
      results.team = await notifyJournal(
        sb, MANAGER_ID,
        {
          title: "🕸️ תקוע אצל הצוות",
          body: rows.map(({ m, s }) => `${m.name}: ${s.stuck.length + s.longOverdue.length}`).join(" · "),
          tag: `team-stuck-${today}`, url: "/?view=team",
        },
        { telegram: { html, buttons: teamBtn } }
      );
    }
  }
  return { sent: true, results };
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

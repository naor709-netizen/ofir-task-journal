import type { SupabaseClient } from "@supabase/supabase-js";
import { MANAGER_ID, MANAGER_NAME, journalPath, memberById } from "@/lib/journals";
import { loadRoster, loadPrefs, notifyJournal, escHtml, appUrl, formatDue, type Task } from "./automation";
import { journalRows, findInTree, claimOnce } from "./journal-ops";

// ============================================================
// עדכוני צוות: אשת צוות סגרה/הוסיפה משימה → אופיר מקבל עדכון לטלפון;
// אופיר הקצה משימה → אשת הצוות מקבלת עדכון לטלפון.
// כל אירוע מאומת מול הנתונים בענן ונשלח פעם אחת בלבד.
// ============================================================

export type ActivityType = "done" | "new" | "assigned";

export async function handleActivity(
  sb: SupabaseClient,
  journalId: string,
  events: { type: ActivityType; taskId: string }[]
): Promise<{ sent: number; skipped: number }> {
  if (journalId === MANAGER_ID || !events.length) return { sent: 0, skipped: events.length };
  const [roster, prefs, rows] = await Promise.all([loadRoster(sb), loadPrefs(sb), journalRows(sb, journalId)]);
  const member = memberById(roster, journalId);
  if (!member) return { sent: 0, skipped: events.length };

  const find = (id: string): Task | null => {
    for (const r of rows) {
      const t = findInTree(r.payload, id);
      if (t) return t;
    }
    return null;
  };

  const done: Task[] = [];
  const added: Task[] = [];
  const assigned: Task[] = [];
  let skipped = 0;

  for (const ev of events.slice(0, 30)) {
    const t = find(ev.taskId);
    const valid =
      !!t && !!t.title?.trim() &&
      (ev.type === "done" ? t.status === "done"
        : ev.type === "assigned" ? t.assignedBy === MANAGER_ID
        : true);
    if (!valid || !(await claimOnce(sb, `act:${ev.type}:${ev.taskId}`))) { skipped++; continue; }
    if (ev.type === "done") done.push(t!);
    else if (ev.type === "new") added.push(t!);
    else assigned.push(t!);
  }

  let sent = 0;
  const herJournal = `${appUrl()}${journalPath(journalId)}`;
  const name = member.name;

  if (done.length && prefs.memberDone) {
    const title = `✅ ${name} · ${done.length === 1 ? "משימה הושלמה" : `${done.length} משימות הושלמו`}`;
    await notifyJournal(
      sb, MANAGER_ID,
      { title, body: done.map((t) => t.title).join(" · "), tag: `act-done-${journalId}`, url: "/?view=team" },
      {
        telegram: {
          html: [`<b>${escHtml(title)}</b>`, ...done.map((t) => `✓ ${escHtml(t.title)}`)].join("\n"),
          buttons: [[{ text: `היומן של ${name}`, url: herJournal }, { text: "דשבורד הצוות", url: `${appUrl()}/?view=team` }]],
        },
      }
    );
    sent++;
  }

  if (added.length && prefs.memberNew) {
    const title = `📝 ${name} · ${added.length === 1 ? "משימה חדשה" : `${added.length} משימות חדשות`}`;
    await notifyJournal(
      sb, MANAGER_ID,
      { title, body: added.map((t) => t.title).join(" · "), tag: `act-new-${journalId}`, url: "/?view=team" },
      {
        telegram: {
          html: [
            `<b>${escHtml(title)}</b>`,
            ...added.map((t) => `• ${escHtml(t.title)}${t.dueDate ? ` <i>(יעד ${formatDue(t.dueDate)})</i>` : ""}${t.critical ? " 🔴" : ""}`),
          ].join("\n"),
          buttons: [[{ text: `היומן של ${name}`, url: herJournal }]],
        },
      }
    );
    sent++;
  }

  for (const t of assigned) {
    await notifyJournal(
      sb, journalId,
      {
        title: `📌 משימה חדשה מ${MANAGER_NAME}`,
        body: `${t.title}${t.dueDate ? ` · יעד ${formatDue(t.dueDate)}` : ""}`,
        tag: `assigned-${t.id}`,
        url: journalPath(journalId),
      },
      {
        telegram: {
          html: [
            `<b>📌 משימה חדשה מ${MANAGER_NAME}</b>`,
            escHtml(t.title),
            t.description ? `<i>${escHtml(t.description).slice(0, 300)}</i>` : "",
            t.dueDate ? `🎯 יעד: ${formatDue(t.dueDate)}` : "",
            t.critical ? "🔴 קריטית" : "",
          ].filter(Boolean).join("\n"),
          buttons: [
            [{ text: "✓ בוצע", callback_data: `d:${t.id}` }],
            [{ text: "פתיחת היומן", url: herJournal }],
          ],
        },
      }
    );
    sent++;
  }

  return { sent, skipped };
}

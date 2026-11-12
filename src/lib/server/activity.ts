import type { SupabaseClient } from "@supabase/supabase-js";
import { MANAGER_ID, MANAGER_NAME, journalPath, memberById, participantsOfPayload } from "@/lib/journals";
import { loadRoster, loadPrefs, notifyJournal, escHtml, appUrl, formatDue, type Task } from "./automation";
import { journalRows, findInTree, claimOnce } from "./journal-ops";

// ============================================================
// עדכוני צוות: אשת צוות סגרה/הוסיפה משימה → אופיר מקבל עדכון לטלפון;
// אופיר הקצה משימה → אשת הצוות מקבלת עדכון לטלפון.
// משימה משותפת: שותף/ה חדש/ה מקבל/ת עדכון, וכשאחד הצדדים מסיים — השני יודע.
// כל אירוע מאומת מול הנתונים בענן ונשלח פעם אחת בלבד.
// ============================================================

export type ActivityType = "done" | "new" | "assigned" | "nudge" | "shared";

export async function handleActivity(
  sb: SupabaseClient,
  journalId: string,
  events: { type: ActivityType; taskId: string }[]
): Promise<{ sent: number; skipped: number }> {
  if (!events.length) return { sent: 0, skipped: 0 };
  const [roster, prefs, rows] = await Promise.all([loadRoster(sb), loadPrefs(sb), journalRows(sb, journalId)]);
  // מי שפעל: אופיר (רק עדכונים על משימות משותפות יוצאים ממנו) או איש/אשת צוות
  const isManager = journalId === MANAGER_ID;
  const member = memberById(roster, journalId);
  if (!isManager && !member) return { sent: 0, skipped: events.length };
  const name = isManager ? MANAGER_NAME : member!.name;
  const known = (id: string) => id === MANAGER_ID || !!memberById(roster, id);

  const find = (id: string): { root: Task; task: Task } | null => {
    for (const r of rows) {
      const t = findInTree(r.payload, id);
      if (t) return { root: r.payload, task: t };
    }
    return null;
  };

  const done: Task[] = [];
  const added: Task[] = [];
  const assigned: Task[] = [];
  const nudged: Task[] = [];
  const sharedNew: { to: string; task: Task }[] = [];
  const sharedDone: { to: string; task: Task }[] = [];
  // "בקשת עדכון" מאופיר: לכל היותר פעם בחצי שעה לאותה משימה
  const bucket = Math.floor(Date.now() / (30 * 60000));
  let skipped = 0;

  for (const ev of events.slice(0, 30)) {
    const hit = find(ev.taskId);
    const t = hit?.task ?? null;
    const titled = !!t && !!t.title?.trim();
    // שאר השותפים במשימה (ריק כשהיא לא משותפת)
    const partners = hit ? participantsOfPayload(hit.root).filter((p) => p !== journalId && known(p)) : [];

    if (ev.type === "shared") {
      let any = false;
      if (titled && hit!.root.id === ev.taskId) {
        for (const to of partners) {
          if (await claimOnce(sb, `act:shared:${ev.taskId}:${to}`)) { sharedNew.push({ to, task: t! }); any = true; }
        }
      }
      if (!any) skipped++;
      continue;
    }

    if (ev.type === "done" && titled && t!.status === "done") {
      for (const to of partners) {
        if (to === MANAGER_ID) continue; // אופיר מקבל את עדכון הצוות הרגיל, למטה
        if (await claimOnce(sb, `act:sdone:${ev.taskId}:${to}`)) sharedDone.push({ to, task: t! });
      }
    }
    if (isManager) continue;

    const valid =
      titled &&
      (ev.type === "done" ? t!.status === "done"
        : ev.type === "assigned" ? t!.assignedBy === MANAGER_ID
        : ev.type === "nudge" ? t!.status !== "done"
        // משימה חדשה שכבר משותפת עם אופיר — העדכון על השיתוף מספיק
        : !partners.includes(MANAGER_ID));
    const key = ev.type === "nudge" ? `act:nudge:${ev.taskId}:${bucket}` : `act:${ev.type}:${ev.taskId}`;
    if (!valid || !(await claimOnce(sb, key))) { skipped++; continue; }
    if (ev.type === "done") done.push(t!);
    else if (ev.type === "new") added.push(t!);
    else if (ev.type === "nudge") nudged.push(t!);
    else assigned.push(t!);
  }

  let sent = 0;
  const herJournal = `${appUrl()}${journalPath(journalId)}`;

  for (const { to, task: t } of sharedNew) {
    const title = `🤝 משימה משותפת עם ${name}`;
    await notifyJournal(
      sb, to,
      { title, body: `${t.title}${t.dueDate ? ` · יעד ${formatDue(t.dueDate)}` : ""}`, tag: `shared-${t.id}`, url: journalPath(to) },
      {
        telegram: {
          html: [
            `<b>${escHtml(title)}</b>`,
            escHtml(t.title),
            t.description ? `<i>${escHtml(t.description).slice(0, 300)}</i>` : "",
            t.dueDate ? `🎯 יעד: ${formatDue(t.dueDate)}` : "",
            t.critical ? "🔴 קריטית" : "",
            "המשימה מופיעה ביומן של שניכם — כל אחד יכול לעדכן ולסמן.",
          ].filter(Boolean).join("\n"),
          buttons: [
            [{ text: "✓ בוצע", callback_data: `d:${t.id}` }],
            [{ text: "פתיחת היומן", url: `${appUrl()}${journalPath(to)}` }],
          ],
        },
      }
    );
    sent++;
  }

  for (const { to, task: t } of sharedDone) {
    const title = "✅ משימה משותפת הושלמה";
    await notifyJournal(
      sb, to,
      { title, body: `${t.title} · ${name}`, tag: `shared-done-${t.id}`, url: journalPath(to) },
      {
        telegram: {
          html: [`<b>${title}</b>`, `✓ ${escHtml(t.title)}`, `<i>סומנה אצל ${escHtml(name)}</i>`].join("\n"),
          buttons: [[{ text: "פתיחת היומן", url: `${appUrl()}${journalPath(to)}` }]],
        },
      }
    );
    sent++;
  }

  // מכאן — עדכוני צוות, רק כשמי שפעל הוא איש/אשת צוות
  if (isManager) return { sent, skipped };

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

  for (const t of nudged) {
    await notifyJournal(
      sb, journalId,
      {
        title: `📣 ${MANAGER_NAME} מבקש עדכון`,
        body: `${t.title}${t.dueDate ? ` · יעד ${formatDue(t.dueDate)}` : ""}`,
        tag: `nudge-${t.id}`,
        url: journalPath(journalId),
      },
      {
        telegram: {
          html: [
            `<b>📣 ${MANAGER_NAME} מבקש עדכון</b>`,
            escHtml(t.title),
            t.dueDate ? `🎯 יעד: ${formatDue(t.dueDate)}` : "",
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

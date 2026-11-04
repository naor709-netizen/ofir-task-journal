import { dateKey, daysSince, flatten, isDone, escHtml, type Task, type JournalView } from "./automation";

// ============================================================
// תקצירים — אותו תוכן בשלושה פורמטים: פוש (טקסט), טלגרם (HTML מצומצם), מייל
// ============================================================

export type Summary = {
  open: Task[];
  dueToday: Task[];
  overdue: Task[];
  critical: Task[];
  inProgress: Task[];
  doneThisWeek: Task[];
  upcoming: Task[];
  stuck: Task[];
  longOverdue: Task[];
  pct: number;
};

export function summarize(roots: Task[], today = dateKey()): Summary {
  const all = flatten(roots);
  const open = all.filter((t) => !isDone(t));
  const weekAgo = dateKey(new Date(), -7);
  const nextWeek = dateKey(new Date(), 7);
  return {
    open,
    dueToday: open.filter((t) => t.dueDate === today),
    overdue: open.filter((t) => t.dueDate && t.dueDate < today),
    critical: open.filter((t) => t.critical),
    inProgress: open.filter((t) => t.status === "in_progress"),
    doneThisWeek: all.filter((t) => isDone(t) && t.endDate && t.endDate >= weekAgo && t.endDate <= today),
    upcoming: open.filter((t) => t.dueDate && t.dueDate > today && t.dueDate <= nextWeek),
    stuck: open.filter((t) => {
      const age = daysSince(t.createdAt);
      return t.status === "in_progress" && age !== null && age >= 14;
    }),
    longOverdue: open.filter((t) => {
      if (!t.dueDate || t.dueDate >= today) return false;
      return Math.floor((Date.parse(today) - Date.parse(t.dueDate)) / 86400000) >= 7;
    }),
    pct: all.length ? Math.round((all.filter(isDone).length / all.length) * 100) : 0,
  };
}

export const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

// שורת סטטוס קצרה לכל אחד מאנשי הצוות (לבריף של המנהל)
export function personLine(j: JournalView, s: Summary): { text: string; html: string; active: boolean } {
  const bits: string[] = [];
  if (s.dueToday.length) bits.push(`${s.dueToday.length} להיום`);
  if (s.overdue.length) bits.push(`${s.overdue.length} באיחור`);
  if (s.critical.length) bits.push(`${s.critical.length} קריטיות`);
  if (s.inProgress.length) bits.push(`${s.inProgress.length} בתהליך`);
  const tail = bits.length ? bits.join(" · ") : s.open.length ? `${s.open.length} פתוחות, בלי יעד להיום` : "אין משימות פתוחות";
  return {
    text: `${j.name}: ${tail}`,
    html: `<b>${escHtml(j.name)}</b> — ${escHtml(tail)}${s.overdue.length ? " ⚠️" : ""}`,
    active: bits.length > 0,
  };
}

export function taskBullets(list: Task[], max: number, prefix = "•"): string[] {
  const lines = list.slice(0, max).map((t) => `${prefix} ${escHtml(t.title || "ללא שם")}${t.critical ? " 🔴" : ""}`);
  if (list.length > max) lines.push(`<i>ועוד ${list.length - max}…</i>`);
  return lines;
}

// "/today" בטלגרם ובבריף הבוקר
export function todayHtml(name: string, s: Summary): string {
  const out = [`<b>☀️ ${escHtml(name)} — היום</b>`];
  if (s.dueToday.length) out.push("", "<b>להיום:</b>", ...taskBullets(s.dueToday, 10));
  if (s.overdue.length) out.push("", "<b>באיחור:</b>", ...taskBullets(s.overdue, 6, "⏰"));
  const extraCritical = s.critical.filter((t) => !s.dueToday.includes(t) && !s.overdue.includes(t));
  if (extraCritical.length) out.push("", "<b>קריטיות:</b>", ...taskBullets(extraCritical, 5, "🔥"));
  if (out.length === 1) out.push("", "אין משימות להיום — יום נקי ✨");
  return out.join("\n");
}

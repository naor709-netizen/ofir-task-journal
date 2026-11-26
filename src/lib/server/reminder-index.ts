import type { SupabaseClient } from "@supabase/supabase-js";
import { participantsOfPayload } from "@/lib/journals";
import { flatten, type Task } from "./automation";

// ============================================================
// אינדקס תזכורות — כדי שה-cron של כל דקה לא יוריד את כל היומנים
// ============================================================
// קודם, כל דקה נמשכו כל המשימות של כל היומנים, כולל קבצים מצורפים — 1,440 פעמים
// ביום. זו הייתה רוב התעבורה מ-Supabase, שחרגה מהמכסה וגרמה לחסימה בנובמבר 2026.
// עכשיו, כל דקה נבדקים רק מספר השורות והחותמת האחרונה (בקשה זעירה), ושורה אחת
// ב-journal_meta שמחזיקה רק תזכורות שעוד רלוונטיות. משימות נמשכות רק כשמשהו השתנה —
// ורק השורות שהשתנו — ובכל מקרה משיכה מלאה פעם בשעה, כרשת ביטחון.

export const REMINDER_INDEX_KEY = "__reminder_index__";
const FULL_SCAN_EVERY = 60 * 60 * 1000;
// החותמות נכתבות לפי השעון של המכשיר. מושכים גם קצת אחורה, לשעונים שמפגרים מעט
const CLOCK_SLACK = 10 * 60 * 1000;
// תזכורת ישנה מזה לא נשלחת ממילא (חלון השליחה הוא שעה)
const KEEP_PAST = 60 * 60 * 1000;

export type IndexedReminder = {
  reminderId: string;
  at: number;
  note: string;
  journalIds: string[];
  task: Pick<Task, "id" | "title" | "critical">;
};

type ReminderIndex = {
  v: 1;
  count: number;
  maxUpdatedAt: string;
  fullScanAt: number;
  rows: Record<string, IndexedReminder[]>;
};

type Row = { id: string; payload: Task | null };

function remindersOfRow(payload: Task, keepFrom: number): IndexedReminder[] {
  const journalIds = participantsOfPayload(payload);
  const out: IndexedReminder[] = [];
  for (const t of flatten([payload])) {
    if (t.status === "done") continue; // משימה שכבר נסגרה לא מנדנדת
    for (const r of t.reminders ?? []) {
      const at = r.datetime ? new Date(r.datetime).getTime() : NaN;
      if (!isNaN(at) && at >= keepFrom) {
        out.push({ reminderId: r.id, at, note: r.note, journalIds, task: { id: t.id, title: t.title, critical: t.critical } });
      }
    }
  }
  return out;
}

function indexRows(rows: Row[], into: Record<string, IndexedReminder[]>, keepFrom: number) {
  for (const r of rows) {
    const items = r.payload ? remindersOfRow(r.payload, keepFrom) : [];
    if (items.length) into[r.id] = items;
    else delete into[r.id];
  }
}

// כל התזכורות שהגיע זמנן (בין windowStart ל-now), בכל היומנים, כולל שלבים
export async function dueReminders(
  sb: SupabaseClient,
  now: number,
  windowStart: number
): Promise<{ due: IndexedReminder[]; scan: "index" | "changed" | "full" }> {
  // 1. מצב הטבלה, בלי תוכן: כמה שורות, ומתי נכתבה האחרונה
  const head = await sb
    .from("journal_tasks")
    .select("updated_at", { count: "exact" })
    .order("updated_at", { ascending: false })
    .limit(1);
  if (head.error) throw head.error;
  const count = head.count ?? 0;
  const maxUpdatedAt = String((head.data?.[0] as { updated_at?: string } | undefined)?.updated_at ?? "");

  // 2. האינדקס השמור. אם הוא חסר או לא קריא — משיכה מלאה, כמו פעם
  const saved = await sb.from("journal_meta").select("payload").eq("key", REMINDER_INDEX_KEY).maybeSingle();
  const prev = !saved.error && (saved.data?.payload as ReminderIndex | undefined)?.v === 1
    ? (saved.data!.payload as ReminderIndex)
    : null;

  const keepFrom = now - KEEP_PAST;
  let next: ReminderIndex;
  let scan: "index" | "changed" | "full";
  if (!prev || prev.count !== count || now - prev.fullScanAt > FULL_SCAN_EVERY) {
    // שורה נוספה או נמחקה, או שעברה שעה: בונים מחדש מכל השורות
    const { data, error } = await sb.from("journal_tasks").select("id,payload");
    if (error) throw error;
    const rows: Record<string, IndexedReminder[]> = {};
    indexRows((data ?? []) as Row[], rows, keepFrom);
    next = { v: 1, count, maxUpdatedAt, fullScanAt: now, rows };
    scan = "full";
  } else if (prev.maxUpdatedAt !== maxUpdatedAt) {
    // שורות עודכנו: מושכים רק אותן
    const since = Date.parse(prev.maxUpdatedAt);
    const from = new Date((isNaN(since) ? 0 : Math.min(since, now)) - CLOCK_SLACK).toISOString();
    const { data, error } = await sb.from("journal_tasks").select("id,payload").gt("updated_at", from);
    if (error) throw error;
    const rows = { ...prev.rows };
    indexRows((data ?? []) as Row[], rows, keepFrom);
    // שורה שנמחקה באותה דקה שבה נוספה אחרת לא משנה את הספירה — מוודאים שהשורות באינדקס עוד קיימות
    const ids = Object.keys(rows);
    if (ids.length) {
      const alive = await sb.from("journal_tasks").select("id").in("id", ids);
      if (alive.error) throw alive.error;
      const exists = new Set(((alive.data ?? []) as { id: string }[]).map((r) => r.id));
      for (const id of ids) if (!exists.has(id)) delete rows[id];
    }
    next = { ...prev, maxUpdatedAt, rows };
    scan = "changed";
  } else {
    next = prev;
    scan = "index";
  }

  if (next !== prev) {
    // מנקים תזכורות שעבר זמנן, כדי שהאינדקס יישאר קטן
    for (const [id, items] of Object.entries(next.rows)) {
      const live = items.filter((r) => r.at >= keepFrom);
      if (live.length) next.rows[id] = live;
      else delete next.rows[id];
    }
    // כשל בשמירה לא עוצר את השליחה — בדקה הבאה פשוט נבנה שוב
    await sb
      .from("journal_meta")
      .upsert({ key: REMINDER_INDEX_KEY, payload: next, updated_at: new Date(now).toISOString() });
  }

  const due = Object.values(next.rows).flat().filter((r) => r.at <= now && r.at >= windowStart);
  return { due, scan };
}

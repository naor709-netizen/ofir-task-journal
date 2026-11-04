import type { SupabaseClient } from "@supabase/supabase-js";
import { MANAGER_ID, journalOfPayload, rowPayload } from "@/lib/journals";
import { dateKey, isDone, flatten, type Task } from "./automation";

// ============================================================
// קריאה/כתיבה של משימות בצד השרת (פעולות מטלגרם, אימות אירועים)
// ============================================================

export type Row = { id: string; payload: Task };

export async function journalRows(sb: SupabaseClient, journalId: string): Promise<Row[]> {
  let q = sb.from("journal_tasks").select("id,payload");
  q = journalId === MANAGER_ID
    ? q.or(`payload->>journalId.is.null,payload->>journalId.eq.${MANAGER_ID}`)
    : q.eq("payload->>journalId", journalId);
  let { data, error } = await q;
  if (error) {
    // רשת ביטחון: סינון JSON שנדחה → מושכים הכל ומסננים כאן
    ({ data, error } = await sb.from("journal_tasks").select("id,payload"));
    if (error) throw error;
  }
  return ((data ?? []) as Row[]).filter((r) => r.payload && journalOfPayload(r.payload) === journalId);
}

export function findInTree(root: Task, id: string): Task | null {
  if (root.id === id) return root;
  for (const s of root.subtasks ?? []) {
    const f = findInTree(s, id);
    if (f) return f;
  }
  return null;
}

export function patchInTree(root: Task, id: string, patch: Partial<Task>): Task {
  if (root.id === id) return { ...root, ...patch };
  return { ...root, subtasks: (root.subtasks ?? []).map((s) => patchInTree(s, id, patch)) };
}

export function findRootOf(rows: Row[], taskId: string): Row | null {
  return rows.find((r) => findInTree(r.payload, taskId)) ?? null;
}

export async function saveRoot(sb: SupabaseClient, journalId: string, root: Task) {
  const { error } = await sb.from("journal_tasks").upsert({
    id: root.id,
    payload: rowPayload(root, journalId),
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function markTaskDone(sb: SupabaseClient, journalId: string, taskId: string): Promise<Task | null> {
  const rows = await journalRows(sb, journalId);
  const row = findRootOf(rows, taskId);
  if (!row) return null;
  const t = findInTree(row.payload, taskId)!;
  if (isDone(t)) return t;
  const patched = patchInTree(row.payload, taskId, { status: "done", endDate: t.endDate ?? dateKey() });
  await saveRoot(sb, journalId, patched);
  return findInTree(patched, taskId);
}

export async function snoozeTask(sb: SupabaseClient, journalId: string, taskId: string, minutes: number): Promise<Task | null> {
  const rows = await journalRows(sb, journalId);
  const row = findRootOf(rows, taskId);
  if (!row) return null;
  const t = findInTree(row.payload, taskId)!;
  const at = new Date(Date.now() + minutes * 60000).toISOString();
  const reminder = { id: `${taskId}-snz-${Date.now().toString(36)}`, datetime: at, note: "", fired: false };
  const patched = patchInTree(row.payload, taskId, { reminders: [...(t.reminders ?? []), reminder] });
  await saveRoot(sb, journalId, patched);
  return t;
}

// פעם אחת בלבד לכל מפתח (טבלת reminders_sent משמשת גם כיומן "כבר נשלח")
export async function claimOnce(sb: SupabaseClient, key: string): Promise<boolean> {
  const { data } = await sb.from("reminders_sent").select("reminder_id").eq("reminder_id", key).maybeSingle();
  if (data) return false;
  await sb.from("reminders_sent").upsert({ reminder_id: key }, { onConflict: "reminder_id" });
  return true;
}

export function openTasks(roots: Task[]): Task[] {
  return flatten(roots).filter((t) => !isDone(t));
}

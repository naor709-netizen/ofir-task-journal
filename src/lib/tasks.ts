"use client";

// ============================================
// יומן המשימות — data layer (יומן פעיל אחד לכל עמוד)
// localStorage cache + Supabase cloud sync (optional)
// ============================================

import { MANAGER_ID, metaKey, journalOfPayload } from "./journals";

export type TaskNature = "personal" | "urgent" | "routine";
export type TaskStatus = "todo" | "in_progress" | "done";

export const NATURE_LABELS: Record<TaskNature, string> = {
  personal: "אישי",
  urgent: "דחוף",
  routine: "שוטף",
};

export const NATURE_COLORS: Record<TaskNature, string> = {
  personal: "#7C3AED",
  urgent: "#DC2626",
  routine: "#0284C7",
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "לביצוע",
  in_progress: "בתהליך",
  done: "הושלם",
};

export const STATUS_COLORS: Record<TaskStatus, string> = {
  todo: "#64748B",
  in_progress: "#B45309",
  done: "#0F8A6C",
};

export interface TaskCategory {
  id: string;
  name: string;
  color: string;
  parentId?: string | null; // תת-קטגוריה
}

export interface TaskFile {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

export interface TaskReminder {
  id: string;
  datetime: string; // ISO
  note: string;
  fired: boolean;
}

export interface Task {
  id: string;
  title: string;
  description: string; // מהות המשימה
  notes: string;
  categoryId: string | null;
  nature: TaskNature | null;
  critical: boolean;
  status: TaskStatus;
  createdAt: string; // ISO — תאריך פתיחה
  dueDate: string | null; // YYYY-MM-DD — יעד, מוצג בלוח השנה
  endDate: string | null; // YYYY-MM-DD — תאריך סיום
  reminders: TaskReminder[];
  files: TaskFile[];
  subtasks: Task[]; // שלבים — לכל שלב כל מאפייני משימה
  assignedBy?: string | null; // מזהה היומן שהקצה את המשימה (אופיר → אשת צוות)
  assignedAt?: string | null;
}

export interface JournalData {
  categories: TaskCategory[];
  tasks: Task[];
}

// היומן הפעיל בעמוד הזה. של אופיר שומר על מפתח האחסון המקורי (תאימות לאחור).
let activeJournal: string = MANAGER_ID;

export function getActiveJournal(): string {
  return activeJournal;
}

export function storageKeyFor(journalId: string): string {
  return journalId === MANAGER_ID ? "ofir-task-journal" : `ofir-task-journal@${journalId}`;
}

function storageKey(): string {
  return storageKeyFor(activeJournal);
}

// צבעי ברירת מחדל מאומתים לרצועת dark mode (validate_palette.js)
export const DEFAULT_CATEGORIES: TaskCategory[] = [
  { id: "work", name: "עבודה", color: "#3D7EFF" },
  { id: "home", name: "בית", color: "#0FA47E" },
  { id: "meetings", name: "פגישות", color: "#0E96D2" },
  { id: "errands", name: "סידורים", color: "#C07F0E" },
];

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function isDone(t: Task): boolean {
  return t.status === "done";
}

export function emptyTask(): Task {
  return {
    id: uid(),
    title: "",
    description: "",
    notes: "",
    categoryId: null,
    nature: null,
    critical: false,
    status: "todo",
    createdAt: new Date().toISOString(),
    dueDate: null,
    endDate: null,
    reminders: [],
    files: [],
    subtasks: [],
  };
}

type LegacyTask = Partial<Task> & { done?: boolean };

// תזכורות ישנות נשמרו כשעון מקומי ("YYYY-MM-DDTHH:mm") — ממירים ל-UTC ISO
// כדי שההשוואה בשרת (וגם באפליקציה) תהיה נכונה בכל אזור זמן.
function normalizeReminderDatetime(dt: string): string {
  if (dt && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dt)) {
    const d = new Date(dt); // נקרא כשעון מקומי
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return dt;
}

export function normalizeTask(t: LegacyTask): Task {
  const status: TaskStatus = t.status ?? (t.done ? "done" : "todo");
  const base = { ...emptyTask(), ...t, status };
  delete (base as LegacyTask).done;
  // שיוך היומן חי בשורה בענן בלבד — לא חלק מהמודל בצד הלקוח
  delete (base as Task & { journalId?: string }).journalId;
  return {
    ...base,
    reminders: (t.reminders ?? []).map((r) => ({ ...r, datetime: normalizeReminderDatetime(r.datetime) })),
    subtasks: (t.subtasks ?? []).map(normalizeTask),
  };
}

// המרות בין ISO (אחסון) לבין ערך שדה datetime-local (תצוגה מקומית)
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function localInputToIso(local: string): string {
  if (!local) return local;
  const d = new Date(local);
  return isNaN(d.getTime()) ? local : d.toISOString();
}

export function loadJournal(): JournalData {
  if (typeof window === "undefined") {
    return { categories: DEFAULT_CATEGORIES, tasks: [] };
  }
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return { categories: DEFAULT_CATEGORIES, tasks: [] };
    const parsed = JSON.parse(raw) as JournalData;
    return {
      categories: (parsed.categories ?? DEFAULT_CATEGORIES).map((c) => ({ parentId: null, ...c })),
      tasks: (parsed.tasks ?? []).map(normalizeTask),
    };
  } catch {
    return { categories: DEFAULT_CATEGORIES, tasks: [] };
  }
}

export function saveJournal(data: JournalData): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(storageKey(), JSON.stringify(data));
    return true;
  } catch {
    // quota exceeded (קבצים גדולים מדי)
    return false;
  }
}

// ============================================
// store (useSyncExternalStore) + cloud sync
// ============================================

let snapshot: JournalData | null = null;
const listeners = new Set<() => void>();

export function subscribeJournal(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getJournalSnapshot(): JournalData | null {
  if (snapshot === null && typeof window !== "undefined") snapshot = loadJournal();
  return snapshot;
}

export function getServerJournalSnapshot(): JournalData | null {
  return null;
}

function notify() {
  listeners.forEach((l) => l());
}

// סנכרון בין טאבים באותו דפדפן — בלי זה, במצב מקומי כל טאב חי בעולם משלו
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== storageKey() || e.newValue === null) return;
    try {
      const parsed = JSON.parse(e.newValue) as JournalData;
      snapshot = {
        categories: (parsed.categories ?? DEFAULT_CATEGORIES).map((c) => ({ parentId: null, ...c })),
        tasks: (parsed.tasks ?? []).map(normalizeTask),
      };
      notify();
    } catch {
      /* ערך פגום — מתעלמים */
    }
  });
}

// --- sync state (shown in the header) ---

export type SyncState = "local" | "syncing" | "synced" | "error";

let syncState: SyncState = "local";
let syncDetail = "";
const syncListeners = new Set<() => void>();

export function getSyncDetail(): string {
  return syncDetail;
}

export function subscribeSyncState(cb: () => void): () => void {
  syncListeners.add(cb);
  return () => syncListeners.delete(cb);
}
export function getSyncState(): SyncState {
  return syncState;
}
export function getServerSyncState(): SyncState {
  return "local";
}
function setSyncState(s: SyncState) {
  if (syncState !== s) {
    syncState = s;
    syncListeners.forEach((l) => l());
  }
}

// --- cloud push (debounced diff of root tasks) ---

let remote = false;
const dirtyRoots = new Set<string>();
const deletedRoots = new Set<string>();
let catsDirty = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
// המצב האחרון שידוע שנמצא בענן — בסיס לזיהוי "הושלמה"/"נוספה" עבור עדכוני המנהל
const cloudRoots = new Map<string, Task>();

// מעבר בין יומנים באותה לשונית (ניווט צד-לקוח) — מאפס את כל מצב הסנכרון
let channel: { unsubscribe: () => unknown } | null = null;

export function setActiveJournal(id: string) {
  if (id === activeJournal) return;
  activeJournal = id;
  snapshot = null;
  dirtyRoots.clear();
  deletedRoots.clear();
  cloudRoots.clear();
  catsDirty = false;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
  remote = false;
  syncStarted = false;
  try { channel?.unsubscribe(); } catch { /* ignore */ }
  channel = null;
  syncState = "local";
  syncListeners.forEach((l) => l());
}

export function setJournalData(next: JournalData): boolean {
  const prev = snapshot;
  snapshot = next;
  const ok = saveJournal(next);
  if (remote && prev) {
    const prevMap = new Map(prev.tasks.map((t) => [t.id, t]));
    const nextIds = new Set(next.tasks.map((t) => t.id));
    for (const t of next.tasks) {
      const p = prevMap.get(t.id);
      if (!p || JSON.stringify(p) !== JSON.stringify(t)) dirtyRoots.add(t.id);
      deletedRoots.delete(t.id);
    }
    for (const id of prevMap.keys()) {
      if (!nextIds.has(id)) {
        deletedRoots.add(id);
        dirtyRoots.delete(id);
      }
    }
    if (JSON.stringify(prev.categories) !== JSON.stringify(next.categories)) catsDirty = true;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(flushPush, 500);
  }
  notify();
  return ok;
}

export type ActivityEvent = { type: "done" | "new"; taskId: string; rootId: string };

// מה השתנה בעץ משימה מאז הגרסה שבענן: משימות/שלבים חדשים עם שם, ומעברים ל"הושלם"
function diffActivity(prev: Task | undefined, next: Task): ActivityEvent[] {
  const before = new Map(prev ? flattenTasks([prev]).map((t) => [t.id, t]) : []);
  const out: ActivityEvent[] = [];
  for (const t of flattenTasks([next])) {
    const p = before.get(t.id);
    if (t.title.trim() && (!p || !p.title.trim()) && !t.assignedBy) out.push({ type: "new", taskId: t.id, rootId: next.id });
    if (p && p.status !== "done" && t.status === "done") out.push({ type: "done", taskId: t.id, rootId: next.id });
  }
  return out;
}

// מכשיר שעבר את נעילת המנהל — פעולות שאופיר עושה ביומן של אשת צוות לא מעדכנות אותו עצמו
export function isManagerDevice(): boolean {
  try { return localStorage.getItem("ofir-manager-device") === "1"; } catch { return false; }
}

function postActivity(journalId: string, events: ActivityEvent[]) {
  if (!events.length || journalId === MANAGER_ID || isManagerDevice()) return;
  try {
    fetch("/api/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ journalId, events }),
      keepalive: true,
    }).catch(() => { /* best-effort */ });
  } catch { /* best-effort */ }
}

async function flushPush() {
  const snap = snapshot;
  const journal = activeJournal;
  if (!snap || !remote) return;
  const roots = snap.tasks.filter((t) => dirtyRoots.has(t.id));
  const upserts = roots.map((t) => ({
    id: t.id,
    payload: { ...t, journalId: journal },
    updated_at: new Date().toISOString(),
  }));
  const dels = [...deletedRoots];
  const cats = catsDirty ? snap.categories : null;
  dirtyRoots.clear();
  deletedRoots.clear();
  catsDirty = false;
  if (!upserts.length && !dels.length && !cats) return;
  setSyncState("syncing");
  try {
    const { supabase } = await import("./supabase");
    if (upserts.length) {
      const { error } = await supabase.from("journal_tasks").upsert(upserts);
      if (error) throw error;
      const events = roots.flatMap((t) => diffActivity(cloudRoots.get(t.id), t));
      roots.forEach((t) => cloudRoots.set(t.id, t));
      postActivity(journal, events);
    }
    if (dels.length) {
      const { error } = await supabase.from("journal_tasks").delete().in("id", dels);
      if (error) throw error;
      dels.forEach((id) => cloudRoots.delete(id));
    }
    if (cats) {
      const { error } = await supabase
        .from("journal_meta")
        .upsert({ key: metaKey("categories", journal), payload: cats, updated_at: new Date().toISOString() });
      if (error) throw error;
    }
    if (journal === activeJournal) setSyncState("synced");
  } catch (e) {
    syncDetail = e instanceof Error ? e.message : JSON.stringify(e);
    setSyncState("error");
  }
}

// --- initial load + realtime pull ---

let syncStarted = false;

export async function initJournalSync() {
  if (syncStarted || typeof window === "undefined") return;
  syncStarted = true;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    syncDetail = "Supabase env vars missing: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY";
    return; // מצב מקומי בלבד
  }
  const journal = activeJournal;
  try {
    const { supabase } = await import("./supabase");
    const cloud = await fetchCloud(journal);
    if (journal !== activeJournal) return; // היומן הוחלף בזמן הטעינה
    remote = true;
    const local = getJournalSnapshot() ?? loadJournal();
    const cloudEmpty = cloud.tasks.length === 0 && cloud.categories === null;
    cloudRoots.clear();
    cloud.tasks.forEach((t) => cloudRoots.set(t.id, t));
    if (cloudEmpty && (local.tasks.length > 0 || local.categories !== DEFAULT_CATEGORIES)) {
      // מכשיר ראשון שמתחבר: מעלה את הנתונים המקומיים לענן
      snapshot = local;
      local.tasks.forEach((t) => dirtyRoots.add(t.id));
      catsDirty = true;
      flushPush();
    } else {
      snapshot = {
        categories: cloud.categories ?? DEFAULT_CATEGORIES,
        tasks: cloud.tasks,
      };
      saveJournal(snapshot);
    }
    setSyncState("synced");
    notify();

    channel = supabase
      .channel(`journal-sync-${journal}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "journal_tasks" }, scheduleRefetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "journal_meta" }, scheduleRefetch)
      .subscribe();
  } catch (e) {
    remote = false;
    syncDetail = e instanceof Error ? e.message : JSON.stringify(e);
    setSyncState("local");
  }
}

type Row = { id: string; payload: LegacyTask & { journalId?: string } };

// שורות של יומן אחד. משימות ישנות (בלי journalId) שייכות לאופיר.
export async function fetchJournalRows(journal: string): Promise<Row[]> {
  const { supabase } = await import("./supabase");
  let q = supabase.from("journal_tasks").select("id,payload");
  q = journal === MANAGER_ID
    ? q.or(`payload->>journalId.is.null,payload->>journalId.eq.${MANAGER_ID}`)
    : q.eq("payload->>journalId", journal);
  let { data, error } = await q;
  if (error) {
    // רשת ביטחון: אם השרת דוחה את סינון ה-JSON — מושכים הכל ומסננים כאן,
    // כדי שהיומן לעולם לא ייפול ל"מקומי בלבד" בגלל תחביר
    ({ data, error } = await supabase.from("journal_tasks").select("id,payload"));
    if (error) throw error;
  }
  // הגנה כפולה: גם אם הסינון בשרת לא הופעל, לא מערבבים יומנים
  return ((data ?? []) as Row[]).filter((r) => journalOfPayload(r.payload) === journal);
}

async function fetchCloud(journal: string): Promise<{ categories: TaskCategory[] | null; tasks: Task[] }> {
  const { supabase } = await import("./supabase");
  // שתי הבקשות כהבטחות — כשל סינכרוני באחת לא משאיר את השנייה כדחייה לא מטופלת
  const [rows, metaRes] = await Promise.all([
    fetchJournalRows(journal),
    (async () => supabase.from("journal_meta").select("key,payload").eq("key", metaKey("categories", journal)))(),
  ]);
  if (metaRes.error) throw metaRes.error;
  const catsRow = (metaRes.data ?? [])[0] as { payload: TaskCategory[] } | undefined;
  const tasks = rows
    .map((r) => normalizeTask(r.payload))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    categories: catsRow ? catsRow.payload.map((c) => ({ parentId: null, ...c })) : null,
    tasks,
  };
}

let refetchTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRefetch() {
  if (refetchTimer) clearTimeout(refetchTimer);
  refetchTimer = setTimeout(refetchCloud, 600);
}

async function refetchCloud() {
  // שינויים מקומיים בהמתנה — הם יידחפו ואז נקבל אירוע חדש
  if (dirtyRoots.size || deletedRoots.size || catsDirty) return;
  const journal = activeJournal;
  try {
    const cloud = await fetchCloud(journal);
    if (journal !== activeJournal) return;
    cloudRoots.clear();
    cloud.tasks.forEach((t) => cloudRoots.set(t.id, t));
    const next: JournalData = {
      categories: cloud.categories ?? snapshot?.categories ?? DEFAULT_CATEGORIES,
      tasks: cloud.tasks,
    };
    if (JSON.stringify(next) !== JSON.stringify(snapshot)) {
      snapshot = next;
      saveJournal(next);
      notify();
    }
  } catch {
    /* transient */
  }
}

// ============================================
// tree helpers — subtasks are full tasks, recursively
// ============================================

export function updateTaskInTree(tasks: Task[], id: string, patch: Partial<Task>): Task[] {
  return tasks.map((t) => {
    if (t.id === id) return { ...t, ...patch };
    if (t.subtasks.length) return { ...t, subtasks: updateTaskInTree(t.subtasks, id, patch) };
    return t;
  });
}

export function replaceTaskInTree(tasks: Task[], updated: Task): Task[] {
  return tasks.map((t) => {
    if (t.id === updated.id) return updated;
    if (t.subtasks.length) return { ...t, subtasks: replaceTaskInTree(t.subtasks, updated) };
    return t;
  });
}

export function removeTaskFromTree(tasks: Task[], id: string): Task[] {
  return tasks
    .filter((t) => t.id !== id)
    .map((t) => (t.subtasks.length ? { ...t, subtasks: removeTaskFromTree(t.subtasks, id) } : t));
}

export function findTaskInTree(tasks: Task[], id: string): Task | null {
  for (const t of tasks) {
    if (t.id === id) return t;
    const found = findTaskInTree(t.subtasks, id);
    if (found) return found;
  }
  return null;
}

export function flattenTasks(tasks: Task[]): Task[] {
  const out: Task[] = [];
  const walk = (list: Task[]) => {
    for (const t of list) {
      out.push(t);
      walk(t.subtasks);
    }
  };
  walk(tasks);
  return out;
}

export function countSubtasks(t: Task): { total: number; done: number } {
  const flat = flattenTasks(t.subtasks);
  return { total: flat.length, done: flat.filter(isDone).length };
}

// ============================================
// date helpers
// ============================================

export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatDateHe(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "numeric" });
}

export function formatDateTimeHe(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "numeric" }) +
    " · " + d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

export const HE_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

export const HE_WEEKDAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

export const HE_WEEKDAYS_FULL = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export const CATEGORY_COLOR_CHOICES = [
  "#3D7EFF", "#2E5EDB", "#0E96D2", "#0891B2", "#0FA47E", "#3C9E4E",
  "#84A80D", "#C07F0E", "#E0662B", "#E05252", "#D6479A", "#B052E0",
  "#7C6FE8", "#9E6BDB", "#1BA8A0", "#64748B",
];

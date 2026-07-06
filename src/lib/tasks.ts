"use client";

// ============================================
// יומן המשימות של אופיר — data layer
// localStorage cache + Supabase cloud sync (optional)
// ============================================

export type TaskNature = "personal" | "urgent" | "routine";
export type TaskStatus = "todo" | "in_progress" | "done";

export const NATURE_LABELS: Record<TaskNature, string> = {
  personal: "אישי",
  urgent: "דחוף",
  routine: "שוטף",
};

export const NATURE_COLORS: Record<TaskNature, string> = {
  personal: "#A78BFA",
  urgent: "#F87171",
  routine: "#38BDF8",
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "לביצוע",
  in_progress: "בתהליך",
  done: "הושלם",
};

export const STATUS_COLORS: Record<TaskStatus, string> = {
  todo: "#94A3B8",
  in_progress: "#FBBF24",
  done: "#2DD4A8",
};

export interface TaskCategory {
  id: string;
  name: string;
  color: string;
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
}

export interface JournalData {
  categories: TaskCategory[];
  tasks: Task[];
}

const STORAGE_KEY = "ofir-task-journal";

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

function normalizeTask(t: LegacyTask): Task {
  const status: TaskStatus = t.status ?? (t.done ? "done" : "todo");
  const base = { ...emptyTask(), ...t, status };
  delete (base as LegacyTask).done;
  return { ...base, subtasks: (t.subtasks ?? []).map(normalizeTask) };
}

export function loadJournal(): JournalData {
  if (typeof window === "undefined") {
    return { categories: DEFAULT_CATEGORIES, tasks: [] };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { categories: DEFAULT_CATEGORIES, tasks: [] };
    const parsed = JSON.parse(raw) as JournalData;
    return {
      categories: parsed.categories ?? DEFAULT_CATEGORIES,
      tasks: (parsed.tasks ?? []).map(normalizeTask),
    };
  } catch {
    return { categories: DEFAULT_CATEGORIES, tasks: [] };
  }
}

export function saveJournal(data: JournalData): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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

// --- sync state (shown in the header) ---

export type SyncState = "local" | "syncing" | "synced" | "error";

let syncState: SyncState = "local";
const syncListeners = new Set<() => void>();

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

async function flushPush() {
  const snap = snapshot;
  if (!snap || !remote) return;
  const upserts = snap.tasks
    .filter((t) => dirtyRoots.has(t.id))
    .map((t) => ({ id: t.id, payload: t, updated_at: new Date().toISOString() }));
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
    }
    if (dels.length) {
      const { error } = await supabase.from("journal_tasks").delete().in("id", dels);
      if (error) throw error;
    }
    if (cats) {
      const { error } = await supabase
        .from("journal_meta")
        .upsert({ key: "categories", payload: cats, updated_at: new Date().toISOString() });
      if (error) throw error;
    }
    setSyncState("synced");
  } catch {
    setSyncState("error");
  }
}

// --- initial load + realtime pull ---

let syncStarted = false;

export async function initJournalSync() {
  if (syncStarted || typeof window === "undefined") return;
  syncStarted = true;
  try {
    const { supabase } = await import("./supabase");
    const cloud = await fetchCloud();
    remote = true;
    const local = getJournalSnapshot() ?? loadJournal();
    const cloudEmpty = cloud.tasks.length === 0 && cloud.categories === null;
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

    supabase
      .channel("journal-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "journal_tasks" }, scheduleRefetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "journal_meta" }, scheduleRefetch)
      .subscribe();
  } catch {
    remote = false;
    setSyncState("local");
  }
}

async function fetchCloud(): Promise<{ categories: TaskCategory[] | null; tasks: Task[] }> {
  const { supabase } = await import("./supabase");
  const [tasksRes, metaRes] = await Promise.all([
    supabase.from("journal_tasks").select("id,payload"),
    supabase.from("journal_meta").select("key,payload"),
  ]);
  if (tasksRes.error) throw tasksRes.error;
  if (metaRes.error) throw metaRes.error;
  const catsRow = (metaRes.data ?? []).find((r: { key: string }) => r.key === "categories");
  const tasks = ((tasksRes.data ?? []) as { payload: LegacyTask }[])
    .map((r) => normalizeTask(r.payload))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { categories: catsRow ? (catsRow.payload as TaskCategory[]) : null, tasks };
}

let refetchTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRefetch() {
  if (refetchTimer) clearTimeout(refetchTimer);
  refetchTimer = setTimeout(refetchCloud, 600);
}

async function refetchCloud() {
  // שינויים מקומיים בהמתנה — הם יידחפו ואז נקבל אירוע חדש
  if (dirtyRoots.size || deletedRoots.size || catsDirty) return;
  try {
    const cloud = await fetchCloud();
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

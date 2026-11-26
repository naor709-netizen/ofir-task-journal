"use client";

// ============================================
// יומן המשימות — data layer (יומן פעיל אחד לכל עמוד)
// localStorage cache + Supabase cloud sync (optional)
// ============================================

import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { MANAGER_ID, metaKey, journalOfPayload, rowPayload, payloadVisibleIn, sharedWithOfPayload } from "./journals";

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
  // --- משימה משותפת (ראו journals.ts) ---
  sharedWith?: string[]; // יומנים נוספים שהמשימה מופיעה בהם (משימת שורש בלבד)
  sharedCats?: Record<string, string | null>; // הקטגוריה האישית של כל שותף, לפי יומן
  ownerId?: string; // בצד הלקוח בלבד: היומן שהמשימה שייכת לו, כשהוא לא היומן שמציג אותה
  ownerCat?: string | null; // בצד הלקוח בלבד: הקטגוריה אצל הבעלים — נשמרת כמו שהיא
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

// ============================================
// משימות משותפות — תרגום בין השורה בענן לבין מה שכל יומן רואה
// לכל אחד מערכת קטגוריות משלו, ולכן אצל שותף categoryId הוא הקטגוריה האישית שלו
// (sharedCats[היומן שלו]), והקטגוריה של הבעלים נשמרת בצד ב-ownerCat.
// ============================================

function toViewer(t: Task, viewer: string, viewerCats: Set<string> | null): Task {
  const own = t.sharedCats && viewer in t.sharedCats
    ? t.sharedCats[viewer]
    // עוד לא בחר/ה קטגוריה: אם יש אצלו/ה קטגוריה עם אותו מזהה (ברירות המחדל) — משתמשים בה
    : t.categoryId && viewerCats?.has(t.categoryId) ? t.categoryId : null;
  return { ...t, ownerCat: t.categoryId, categoryId: own ?? null, subtasks: t.subtasks.map((x) => toViewer(x, viewer, viewerCats)) };
}

function fromViewer(t: Task, viewer: string): Task {
  const { ownerCat, ...rest } = t;
  return {
    ...rest,
    categoryId: ownerCat ?? null,
    sharedCats: { ...(t.sharedCats ?? {}), [viewer]: t.categoryId },
    subtasks: t.subtasks.map((x) => fromViewer(x, viewer)),
  };
}

// שורה מהענן → המשימה כפי שהיא נראית ביומן viewer
export function taskFromRow(
  payload: LegacyTask & { journalId?: string },
  viewer: string,
  viewerCats: Set<string> | null = null
): Task {
  const owner = journalOfPayload(payload);
  const t = normalizeTask(payload);
  delete t.ownerId;
  delete t.ownerCat;
  const shared = sharedWithOfPayload(payload);
  if (shared.length) t.sharedWith = shared; else delete t.sharedWith;
  return owner === viewer ? t : { ...toViewer(t, viewer, viewerCats), ownerId: owner };
}

// המשימה כפי שהיא ביומן viewer → מה שנשמר בשורה (תמיד אצל הבעלים)
export function taskToRow(t: Task, viewer: string): Task & { journalId?: string } {
  const base = t.ownerId ? { ...fromViewer(t, viewer), ownerId: t.ownerId } : t;
  const row = rowPayload(base, viewer);
  if (!row.sharedWith?.length) delete row.sharedWith;
  return row;
}

// האם המשימה משותפת, ועם מי — מנקודת המבט של היומן שמציג אותה
export function sharedPartners(t: Task, viewer: string): string[] {
  const all = [t.ownerId ?? viewer, ...(t.sharedWith ?? [])];
  return [...new Set(all)].filter((x) => x !== viewer);
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
// משימה ששותפה איתי ומחקתי אצלי: לא נמחקת — רק יורדת מהיומן שלי ונשארת אצל הבעלים
const leftRoots = new Map<string, Task>();
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
  leftRoots.clear();
  cloudRoots.clear();
  catsDirty = false;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
  remote = false;
  syncStarted = false;
  if (initRetryTimer) clearTimeout(initRetryTimer);
  initRetryTimer = null;
  if (applyTimer) clearTimeout(applyTimer);
  applyTimer = null;
  remoteChanges.clear();
  pushRetries = 0;
  try { channel?.unsubscribe(); } catch { /* ignore */ }
  channel = null;
  syncState = "local";
  syncListeners.forEach((l) => l());
}

// --- שינויים שעוד לא הגיעו לענן — נשמרים גם בדפדפן ---
// בלי זה, שינוי שנעשה כשהענן לא זמין (אין רשת, Supabase חסום) נשמר רק בעותק
// המקומי, ובחיבור הבא העותק מהענן דורס אותו. הרשימה נשמרת ב-localStorage כדי
// לשרוד רענון וסגירה, ומשותפת לכל הלשוניות של אותו יומן.

type Pending = { dirty: string[]; deleted: string[]; left: Task[]; cats: boolean };

function pendingKey(journal: string): string {
  return `${storageKeyFor(journal)}:pending`;
}

function readPending(journal: string = activeJournal): Pending {
  const empty: Pending = { dirty: [], deleted: [], left: [], cats: false };
  if (typeof window === "undefined") return empty;
  try {
    const raw = localStorage.getItem(pendingKey(journal));
    if (!raw) return empty;
    const p = JSON.parse(raw) as Partial<Pending>;
    return {
      dirty: Array.isArray(p.dirty) ? p.dirty : [],
      deleted: Array.isArray(p.deleted) ? p.deleted : [],
      left: Array.isArray(p.left) ? p.left : [],
      cats: !!p.cats,
    };
  } catch {
    return empty;
  }
}

function writePending(journal: string, p: Pending) {
  try {
    if (!p.dirty.length && !p.deleted.length && !p.left.length && !p.cats) localStorage.removeItem(pendingKey(journal));
    else localStorage.setItem(pendingKey(journal), JSON.stringify(p));
  } catch { /* מצב פרטי / אחסון מלא */ }
}

// מוסיף לרשימה השמורה את מה שממתין עכשיו בזיכרון
function persistPending() {
  const p = readPending();
  const dirty = new Set([...p.dirty, ...dirtyRoots]);
  const deleted = new Set([...p.deleted, ...deletedRoots]);
  const left = new Map(p.left.map((t) => [t.id, t]));
  leftRoots.forEach((t, id) => left.set(id, t));
  dirtyRoots.forEach((id) => { deleted.delete(id); left.delete(id); });
  deletedRoots.forEach((id) => dirty.delete(id));
  leftRoots.forEach((_, id) => dirty.delete(id));
  writePending(activeJournal, { dirty: [...dirty], deleted: [...deleted], left: [...left.values()], cats: p.cats || catsDirty });
}

// מסיר מהרשימה השמורה את מה שנשמר בענן — חוץ ממה שהשתנה שוב בינתיים
function clearPersisted(journal: string, done: { dirty: string[]; deleted: string[]; left: string[]; cats: boolean }) {
  const p = readPending(journal);
  const active = journal === activeJournal;
  const drop = (ids: string[]) =>
    new Set(ids.filter((id) => !active || (!dirtyRoots.has(id) && !deletedRoots.has(id) && !leftRoots.has(id))));
  const dDirty = drop(done.dirty);
  const dDeleted = drop(done.deleted);
  const dLeft = drop(done.left);
  writePending(journal, {
    dirty: p.dirty.filter((id) => !dDirty.has(id)),
    deleted: p.deleted.filter((id) => !dDeleted.has(id)),
    left: p.left.filter((t) => !dLeft.has(t.id)),
    cats: p.cats && !(done.cats && !(active && catsDirty)),
  });
}

export function setJournalData(next: JournalData): boolean {
  const prev = snapshot;
  snapshot = next;
  const ok = saveJournal(next);
  // השינויים נרשמים תמיד — גם כשאין חיבור לענן — כדי שיגיעו אליו כשהחיבור יחזור
  if (prev) {
    const prevMap = new Map(prev.tasks.map((t) => [t.id, t]));
    const nextIds = new Set(next.tasks.map((t) => t.id));
    for (const t of next.tasks) {
      const p = prevMap.get(t.id);
      if (!p || JSON.stringify(p) !== JSON.stringify(t)) dirtyRoots.add(t.id);
      deletedRoots.delete(t.id);
      leftRoots.delete(t.id);
    }
    for (const [id, p] of prevMap) {
      if (!nextIds.has(id)) {
        if (p.ownerId) leftRoots.set(id, p);
        else deletedRoots.add(id);
        dirtyRoots.delete(id);
      }
    }
    if (JSON.stringify(prev.categories) !== JSON.stringify(next.categories)) catsDirty = true;
    persistPending();
    if (remote) {
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = setTimeout(flushPush, 500);
    }
  }
  notify();
  return ok;
}

export type ActivityEvent = { type: "done" | "new" | "shared"; taskId: string; rootId: string };

// מה השתנה בעץ משימה מאז הגרסה שבענן: משימות/שלבים חדשים עם שם, ומעברים ל"הושלם"
function diffActivity(prev: Task | undefined, next: Task): ActivityEvent[] {
  const before = new Map(prev ? flattenTasks([prev]).map((t) => [t.id, t]) : []);
  const out: ActivityEvent[] = [];
  for (const t of flattenTasks([next])) {
    const p = before.get(t.id);
    if (t.title.trim() && (!p || !p.title.trim()) && !t.assignedBy) out.push({ type: "new", taskId: t.id, rootId: next.id });
    if (p && p.status !== "done" && t.status === "done") out.push({ type: "done", taskId: t.id, rootId: next.id });
  }
  // שותף/ה חדש/ה למשימה → מקבל/ת עדכון לטלפון
  const sharedBefore = new Set(prev && prev.title.trim() ? prev.sharedWith ?? [] : []);
  if (next.title.trim() && (next.sharedWith ?? []).some((x) => !sharedBefore.has(x))) {
    out.push({ type: "shared", taskId: next.id, rootId: next.id });
  }
  return out;
}

// המכשיר של אופיר (פתח את היומן הראשי) — משמש רק לקיצור "לדשבורד הצוות"
export function isManagerDevice(): boolean {
  try { return localStorage.getItem("ofir-manager-device") === "1"; } catch { return false; }
}

// עדכונים לאופיר נשלחים מכל מכשיר — עדיף עדכון כפול נדיר מאשר עדכון של איש צוות שהולך לאיבוד
function postActivity(journalId: string, all: ActivityEvent[], sharedRoots: Set<string>) {
  // אופיר לא מעדכן את עצמו — מהיומן שלו יוצאים רק עדכונים על משימות משותפות, לשותפים
  const events = journalId === MANAGER_ID
    ? all.filter((e) => e.type !== "new" && sharedRoots.has(e.rootId))
    : all;
  if (!events.length) return;
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
  const upserts = [
    ...roots.map((t) => ({ id: t.id, payload: taskToRow(t, journal), updated_at: new Date().toISOString() })),
    // ירדתי ממשימה משותפת: השורה נשארת אצל הבעלים, רק בלי היומן שלי
    ...[...leftRoots.values()].map((t) => ({
      id: t.id,
      payload: taskToRow({ ...t, sharedWith: (t.sharedWith ?? []).filter((x) => x !== journal) }, journal),
      updated_at: new Date().toISOString(),
    })),
  ];
  const dels = [...deletedRoots];
  const cats = catsDirty ? snap.categories : null;
  // מה שנשלח עכשיו — לשחזור אם השליחה נכשלת, ולניקוי מהרשימה השמורה אם הצליחה
  const sentDirty = [...dirtyRoots];
  const sentLeft = new Map(leftRoots);
  const sentCats = catsDirty;
  dirtyRoots.clear();
  deletedRoots.clear();
  leftRoots.clear();
  catsDirty = false;
  if (!upserts.length && !dels.length && !cats) {
    clearPersisted(journal, { dirty: sentDirty, deleted: dels, left: [...sentLeft.keys()], cats: sentCats });
    return;
  }
  setSyncState("syncing");
  try {
    const { supabase } = await import("./supabase");
    if (upserts.length) {
      const { error } = await supabase.from("journal_tasks").upsert(upserts);
      if (error) throw error;
      const events = roots.flatMap((t) => diffActivity(cloudRoots.get(t.id), t));
      roots.forEach((t) => cloudRoots.set(t.id, t));
      postActivity(journal, events, new Set(roots.filter((t) => t.ownerId || t.sharedWith?.length).map((t) => t.id)));
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
    clearPersisted(journal, { dirty: sentDirty, deleted: dels, left: [...sentLeft.keys()], cats: sentCats });
    if (journal !== activeJournal) return;
    pushRetries = 0;
    setSyncState("synced");
  } catch (e) {
    syncDetail = e instanceof Error ? e.message : JSON.stringify(e);
    if (journal !== activeJournal) return;
    // השליחה נכשלה: הכול חוזר לרשימת ההמתנה (חוץ ממה שהשתנה שוב בינתיים), וננסה שוב
    for (const id of sentDirty) if (!deletedRoots.has(id) && !leftRoots.has(id)) dirtyRoots.add(id);
    for (const id of dels) if (!dirtyRoots.has(id)) deletedRoots.add(id);
    sentLeft.forEach((t, id) => { if (!dirtyRoots.has(id)) leftRoots.set(id, t); });
    if (sentCats) catsDirty = true;
    persistPending();
    setSyncState("error");
    schedulePushRetry();
  }
}

// ניסיון חוזר אחרי כשל, בהמתנה הולכת וגדלה (30 שניות עד 10 דקות)
let pushRetries = 0;
function schedulePushRetry() {
  const delay = Math.min(30_000 * 2 ** pushRetries, 600_000);
  pushRetries++;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(flushPush, delay);
}

// --- initial load + realtime pull ---

let syncStarted = false;
let initRetryTimer: ReturnType<typeof setTimeout> | null = null;

function hasPending(): boolean {
  return dirtyRoots.size > 0 || deletedRoots.size > 0 || leftRoots.size > 0 || catsDirty;
}

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
    if (initRetryTimer) clearTimeout(initRetryTimer);
    initRetryTimer = null;
    const local = getJournalSnapshot() ?? loadJournal();
    // "ריק" = אין בענן שום שורה של היומן הזה עצמו. משימות ששותפו איתו מיומן אחר
    // לא נחשבות — אחרת המשימות המקומיות של מכשיר ראשון היו נדרסות ונעלמות.
    const ownCloud = cloud.tasks.filter((t) => !t.ownerId);
    const cloudEmpty = ownCloud.length === 0 && cloud.categories === null;
    cloudRoots.clear();
    cloud.tasks.forEach((t) => cloudRoots.set(t.id, t));
    const localOwn = local.tasks.filter((t) => !t.ownerId);
    if (cloudEmpty && (localOwn.length > 0 || local.categories !== DEFAULT_CATEGORIES)) {
      // מכשיר ראשון שמתחבר: מעלה את הנתונים המקומיים לענן, ומצרף את המשימות ששותפו איתו
      const shared = cloud.tasks.filter((t) => t.ownerId && !localOwn.some((x) => x.id === t.id));
      snapshot = { categories: local.categories, tasks: [...localOwn, ...shared] };
      localOwn.forEach((t) => dirtyRoots.add(t.id));
      catsDirty = true;
    } else {
      // הענן קובע — חוץ משינויים מקומיים שעוד לא הגיעו אליו, שגוברים עליו ונשלחים
      snapshot = mergeLocalChanges(journal, local, cloud);
    }
    saveJournal(snapshot);
    setSyncState("synced");
    notify();
    if (hasPending()) {
      persistPending();
      flushPush();
    }

    let subscribedOnce = false;
    channel = supabase
      .channel(`journal-sync-${journal}`)
      // שינוי בשורה: מעדכנים רק אותה, מתוך האירוע עצמו — בלי למשוך מחדש את כל היומן
      .on("postgres_changes", { event: "*", schema: "public", table: "journal_tasks" }, onTaskChange)
      // רק הקטגוריות של היומן הזה. שאר journal_meta (טלגרם, צוות, אינדקס התזכורות) לא נוגע בתצוגה
      .on("postgres_changes", {
        event: "*", schema: "public", table: "journal_meta", filter: `key=eq.${metaKey("categories", journal)}`,
      }, scheduleRefetch)
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        // התחברות מחדש אחרי ניתוק (טלפון שנרדם, רשת שנפלה): ייתכן שהוחמצו שינויים בינתיים
        if (subscribedOnce) scheduleRefetch();
        subscribedOnce = true;
      });
  } catch (e) {
    remote = false;
    syncDetail = e instanceof Error ? e.message : JSON.stringify(e);
    setSyncState("local");
    // הענן לא זמין: ממשיכים מקומית, ומנסים שוב בעוד שתי דקות (או כשהיומן חוזר למסך)
    if (journal === activeJournal) {
      syncStarted = false;
      if (initRetryTimer) clearTimeout(initRetryTimer);
      initRetryTimer = setTimeout(() => { initRetryTimer = null; initJournalSync(); }, 120_000);
    }
  }
}

// חזרה למסך / חזרת רשת: ניסיון התחברות מיידי, שליחת שינויים שממתינים,
// ואחרי היעדרות ארוכה — משיכה אחת של היומן, למקרה שאירועים הוחמצו
if (typeof window !== "undefined") {
  let hiddenAt = 0;
  const wake = () => {
    if (document.visibilityState !== "visible") return;
    if (!remote) {
      if (initRetryTimer) {
        clearTimeout(initRetryTimer);
        initRetryTimer = null;
        initJournalSync();
      }
      return;
    }
    if (hasPending()) {
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = setTimeout(flushPush, 0);
    }
    if (hiddenAt && Date.now() - hiddenAt > 10 * 60_000) scheduleRefetch();
    hiddenAt = 0;
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") hiddenAt = Date.now();
    else wake();
  });
  window.addEventListener("online", wake);
}

type RowPayload = LegacyTask & { journalId?: string };
type Row = { id: string; payload: RowPayload; updated_at?: string };

// משימה ששותפה איתי ועוד אין לה שם — היוצר עדיין מקליד; לא מציגים "ללא שם" אצל השותף
function rowVisible(payload: RowPayload | null | undefined, journal: string): payload is RowPayload {
  return !!payload && payloadVisibleIn(payload, journal) &&
    (journalOfPayload(payload) === journal || !!String(payload.title ?? "").trim());
}

// שורות של יומן אחד: שלו, ועוד משימות ששותפו איתו מיומן אחר.
// משימות ישנות (בלי journalId) שייכות לאופיר.
export async function fetchJournalRows(journal: string): Promise<Row[]> {
  const { supabase } = await import("./supabase");
  // "כל שורה משותפת" נמשכת מהשרת (מעטות), והשיוך ליומן הזה נבדק כאן למטה
  const mine = journal === MANAGER_ID
    ? `payload->>journalId.is.null,payload->>journalId.eq.${MANAGER_ID}`
    : `payload->>journalId.eq.${journal}`;
  let { data, error } = await supabase.from("journal_tasks").select("id,payload,updated_at")
    .or(`${mine},payload->>sharedWith.not.is.null`);
  if (error) {
    // רשת ביטחון: אם השרת דוחה את סינון ה-JSON — מושכים הכל ומסננים כאן,
    // כדי שהיומן לעולם לא ייפול ל"מקומי בלבד" בגלל תחביר
    ({ data, error } = await supabase.from("journal_tasks").select("id,payload,updated_at"));
    if (error) throw error;
  }
  // הגנה כפולה: גם אם הסינון בשרת לא הופעל, לא מערבבים יומנים
  return ((data ?? []) as Row[]).filter((r) => rowVisible(r.payload, journal));
}

type CloudData = {
  categories: TaskCategory[] | null;
  tasks: Task[];
  stamps: Map<string, string>; // מתי כל שורה נכתבה לענן לאחרונה
};

const byCreatedDesc = (a: Task, b: Task) => b.createdAt.localeCompare(a.createdAt);

async function fetchCloud(journal: string): Promise<CloudData> {
  const { supabase } = await import("./supabase");
  // שתי הבקשות כהבטחות — כשל סינכרוני באחת לא משאיר את השנייה כדחייה לא מטופלת
  const [rows, metaRes] = await Promise.all([
    fetchJournalRows(journal),
    (async () => supabase.from("journal_meta").select("key,payload").eq("key", metaKey("categories", journal)))(),
  ]);
  if (metaRes.error) throw metaRes.error;
  const catsRow = (metaRes.data ?? [])[0] as { payload: TaskCategory[] } | undefined;
  const catIds = new Set((catsRow?.payload ?? DEFAULT_CATEGORIES).map((c) => c.id));
  const tasks = rows.map((r) => taskFromRow(r.payload, journal, catIds)).sort(byCreatedDesc);
  const stamps = new Map<string, string>();
  rows.forEach((r) => { if (r.updated_at) stamps.set(r.id, r.updated_at); });
  return {
    categories: catsRow ? catsRow.payload.map((c) => ({ parentId: null, ...c })) : null,
    tasks,
    stamps,
  };
}

// --- מיזוג בחיבור: הענן, ועליו השינויים המקומיים שעוד לא הגיעו אליו ---

function mergeLocalChanges(journal: string, local: JournalData, cloud: CloudData): JournalData {
  const pending = readPending(journal);
  const localById = new Map(local.tasks.map((t) => [t.id, t]));
  const merged = new Map(cloud.tasks.map((t) => [t.id, t]));
  for (const id of pending.dirty) {
    const t = localById.get(id);
    if (t) { merged.set(id, t); dirtyRoots.add(id); }
  }
  for (const id of pending.deleted) {
    const c = merged.get(id);
    if (c && !c.ownerId) { merged.delete(id); deletedRoots.add(id); }
  }
  for (const t of pending.left) {
    if (merged.delete(t.id)) leftRoots.set(t.id, t);
  }
  let categories = cloud.categories ?? DEFAULT_CATEGORIES;
  if (pending.cats) { categories = local.categories; catsDirty = true; }
  for (const t of recoverOutageEdits(journal, local, cloud, pending)) {
    merged.set(t.id, t);
    dirtyRoots.add(t.id);
  }
  return { categories, tasks: [...merged.values()].sort(byCreatedDesc) };
}

// החסימה של Supabase בלילה שבין 24 ל-25.11.2026: מהבדיקה התקינה האחרונה ועד שהענן חזר,
// אף מכשיר לא יכול היה לכתוב אליו — והשינויים מאותם ימים לא נרשמו ברשימת ההמתנה,
// כי היא נוספה רק אחר כך.
const OUTAGE_START = Date.parse("2026-11-24T20:17:00Z");

// סדר מפתחות קבוע, כדי שהשוואה לא תיפול על סדר שדות
function stableJson(v: unknown): string {
  return JSON.stringify(v, (_k, val: unknown) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : val);
}

// פעם אחת לכל יומן בכל מכשיר: מזהה שינויים מתקופת החסימה ומחזיר אותם לענן.
// 1. משימה שקיימת רק במכשיר ונוצרה אחרי תחילת החסימה — נוצרה בזמן החסימה. עולה.
// 2. משימה שבמכשיר שונה מהענן, כשבענן היא לא נכתבה מאז תחילת החסימה — שונתה בזמן
//    החסימה. עולה, אבל רק אם המכשיר היה מעודכן כשהחסימה התחילה (יש בו כל משימה שנוצרה
//    לפני כן). במכשיר שלא נפתח זמן רב ההבדלים הם עדכונים שלא הגיעו אליו — שם הענן קובע.
// העותקים המקומיים שהענן גובר עליהם נשמרים בגיבוי במכשיר, כדי ששום דבר לא יימחק לגמרי.
function recoverOutageEdits(journal: string, local: JournalData, cloud: CloudData, pending: Pending): Task[] {
  const flag = `${storageKeyFor(journal)}:outage-2026-11`;
  try {
    if (localStorage.getItem(flag)) return [];
  } catch {
    return [];
  }
  const out: Task[] = [];
  const kept: Task[] = [];
  const skip = new Set([...pending.dirty, ...pending.deleted, ...pending.left.map((t) => t.id)]);
  const ms = (iso: string | undefined) => Date.parse(iso ?? "");
  const cloudById = new Map(cloud.tasks.map((t) => [t.id, t]));
  const localIds = new Set(local.tasks.map((t) => t.id));
  const fresh = cloud.tasks.every((t) => t.ownerId || !(ms(t.createdAt) < OUTAGE_START) || localIds.has(t.id));
  for (const t of local.tasks) {
    if (skip.has(t.id)) continue;
    const c = cloudById.get(t.id);
    if (!c) {
      if (t.ownerId) continue;
      if (ms(t.createdAt) >= OUTAGE_START) out.push(t);
      else kept.push(t);
      continue;
    }
    if (stableJson(t) === stableJson(c)) continue;
    if (fresh && ms(cloud.stamps.get(t.id)) < OUTAGE_START) out.push(t);
    else kept.push(t);
  }
  try {
    if (kept.length || out.length) {
      localStorage.setItem(`${storageKeyFor(journal)}:outage-backup`, JSON.stringify({
        at: new Date().toISOString(), fresh,
        restored: out.map((t) => t.id),
        localOnly: kept,
        cloudBefore: out.map((t) => cloudById.get(t.id)).filter(Boolean),
      }));
    }
  } catch { /* אחסון מלא — הגיבוי לא קריטי */ }
  try { localStorage.setItem(flag, new Date().toISOString()); } catch { /* ignore */ }
  return out;
}

// --- שינויים מהענן בזמן אמת ---

type RemoteChange = { kind: "row"; row: Row } | { kind: "gone" } | { kind: "fetch" };
const remoteChanges = new Map<string, RemoteChange>();
let applyTimer: ReturnType<typeof setTimeout> | null = null;

function onTaskChange(p: RealtimePostgresChangesPayload<Row>) {
  const id = (p.new as Partial<Row> | undefined)?.id ?? (p.old as Partial<Row> | undefined)?.id;
  if (!id) { scheduleRefetch(); return; }
  if (p.eventType === "DELETE") {
    remoteChanges.set(id, { kind: "gone" });
  } else {
    const row = p.new as Partial<Row>;
    // שורה גדולה מדי מגיעה בלי התוכן — מושכים רק אותה
    remoteChanges.set(id, row.payload && typeof row.payload === "object"
      ? { kind: "row", row: row as Row }
      : { kind: "fetch" });
  }
  if (applyTimer) clearTimeout(applyTimer);
  applyTimer = setTimeout(applyRemoteChanges, 400);
}

async function applyRemoteChanges() {
  applyTimer = null;
  const journal = activeJournal;
  const batch = new Map(remoteChanges);
  remoteChanges.clear();
  const toFetch = [...batch].filter(([, c]) => c.kind === "fetch").map(([id]) => id);
  if (toFetch.length) {
    try {
      const { supabase } = await import("./supabase");
      const { data, error } = await supabase.from("journal_tasks").select("id,payload,updated_at").in("id", toFetch);
      if (error) throw error;
      const got = new Map(((data ?? []) as Row[]).map((r) => [r.id, r]));
      for (const id of toFetch) {
        const row = got.get(id);
        batch.set(id, row ? { kind: "row", row } : { kind: "gone" });
      }
    } catch {
      scheduleRefetch();
      return;
    }
  }
  if (journal !== activeJournal || !snapshot) return;
  const catIds = new Set(snapshot.categories.map((c) => c.id));
  const tasks = new Map(snapshot.tasks.map((t) => [t.id, t]));
  let changed = false;
  for (const [id, c] of batch) {
    // שינוי מקומי שממתין גובר — הוא יישלח לענן ויחזור כאירוע
    if (dirtyRoots.has(id) || deletedRoots.has(id) || leftRoots.has(id)) continue;
    if (c.kind === "row" && rowVisible(c.row.payload, journal)) {
      const t = taskFromRow(c.row.payload, journal, catIds);
      cloudRoots.set(id, t);
      const cur = tasks.get(id);
      if (!cur || JSON.stringify(cur) !== JSON.stringify(t)) { tasks.set(id, t); changed = true; }
    } else {
      cloudRoots.delete(id);
      if (tasks.delete(id)) changed = true;
    }
  }
  if (!changed) return;
  snapshot = { categories: snapshot.categories, tasks: [...tasks.values()].sort(byCreatedDesc) };
  saveJournal(snapshot);
  notify();
}

let refetchTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRefetch() {
  if (refetchTimer) clearTimeout(refetchTimer);
  refetchTimer = setTimeout(refetchCloud, 600);
}

// משיכה מלאה של היומן — רק כשצריך: שינוי קטגוריות, או חיבור מחדש אחרי ניתוק
async function refetchCloud() {
  // שינויים מקומיים בהמתנה — הם יידחפו ואז נקבל אירוע חדש
  if (hasPending()) return;
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

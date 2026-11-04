"use client";

// ============================================
// הצוות — רשימת אנשי הצוות, נעילת המנהל, העדפות עדכונים,
// ותמונת מצב של כל היומנים לדשבורד המנהל.
// ============================================

import {
  MANAGER_ID, META, DEFAULT_PREFS, metaKey, journalOfPayload, normalizeRoster, newJournalId,
  MEMBER_COLOR_ORDER,
  type TeamRoster, type TeamMember, type ManagerPin, type NotifyPrefs, type PersonColor,
} from "./journals";
import {
  type Task, type TaskCategory, DEFAULT_CATEGORIES, normalizeTask, storageKeyFor,
  replaceTaskInTree, findTaskInTree, emptyTask, uid,
} from "./tasks";

const hasCloud = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export type TelegramLink = { name?: string; linkedAt: string } | null;

export interface TeamMeta {
  roster: TeamRoster;
  pin: ManagerPin | null;
  prefs: NotifyPrefs;
  telegram: Record<string, TelegramLink>;
  loaded: boolean; // נטען מהמקור (ענן או מקומי) — לא רק מהמטמון
  mode: "cloud" | "local";
}

const META_CACHE = "ofir-team-cache";
const UNLOCK_KEY = "ofir-manager-unlock";
const DEVICE_KEY = "ofir-manager-device";

function readCache(): TeamMeta {
  const base: TeamMeta = {
    roster: { members: [] }, pin: null, prefs: DEFAULT_PREFS, telegram: {},
    loaded: false, mode: hasCloud ? "cloud" : "local",
  };
  if (typeof window === "undefined") return base;
  try {
    const raw = localStorage.getItem(META_CACHE);
    if (!raw) return { ...base, loaded: !hasCloud };
    const p = JSON.parse(raw) as Partial<TeamMeta>;
    return {
      ...base,
      roster: normalizeRoster(p.roster),
      pin: p.pin ?? null,
      prefs: { ...DEFAULT_PREFS, ...(p.prefs ?? {}) },
      telegram: p.telegram ?? {},
      // בלי ענן המטמון הוא המקור עצמו
      loaded: !hasCloud,
    };
  } catch {
    return base;
  }
}

let meta: TeamMeta | null = null;
const metaListeners = new Set<() => void>();
const SERVER_META: TeamMeta = {
  roster: { members: [] }, pin: null, prefs: DEFAULT_PREFS, telegram: {}, loaded: false, mode: "cloud",
};

export function subscribeTeamMeta(cb: () => void): () => void {
  metaListeners.add(cb);
  return () => metaListeners.delete(cb);
}
export function getTeamMeta(): TeamMeta {
  if (meta === null) meta = readCache();
  return meta;
}
export function getServerTeamMeta(): TeamMeta {
  return SERVER_META;
}

function setMeta(next: TeamMeta) {
  meta = next;
  try {
    localStorage.setItem(META_CACHE, JSON.stringify({
      roster: next.roster, pin: next.pin, prefs: next.prefs, telegram: next.telegram,
    }));
  } catch { /* quota */ }
  metaListeners.forEach((l) => l());
}

let metaStarted = false;

export async function initTeamMeta() {
  if (metaStarted || typeof window === "undefined") return;
  metaStarted = true;
  if (!hasCloud) {
    setMeta({ ...getTeamMeta(), loaded: true, mode: "local" });
    return;
  }
  await refetchMeta();
  try {
    const { supabase } = await import("./supabase");
    supabase
      .channel("team-meta")
      .on("postgres_changes", { event: "*", schema: "public", table: "journal_meta" }, () => {
        if (metaTimer) clearTimeout(metaTimer);
        metaTimer = setTimeout(refetchMeta, 500);
      })
      .subscribe();
  } catch { /* offline */ }
}

let metaTimer: ReturnType<typeof setTimeout> | null = null;

async function refetchMeta() {
  try {
    const { supabase } = await import("./supabase");
    const [main, tg] = await Promise.all([
      supabase.from("journal_meta").select("key,payload").in("key", [META.team, META.pin, META.prefs]),
      supabase.from("journal_meta").select("key,payload").like("key", "tg:%"),
    ]);
    if (main.error) throw main.error;
    const rows = (main.data ?? []) as { key: string; payload: unknown }[];
    const get = (k: string) => rows.find((r) => r.key === k)?.payload;
    const telegram: Record<string, TelegramLink> = {};
    for (const r of (tg.data ?? []) as { key: string; payload: { name?: string; linkedAt?: string } | null }[]) {
      const jid = r.key.slice(3);
      telegram[jid] = r.payload?.linkedAt ? { name: r.payload.name, linkedAt: r.payload.linkedAt } : null;
    }
    const pin = get(META.pin) as ManagerPin | undefined;
    setMeta({
      roster: normalizeRoster(get(META.team)),
      pin: pin?.hash && pin?.salt ? pin : null,
      prefs: { ...DEFAULT_PREFS, ...((get(META.prefs) as Partial<NotifyPrefs>) ?? {}) },
      telegram,
      loaded: true,
      mode: "cloud",
    });
  } catch {
    // אין חיבור — נשארים עם המטמון, אבל מסמנים שנטען כדי לא לתקוע את המסך
    setMeta({ ...getTeamMeta(), loaded: true });
  }
}

async function upsertMeta(key: string, payload: unknown) {
  if (!hasCloud) return;
  const { supabase } = await import("./supabase");
  const { error } = await supabase
    .from("journal_meta")
    .upsert({ key, payload, updated_at: new Date().toISOString() });
  if (error) throw error;
}

async function deleteMeta(keys: string[]) {
  if (!hasCloud || !keys.length) return;
  const { supabase } = await import("./supabase");
  await supabase.from("journal_meta").delete().in("key", keys);
}

// ---------- roster ----------

export async function saveRoster(roster: TeamRoster) {
  setMeta({ ...getTeamMeta(), roster });
  await upsertMeta(META.team, roster);
}

export async function addMember(name: string, color?: PersonColor, role?: string): Promise<TeamMember> {
  const m = getTeamMeta();
  const used = new Set(m.roster.members.map((x) => x.color));
  const member: TeamMember = {
    id: newJournalId(),
    name: name.trim(),
    color: color ?? MEMBER_COLOR_ORDER.find((c) => !used.has(c)) ?? "teal",
    role: role?.trim() || undefined,
    createdAt: new Date().toISOString(),
  };
  await saveRoster({ members: [...m.roster.members, member] });
  return member;
}

export async function updateMember(id: string, patch: Partial<Omit<TeamMember, "id">>) {
  const m = getTeamMeta();
  await saveRoster({ members: m.roster.members.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
}

// מסיר את אשת הצוות ואת כל היומן שלה (הגיבוי הלילי שומר עותק)
export async function removeMember(id: string) {
  const m = getTeamMeta();
  await saveRoster({ members: m.roster.members.filter((x) => x.id !== id) });
  const nextJ = { ...getTeamData().journals };
  delete nextJ[id];
  setTeamData({ ...getTeamData(), journals: nextJ });
  try { localStorage.removeItem(storageKeyFor(id)); } catch { /* ignore */ }
  if (!hasCloud) return;
  const { supabase } = await import("./supabase");
  await supabase.from("journal_tasks").delete().eq("payload->>journalId", id);
  await deleteMeta([metaKey("categories", id), META.telegram(id), META.telegramPending(id)]);
}

export async function savePrefs(prefs: NotifyPrefs) {
  setMeta({ ...getTeamMeta(), prefs });
  await upsertMeta(META.prefs, prefs);
}

// ---------- manager PIN ----------
// וילון פרטיות, לא אבטחה: הנתונים עצמם נגישים לכל מי שמחזיק במפתח ה-anon.
// מונע מאשת צוות לפתוח בטעות (או מסקרנות) את היומן ואת דשבורד המנהל.

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function setManagerPin(pin: string) {
  const salt = uid();
  const hash = await sha256(`${salt}:${pin}`);
  const p = { salt, hash };
  setMeta({ ...getTeamMeta(), pin: p });
  markUnlocked(hash);
  await upsertMeta(META.pin, p);
}

export async function verifyManagerPin(pin: string): Promise<boolean> {
  const p = getTeamMeta().pin;
  if (!p) return true;
  const ok = (await sha256(`${p.salt}:${pin}`)) === p.hash;
  if (ok) markUnlocked(p.hash);
  return ok;
}

function markUnlocked(hash: string) {
  try {
    localStorage.setItem(UNLOCK_KEY, hash);
    localStorage.setItem(DEVICE_KEY, "1");
  } catch { /* ignore */ }
}

export function markManagerDevice() {
  try { localStorage.setItem(DEVICE_KEY, "1"); } catch { /* ignore */ }
}

export function isUnlocked(pin: ManagerPin | null): boolean {
  if (!pin) return true;
  try { return localStorage.getItem(UNLOCK_KEY) === pin.hash; } catch { return false; }
}

export function lockManager() {
  try { localStorage.removeItem(UNLOCK_KEY); } catch { /* ignore */ }
}

// ============================================
// תמונת מצב של כל היומנים (נטען רק כשדשבורד המנהל נפתח)
// ============================================

export interface JournalSlice { tasks: Task[]; categories: TaskCategory[] }

export interface TeamData {
  journals: Record<string, JournalSlice>;
  loaded: boolean;
  error: string | null;
  fetchedAt: number;
}

let data: TeamData = { journals: {}, loaded: false, error: null, fetchedAt: 0 };
const dataListeners = new Set<() => void>();
const SERVER_DATA: TeamData = { journals: {}, loaded: false, error: null, fetchedAt: 0 };

export function subscribeTeamData(cb: () => void): () => void {
  dataListeners.add(cb);
  return () => dataListeners.delete(cb);
}
export function getTeamData(): TeamData { return data; }
export function getServerTeamData(): TeamData { return SERVER_DATA; }

function setTeamData(next: TeamData) {
  data = next;
  dataListeners.forEach((l) => l());
}

let dataStarted = false;
let dataTimer: ReturnType<typeof setTimeout> | null = null;
const pendingWrites = new Set<string>();

export async function initTeamData() {
  if (dataStarted || typeof window === "undefined") return;
  dataStarted = true;
  await refetchTeamData();
  if (!hasCloud) {
    window.addEventListener("storage", (e) => {
      if (e.key?.startsWith("ofir-task-journal")) refetchTeamData();
    });
    return;
  }
  try {
    const { supabase } = await import("./supabase");
    const schedule = () => {
      if (dataTimer) clearTimeout(dataTimer);
      dataTimer = setTimeout(refetchTeamData, 700);
    };
    supabase
      .channel("team-data")
      .on("postgres_changes", { event: "*", schema: "public", table: "journal_tasks" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "journal_meta" }, schedule)
      .subscribe();
  } catch { /* offline */ }
}

function readLocalSlice(journalId: string): JournalSlice {
  try {
    const raw = localStorage.getItem(storageKeyFor(journalId));
    if (!raw) return { tasks: [], categories: DEFAULT_CATEGORIES };
    const p = JSON.parse(raw) as { tasks?: Task[]; categories?: TaskCategory[] };
    return {
      tasks: (p.tasks ?? []).map(normalizeTask),
      categories: (p.categories ?? DEFAULT_CATEGORIES).map((c) => ({ ...c, parentId: c.parentId ?? null })),
    };
  } catch {
    return { tasks: [], categories: DEFAULT_CATEGORIES };
  }
}

export async function refetchTeamData() {
  if (pendingWrites.size) return; // כתיבה בדרך — נקבל אירוע חדש אחריה
  const ids = [MANAGER_ID, ...getTeamMeta().roster.members.map((m) => m.id)];
  if (!hasCloud) {
    const journals: Record<string, JournalSlice> = {};
    for (const id of ids) journals[id] = readLocalSlice(id);
    setTeamData({ journals, loaded: true, error: null, fetchedAt: Date.now() });
    return;
  }
  try {
    const { supabase } = await import("./supabase");
    const [tasksRes, catsRes] = await Promise.all([
      supabase.from("journal_tasks").select("id,payload"),
      supabase.from("journal_meta").select("key,payload").like("key", "categories%"),
    ]);
    if (tasksRes.error) throw tasksRes.error;
    const journals: Record<string, JournalSlice> = {};
    for (const id of ids) journals[id] = { tasks: [], categories: DEFAULT_CATEGORIES };
    for (const r of (catsRes.data ?? []) as { key: string; payload: TaskCategory[] }[]) {
      const jid = r.key === "categories" ? MANAGER_ID : r.key.startsWith("categories@") ? r.key.slice(11) : null;
      if (jid && journals[jid]) journals[jid].categories = r.payload.map((c) => ({ ...c, parentId: c.parentId ?? null }));
    }
    for (const r of (tasksRes.data ?? []) as { payload: Task & { journalId?: string } }[]) {
      const jid = journalOfPayload(r.payload);
      if (!journals[jid]) continue; // יומן של אשת צוות שהוסרה
      journals[jid].tasks.push(normalizeTask(r.payload));
    }
    for (const j of Object.values(journals)) j.tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    setTeamData({ journals, loaded: true, error: null, fetchedAt: Date.now() });
  } catch (e) {
    setTeamData({ ...data, loaded: true, error: e instanceof Error ? e.message : "שגיאת טעינה" });
  }
}

// כתיבה ליומן של אשת צוות מתוך דשבורד המנהל (עדכון אופטימי + ענן)
export async function upsertJournalRoot(journalId: string, root: Task) {
  const slice = data.journals[journalId] ?? { tasks: [], categories: DEFAULT_CATEGORIES };
  const exists = slice.tasks.some((t) => t.id === root.id);
  const tasks = exists ? slice.tasks.map((t) => (t.id === root.id ? root : t)) : [root, ...slice.tasks];
  setTeamData({ ...data, journals: { ...data.journals, [journalId]: { ...slice, tasks } } });

  if (!hasCloud) {
    try {
      const raw = localStorage.getItem(storageKeyFor(journalId));
      const p = raw ? JSON.parse(raw) : { categories: slice.categories, tasks: [] };
      const lt: Task[] = p.tasks ?? [];
      p.tasks = lt.some((t) => t.id === root.id) ? lt.map((t) => (t.id === root.id ? root : t)) : [root, ...lt];
      localStorage.setItem(storageKeyFor(journalId), JSON.stringify(p));
    } catch { /* quota */ }
    return;
  }
  pendingWrites.add(root.id);
  try {
    const { supabase } = await import("./supabase");
    const { error } = await supabase.from("journal_tasks").upsert({
      id: root.id, payload: { ...root, journalId }, updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  } finally {
    pendingWrites.delete(root.id);
  }
}

export async function deleteJournalRoot(journalId: string, rootId: string) {
  const slice = data.journals[journalId];
  if (slice) {
    setTeamData({
      ...data,
      journals: { ...data.journals, [journalId]: { ...slice, tasks: slice.tasks.filter((t) => t.id !== rootId) } },
    });
  }
  if (!hasCloud) {
    try {
      const raw = localStorage.getItem(storageKeyFor(journalId));
      if (raw) {
        const p = JSON.parse(raw);
        p.tasks = (p.tasks ?? []).filter((t: Task) => t.id !== rootId);
        localStorage.setItem(storageKeyFor(journalId), JSON.stringify(p));
      }
    } catch { /* ignore */ }
    return;
  }
  const { supabase } = await import("./supabase");
  await supabase.from("journal_tasks").delete().eq("id", rootId);
}

// עדכון משימה (או שלב) בתוך עץ של יומן כלשהו
export async function patchJournalTask(journalId: string, taskId: string, patch: Partial<Task>) {
  const slice = data.journals[journalId];
  if (!slice) return;
  const root = slice.tasks.find((r) => r.id === taskId || findTaskInTree(r.subtasks, taskId));
  if (!root) return;
  const target = root.id === taskId ? root : findTaskInTree(root.subtasks, taskId)!;
  const nextRoot = root.id === taskId ? { ...root, ...patch } : replaceTaskInTree([root], { ...target, ...patch })[0];
  await upsertJournalRoot(journalId, nextRoot);
}

// אופיר מקצה משימה לאשת צוות — נוחתת ביומן שלה עם סימון "מאופיר" ועדכון לטלפון שלה
export async function assignTask(journalId: string, fields: Partial<Task>): Promise<Task> {
  const t: Task = {
    ...emptyTask(),
    ...fields,
    assignedBy: MANAGER_ID,
    assignedAt: new Date().toISOString(),
  };
  await upsertJournalRoot(journalId, t);
  if (hasCloud) {
    fetch("/api/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ journalId, events: [{ type: "assigned", taskId: t.id, rootId: t.id }] }),
    }).catch(() => { /* best-effort */ });
  }
  return t;
}

// קטגוריה חדשה ביומן של אשת צוות (מתוך עריכת משימה בדשבורד המנהל)
export function addJournalCategory(journalId: string, name: string, color: string): TaskCategory | null {
  if (!name.trim()) return null;
  const slice = data.journals[journalId] ?? { tasks: [], categories: DEFAULT_CATEGORIES };
  const cat: TaskCategory = { id: uid(), name: name.trim(), color, parentId: null };
  const categories = [...slice.categories, cat];
  setTeamData({ ...data, journals: { ...data.journals, [journalId]: { ...slice, categories } } });
  if (!hasCloud) {
    try {
      const raw = localStorage.getItem(storageKeyFor(journalId));
      const p = raw ? JSON.parse(raw) : { tasks: [] };
      p.categories = categories;
      localStorage.setItem(storageKeyFor(journalId), JSON.stringify(p));
    } catch { /* quota */ }
  } else {
    upsertMeta(metaKey("categories", journalId), categories).catch(() => { /* next refetch heals */ });
  }
  return cat;
}

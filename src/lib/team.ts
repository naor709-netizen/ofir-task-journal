"use client";

// ============================================
// הצוות — רשימת אנשי הצוות, נעילת המנהל, העדפות עדכונים,
// ותמונת מצב של כל היומנים לדשבורד המנהל.
// ============================================

import {
  MANAGER_ID, META, DEFAULT_PREFS, metaKey, participantsOfPayload, normalizeRoster, newJournalId,
  MEMBER_COLOR_ORDER,
  type TeamRoster, type TeamMember, type NotifyPrefs, type PersonColor,
} from "./journals";
import {
  type Task, type TaskCategory, DEFAULT_CATEGORIES, normalizeTask, storageKeyFor,
  replaceTaskInTree, findTaskInTree, emptyTask, uid, taskFromRow, taskToRow,
} from "./tasks";

const hasCloud = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export type TelegramLink = { name?: string; linkedAt: string } | null;
export type SmsLinkInfo = { mask: string; linkedAt: string } | null;

export interface TeamMeta {
  roster: TeamRoster;
  prefs: NotifyPrefs;
  telegram: Record<string, TelegramLink>;
  sms: Record<string, SmsLinkInfo>;
  push: Record<string, number>; // כמה מכשירים עם התראות פעילות לכל יומן
  loaded: boolean; // נטען מהמקור (ענן או מקומי) — לא רק מהמטמון
  mode: "cloud" | "local";
}

const META_CACHE = "ofir-team-cache";

function readCache(): TeamMeta {
  const base: TeamMeta = {
    roster: { members: [] }, prefs: DEFAULT_PREFS, telegram: {}, sms: {}, push: {},
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
      prefs: { ...DEFAULT_PREFS, ...(p.prefs ?? {}) },
      telegram: p.telegram ?? {},
      sms: p.sms ?? {},
      push: p.push ?? {},
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
  roster: { members: [] }, prefs: DEFAULT_PREFS, telegram: {}, sms: {}, push: {}, loaded: false, mode: "cloud",
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
      roster: next.roster, prefs: next.prefs, telegram: next.telegram, sms: next.sms, push: next.push,
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
    const [main, tg, sms, subs] = await Promise.all([
      supabase.from("journal_meta").select("key,payload").in("key", [META.team, META.prefs]),
      supabase.from("journal_meta").select("key,payload").like("key", "tg:%"),
      supabase.from("journal_meta").select("key,payload").like("key", "sms:%"),
      // רק השיוך ליומן — לא מפתחות המנוי
      supabase.from("push_subscriptions").select("journal:subscription->>journalId"),
    ]);
    if (main.error) throw main.error;
    const rows = (main.data ?? []) as { key: string; payload: unknown }[];
    const get = (k: string) => rows.find((r) => r.key === k)?.payload;
    const telegram: Record<string, TelegramLink> = {};
    for (const r of (tg.data ?? []) as { key: string; payload: { name?: string; linkedAt?: string } | null }[]) {
      const jid = r.key.slice(3);
      telegram[jid] = r.payload?.linkedAt ? { name: r.payload.name, linkedAt: r.payload.linkedAt } : null;
    }
    // רק המסכה ("050-•••-4567") מגיעה ללקוח; המספר עצמו מוצפן בשרת
    const smsLinks: Record<string, SmsLinkInfo> = {};
    for (const r of (sms.data ?? []) as { key: string; payload: { mask?: string; linkedAt?: string } | null }[]) {
      smsLinks[r.key.slice(4)] = r.payload?.mask && r.payload.linkedAt ? { mask: r.payload.mask, linkedAt: r.payload.linkedAt } : null;
    }
    const push: Record<string, number> = {};
    for (const r of (subs.data ?? []) as { journal: string | null }[]) {
      const jid = r.journal || MANAGER_ID;
      push[jid] = (push[jid] ?? 0) + 1;
    }
    setMeta({
      roster: normalizeRoster(get(META.team)),
      prefs: { ...DEFAULT_PREFS, ...((get(META.prefs) as Partial<NotifyPrefs>) ?? {}) },
      telegram,
      sms: smsLinks,
      push,
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
  // משימות של אחרים ששותפו איתו/ה: נשארות אצל הבעלים, רק בלי השותף שנמחק
  const { data: sharedRows } = await supabase.from("journal_tasks").select("id,payload").not("payload->>sharedWith", "is", null);
  const strip = ((sharedRows ?? []) as { id: string; payload: Task & { journalId?: string } }[])
    .filter((r) => Array.isArray(r.payload?.sharedWith) && r.payload.sharedWith.includes(id))
    .map((r) => {
      const rest = r.payload.sharedWith!.filter((x) => x !== id);
      const payload = { ...r.payload, sharedWith: rest.length ? rest : undefined } as Task & { journalId?: string };
      if (payload.sharedCats) { const sc = { ...payload.sharedCats }; delete sc[id]; payload.sharedCats = sc; }
      if (!payload.sharedWith) delete payload.sharedWith;
      return { id: r.id, payload, updated_at: new Date().toISOString() };
    });
  if (strip.length) await supabase.from("journal_tasks").upsert(strip);
  await deleteMeta([metaKey("categories", id), META.telegram(id), META.telegramPending(id), `sms:${id}`, `sms-pending:${id}`]);
}

export async function savePrefs(prefs: NotifyPrefs) {
  setMeta({ ...getTeamMeta(), prefs });
  await upsertMeta(META.prefs, prefs);
}

// ---------- מכשיר המנהל ----------
// אין נעילה (הוסרה לבקשת המשתמש). רק מסמנים שזה המכשיר של אופיר, כדי להציג ביומן
// של איש צוות קיצור חזרה לדשבורד הצוות.
export function markManagerDevice() {
  try { localStorage.setItem("ofir-manager-device", "1"); } catch { /* ignore */ }
}

// ============================================
// תמונת מצב של כל היומנים (נטען רק כשדשבורד המנהל נפתח)
// ============================================

export interface JournalSlice {
  tasks: Task[];
  categories: TaskCategory[];
  updatedAt?: Record<string, string>; // rootId → מתי השורה עודכנה לאחרונה בענן (לבקרה של המנהל)
}

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
      supabase.from("journal_tasks").select("id,payload,updated_at"),
      supabase.from("journal_meta").select("key,payload").like("key", "categories%"),
    ]);
    if (tasksRes.error) throw tasksRes.error;
    const journals: Record<string, JournalSlice> = {};
    for (const id of ids) journals[id] = { tasks: [], categories: DEFAULT_CATEGORIES, updatedAt: {} };
    for (const r of (catsRes.data ?? []) as { key: string; payload: TaskCategory[] }[]) {
      const jid = r.key === "categories" ? MANAGER_ID : r.key.startsWith("categories@") ? r.key.slice(11) : null;
      if (jid && journals[jid]) journals[jid].categories = r.payload.map((c) => ({ ...c, parentId: c.parentId ?? null }));
    }
    for (const r of (tasksRes.data ?? []) as { id: string; payload: Task & { journalId?: string }; updated_at?: string }[]) {
      if (!r.payload) continue;
      // משימה משותפת מופיעה אצל כל מי ששותף בה (הבעלים + sharedWith)
      const owner = participantsOfPayload(r.payload)[0];
      for (const jid of participantsOfPayload(r.payload)) {
        const slice = journals[jid];
        if (!slice) continue; // יומן של אשת צוות שהוסרה
        if (jid !== owner && !String(r.payload.title ?? "").trim()) continue; // עדיין בהקלדה אצל היוצר
        slice.tasks.push(taskFromRow(r.payload, jid, new Set(slice.categories.map((c) => c.id))));
        if (r.updated_at) slice.updatedAt![r.id] = r.updated_at;
      }
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
  const updatedAt = { ...(slice.updatedAt ?? {}), [root.id]: new Date().toISOString() };
  setTeamData({ ...data, journals: { ...data.journals, [journalId]: { ...slice, tasks, updatedAt } } });

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
      id: root.id, payload: taskToRow(root, journalId), updated_at: new Date().toISOString(),
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

// "בקשת עדכון" — אופיר מבקש מאיש הצוות לעדכן משימה; קופצת לו/ה התראה בטלפון.
// השרת מאמת שהמשימה קיימת ופתוחה, ומגביל לפעם בחצי שעה לכל משימה.
export async function nudgeTask(journalId: string, taskId: string): Promise<"sent" | "limited" | "failed" | "local"> {
  if (!hasCloud) return "local";
  try {
    const res = await fetch("/api/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ journalId, events: [{ type: "nudge", taskId }] }),
    });
    const j = (await res.json().catch(() => ({}))) as { sent?: number };
    if (!res.ok) return "failed";
    return (j.sent ?? 0) > 0 ? "sent" : "limited";
  } catch {
    return "failed";
  }
}

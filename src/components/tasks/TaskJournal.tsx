"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { useToast } from "@/components/Toast";
import {
  type JournalData, type Task, type TaskCategory, type TaskNature, type TaskStatus,
  subscribeJournal, getJournalSnapshot, getServerJournalSnapshot, setJournalData,
  subscribeSyncState, getSyncState, getServerSyncState, getSyncDetail, initJournalSync,
  emptyTask, uid, isDone, isManagerDevice,
  replaceTaskInTree, removeTaskFromTree, findTaskInTree, flattenTasks, countSubtasks,
  toDateKey, formatDateHe, sharedPartners,
  NATURE_LABELS, NATURE_COLORS, STATUS_LABELS, STATUS_COLORS,
  HE_MONTHS, HE_WEEKDAYS, HE_WEEKDAYS_FULL, CATEGORY_COLOR_CHOICES,
} from "@/lib/tasks";
import { pushPermission, isSubscribed, showLocalNotification, syncPushSubscription } from "@/lib/push";
import { subscribeTeamMeta, getTeamMeta, getServerTeamMeta, markManagerDevice } from "@/lib/team";
import { MANAGER_ID, MANAGER_NAME, firstName, type PersonColor } from "@/lib/journals";
import { parseQuickAdd, hebrewDateToday } from "@/lib/quickadd";
import { celebrate } from "@/lib/celebrate";
import { T, alpha, card, tintCard, chip, inputStyle, Ic, StatusIcon, Avatar, ProgressRing, primaryBtn, IconChip, palVar, type Pal } from "./ui";
import { TaskModal } from "./TaskModal";
import { WeekView, TableView, BoardView, StatsView } from "./views";
import { NotifyCenter } from "./NotifyCenter";
import { InstallBanner, InstallSheet } from "./InstallApp";
import { TeamView, TeamStrip } from "./TeamView";
import { Donut, Legend, DayBars, DayBarsLegend } from "./charts";

gsap.registerPlugin(useGSAP);

type ViewKey = "dashboard" | "shared" | "team" | "week" | "table" | "board" | "stats";

const BASE_VIEWS: { key: ViewKey; label: string; icon: (s?: number) => React.ReactNode }[] = [
  { key: "dashboard", label: "דשבורד", icon: Ic.grid },
  { key: "week", label: "השבוע", icon: Ic.week },
  { key: "table", label: "טבלה", icon: Ic.table },
  { key: "board", label: "קנבן", icon: Ic.board },
  { key: "stats", label: "אנליטיקות", icon: Ic.chart },
];

type StatusFilter = "all" | "active" | "progress" | "done";

// משימה משותפת: שייכת ליומן אחר ושותפה איתי, או שלי ושיתפתי אותה
const isSharedTask = (t: Task) => !!(t.ownerId || t.sharedWith?.length);

export default function TaskJournal({ journalId, personName, personColor }: {
  journalId: string;
  personName: string;
  personColor: PersonColor;
}) {
  const { toast } = useToast();
  const journal = useSyncExternalStore(subscribeJournal, getJournalSnapshot, getServerJournalSnapshot);
  const syncState = useSyncExternalStore(subscribeSyncState, getSyncState, getServerSyncState);
  const teamMeta = useSyncExternalStore(subscribeTeamMeta, getTeamMeta, getServerTeamMeta);
  const isManager = journalId === MANAGER_ID;

  // כל האנשים (אופיר + הצוות) — לשיתוף משימה בין יומנים
  const people = useMemo(() => [
    { id: MANAGER_ID, name: MANAGER_NAME, color: "blue" as PersonColor },
    ...teamMeta.roster.members.map((m) => ({ id: m.id, name: m.name, color: m.color })),
  ], [teamMeta.roster.members]);
  const sharedLabelOf = (t: Task): string | null => {
    const names = sharedPartners(t, journalId)
      .map((id) => people.find((p) => p.id === id)?.name)
      .filter((n): n is string => !!n)
      .map(firstName);
    return names.length ? `משותפת עם ${names.join(" ו")}` : null;
  };
  // יש עם מי לשתף? אצל אופיר — כשיש צוות; אצל איש צוות — תמיד (לפחות אופיר)
  const partners = people.filter((p) => p.id !== journalId);
  const canShare = partners.length > 0;
  // משימה משותפת חדשה: עם שותף/ה יחיד/ה — משותפת מראש; עם כמה — בוחרים בחלון המשימה
  const createShared = () => createTask(partners.length === 1 ? [partners[0].id] : []);

  // "משותפות" — טאב קבוע מיד אחרי הדשבורד, אצל כולם
  const VIEWS = useMemo(() => {
    const shared = { key: "shared" as ViewKey, label: "משותפות", icon: Ic.share };
    const team = { key: "team" as ViewKey, label: "הצוות", icon: Ic.users };
    return isManager
      ? [BASE_VIEWS[0], shared, team, ...BASE_VIEWS.slice(1)]
      : [BASE_VIEWS[0], shared, ...BASE_VIEWS.slice(1)];
  }, [isManager]);
  // קישורים מהתראות: /?view=team (היומן לא מצויר בשרת — אין חשש לאי-התאמה)
  const [view, setView] = useState<ViewKey>(() => {
    if (typeof window === "undefined") return "dashboard";
    const v = new URLSearchParams(window.location.search).get("view") as ViewKey | null;
    return v && VIEWS.some((x) => x.key === v) ? v : "dashboard";
  });
  useEffect(() => { if (isManager) markManagerDevice(); }, [isManager]);

  // filters
  const [catFilter, setCatFilter] = useState<Set<string>>(new Set());
  const [natureFilter, setNatureFilter] = useState<Set<TaskNature>>(new Set());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [sharedOnly, setSharedOnly] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // calendar
  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());

  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  // מהדשבורד הראשי ישר ל"כל המשימות" של איש צוות מסוים
  const [teamFocus, setTeamFocus] = useState<string | null>(null);

  // add category (sidebar)
  const [newCatName, setNewCatName] = useState("");
  const [newCatColor, setNewCatColor] = useState(CATEGORY_COLOR_CHOICES[0]);
  const [newCatParent, setNewCatParent] = useState<string | null>(null);

  useEffect(() => { initJournalSync(); }, []);

  // ---- theme (בהיר/כהה) — ה-DOM כבר נקבע ע"י הסקריפט ב-layout לפני הציור הראשון ----
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    const saved = localStorage.getItem("ofir-theme");
    return saved === "dark" || (!saved && window.matchMedia?.("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  });
  function toggleTheme() {
    const t = theme === "dark" ? "light" : "dark";
    setTheme(t);
    localStorage.setItem("ofir-theme", t);
    document.documentElement.dataset.theme = t;
  }

  // ---- push notifications ----
  const [pushState, setPushState] = useState<"unsupported" | "off" | "on" | "denied">("off");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const perm = pushPermission();
      if (perm === "unsupported") { if (!cancelled) setPushState("unsupported"); return; }
      if (perm === "denied") { if (!cancelled) setPushState("denied"); return; }
      const sub = await isSubscribed();
      if (!cancelled) setPushState(sub && perm === "granted" ? "on" : "off");
      // מרענן את המנוי בשרת בכל פתיחה — מרפא מכשירים שנמחקו ומצמיד ליומן הנכון
      if (sub) syncPushSubscription(journalId);
    })();
    return () => { cancelled = true; };
  }, [journalId]);
  const smsLinked = !!teamMeta.sms[journalId];
  const telegramLinked = !!teamMeta.telegram[journalId];
  const phoneReady = telegramLinked || pushState === "on" || smsLinked;

  function persist(next: JournalData) {
    if (!setJournalData(next)) toast("השמירה נכשלה — ייתכן שהקבצים המצורפים גדולים מדי", "error");
  }

  // ---- reminders loop ----
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    function check() {
      const now = Date.now();
      setNowTick(now);
      const j = getJournalSnapshot();
      if (!j) return;
      let changed = false;
      let tasks = j.tasks;
      for (const t of flattenTasks(tasks)) {
        for (const r of t.reminders) {
          if (!r.fired && new Date(r.datetime).getTime() <= now) {
            changed = true;
            const updated: Task = {
              ...t,
              reminders: t.reminders.map((x) => (x.id === r.id ? { ...x, fired: true } : x)),
            };
            tasks = replaceTaskInTree(tasks, updated);
            const body = r.note || t.title;
            toast(`תזכורת: ${body}`, "info");
            showLocalNotification(`היומן של ${personName}`, body, r.id);
          }
        }
      }
      if (changed) setJournalData({ ...j, tasks });
    }
    const t = setTimeout(check, 800);
    const iv = setInterval(check, 20000);
    return () => { clearTimeout(t); clearInterval(iv); };
  }, [toast, personName]);

  // ---- derived ----
  const categories = useMemo(() => journal?.categories ?? [], [journal]);
  const catById = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c])) as Record<string, TaskCategory>,
    [categories]
  );

  const expandedCatFilter = useMemo(() => {
    if (catFilter.size === 0) return catFilter;
    const s = new Set(catFilter);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of categories) {
        if (c.parentId && s.has(c.parentId) && !s.has(c.id)) { s.add(c.id); grew = true; }
      }
    }
    return s;
  }, [catFilter, categories]);

  const todayKey = toDateKey(today);

  const baseFiltered = useMemo(() => {
    // חיפוש סלחני: לא תלוי רישיות או סדר מילים — כל מילה צריכה להופיע איפשהו במשימה
    const qWords = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    // שלבים הם משימות לכל דבר — שורש עובר סינון אם הוא או אחד השלבים שלו עונה על כל התנאים
    const matches = (t: Task): boolean => {
      if (expandedCatFilter.size > 0 && !(t.categoryId && expandedCatFilter.has(t.categoryId))) return false;
      if (natureFilter.size > 0 && !(t.nature && natureFilter.has(t.nature))) return false;
      if (statusFilter === "active" && isDone(t)) return false;
      if (statusFilter === "progress" && t.status !== "in_progress") return false;
      if (statusFilter === "done" && !isDone(t)) return false;
      if (criticalOnly && !t.critical) return false;
      if (sharedOnly && !isSharedTask(t)) return false;
      if (selectedDate && t.dueDate !== selectedDate && t.endDate !== selectedDate) return false;
      return true;
    };
    const haystack = (t: Task): string =>
      [
        t.title, t.description, t.notes,
        t.categoryId ? catById[t.categoryId]?.name : "",
        ...t.reminders.map((r) => r.note),
      ].filter(Boolean).join(" ").toLowerCase();
    return (journal?.tasks ?? []).filter((root) => {
      const tree = [root, ...flattenTasks(root.subtasks)];
      if (!tree.some(matches)) return false;
      if (qWords.length && !tree.some((x) => {
        const s = haystack(x);
        return qWords.every((w) => s.includes(w));
      })) return false;
      return true;
    });
  }, [journal, expandedCatFilter, natureFilter, statusFilter, criticalOnly, sharedOnly, search, selectedDate, catById]);
  const filteredTasks = overdueOnly
    ? baseFiltered.filter((root) => [root, ...flattenTasks(root.subtasks)].some((t) => !isDone(t) && t.dueDate && t.dueDate < todayKey))
    : baseFiltered;

  const criticalTasks = filteredTasks.filter((t) => t.critical && !isDone(t));
  // משימות שהושלמו לא נשארות ברשימה הראשית — הן עוברות לרשימה מרוכזת מתחת ללוח השנה
  // משימות משותפות פתוחות — מקבלות מקום משלהן בדשבורד, ולכן לא חוזרות ב"המשימות שלי"
  const sharedTasks = filteredTasks.filter((t) => isSharedTask(t) && !isDone(t));
  const sharedDone = filteredTasks.filter((t) => isSharedTask(t) && isDone(t))
    .sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""));
  const sharedOpenAll = (journal?.tasks ?? []).filter((t) => isSharedTask(t) && !isDone(t)).length;
  const regularTasks = filteredTasks.filter((t) => !isDone(t) && !t.critical && !isSharedTask(t));
  const doneTasks = [...filteredTasks.filter(isDone)]
    .sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""));
  const activeCount = filteredTasks.length - doneTasks.length;

  const allFlat = useMemo(() => flattenTasks(journal?.tasks ?? []), [journal]);
  const openCount = allFlat.filter((t) => !isDone(t)).length;
  const inProgressCount = allFlat.filter((t) => t.status === "in_progress").length;
  const criticalCount = allFlat.filter((t) => t.critical && !isDone(t)).length;
  const overdueCount = allFlat.filter((t) => !isDone(t) && t.dueDate && t.dueDate < todayKey).length;

  // רצף ימים עם לפחות השלמה אחת (אם היום עוד ריק — הרצף נספר עד אתמול)
  const streak = useMemo(() => {
    const days = new Set(allFlat.filter((t) => isDone(t) && t.endDate).map((t) => t.endDate as string));
    let s = 0;
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (!days.has(toDateKey(d))) d.setDate(d.getDate() - 1);
    while (days.has(toDateKey(d))) { s++; d.setDate(d.getDate() - 1); }
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFlat, todayKey]);

  function shareDay() {
    const todays = allFlat.filter((t) => t.dueDate === todayKey);
    const overdue = allFlat.filter((t) => !isDone(t) && t.dueDate && t.dueDate < todayKey);
    const lines = [
      `📋 היומן של ${personName} — יום ${HE_WEEKDAYS_FULL[today.getDay()]} ${today.getDate()}.${today.getMonth() + 1}`,
      "",
      ...(todays.length
        ? todays.map((t) => `${isDone(t) ? "✅" : t.critical ? "🔴" : "◻️"} ${t.title}${t.status === "in_progress" ? " (בתהליך)" : ""}`)
        : ["אין משימות להיום ✨"]),
    ];
    if (overdue.length) lines.push("", `⏰ ${overdue.length} משימות באיחור`);
    if (streak >= 2) lines.push("", `🔥 רצף של ${streak} ימים`);
    const text = lines.join("\n");
    if (typeof navigator !== "undefined" && navigator.share) {
      navigator.share({ text }).catch(() => { /* בוטל */ });
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
    }
  }

  const upcomingReminders = useMemo(() => {
    if (!nowTick) return [];
    return allFlat
      .filter((t) => !isDone(t))
      .flatMap((t) => t.reminders.filter((r) => !r.fired && new Date(r.datetime).getTime() >= nowTick)
        .map((r) => ({ task: t, r })))
      .sort((a, b) => a.r.datetime.localeCompare(b.r.datetime))
      .slice(0, 5);
  }, [allFlat, nowTick]);

  const calendarItems = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const root of filteredTasks) {
      for (const t of [root, ...flattenTasks(root.subtasks)]) {
        if (t.dueDate) (map[t.dueDate] ??= []).push(t);
      }
    }
    return map;
  }, [filteredTasks]);

  // ---- actions ----
  function addCategory(name: string, color: string, parentId: string | null = null): TaskCategory | null {
    if (!journal || !name.trim()) return null;
    const cat: TaskCategory = { id: uid(), name: name.trim(), color, parentId };
    persist({ ...journal, categories: [...journal.categories, cat] });
    return cat;
  }

  function deleteCategory(id: string) {
    if (!journal) return;
    const cat = catById[id];
    const assigned = flattenTasks(journal.tasks).filter((t) => t.categoryId === id).length;
    const msg = assigned > 0
      ? `למחוק את הקטגוריה "${cat?.name ?? ""}"? ${assigned} משימות ישוחררו ממנה (המשימות עצמן יישארו).`
      : `למחוק את הקטגוריה "${cat?.name ?? ""}"?`;
    if (!confirm(msg)) return;
    // ביטול מדויק: משחזר את הקטגוריה, השיוכים ותתי-הקטגוריות בלי לדרוס עריכות ביניים
    const removedCat = journal.categories.find((c) => c.id === id);
    const affectedIds = new Set(flattenTasks(journal.tasks).filter((t) => t.categoryId === id).map((t) => t.id));
    const childIds = new Set(journal.categories.filter((c) => c.parentId === id).map((c) => c.id));
    const clearCat = (list: Task[]): Task[] =>
      list.map((t) => ({
        ...t,
        categoryId: t.categoryId === id ? null : t.categoryId,
        subtasks: clearCat(t.subtasks),
      }));
    persist({
      ...journal,
      categories: journal.categories
        .filter((c) => c.id !== id)
        .map((c) => (c.parentId === id ? { ...c, parentId: null } : c)),
      tasks: clearCat(journal.tasks),
    });
    setCatFilter((p) => { const n = new Set(p); n.delete(id); return n; });
    toast("הקטגוריה נמחקה", "info", {
      label: "ביטול",
      onClick: () => {
        const s = getJournalSnapshot();
        if (!s || !removedCat) return;
        const restoreCat = (list: Task[]): Task[] =>
          list.map((t) => ({
            ...t,
            categoryId: !t.categoryId && affectedIds.has(t.id) ? id : t.categoryId,
            subtasks: restoreCat(t.subtasks),
          }));
        persist({
          ...s,
          categories: (s.categories.some((c) => c.id === id) ? s.categories : [...s.categories, removedCat])
            .map((c) => (childIds.has(c.id) && !c.parentId ? { ...c, parentId: id } : c)),
          tasks: restoreCat(s.tasks),
        });
      },
    });
  }

  function createTask(sharedWith?: string[]) {
    if (!journal) return;
    const t: Task = { ...emptyTask(), title: "", dueDate: todayKey, ...(sharedWith?.length ? { sharedWith } : {}) };
    persist({ ...journal, tasks: [t, ...journal.tasks] });
    setFreshId(t.id);
    setOpenTaskId(t.id);
  }

  function saveTask(updated: Task) {
    if (!journal) return;
    persist({ ...journal, tasks: replaceTaskInTree(journal.tasks, updated) });
  }

  function deleteTask(id: string) {
    if (!journal) return;
    // ביטול מדויק: מחזיר רק את המשימה שנמחקה למקומה, בלי לדרוס עריכות שנעשו בינתיים
    const idx = journal.tasks.findIndex((t) => t.id === id);
    const removed = idx >= 0 ? journal.tasks[idx] : null;
    persist({ ...journal, tasks: removeTaskFromTree(journal.tasks, id) });
    setOpenTaskId(null);
    toast(removed?.ownerId ? "המשימה הוסרה מהיומן שלך" : "המשימה נמחקה", "info", {
      label: "ביטול",
      onClick: () => {
        const s = getJournalSnapshot();
        if (!s || !removed || findTaskInTree(s.tasks, removed.id)) return;
        const tasks = [...s.tasks];
        tasks.splice(Math.min(idx, tasks.length), 0, removed);
        persist({ ...s, tasks });
      },
    });
  }

  function setTaskStatus(t: Task, status: TaskStatus) {
    if (status === "done" && t.status !== "done") celebrate();
    saveTask({
      ...t,
      status,
      endDate: status === "done" ? (t.endDate ?? todayKey) : t.endDate,
    });
  }

  // ---- quick add — עברית חופשית ----
  const [quickText, setQuickText] = useState("");
  const quickPreview = useMemo(() => (quickText.trim() ? parseQuickAdd(quickText) : null), [quickText]);
  function quickAdd() {
    if (!journal || !quickText.trim()) return;
    const p = parseQuickAdd(quickText);
    if (!p.title) { toast("חסר שם למשימה", "error"); return; }
    const t: Task = {
      ...emptyTask(),
      title: p.title,
      critical: p.critical,
      dueDate: p.dueDate ?? todayKey,
      reminders: p.reminder ? [{ id: uid(), datetime: p.reminder, note: "", fired: false }] : [],
    };
    persist({ ...journal, tasks: [t, ...journal.tasks] });
    setQuickText("");
    toast(p.summary, "success");
  }

  function cycleStatus(t: Task) {
    const order: TaskStatus[] = ["todo", "in_progress", "done"];
    setTaskStatus(t, order[(order.indexOf(t.status) + 1) % 3]);
  }

  function toggleSet<V>(set: Set<V>, v: V, setter: (s: Set<V>) => void) {
    const n = new Set(set);
    if (n.has(v)) n.delete(v); else n.add(v);
    setter(n);
  }

  function clearFilters() {
    setCatFilter(new Set()); setNatureFilter(new Set()); setStatusFilter("all");
    setCriticalOnly(false); setSharedOnly(false); setOverdueOnly(false); setSearch(""); setSelectedDate(null);
  }

  const openRoot = openTaskId && journal
    ? journal.tasks.find((root) => [root, ...flattenTasks(root.subtasks)].some((t) => t.id === openTaskId)) ?? null
    : null;

  const filtersActive = catFilter.size > 0 || natureFilter.size > 0 || statusFilter !== "all" || criticalOnly || sharedOnly || overdueOnly || !!search.trim() || !!selectedDate;

  // ---- GSAP choreography ----
  const rootRef = useRef<HTMLDivElement>(null);
  const entranceDone = useRef(false);
  const viewFirst = useRef(true);

  useGSAP(() => {
    if (!journal || entranceDone.current) return;
    entranceDone.current = true;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const tl = gsap.timeline({ defaults: { ease: "power3.out", duration: 0.5 } });
      tl.from(".tj-header", { y: -12, opacity: 0, duration: 0.36, clearProps: "opacity,transform" })
        .from(".tj-toolbar", { y: 10, opacity: 0, duration: 0.36, clearProps: "opacity,transform" }, "-=0.2")
        .from(".tj-main > *", { y: 18, opacity: 0, stagger: 0.05, clearProps: "opacity,transform" }, "-=0.18");
      gsap.utils.toArray<HTMLElement>(".tj-kpi-num").forEach((el) => {
        const end = parseInt(el.textContent || "0", 10) || 0;
        if (end > 0) {
          gsap.fromTo(el, { textContent: 0 },
            { textContent: end, duration: 0.9, delay: 0.25, ease: "power2.out", snap: { textContent: 1 } });
        }
      });
    });
  }, { scope: rootRef, dependencies: [!!journal] });

  useGSAP(() => {
    if (!journal) return;
    if (viewFirst.current) { viewFirst.current = false; return; }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    gsap.fromTo(".tj-main",
      { opacity: 0, y: 8, filter: "blur(4px)" },
      { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.34, ease: "power2.out", clearProps: "opacity,transform,filter" });
  }, { scope: rootRef, dependencies: [view] });

  const sync = {
    local:   { icon: Ic.cloudOff(13), label: "מקומי בלבד", color: T.ink3 },
    syncing: { icon: Ic.cloud(13),    label: "מסנכרן…",    color: T.amber },
    synced:  { icon: Ic.cloud(13),    label: "מסונכרן",    color: T.mint },
    error:   { icon: Ic.alert(13),    label: "שגיאת סנכרון", color: T.danger },
  }[syncState];

  function showSyncDiag() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    alert(
      `אבחון סנכרון\n` +
      `מצב: ${sync.label}\n` +
      `כתובת Supabase בבנייה: ${url || "❌ חסרה"}\n` +
      `מפתח anon בבנייה: ${key ? "✓ קיים (" + key.slice(0, 12) + "…)" : "❌ חסר"}\n` +
      `שגיאה אחרונה: ${getSyncDetail() || "אין"}`
    );
  }

  const header = (
    <Header
      sync={sync} onSyncClick={showSyncDiag}
      personName={personName} personColor={personColor} isManager={isManager}
      teamCount={teamMeta.roster.members.length}
    />
  );

  if (!journal) {
    return (
      <div style={{ minHeight: "100vh" }}>
        {header}
        <div style={{ maxWidth: 1252, margin: "0 auto", padding: "16px 18px", display: "grid", gap: 14 }}>
          <div className="tj-skel" style={{ height: 52 }} />
          <div className="tj-skel" style={{ height: 190 }} />
          <div className="tj-skel" style={{ height: 340 }} />
        </div>
      </div>
    );
  }

  const sharedPanelProps = {
    tasks: sharedTasks,
    canShare, isManager,
    me: { id: journalId, name: personName, color: personColor },
    partners,
    filtered: filtersActive,
    catById, todayKey,
    labelOf: sharedLabelOf,
    onCreate: createShared,
    onAddTeam: () => { setView("team"); window.scrollTo({ top: 0, behavior: "smooth" }); },
    onOpen: (id: string) => setOpenTaskId(id),
    onCycle: (t: Task) => cycleStatus(t),
  };

  const isTeam = view === "team";

  return (
    <div ref={rootRef} style={{ minHeight: "100vh", color: T.ink }}>
      {header}

      {/* ===== סרגל פקודות צף: טאבים + פעולות ===== */}
      <div className="tj-toolbar" style={{
        maxWidth: 1252, margin: "12px auto 0", padding: "7px 8px",
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        position: "sticky", top: 8, zIndex: 40,
        background: "var(--tj-glass)",
        backdropFilter: "blur(18px) saturate(1.5)", WebkitBackdropFilter: "blur(18px) saturate(1.5)",
        border: `1px solid ${T.line}`, borderRadius: 22,
        boxShadow: "inset 0 1px 0 var(--tj-bezel), 0 14px 34px -18px var(--tj-shadow-strong)",
      }}>
        <ViewTabs views={VIEWS} view={view} onChange={setView} badges={{ shared: sharedOpenAll }} />

        <div className="tj-actions" style={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={toggleTheme} aria-label={theme === "dark" ? "מעבר למצב בהיר" : "מעבר למצב כהה"} title={theme === "dark" ? "מעבר למצב בהיר" : "מעבר למצב כהה"} style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 34, height: 34, borderRadius: 99, border: `1px solid ${T.line}`,
            background: T.surface, color: T.ink2, cursor: "pointer", flexShrink: 0,
          }}>
            {theme === "dark" ? Ic.sun(15) : Ic.moon(15)}
          </button>
          <button onClick={() => setNotifyOpen(true)} title="התראות לטלפון" style={{
            display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 600, fontFamily: "inherit",
            height: 34, padding: "0 13px", borderRadius: 99, cursor: "pointer", flexShrink: 0,
            border: `1px solid ${phoneReady ? alpha(T.mint, 40) : T.line}`,
            background: phoneReady ? T.mintSoft : T.surface,
            color: phoneReady ? T.mint : T.ink2,
          }}>
            <span style={{ position: "relative", display: "inline-flex" }}>
              {Ic.bell(14)}
              <span style={{
                position: "absolute", top: -2, insetInlineEnd: -2, width: 7, height: 7, borderRadius: 99,
                background: phoneReady ? T.mint : T.amber, boxShadow: `0 0 0 2px ${T.surface}`,
              }} />
            </span>
            <span className="tj-notify-label">{phoneReady ? (telegramLinked ? "טלגרם מחובר" : pushState === "on" ? "התראות פעילות" : "SMS מחובר") : "התראות לטלפון"}</span>
          </button>
          {!isTeam && (
            <button onClick={() => createTask()} className="tj-newbtn" style={{ ...primaryBtn, padding: "6px 7px 6px 18px", height: 40 }}>
              <span className="tj-newbtn-orb" style={{
                width: 27, height: 27, borderRadius: 99, background: "rgba(255,255,255,0.2)",
                display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>{Ic.plus(14)}</span>
              משימה חדשה
            </button>
          )}
        </div>
      </div>

      {isTeam ? (
        <div className="tj-layout" style={{ maxWidth: 1280, margin: "0 auto", padding: "16px 18px 60px" }}>
          <main className="tj-main" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <TeamView
              todayKey={todayKey}
              onOpenOwnTask={(id) => setOpenTaskId(id)}
              onOpenNotify={() => setNotifyOpen(true)}
              focusMember={teamFocus}
            />
          </main>
        </div>
      ) : (
      <div className="tj-layout" style={{
        maxWidth: 1280, margin: "0 auto", padding: "16px 18px 60px",
        display: "flex", gap: 16, alignItems: "flex-start",
      }}>

        {/* ---- sidebar ---- */}
        <aside className={sidebarOpen ? "tj-card" : "tj-sidebar tj-card"} style={{
          ...card, width: 260, flexShrink: 0, padding: 16,
          position: "sticky", top: 70,
          display: sidebarOpen ? "block" : undefined,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12, color: T.ink2, fontSize: 12.5, fontWeight: 700 }}>
            {Ic.filter(14)} סינון
            {filtersActive && (
              <button onClick={clearFilters} style={{
                marginInlineStart: "auto", background: "none", border: "none",
                color: T.accent, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              }}>
                ניקוי
              </button>
            )}
          </div>

          <button className="tj-apply-mobile" onClick={() => { setSidebarOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{
            ...primaryBtn, display: "none", width: "100%", borderRadius: 14, padding: "11px 0", marginBottom: 14,
          }}>
            הצגת {filteredTasks.length} תוצאות {Ic.chevL(15)}
          </button>

          <div style={{ position: "relative", marginBottom: 10 }}>
            {/* בלי pointer-events האייקון בולע הקשות על השדה בנייד */}
            <span style={{ position: "absolute", insetInlineStart: 11, top: "50%", transform: "translateY(-50%)", color: T.ink3, pointerEvents: "none" }}>
              {Ic.search(14)}
            </span>
            <input
              type="search" inputMode="search" placeholder="חיפוש משימה…" value={search} aria-label="חיפוש משימה"
              onChange={(e) => { setSearch(e.target.value); if (selectedDate) setSelectedDate(null); }}
              onKeyDown={(e) => {
                // מקש "חיפוש" במקלדת של הנייד = Enter — מיישם את הסינון ומציג את התוצאות
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                  setSidebarOpen(false);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }
              }}
              style={{ ...inputStyle, width: "100%", paddingInlineStart: 33 }}
            />
          </div>

          {/* פידבק חי בזמן הקלדה — בנייד התוצאות מוסתרות מאחורי הפאנל */}
          {search.trim() !== "" && (
            <div className="tj-search-live" style={{
              display: "none", flexDirection: "column", gap: 5, marginBottom: 14,
              background: T.bg2, borderRadius: 13, padding: 10,
            }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: filteredTasks.length === 0 ? T.danger : T.ink2 }}>
                {filteredTasks.length === 0 ? "לא נמצאו משימות תואמות" : `נמצאו ${filteredTasks.length} משימות — הקשה פותחת:`}
              </span>
              {filteredTasks.slice(0, 5).map((t) => (
                <button key={t.id} onClick={() => setOpenTaskId(t.id)} style={{
                  display: "flex", alignItems: "center", gap: 8, textAlign: "start",
                  background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10,
                  padding: "8px 10px", fontSize: 12.5, fontWeight: 500, color: T.ink,
                  cursor: "pointer", fontFamily: "inherit",
                }}>
                  <span style={{ color: STATUS_COLORS[t.status], display: "inline-flex", flexShrink: 0 }}>
                    <StatusIcon status={t.status} size={13} />
                  </span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title || "ללא שם"}</span>
                </button>
              ))}
              {filteredTasks.length > 5 && (
                <button onClick={() => { setSidebarOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{
                  background: "none", border: "none", color: T.accent, fontSize: 11.5,
                  cursor: "pointer", fontFamily: "inherit", textAlign: "start", padding: "2px 0",
                }}>
                  לכל {filteredTasks.length} התוצאות ←
                </button>
              )}
            </div>
          )}

          <SectionTitle>קטגוריות</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 10 }}>
            {[...categories.filter((c) => !c.parentId).flatMap((parent) => [parent, ...categories.filter((k) => k.parentId === parent.id)])].map((c) => {
              const active = catFilter.has(c.id);
              const count = filteredCountByCat(journal.tasks, c.id);
              return (
                <div key={c.id} className="tj-catrow" style={{ display: "flex", alignItems: "center", gap: 2, paddingInlineStart: c.parentId ? 18 : 0 }}>
                  <button
                    onClick={() => toggleSet(catFilter, c.id, setCatFilter)}
                    aria-pressed={active}
                    style={{
                      flex: 1, display: "flex", alignItems: "center", gap: 9, textAlign: "start",
                      background: active ? alpha(c.color, 12) : "transparent",
                      border: `1px solid ${active ? alpha(c.color, 40) : "transparent"}`,
                      borderRadius: 10, padding: "7px 10px", cursor: "pointer",
                      fontSize: 12.5, fontWeight: active ? 600 : 500,
                      color: active ? T.ink : T.ink2, fontFamily: "inherit",
                    }}>
                    <span style={{ width: c.parentId ? 7 : 9, height: c.parentId ? 7 : 9, borderRadius: 99, background: c.color, flexShrink: 0, boxShadow: `0 0 0 3px ${alpha(c.color, 16)}` }} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: c.parentId ? 12 : undefined }}>{c.name}</span>
                    <span className="num" style={{ fontSize: 10.5, color: T.ink3 }}>{count}</span>
                  </button>
                  {!c.parentId && (
                    <button title="הוספת תת-קטגוריה" aria-label={`הוספת תת-קטגוריה ל${c.name}`} onClick={() => { setNewCatParent(c.id); setNewCatName(""); }}
                      className="tj-catdel"
                      style={{ background: "transparent", border: "none", color: T.accent, cursor: "pointer", padding: 4, borderRadius: 6 }}>
                      {Ic.plus(11)}
                    </button>
                  )}
                  <button title="מחיקת קטגוריה" aria-label={`מחיקת הקטגוריה ${c.name}`} onClick={() => deleteCategory(c.id)}
                    className="tj-catdel"
                    style={{ background: "transparent", border: "none", color: T.ink3, cursor: "pointer", padding: 4, borderRadius: 6 }}>
                    {Ic.x(11)}
                  </button>
                </div>
              );
            })}
          </div>

          {/* add category */}
          <div style={{ background: T.bg2, borderRadius: 14, padding: 11, marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: T.ink2, marginBottom: 7, display: "flex", alignItems: "center", gap: 5 }}>
              {Ic.plus(12)}
              {newCatParent && catById[newCatParent]
                ? <>תת-קטגוריה בתוך <b style={{ color: catById[newCatParent].color }}>{catById[newCatParent].name}</b>
                    <button onClick={() => setNewCatParent(null)} title="ביטול" aria-label="ביטול"
                      style={{ background: "none", border: "none", color: T.ink3, cursor: "pointer", display: "inline-flex", padding: 2 }}>
                      {Ic.x(10)}
                    </button>
                  </>
                : "קטגוריה חדשה"}
            </div>
            <input
              placeholder="שם הקטגוריה" value={newCatName} aria-label="שם הקטגוריה"
              onChange={(e) => setNewCatName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && newCatName.trim()) { addCategory(newCatName, newCatColor, newCatParent); setNewCatName(""); setNewCatParent(null); } }}
              style={{ ...inputStyle, width: "100%", padding: "7px 10px", fontSize: 12, marginBottom: 8 }}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
              {CATEGORY_COLOR_CHOICES.map((col) => (
                <button key={col} onClick={() => setNewCatColor(col)} aria-label={`צבע ${col}`} style={{
                  width: 18, height: 18, borderRadius: 99, background: col, cursor: "pointer",
                  border: "none",
                  outline: newCatColor === col ? `2px solid ${T.ink}` : "none", outlineOffset: 1,
                }} />
              ))}
              <input type="color" value={newCatColor} onChange={(e) => setNewCatColor(e.target.value)}
                title="צבע חופשי" aria-label="צבע חופשי"
                style={{ width: 18, height: 18, padding: 0, border: "none", borderRadius: 99, cursor: "pointer", background: "transparent" }} />
            </div>
            <button
              onClick={() => { if (newCatName.trim()) { addCategory(newCatName, newCatColor, newCatParent); setNewCatName(""); setNewCatParent(null); } }}
              disabled={!newCatName.trim()}
              style={{
                width: "100%", border: "none", borderRadius: 10, padding: "8px 0",
                fontSize: 12, fontWeight: 600, fontFamily: "inherit",
                background: newCatName.trim() ? T.accentSoft : T.surface,
                color: newCatName.trim() ? T.accent : T.ink3,
                cursor: newCatName.trim() ? "pointer" : "default",
                boxShadow: newCatName.trim() ? `inset 0 0 0 1px ${T.accentLine}` : `inset 0 0 0 1px ${T.line}`,
              }}>
              הוספה
            </button>
          </div>

          <SectionTitle>מהות</SectionTitle>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
            {(Object.keys(NATURE_LABELS) as TaskNature[]).map((n) => (
              <button key={n} onClick={() => toggleSet(natureFilter, n, setNatureFilter)} aria-pressed={natureFilter.has(n)}
                style={chip(NATURE_COLORS[n], natureFilter.has(n))}>
                {NATURE_LABELS[n]}
              </button>
            ))}
          </div>

          <SectionTitle>סטטוס</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 4, marginBottom: 16, background: T.bg2, padding: 3, borderRadius: 12 }}>
            {([["all", "הכל"], ["active", "פעילות"], ["progress", "בתהליך"], ["done", "הושלמו"]] as const).map(([v, label]) => (
              <button key={v} onClick={() => setStatusFilter(v)} aria-pressed={statusFilter === v} style={{
                borderRadius: 9, padding: "7px 0", fontSize: 11.5, cursor: "pointer", fontFamily: "inherit",
                border: "none",
                background: statusFilter === v ? T.surface : "transparent",
                boxShadow: statusFilter === v ? `0 1px 2px var(--tj-shadow), inset 0 0 0 1px ${T.line}` : "none",
                color: statusFilter === v ? T.accent : T.ink2, fontWeight: statusFilter === v ? 700 : 500,
              }}>{label}</button>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
            <FilterToggle on={criticalOnly} onClick={() => setCriticalOnly(!criticalOnly)} icon={Ic.flame(14)} label="רק משימות קריטיות" />
            <FilterToggle on={overdueOnly} onClick={() => setOverdueOnly(!overdueOnly)} icon={Ic.alert(14)} label="רק משימות באיחור" />
            {canShare && <FilterToggle on={sharedOnly} onClick={() => setSharedOnly(!sharedOnly)} icon={Ic.users(14)} label="רק משימות משותפות" tone="accent" />}
          </div>

          {upcomingReminders.length > 0 && (
            <>
              <SectionTitle>תזכורות קרובות</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {upcomingReminders.map(({ task, r }) => (
                  <button key={r.id} onClick={() => setOpenTaskId(task.id)} style={{
                    textAlign: "start", background: T.bg2, border: "none",
                    borderRadius: 11, padding: "8px 10px", cursor: "pointer", fontFamily: "inherit",
                    display: "flex", gap: 8, alignItems: "flex-start",
                  }}>
                    <span style={{ color: T.accent, marginTop: 1 }}>{Ic.clock(13)}</span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 12, fontWeight: 500, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.note || task.title}
                      </span>
                      <span className="num" style={{ fontSize: 10.5, color: T.ink3 }}>
                        {new Date(r.datetime).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </aside>

        {/* ---- main ---- */}
        <main className="tj-main" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>

          <button className="tj-sidebar-toggle" onClick={() => setSidebarOpen((o) => {
            if (!o) window.scrollTo({ top: 0, behavior: "smooth" });
            return !o;
          })} style={{
            display: "none", ...card, padding: "11px 14px", fontSize: 13, fontWeight: 600,
            color: T.ink2, cursor: "pointer", textAlign: "start", fontFamily: "inherit",
            alignItems: "center", gap: 8,
          }}>
            {sidebarOpen ? <>{Ic.x(14)} סגירת סינון</> : <>{Ic.filter(14)} סינון וקטגוריות{filtersActive && <span style={{ marginInlineStart: "auto", width: 8, height: 8, borderRadius: 99, background: T.accent }} />}</>}
          </button>

          {view === "dashboard" && (
            <>
              <InstallBanner journalId={journalId} onOpen={() => setInstallOpen(true)} />
              <Hero
                personName={personName}
                today={today}
                todayKey={todayKey}
                allFlat={allFlat}
                nowTick={nowTick}
                streak={streak}
                overdueCount={overdueCount}
                criticalCount={criticalCount}
                quickText={quickText}
                setQuickText={setQuickText}
                quickPreview={quickPreview}
                onQuickAdd={quickAdd}
                onShare={shareDay}
                onOpenTask={setOpenTaskId}
              />

              {/* מדדים לחיצים — כל מדד הוא גם מסנן */}
              <div className="tj-kpis" style={{
                display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10,
              }}>
                <StatCell label="משימות פתוחות" value={openCount} icon={Ic.layers(16)} pal="blue"
                  active={statusFilter === "active"} onClick={() => setStatusFilter(statusFilter === "active" ? "all" : "active")} />
                <StatCell label="בתהליך" value={inProgressCount} icon={Ic.progress(16)} pal="purple"
                  active={statusFilter === "progress"} onClick={() => setStatusFilter(statusFilter === "progress" ? "all" : "progress")} />
                <StatCell label="קריטיות" value={criticalCount} icon={Ic.flame(16)} pal="crimson" tone={criticalCount > 0 ? "danger" : undefined}
                  active={criticalOnly} onClick={() => setCriticalOnly(!criticalOnly)} />
                <StatCell label="באיחור" value={overdueCount} icon={Ic.alert(16)} pal="pink" tone={overdueCount > 0 ? "danger" : undefined}
                  active={overdueOnly} onClick={() => setOverdueOnly(!overdueOnly)} />
              </div>

              {/* הצוות במבט אחד — רק אצל אופיר, ורק כשיש צוות */}
              {isManager && (
                <TeamStrip todayKey={todayKey} onOpenMember={(id) => {
                  setTeamFocus(id);
                  setView("team");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }} />
              )}

              {/* ---- משימות משותפות: מופיעות אצל שני הצדדים ---- */}
              <SharedPanel {...sharedPanelProps} />

              {/* critical strip */}
              {criticalTasks.length > 0 && (
                <section className="tj-card" style={{ ...tintCard(T.danger), padding: 16 }}>
                  <SectionHead icon={Ic.flame(15)} title="משימות קריטיות" count={criticalTasks.length} tone="danger" />
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", gap: 8 }}>
                    {criticalTasks.map((t) => (
                      <TaskRow key={t.id} task={t} cat={t.categoryId ? catById[t.categoryId] : undefined} sharedLabel={sharedLabelOf(t)}
                        critical todayKey={todayKey}
                        onOpen={() => setOpenTaskId(t.id)} onCycle={() => cycleStatus(t)} compact />
                    ))}
                  </div>
                </section>
              )}

              {/* tasks (main, right) + calendar (left column) side by side */}
              <div className="tj-dash-cols" style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
                  <section className="tj-card" style={{ ...card, padding: 16 }}>
                    <SectionHead icon={Ic.layers(15)} title="המשימות שלי" count={activeCount}
                      extra={filtersActive ? (
                        <button onClick={clearFilters} style={{ marginInlineStart: "auto", background: "none", border: "none", color: T.accent, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 4 }}>
                          {Ic.x(11)} ניקוי סינון
                        </button>
                      ) : undefined} />

                    {activeCount === 0 ? (
                      doneTasks.length > 0 ? (
                        <div style={{ textAlign: "center", padding: "34px 20px", color: T.mint, fontSize: 14, fontWeight: 600, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                          {Ic.sparkle(26)}
                          כל המשימות הושלמו — כל הכבוד!
                        </div>
                      ) : (
                        <Empty filtersActive={filtersActive} onCreate={() => createTask()} />
                      )
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {regularTasks.map((t) => (
                          <TaskRow key={t.id} task={t} cat={t.categoryId ? catById[t.categoryId] : undefined} sharedLabel={sharedLabelOf(t)}
                            todayKey={todayKey}
                            onOpen={() => setOpenTaskId(t.id)} onCycle={() => cycleStatus(t)} />
                        ))}
                        {regularTasks.length === 0 && (
                          <div style={{ fontSize: 12.5, color: T.ink3, padding: "8px 2px" }}>כל המשימות הפתוחות כאן קריטיות — הן מופיעות למעלה.</div>
                        )}
                      </div>
                    )}
                  </section>
                </div>
                <div className="tj-dash-cal" style={{ width: 452, flexShrink: 0, position: "sticky", top: 70 }}>
                  <section className="tj-card" style={{ ...card, padding: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                      <HeadIcon icon={Ic.calendar(15)} pal="purple" />
                      <h2 style={sectionH2}>לוח שנה</h2>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, marginInlineStart: "auto" }}>
                        <NavBtn label="החודש הקודם" onClick={() => { const m = calMonth - 1; if (m < 0) { setCalMonth(11); setCalYear(calYear - 1); } else setCalMonth(m); }}>{Ic.chevR(14)}</NavBtn>
                        <div className="num" style={{ minWidth: 112, textAlign: "center", fontWeight: 600, fontSize: 13.5 }}>
                          {HE_MONTHS[calMonth]} {calYear}
                        </div>
                        <NavBtn label="החודש הבא" onClick={() => { const m = calMonth + 1; if (m > 11) { setCalMonth(0); setCalYear(calYear + 1); } else setCalMonth(m); }}>{Ic.chevL(14)}</NavBtn>
                        <button onClick={() => { setCalYear(today.getFullYear()); setCalMonth(today.getMonth()); }} style={{
                          marginInlineStart: 6, background: T.accentSoft, color: T.accent, border: "none",
                          borderRadius: 99, padding: "5px 13px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                        }}>היום</button>
                      </div>
                    </div>

                    <CalendarGrid
                      year={calYear} month={calMonth} todayKey={todayKey}
                      items={calendarItems} catById={catById}
                      selectedDate={selectedDate}
                      onSelectDate={(k) => setSelectedDate(selectedDate === k ? null : k)}
                      onOpenTask={(id) => setOpenTaskId(id)}
                    />

                    {selectedDate && (
                      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
                        <span style={{ color: T.mint, background: T.mintSoft, borderRadius: 99, padding: "3px 12px", fontWeight: 600 }}>
                          מסונן לתאריך {formatDateHe(selectedDate)}
                        </span>
                        <button onClick={() => setSelectedDate(null)} style={{ background: "none", border: "none", color: T.ink3, cursor: "pointer", fontSize: 11.5, textDecoration: "underline", fontFamily: "inherit" }}>
                          הצגת הכל
                        </button>
                      </div>
                    )}
                  </section>

                  {/* השבוע שלך — גרף שטח של 14 ימים + דונאט פתוחות לפי קטגוריה */}
                  <WeekInsights allFlat={allFlat} catById={catById} todayKey={todayKey} />

                  {/* המשימות שהושלמו — רשימה מרוכזת מתחת ללוח השנה (בקשה של אופיר) */}
                  <section className="tj-card" style={{ ...card, padding: 16, marginTop: 14 }}>
                    <SectionHead icon={Ic.checkCircle(15)} title="הושלמו" count={doneTasks.length} tone="mint" tight={doneTasks.length === 0} />
                    {doneTasks.length === 0 ? (
                      <div style={{ fontSize: 12, color: T.ink3, marginTop: 8 }}>
                        משימות שתסמנו כ&quot;הושלמו&quot; יעברו לכאן.
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 380, overflowY: "auto" }}>
                        {doneTasks.map((t) => (
                          <TaskRow key={t.id} task={t} cat={t.categoryId ? catById[t.categoryId] : undefined} sharedLabel={sharedLabelOf(t)}
                            todayKey={todayKey} compact
                            onOpen={() => setOpenTaskId(t.id)} onCycle={() => cycleStatus(t)} />
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              </div>
            </>
          )}

          {view === "shared" && <SharedPanel {...sharedPanelProps} full done={sharedDone} />}
          {view === "week" && (
            <WeekView roots={filteredTasks} catById={catById} todayKey={todayKey} onOpen={setOpenTaskId} />
          )}
          {view === "table" && (
            <TableView roots={filteredTasks} catById={catById} todayKey={todayKey}
              onOpen={setOpenTaskId} onCycle={cycleStatus} />
          )}
          {view === "board" && (
            <BoardView roots={filteredTasks} catById={catById} todayKey={todayKey}
              onOpen={setOpenTaskId} onSetStatus={(id, s) => {
                const t = journal.tasks.find((x) => x.id === id);
                if (t) setTaskStatus(t, s);
              }} />
          )}
          {view === "stats" && (
            <StatsView roots={filteredTasks} catById={catById} todayKey={todayKey} />
          )}
        </main>
      </div>
      )}

      {openRoot && (
        <TaskModal
          root={openRoot}
          isNew={openRoot.id === freshId}
          focusId={openTaskId!}
          categories={categories}
          onSave={saveTask}
          onDelete={deleteTask}
          onAddCategory={addCategory}
          share={{ journalId, people }}
          onClose={() => {
            const snap = getJournalSnapshot();
            if (freshId && snap) {
              const ft = snap.tasks.find((x) => x.id === freshId);
              if (ft && !ft.title.trim()) setJournalData({ ...snap, tasks: removeTaskFromTree(snap.tasks, freshId) });
            }
            setOpenTaskId(null);
            setFreshId(null);
          }}
        />
      )}

      {installOpen && <InstallSheet personName={personName} onClose={() => setInstallOpen(false)} />}

      {notifyOpen && (
        <NotifyCenter
          journalId={journalId}
          personName={personName}
          pushState={pushState}
          setPushState={setPushState}
          onClose={() => setNotifyOpen(false)}
        />
      )}

      <style>{`
        @media (max-width: 1290px) { .tj-toolbar { margin-inline: 12px !important; } }
        .tj-newbtn:hover .tj-newbtn-orb { transform: rotate(90deg) scale(1.08); }
        .tj-newbtn-orb { transition: transform .45s var(--ease-soft); }
        .tj-catdel { opacity: 0; transition: opacity .15s; }
        .tj-catrow:hover .tj-catdel, .tj-catrow:focus-within .tj-catdel { opacity: 0.75; }
        @media (max-width: 520px) { .tj-synctext { display: none; } .tj-shared-with { display: none; } }
        @media (max-width: 1180px) {
          .tj-dash-cols { flex-direction: column !important; align-items: stretch !important; }
          .tj-dash-cal { width: 100% !important; position: static !important; }
        }
        @media (max-width: 900px) {
          .tj-sidebar { display: none; }
          .tj-sidebar-toggle { display: flex !important; }
          .tj-layout { flex-direction: column; }
          .tj-layout > aside { width: 100% !important; position: static !important; }
          .tj-catdel { opacity: 0.75; }
          .tj-apply-mobile { display: flex !important; }
          .tj-search-live { display: flex !important; }
        }
        input[type="search"]::-webkit-search-cancel-button { -webkit-appearance: none; }
        @media (max-width: 760px) {
          .tj-toolbar { flex-direction: column; align-items: stretch !important; }
          .tj-actions { margin-inline-start: 0 !important; }
          .tj-newbtn { flex: 1; }
          .tj-notify-label { display: none; }
        }
        @media (max-width: 640px) {
          /* פונט מתחת ל-16px גורם לזום אוטומטי של iOS בפוקוס על שדה */
          input, textarea, select { font-size: 16px !important; }
          .tj-toolbar { padding: 6px !important; margin: 8px 8px 0 !important; top: 6px !important; border-radius: 20px !important; }
          .tj-layout { padding: 10px 10px 40px !important; gap: 10px !important; }
          .tj-card { padding: 13px !important; }
          .tj-kpis { grid-template-columns: repeat(2,1fr) !important; gap: 8px !important; }
          .tj-calday { min-height: 52px !important; padding: 3px 3px !important; }
          .tj-calday button { font-size: 8.5px !important; padding: 1px 3px !important; }
        }
      `}</style>
    </div>
  );
}

const noopSubscribe = () => () => {};

function filteredCountByCat(tasks: Task[], catId: string): number {
  return flattenTasks(tasks).filter((t) => t.categoryId === catId && !isDone(t)).length;
}

// ============ pieces ============

const sectionH2: React.CSSProperties = {
  margin: 0, fontSize: 15.5, fontWeight: 800, fontFamily: "var(--font-display)", letterSpacing: "-0.015em",
};

// "הלוגו" של כל פיצ'ר — צבע קבוע מלוח הצבעים (DESIGN.md §2)
function HeadIcon({ icon, pal = "blue" }: { icon: React.ReactNode; pal?: Pal }) {
  return <IconChip pal={pal} size={32}>{icon}</IconChip>;
}

function SectionHead({ icon, title, count, tone, extra, tight, pal }: {
  icon: React.ReactNode; title: string; count?: number; tone?: "danger" | "mint"; extra?: React.ReactNode; tight?: boolean; pal?: Pal;
}) {
  const c = tone === "danger" ? T.danger : tone === "mint" ? T.mint : T.accent;
  const bg = tone === "danger" ? T.dangerSoft : tone === "mint" ? T.mintSoft : T.accentSoft;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: tight ? 0 : 13 }}>
      <HeadIcon icon={icon} pal={pal ?? (tone === "danger" ? "crimson" : tone === "mint" ? "lime" : "blue")} />
      <h2 style={sectionH2}>{title}</h2>
      {count !== undefined && (
        <span className="num" style={{ fontSize: 11.5, fontWeight: 700, color: c, background: bg, borderRadius: 99, padding: "2px 10px" }}>
          {count}
        </span>
      )}
      {extra}
    </div>
  );
}

// ---- הכותרת: זהות ההסתדרות + של מי היומן ----
function Header({ sync, onSyncClick, personName, personColor, isManager, teamCount }: {
  sync: { icon: React.ReactNode; label: string; color: string };
  onSyncClick: () => void;
  personName: string;
  personColor: PersonColor;
  isManager: boolean;
  teamCount: number;
}) {
  // מכשיר של המנהל שפתח יומן של איש צוות — קיצור חזרה לדשבורד
  const managerDevice = useSyncExternalStore(noopSubscribe, isManagerDevice, () => false) && !isManager;
  return (
    <header className="tj-header" style={{
      background: "var(--tj-glass)",
      backdropFilter: "saturate(1.4) blur(12px)", WebkitBackdropFilter: "saturate(1.4) blur(12px)",
      borderBottom: `1px solid ${T.line}`,
      padding: "10px 18px", display: "flex", alignItems: "center", gap: 12,
    }}>
      <div style={{
        background: "#fff", borderRadius: 13, padding: "5px 8px", display: "flex", alignItems: "center",
        border: `1px solid ${T.line}`, boxShadow: T.shadowSm,
      }}>
        <Image src="/logo-histadrut.svg" alt="ההסתדרות" width={40} height={34}
          style={{ height: 30, width: "auto" }} />
      </div>
      <div className="tj-brandtext" style={{ lineHeight: 1.15 }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 16.5, color: "#E8483E", letterSpacing: "-0.02em" }}>
          ההסתדרות
        </div>
        <div style={{ fontSize: 10.5, color: T.ink2, fontWeight: 500 }}>
          הבית של העובדים בישראל
        </div>
      </div>
      <div className="tj-brandtext" style={{ width: 1, height: 30, background: T.line, marginInline: 4 }} />
      {/* הלוגו של האפליקציה: ביומן של אופיר הוא גם התמונה שלו; אצל איש צוות — האווטר האישי */}
      {isManager ? (
        <span className="tj-applogo" style={{
          width: 40, height: 40, borderRadius: 13, overflow: "hidden", flexShrink: 0, display: "inline-flex",
          boxShadow: `0 0 0 2px var(--tj-surface), 0 0 0 3.5px ${alpha("var(--tj-accent)", 55)}, 0 8px 18px -10px ${T.glow}`,
        }}>
          <Image src="/logo-face.png" alt="היומן השיתופי של אופיר" width={40} height={40} priority
            style={{ width: 40, height: 40, objectFit: "cover" }} />
        </span>
      ) : (
        <Avatar name={personName} color={personColor} size={36} />
      )}
      <div style={{ lineHeight: 1.2, minWidth: 0 }}>
        <h1 style={{
          margin: 0, fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 16, color: T.ink,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", letterSpacing: "-0.015em",
        }}>
          היומן של {personName}
        </h1>
        <div style={{ fontSize: 11, color: T.ink3, display: "flex", alignItems: "center", gap: 5 }}>
          {isManager ? (
            <>
              <span style={{ color: T.accent, display: "inline-flex" }}>{Ic.crown(11)}</span>
              {teamCount > 0 ? `מנהל · ${teamCount} ${teamCount === 1 ? "איש צוות" : "אנשי צוות"}` : "היומן השיתופי"}
            </>
          ) : (
            <>
              <Image src="/logo-face.png" alt="" width={16} height={16}
                style={{ width: 16, height: 16, borderRadius: 99, objectFit: "cover", boxShadow: `0 0 0 1px ${T.line}` }} />
              היומן השיתופי של {MANAGER_NAME}
            </>
          )}
          <span className="num" style={{ opacity: 0.6, letterSpacing: "0.12em", fontSize: 9.5 }}>· V5</span>
        </div>
      </div>
      <div style={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        {managerDevice && (
          // ניווט מלא ולא <Link>: מעבר בין יומנים טוען מחדש את מצב הסנכרון ואת נעילת המנהל
          // eslint-disable-next-line @next/next/no-html-link-for-pages
          <a href="/?view=team" style={{
            display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none",
            color: T.ink2, fontSize: 11.5, fontWeight: 600, border: `1px solid ${T.line}`,
            borderRadius: 99, padding: "5px 11px", background: T.surface,
          }}>
            {Ic.users(13)} <span className="tj-synctext">לדשבורד הצוות</span>
          </a>
        )}
        <button onClick={onSyncClick} title="לחיצה מציגה אבחון סנכרון" style={{
          color: sync.color, display: "inline-flex", alignItems: "center", gap: 6,
          background: T.surface, border: `1px solid ${T.line}`, borderRadius: 99, padding: "5px 11px",
          fontSize: 11, fontWeight: 600, boxShadow: T.shadowSm, cursor: "pointer", fontFamily: "inherit",
        }}>
          {sync.icon}<span className="tj-synctext">{sync.label}</span>
        </button>
      </div>
      <style>{`@media (max-width: 640px) { .tj-brandtext { display: none; } .tj-header { padding: 9px 12px !important; } }`}</style>
    </header>
  );
}

// ---- השבוע שלך: מה נסגר ומה נפתח, ולאן הולכות המשימות הפתוחות ----
function WeekInsights({ allFlat, catById, todayKey }: { allFlat: Task[]; catById: Record<string, TaskCategory>; todayKey: string }) {
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => {
    const d = new Date(`${todayKey}T12:00:00`);
    d.setDate(d.getDate() - (13 - i));
    return toDateKey(d);
  }), [todayKey]);
  const doneSeries = days.map((d) => allFlat.filter((t) => isDone(t) && t.endDate === d).length);
  const newSeries = days.map((d) => allFlat.filter((t) => t.createdAt?.slice(0, 10) === d).length);
  const doneWeek = doneSeries.slice(-7).reduce((a, b) => a + b, 0);
  const prevWeek = doneSeries.slice(0, 7).reduce((a, b) => a + b, 0);
  const trend = doneWeek - prevWeek;

  const open = allFlat.filter((t) => !isDone(t));
  const counts = new Map<string, number>();
  for (const t of open) {
    const k = t.categoryId && catById[t.categoryId] ? t.categoryId : "__none";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 4);
  const rest = sorted.slice(4).reduce((n, [, v]) => n + v, 0);
  const slices = [
    ...top.map(([k, v]) => ({
      key: k, value: v,
      label: k === "__none" ? "ללא קטגוריה" : catById[k].name,
      color: k === "__none" ? "#8A97A8" : catById[k].color,
    })),
    ...(rest ? [{ key: "__rest", value: rest, label: "אחרות", color: "#B7C2D0" }] : []),
  ];
  const dm = (k: string) => `${parseInt(k.slice(8, 10), 10)}.${parseInt(k.slice(5, 7), 10)}`;

  return (
    <section className="tj-card" style={{ ...card, padding: 16, marginTop: 14 }}>
      <SectionHead icon={Ic.chart(15)} title="השבוע שלך" pal="lavender" extra={
        <span style={{
          marginInlineStart: "auto", fontSize: 11.5, fontWeight: 700, borderRadius: 99, padding: "3px 10px",
          color: trend >= 0 ? T.mint : T.amber, background: trend >= 0 ? T.mintSoft : T.amberSoft,
        }}>
          <span className="num">{doneWeek}</span> נסגרו השבוע
          {trend !== 0 && <> · {trend > 0 ? "▲" : "▼"} <span className="num">{Math.abs(trend)}</span> משבוע שעבר</>}
        </span>
      } />
      {open.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
          <Donut
            slices={slices}
            size={124} thickness={17}
            ariaLabel={`${open.length} משימות פתוחות לפי קטגוריה`}
            center={<span className="num" style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, color: T.ink }}>{open.length}</span>}
            sub="פתוחות"
          />
          <div style={{ flex: 1, minWidth: 140 }}>
            <Legend items={slices.map((x) => ({ label: x.label, color: x.color, value: x.value }))} />
          </div>
        </div>
      )}
      <DayBars
        height={170}
        days={days.map((d) => ({ short: dm(d), long: `${HE_WEEKDAYS_FULL[new Date(`${d}T12:00:00`).getDay()]} ${dm(d)}` }))}
        up={{ label: "נסגרו", color: "var(--pal-lime)", values: doneSeries }}
        down={{ label: "נפתחו", color: "var(--pal-blue)", values: newSeries }}
        ariaLabel={`ב-14 הימים האחרונים נסגרו ${doneSeries.reduce((x, y) => x + y, 0)} משימות ונפתחו ${newSeries.reduce((x, y) => x + y, 0)}`}
      />
      <div style={{ marginTop: 8 }}>
        <DayBarsLegend items={[
          { label: "נסגרו", color: "var(--pal-lime)", total: doneSeries.reduce((x, y) => x + y, 0) },
          { label: "נפתחו", color: "var(--pal-blue)", total: newSeries.reduce((x, y) => x + y, 0) },
        ]} />
      </div>
    </section>
  );
}

// ---- טאבים עם גלולה שגולשת ----
function ViewTabs({ views, view, onChange, badges }: {
  views: { key: ViewKey; label: string; icon: (s?: number) => React.ReactNode }[];
  view: ViewKey;
  onChange: (v: ViewKey) => void;
  badges?: Partial<Record<ViewKey, number>>;
}) {
  const navRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number; total: number } | null>(null);
  useLayoutEffect(() => {
    function measure() {
      const nav = navRef.current;
      const btn = nav?.querySelector<HTMLElement>(`[data-view="${view}"]`);
      if (!nav || !btn) return;
      const nr = nav.getBoundingClientRect();
      const br = btn.getBoundingClientRect();
      // RTL: מודדים מהקצה הימני של התוכן הנגלל (scrollLeft שלילי כשגוללים שמאלה)
      setPill({ x: nr.right - br.right - nav.scrollLeft, w: br.width, total: nav.scrollWidth });
    }
    measure();
    window.addEventListener("resize", measure);
    document.fonts?.ready.then(measure).catch(() => { /* ignore */ });
    return () => window.removeEventListener("resize", measure);
  }, [view, views]);

  return (
    <nav ref={navRef} className="no-scrollbar" aria-label="תצוגות" style={{
      position: "relative", display: "flex", gap: 2, background: T.bg2,
      borderRadius: 14, padding: 3, overflowX: "auto", maxWidth: "100%",
    }}>
      {pill && (
        <span className="tj-tabpill" style={{
          width: pill.total,
          clipPath: `inset(0 ${pill.x}px 0 ${Math.max(0, pill.total - pill.x - pill.w)}px round 10px)`,
        }} />
      )}
      {views.map((v) => {
        const active = view === v.key;
        return (
          <button key={v.key} data-view={v.key} aria-current={active ? "page" : undefined}
            onClick={(e) => { onChange(v.key); e.currentTarget.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" }); }}
            style={{
            position: "relative", display: "inline-flex", alignItems: "center", gap: 7,
            background: "transparent", color: active ? "#fff" : T.ink2,
            border: "none", borderRadius: 10, padding: "8px 13px",
            fontSize: 13, fontWeight: active ? 700 : 500, cursor: "pointer",
            whiteSpace: "nowrap", fontFamily: "inherit",
            transition: "color .3s var(--ease-out)",
          }}>
            <span style={{ color: active ? "#fff" : T.ink3, display: "inline-flex", transition: "color .3s var(--ease-out)" }}>{v.icon(15)}</span>
            {v.label}
            {!!badges?.[v.key] && (
              <span className="num" style={{
                minWidth: 18, height: 18, padding: "0 5px", borderRadius: 99, fontSize: 10.5, fontWeight: 700, lineHeight: "18px",
                textAlign: "center", background: active ? "rgba(255,255,255,0.25)" : T.accentSoft, color: active ? "#fff" : T.accent,
              }}>{badges[v.key]}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

// ---- ה-hero: "שמיים" שמשתנים לפי שעת היום — זריחה, שמיים כחולים, שקיעה, לילה ----
// הטקסט יושב בצד ימין (RTL), ולכן כל רמפה כהה בימין ומתבהרת שמאלה.
type Sky = { name: string; bg: string; orb: string; orbGlow: string; stars: boolean; ring: string };

function skyFor(h: number): Sky {
  if (h >= 5 && h < 10) return {
    name: "זריחה",
    bg: "linear-gradient(245deg, #172F73 0%, #3C4FA8 34%, #D9775E 72%, #F4BE7E 100%)",
    orb: "#FFE6B0", orbGlow: "rgba(255,196,120,0.55)", stars: false, ring: "#FFE6B0",
  };
  if (h >= 10 && h < 16) return {
    name: "צהריים",
    bg: "linear-gradient(245deg, #12348F 0%, #1D4ED8 38%, #2F8FEA 74%, #6CC4F5 100%)",
    orb: "#FFF6CF", orbGlow: "rgba(255,240,180,0.55)", stars: false, ring: "#A7F3D0",
  };
  if (h >= 16 && h < 20) return {
    name: "שקיעה",
    bg: "linear-gradient(245deg, #101B4A 0%, #3A2F7A 30%, #B24A6E 66%, #F29245 100%)",
    orb: "#FFD08A", orbGlow: "rgba(255,150,90,0.55)", stars: false, ring: "#FFD08A",
  };
  return {
    name: "לילה",
    bg: "linear-gradient(245deg, #040A1C 0%, #0A1638 45%, #16307A 100%)",
    orb: "#E8EEFF", orbGlow: "rgba(180,200,255,0.35)", stars: true, ring: "#A7F3D0",
  };
}

const W = (a: number) => `rgba(255,255,255,${a})`;

function Hero({
  personName, today, todayKey, allFlat, nowTick, streak, overdueCount, criticalCount,
  quickText, setQuickText, quickPreview, onQuickAdd, onShare, onOpenTask,
}: {
  personName: string;
  today: Date;
  todayKey: string;
  allFlat: Task[];
  nowTick: number;
  streak: number;
  overdueCount: number;
  criticalCount: number;
  quickText: string;
  setQuickText: (s: string) => void;
  quickPreview: ReturnType<typeof parseQuickAdd> | null;
  onQuickAdd: () => void;
  onShare: () => void;
  onOpenTask: (id: string) => void;
}) {
  const h = today.getHours();
  const sky = skyFor(h);
  const greet = h < 5 ? "לילה טוב" : h < 12 ? "בוקר טוב" : h < 17 ? "צהריים טובים" : h < 22 ? "ערב טוב" : "לילה טוב";
  const todays = allFlat.filter((t) => t.dueDate === todayKey);
  const todayDone = todays.filter(isDone).length;
  const todayOpen = todays.length - todayDone;
  const doneAll = allFlat.filter(isDone).length;
  const pctAll = allFlat.length ? Math.round((doneAll / allFlat.length) * 100) : 0;
  const bits: string[] = [];
  if (todayOpen > 0) bits.push(`${todayOpen} משימות להיום`);
  if (overdueCount > 0) bits.push(`${overdueCount} באיחור`);
  if (criticalCount > 0) bits.push(`${criticalCount} קריטיות`);
  const heb = hebrewDateToday(today);

  // מיקום השמש/הירח על קשת השמיים לפי השעה (ימין = בוקר, שמאל = ערב)
  const hours = today.getHours() + today.getMinutes() / 60;
  const dayT = Math.max(0, Math.min(1, (hours - 5) / 15)); // 05:00→20:00
  const nightT = ((hours + 24 - 20) % 24) / 9; // 20:00→05:00
  const t = sky.stars ? Math.min(1, nightT) : dayT;
  const orbX = 8 + t * 72; // אחוז מימין
  const orbY = 62 - Math.sin(t * Math.PI) * 48; // אחוז מלמעלה

  const previewChips: string[] = [];
  if (quickPreview) {
    if (quickPreview.dueDate && quickPreview.dueDate !== todayKey) previewChips.push(formatDateHe(quickPreview.dueDate));
    else previewChips.push("היום");
    if (quickPreview.reminder) {
      previewChips.push(`תזכורת ${new Date(quickPreview.reminder).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}`);
    }
    if (quickPreview.critical) previewChips.push("קריטית");
  }

  return (
    <section className="tj-card tj-hero" aria-label={`סקירת היום — ${sky.name}`} style={{
      position: "relative", borderRadius: 26, padding: "22px 22px 18px", overflow: "hidden", color: "#fff",
      background: sky.bg,
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.22), 0 30px 60px -34px rgba(10,20,60,0.75)",
    }}>
      {/* שכבות השמיים: כוכבים, שמש/ירח, אובך אופק */}
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        {sky.stars && <div className="tj-stars" />}
        <div className="tj-orb" style={{
          position: "absolute", right: `${orbX}%`, top: `${orbY}%`, width: 190, height: 190, marginRight: -95, marginTop: -95,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${sky.orb} 0 18%, ${sky.orbGlow} 32%, transparent 68%)`,
          filter: "blur(1px)",
        }} />
        <div style={{ position: "absolute", insetInline: 0, bottom: 0, height: "45%", background: "linear-gradient(0deg, rgba(4,10,30,0.35), transparent)" }} />
        <div style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: "70%", background: "linear-gradient(270deg, rgba(4,10,30,0.28), transparent)" }} />
      </div>

      <div className="tj-hero-grid" style={{ position: "relative", zIndex: 1, display: "grid", gridTemplateColumns: "1fr auto", gap: 18, alignItems: "start" }}>
        <div style={{ minWidth: 0 }}>
          <div className="tj-hero-head" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 32, fontWeight: 800, fontFamily: "var(--font-display)", letterSpacing: "-0.035em", lineHeight: 1.05, textShadow: "0 2px 18px rgba(0,0,0,0.25)" }}>
              {greet}, {firstName(personName)}
            </h2>
            {streak >= 2 && (
              <span className="num" title={`${streak} ימים ברצף עם משימות שהושלמו`} style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                fontSize: 12, fontWeight: 700, color: "#fff", background: W(0.16),
                border: `1px solid ${W(0.28)}`, borderRadius: 99, padding: "3px 11px 3px 9px",
                backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
              }}>
                {Ic.flame(12)} רצף {streak} ימים
              </span>
            )}
          </div>
          <div style={{ fontSize: 13.5, color: W(0.86), marginTop: 6 }}>
            יום {HE_WEEKDAYS_FULL[today.getDay()]}, <span className="num">{today.getDate()}.{today.getMonth() + 1}</span>
            {heb ? <> · {heb}</> : null}
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#fff", marginTop: 2 }}>
            {bits.length ? bits.join(" · ") : "אין משימות להיום — יום נקי"}
          </div>

          <DayTimeline allFlat={allFlat} todayKey={todayKey} nowTick={nowTick} onOpenTask={onOpenTask} />

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <span style={{ position: "absolute", insetInlineStart: 12, top: "50%", transform: "translateY(-50%)", color: "#fff", pointerEvents: "none" }}>
                {Ic.sparkle(15)}
              </span>
              <input
                className="tj-hero-input"
                value={quickText}
                onChange={(e) => setQuickText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") onQuickAdd(); }}
                aria-label="הוספה מהירה"
                placeholder={'נסו: "להתקשר לדני מחר ב-10:00"'}
                style={{
                  ...inputStyle, width: "100%", paddingInlineStart: 36, height: 46, borderRadius: 15,
                  background: W(0.14), border: `1px solid ${W(0.32)}`, color: "#fff",
                  backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
                }}
              />
            </div>
            <button onClick={onQuickAdd} disabled={!quickText.trim()} style={{
              border: "none", borderRadius: 15, padding: "0 20px", height: 46, cursor: quickText.trim() ? "pointer" : "default",
              fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 800,
              background: quickText.trim() ? "#fff" : W(0.18), color: quickText.trim() ? "#16307A" : W(0.75),
              boxShadow: quickText.trim() ? "0 10px 24px -12px rgba(0,0,0,0.5)" : "none",
            }}>
              הוספה
            </button>
          </div>
          <div aria-live="polite" style={{ minHeight: 26, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {quickPreview?.title ? (
              <>
                <span style={{ fontSize: 11.5, color: W(0.78) }}>הבנתי:</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {quickPreview.title}
                </span>
                {previewChips.map((c) => (
                  <span key={c} className="tj-pop" style={{
                    fontSize: 11.5, fontWeight: 700, borderRadius: 99, padding: "2px 10px",
                    color: c === "קריטית" ? "#FFE4E6" : "#fff",
                    background: c === "קריטית" ? "rgba(244,63,94,0.45)" : W(0.2),
                    border: `1px solid ${W(0.25)}`,
                  }}>{c}</span>
                ))}
              </>
            ) : (
              <button onClick={onShare} style={{
                display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", padding: 0,
                color: W(0.82), fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              }}>
                {Ic.share(12)} שיתוף סיכום היום בוואטסאפ
              </button>
            )}
          </div>
        </div>

        {/* טבעת היום: כמה מהמשימות של היום כבר נסגרו */}
        <div className="tj-hero-ring" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, paddingTop: 2 }}>
          <div style={{ borderRadius: "50%", background: W(0.1), padding: 8, backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", border: `1px solid ${W(0.2)}` }}>
            <ProgressRing
              value={todays.length ? todayDone / todays.length : pctAll / 100}
              size={112} stroke={9} color={sky.ring} track={W(0.2)}
              label={todays.length ? `${todayDone} מתוך ${todays.length} משימות היום הושלמו` : `התקדמות כוללת ${pctAll}%`}
            >
              {todays.length ? (
                <>
                  <span className="num" style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, color: "#fff" }}>
                    {todayDone}<span style={{ color: W(0.65), fontSize: 16 }}>/{todays.length}</span>
                  </span>
                  <span style={{ fontSize: 11, color: W(0.8), marginTop: 3 }}>היום</span>
                </>
              ) : (
                <>
                  <span className="num" style={{ fontSize: 24, fontWeight: 800, lineHeight: 1, color: "#fff" }}>{pctAll}%</span>
                  <span style={{ fontSize: 11, color: W(0.8), marginTop: 3 }}>הושלם</span>
                </>
              )}
            </ProgressRing>
          </div>
          <span className="num" style={{ fontSize: 11, color: W(0.82) }}>
            התקדמות כוללת <b style={{ color: "#fff" }}>{pctAll}%</b>
          </span>
        </div>
      </div>
      <style>{`
        .tj-hero-input::placeholder { color: rgba(255,255,255,0.72) !important; }
        .tj-hero-input:focus { border-color: rgba(255,255,255,0.7) !important; background: rgba(255,255,255,0.2) !important; }
        .tj-stars { position: absolute; inset: 0; opacity: 0.9;
          background-image:
            radial-gradient(1.2px 1.2px at 12% 22%, #fff 99%, transparent), radial-gradient(1px 1px at 28% 64%, #fff 99%, transparent),
            radial-gradient(1.4px 1.4px at 44% 18%, #fff 99%, transparent), radial-gradient(1px 1px at 58% 42%, #fff 99%, transparent),
            radial-gradient(1.2px 1.2px at 71% 12%, #fff 99%, transparent), radial-gradient(1px 1px at 84% 56%, #fff 99%, transparent),
            radial-gradient(1.3px 1.3px at 92% 28%, #fff 99%, transparent), radial-gradient(1px 1px at 36% 84%, #fff 99%, transparent),
            radial-gradient(1px 1px at 66% 78%, #fff 99%, transparent), radial-gradient(1.2px 1.2px at 6% 70%, #fff 99%, transparent);
          animation: tj-twinkle 6s ease-in-out infinite alternate; }
        @keyframes tj-twinkle { from { opacity: 0.55; } to { opacity: 0.95; } }
        .tj-orb { animation: tj-orb-breathe 9s ease-in-out infinite alternate; }
        @keyframes tj-orb-breathe { from { transform: scale(0.94); opacity: 0.9; } to { transform: scale(1.06); opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .tj-stars, .tj-orb { animation: none !important; } }
        @media (max-width: 640px) {
          .tj-card.tj-hero { padding: 18px 16px 14px !important; border-radius: 22px !important; }
          .tj-hero-grid { grid-template-columns: 1fr !important; }
          .tj-hero-ring { position: absolute; top: 0; inset-inline-end: 0; transform: scale(0.58); transform-origin: top left; }
          .tj-hero-ring > span { display: none; }
          .tj-hero-head { padding-inline-end: 72px; }
          .tj-hero h2 { font-size: 25px !important; }
        }
      `}</style>
    </section>
  );
}

// ציר היום: התזכורות של היום על פני השעות, עם סמן "עכשיו" חי — בגווני לבן על השמיים
function DayTimeline({ allFlat, todayKey, nowTick, onOpenTask }: {
  allFlat: Task[]; todayKey: string; nowTick: number; onOpenTask: (id: string) => void;
}) {
  const START = 6, END = 24;
  const items = allFlat.flatMap((t) =>
    t.reminders
      .filter((r) => toDateKey(new Date(r.datetime)) === todayKey)
      .map((r) => ({ t, r, d: new Date(r.datetime) }))
  ).sort((a, b) => a.d.getTime() - b.d.getTime());
  const pos = (d: Date) => {
    const hours = d.getHours() + d.getMinutes() / 60;
    return Math.max(0, Math.min(1, (hours - START) / (END - START)));
  };
  const now = nowTick ? new Date(nowTick) : null;
  const nowPos = now ? pos(now) : null;
  const ticks = [6, 9, 12, 15, 18, 21, 24];
  return (
    <div style={{ marginTop: 18 }} aria-label="ציר היום">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 7 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "#fff" }}>היום שלך</span>
        <span style={{ fontSize: 11, color: W(0.78) }}>
          {items.length ? `${items.length} ${items.length === 1 ? "תזכורת" : "תזכורות"} היום` : "אין תזכורות מתוזמנות להיום"}
        </span>
      </div>
      <div style={{ position: "relative", height: 30 }}>
        <div style={{ position: "absolute", insetInline: 0, top: 13, height: 4, borderRadius: 99, background: W(0.22) }} />
        {nowPos !== null && (
          <div style={{
            position: "absolute", insetInlineStart: 0, top: 13, height: 4, borderRadius: 99,
            width: `${nowPos * 100}%`, background: `linear-gradient(270deg, ${W(0.35)}, ${W(0.95)})`,
          }} />
        )}
        {ticks.map((h) => (
          <span key={h} style={{
            position: "absolute", top: 11, width: 1, height: 8, background: W(0.35),
            insetInlineStart: `${((h - START) / (END - START)) * 100}%`,
          }} />
        ))}
        {items.map(({ t, r, d }) => {
          const past = now ? d.getTime() < now.getTime() : false;
          const done = isDone(t);
          const ring = t.critical ? "#FDA4AF" : done ? "#A7F3D0" : "#fff";
          return (
            <button key={r.id} onClick={() => onOpenTask(t.id)}
              title={`${d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })} · ${r.note || t.title}`}
              aria-label={`${d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })} — ${r.note || t.title}`}
              style={{
                position: "absolute", top: 3, insetInlineStart: `calc(${pos(d) * 100}% - 12px)`,
                width: 24, height: 24, borderRadius: 99, border: "none", background: "transparent",
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
              }}>
              <span style={{
                width: 12, height: 12, borderRadius: 99, background: past || done ? "transparent" : ring,
                boxShadow: `0 0 0 2.5px ${ring}, 0 0 12px 2px ${W(0.45)}`,
              }} />
            </button>
          );
        })}
        {nowPos !== null && now && now.getHours() >= START && (
          <span className="tj-live" title="עכשיו" style={{
            position: "absolute", top: 10, insetInlineStart: `calc(${nowPos * 100}% - 5px)`,
            width: 10, height: 10, borderRadius: 99, background: "#fff", color: "#fff",
            boxShadow: `0 0 0 3px ${W(0.35)}`,
          }} />
        )}
      </div>
      <div style={{ position: "relative", height: 14 }}>
        {ticks.map((h) => (
          <span key={h} className="num" style={{
            position: "absolute", fontSize: 10, color: W(0.75),
            insetInlineStart: `${((h - START) / (END - START)) * 100}%`, transform: "translateX(50%)",
          }}>{h === 24 ? "00" : String(h).padStart(2, "0")}</span>
        ))}
      </div>
    </div>
  );
}

function StatCell({ label, value, icon, tone, pal, active, onClick }: {
  label: string; value: number; icon: React.ReactNode; tone?: "danger"; pal: Pal; active: boolean; onClick: () => void;
}) {
  // לכל מדד צבע קבוע מהלוח; המספר נצבע אדום רק כשיש באמת בעיה
  const c = palVar(pal);
  return (
    <button onClick={onClick} aria-pressed={active} title={active ? "לחיצה מבטלת את הסינון" : `סינון: ${label}`} className="tj-stat" style={{
      position: "relative", overflow: "hidden",
      display: "flex", alignItems: "center", gap: 12, textAlign: "start", padding: "14px 15px",
      borderRadius: 18, cursor: "pointer", fontFamily: "inherit",
      border: `1px solid ${active ? alpha(c, 55) : alpha(c, 18)}`,
      background: `linear-gradient(150deg, ${alpha(c, active ? 20 : 12)} 0%, ${alpha(c, active ? 8 : 3)} 70%), var(--tj-surface)`,
      boxShadow: active ? `0 12px 26px -16px ${alpha(c, 80)}` : "inset 0 1px 0 var(--tj-bezel)",
    }}>
      <IconChip pal={pal} size={42} radius={13}>{icon}</IconChip>
      <span style={{ minWidth: 0 }}>
        <span className="num tj-kpi-num" style={{ display: "block", fontSize: 28, fontWeight: 800, lineHeight: 1, color: tone === "danger" ? T.danger : T.ink }}>{value}</span>
        <span style={{ display: "block", fontSize: 12, color: T.ink2, fontWeight: 600, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      </span>
    </button>
  );
}

function FilterToggle({ on, onClick, icon, label, tone = "danger" }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string; tone?: "danger" | "accent" }) {
  const c = tone === "accent" ? T.accent : T.danger;
  return (
    <button onClick={onClick} aria-pressed={on} style={{
      display: "flex", alignItems: "center", gap: 8, width: "100%",
      background: on ? alpha(c, 12) : "transparent",
      border: `1px solid ${on ? alpha(c, 30) : T.line}`,
      borderRadius: 11, padding: "8px 10px", fontSize: 12.5, cursor: "pointer",
      color: on ? c : T.ink2, fontWeight: on ? 600 : 500,
      fontFamily: "inherit",
    }}>
      <span style={{ color: c, display: "inline-flex" }}>{icon}</span>
      {label}
    </button>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 7,
      fontSize: 11, fontWeight: 700, color: T.ink3, marginBottom: 9,
    }}>
      {children}
    </div>
  );
}

function NavBtn({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} aria-label={label} style={{
      width: 30, height: 30, borderRadius: 99, border: `1px solid ${T.line}`,
      background: "transparent", cursor: "pointer", color: T.ink2,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
    }}>{children}</button>
  );
}

// ---- משימות משותפות: מקטע בדשבורד + טאב "משותפות" (full) ----
type PersonLite = { id: string; name: string; color: PersonColor };
function SharedPanel({ tasks, done, full, canShare, isManager, me, partners, filtered, catById, todayKey, labelOf, onCreate, onAddTeam, onOpen, onCycle }: {
  tasks: Task[]; done?: Task[]; full?: boolean;
  canShare: boolean; isManager: boolean; me: PersonLite; partners: PersonLite[]; filtered: boolean;
  catById: Record<string, TaskCategory>; todayKey: string;
  labelOf: (t: Task) => string | null;
  onCreate: () => void; onAddTeam: () => void; onOpen: (id: string) => void; onCycle: (t: Task) => void;
}) {
  const only = partners.length === 1 ? partners[0] : null;
  const faces = [me, ...partners.slice(0, 2)];
  const steps = [
    { n: 1, text: "לוחצים ״משימה משותפת״ (או בחלון של כל משימה ← ״שיתוף עם…״)." },
    { n: 2, text: "המשימה מופיעה ביומן של שניכם, עם התגית ״משותפת עם…״." },
    { n: 3, text: "כל אחד יכול לעדכן ולסמן ״הושלם״ — והשני רואה מיד. התזכורות קופצות לשניכם." },
  ];
  return (
    <section className="tj-card tj-shared" style={{ ...card, padding: full ? 20 : 16 }}>
      <SectionHead icon={Ic.share(15)} title="משימות משותפות" count={canShare ? tasks.length : undefined} pal="pink"
        extra={canShare ? (
          <button onClick={onCreate} style={{ ...primaryBtn, marginInlineStart: "auto", height: 34, padding: "0 14px", fontSize: 12.5, whiteSpace: "nowrap" }}>
            {Ic.plus(13)} משימה משותפת{only && <span className="tj-shared-with"> עם {firstName(only.name)}</span>}
          </button>
        ) : undefined} />

      {!canShare ? (
        // אופיר בלי צוות: אין עם מי לשתף עדיין — מסבירים ושולחים להוספה
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", background: T.bg2, borderRadius: 14, padding: "14px 16px" }}>
          <span style={{ display: "inline-flex", flexShrink: 0 }}>
            <Avatar name={me.name} color={me.color} size={34} />
            <span style={{
              marginInlineStart: -10, width: 34, height: 34, borderRadius: 99, display: "inline-flex", alignItems: "center", justifyContent: "center",
              border: `1.5px dashed ${T.lineStrong}`, background: T.surface, color: T.ink3,
            }}>{Ic.plus(14)}</span>
          </span>
          <span style={{ flex: "1 1 220px", fontSize: 13, color: T.ink2, lineHeight: 1.6 }}>
            <b style={{ color: T.ink }}>כדי לשתף משימות צריך קודם מישהו בצוות.</b>{" "}
            {isManager ? "מוסיפים את נדין (פעם אחת) — ומאותו רגע אפשר ליצור משימות שמופיעות אצל שניכם." : "הצוות עוד נטען…"}
          </span>
          {isManager && (
            <button onClick={onAddTeam} style={{ ...primaryBtn, height: 38, padding: "0 16px", fontSize: 13 }}>
              {Ic.userPlus(14)} הוספה לצוות
            </button>
          )}
        </div>
      ) : tasks.length === 0 ? (
        <div style={{ background: T.bg2, borderRadius: 14, padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13, color: T.ink2, lineHeight: 1.6 }}>
            <span style={{ display: "inline-flex", flexShrink: 0 }}>
              {faces.map((p, i) => (
                <span key={p.id} style={{ marginInlineStart: i ? -8 : 0, borderRadius: 99, boxShadow: "0 0 0 2px var(--tj-bg2)", display: "inline-flex" }}>
                  <Avatar name={p.name} color={p.color} size={30} />
                </span>
              ))}
            </span>
            <span>
              <b style={{ color: T.ink }}>{filtered ? "אין משימות משותפות שתואמות את הסינון." : "עוד אין משימות משותפות."}</b>{" "}
              משימה משותפת מופיעה ביומן של {only ? `שניכם — ${firstName(me.name)} ו${firstName(only.name)}` : "כל מי ששותף בה"}.
            </span>
          </div>
          {full && (
            <ol style={{ listStyle: "none", margin: "14px 0 0", padding: 0, display: "grid", gap: 8 }}>
              {steps.map((st) => (
                <li key={st.n} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12.5, color: T.ink, lineHeight: 1.55 }}>
                  <IconChip pal="pink" size={22} radius={99}><span className="num" style={{ fontSize: 11, fontWeight: 700 }}>{st.n}</span></IconChip>
                  <span style={{ paddingTop: 2 }}>{st.text}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} cat={t.categoryId ? catById[t.categoryId] : undefined} sharedLabel={labelOf(t)}
              critical={t.critical} todayKey={todayKey} onOpen={() => onOpen(t.id)} onCycle={() => onCycle(t)} />
          ))}
        </div>
      )}

      {full && canShare && done && done.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "18px 2px 8px", fontSize: 12.5, fontWeight: 700, color: T.ink2 }}>
            {Ic.checkCircle(14)} הושלמו <span className="num" style={{ color: T.ink3, fontWeight: 600 }}>{done.length}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {done.slice(0, 30).map((t) => (
              <TaskRow key={t.id} task={t} cat={t.categoryId ? catById[t.categoryId] : undefined} sharedLabel={labelOf(t)}
                todayKey={todayKey} onOpen={() => onOpen(t.id)} onCycle={() => onCycle(t)} compact />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Empty({ filtersActive, onCreate }: { filtersActive: boolean; onCreate: () => void }) {
  return (
    <div style={{ textAlign: "center", padding: "40px 20px", color: T.ink3 }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }} aria-hidden="true">
        {/* איור: ערימת כרטיסי משימה, העליון מסומן כבוצע */}
        <svg width="150" height="104" viewBox="0 0 150 104" fill="none">
          <ellipse cx="75" cy="96" rx="52" ry="6" fill="var(--tj-accent)" opacity="0.12" />
          <rect x="30" y="30" width="96" height="52" rx="12" fill="var(--tj-surface2)" transform="rotate(-6 78 56)" />
          <rect x="24" y="22" width="100" height="56" rx="13" fill="var(--tj-surface)" stroke="var(--tj-line-strong)" transform="rotate(4 74 50)" />
          <g transform="rotate(-2 75 46)">
            <rect x="20" y="16" width="110" height="60" rx="14" fill="var(--tj-surface)" stroke="var(--tj-accent)" strokeOpacity="0.45" />
            <circle cx="112" cy="46" r="11" fill="var(--tj-mint)" />
            <path d="m107 46 3.5 3.5L117 43" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="36" y="36" width="58" height="7" rx="3.5" fill="var(--tj-accent)" opacity="0.55" />
            <rect x="50" y="50" width="44" height="5" rx="2.5" fill="var(--tj-ink3)" opacity="0.4" />
          </g>
          <path d="M136 14c.5 3.5 2.3 5.3 5.8 5.8-3.5.5-5.3 2.3-5.8 5.8-.5-3.5-2.3-5.3-5.8-5.8 3.5-.5 5.3-2.3 5.8-5.8Z" fill="var(--tj-amber)" opacity="0.8" />
          <path d="M14 58c.4 2.6 1.7 3.9 4.3 4.3-2.6.4-3.9 1.7-4.3 4.3-.4-2.6-1.7-3.9-4.3-4.3 2.6-.4 3.9-1.7 4.3-4.3Z" fill="var(--tj-accent)" opacity="0.7" />
        </svg>
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 600, color: T.ink }}>
        {filtersActive ? "אין משימות שתואמות את הסינון" : "היומן ריק — זה הזמן להתחיל"}
      </div>
      <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 4 }}>
        {filtersActive ? "נסו להסיר חלק מהמסננים בסרגל הצד." : "כתבו משימה בשורת ההוספה המהירה למעלה, או פתחו משימה מלאה."}
      </div>
      {!filtersActive && (
        <button onClick={onCreate} style={{ ...primaryBtn, marginTop: 16 }}>{Ic.plus(14)} משימה ראשונה</button>
      )}
    </div>
  );
}

export function TaskRow({ task, cat, onOpen, onCycle, critical, compact, todayKey, sharedLabel }: {
  task: Task;
  cat?: TaskCategory;
  sharedLabel?: string | null;
  onOpen: () => void;
  onCycle: () => void;
  critical?: boolean;
  compact?: boolean;
  todayKey: string;
}) {
  const sub = countSubtasks(task);
  const done = isDone(task);
  const overdue = !done && task.dueDate && task.dueDate < todayKey;
  const restBg = critical ? alpha(T.danger, 5) : T.bg2;

  return (
    <div
      data-task-row
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) onOpen(); }}
      style={{
        display: "flex", alignItems: "center", gap: 11, cursor: "pointer",
        background: restBg,
        borderRadius: 14, padding: compact ? "9px 12px" : "11px 13px",
        opacity: done ? 0.6 : 1,
        transition: "background .3s var(--ease-soft), box-shadow .3s var(--ease-soft)",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = T.surface2; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = restBg; }}
    >
      <button
        title={`סטטוס: ${STATUS_LABELS[task.status]} (לחיצה מקדמת)`}
        aria-label={`סטטוס: ${STATUS_LABELS[task.status]} — לחיצה מקדמת`}
        onClick={(e) => {
          e.stopPropagation();
          // הבזק סיום — פעימה + הילה ירוקה, ורק אז המשימה עוברת ל"הושלמו"
          const row = e.currentTarget.closest("[data-task-row]");
          if (task.status === "in_progress" && row &&
              !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            gsap.fromTo(row, { scale: 1 },
              { scale: 1.02, duration: 0.14, yoyo: true, repeat: 1, ease: "power2.out", clearProps: "transform", onComplete: onCycle });
            gsap.fromTo(row, { boxShadow: "0 0 0 0 rgba(15,164,126,0)" },
              { boxShadow: "0 0 0 6px rgba(15,164,126,0.30)", duration: 0.14, yoyo: true, repeat: 1, ease: "power1.out", clearProps: "boxShadow" });
          } else {
            onCycle();
          }
        }}
        style={{
          background: "none", border: "none", cursor: "pointer", padding: 2,
          color: STATUS_COLORS[task.status], display: "inline-flex", flexShrink: 0,
        }}>
        <StatusIcon status={task.status} size={19} />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{
            fontWeight: 600, fontSize: compact ? 13 : 13.5, color: T.ink,
            textDecoration: done ? "line-through" : "none",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%",
          }}>
            {task.title || "ללא שם"}
          </span>
          {task.assignedBy && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700,
              color: T.accent, background: T.accentSoft, borderRadius: 99, padding: "1px 8px", flexShrink: 0,
            }}>
              {Ic.send(10)} מ{MANAGER_NAME}
            </span>
          )}
          {sharedLabel && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700,
              color: T.ink2, background: T.surface2, borderRadius: 99, padding: "1px 8px", flexShrink: 0,
            }}>
              {Ic.users(10)} {sharedLabel}
            </span>
          )}
          <span className="num" style={{ fontSize: 10, color: T.ink3, flexShrink: 0 }}>
            נפתחה {formatDateHe(task.createdAt)}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 5, flexWrap: "wrap" }}>
          {task.critical && (
            <Meta color={T.danger}>{Ic.flame(11)} קריטית</Meta>
          )}
          {cat && (
            <Meta color={T.ink2}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: cat.color }} />
              {cat.name}
            </Meta>
          )}
          {task.nature && <Meta color={NATURE_COLORS[task.nature]}>{NATURE_LABELS[task.nature]}</Meta>}
          {task.dueDate && (
            <Meta color={overdue ? T.danger : T.ink2}>
              {Ic.target(11)} <span className="num">{formatDateHe(task.dueDate)}</span>
              {overdue ? " · באיחור" : ""}
            </Meta>
          )}
          {task.reminders.some((r) => !r.fired) && <Meta color={T.ink3}>{Ic.clock(11)}</Meta>}
          {task.files.length > 0 && <Meta color={T.ink3}>{Ic.clip(11)} <span className="num">{task.files.length}</span></Meta>}
          {sub.total > 0 && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5, color: T.ink3 }}>
              <span style={{ width: 48, height: 4, borderRadius: 99, background: T.surface2, overflow: "hidden", display: "inline-block" }}>
                <span style={{ display: "block", height: "100%", width: `${(sub.done / sub.total) * 100}%`, background: T.grad, borderRadius: 99 }} />
              </span>
              <span className="num">{sub.done}/{sub.total}</span>
            </span>
          )}
        </div>
      </div>
      <span style={{ color: T.ink3, flexShrink: 0, opacity: 0.6 }}>{Ic.chevL(14)}</span>
    </div>
  );
}

function Meta({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, color }}>
      {children}
    </span>
  );
}

function CalendarGrid({ year, month, todayKey, items, catById, selectedDate, onSelectDate, onOpenTask }: {
  year: number;
  month: number;
  todayKey: string;
  items: Record<string, Task[]>;
  catById: Record<string, TaskCategory>;
  selectedDate: string | null;
  onSelectDate: (key: string) => void;
  onOpenTask: (id: string) => void;
}) {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startPad = first.getDay();
  const cells: (number | null)[] = [
    ...Array.from({ length: startPad }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, marginBottom: 4 }}>
        {HE_WEEKDAYS.map((d) => (
          <div key={d} style={{ textAlign: "center", fontSize: 10.5, fontWeight: 600, color: T.ink3, padding: "3px 0" }}>{d}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
        {cells.map((day, i) => {
          if (day === null) return <div key={i} className="tj-calday" style={{ minHeight: 72, borderRadius: 11 }} />;
          const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dayTasks = items[key] ?? [];
          const isToday = key === todayKey;
          const isSelected = key === selectedDate;
          return (
            <div
              key={i}
              className="tj-calday"
              onClick={() => onSelectDate(key)}
              style={{
                minHeight: 72, borderRadius: 11, padding: "4px 5px", cursor: "pointer",
                background: isSelected ? T.mintSoft : isToday ? T.accentSoft : T.bg2,
                boxShadow: isSelected ? `inset 0 0 0 1.5px ${alpha(T.mint, 50)}` : isToday ? `inset 0 0 0 1.5px ${T.accent}` : "none",
                display: "flex", flexDirection: "column", gap: 3, overflow: "hidden",
              }}
            >
              <span className="num" style={{
                fontSize: 10.5, fontWeight: isToday ? 800 : 500,
                color: isToday ? T.accent : T.ink3,
              }}>
                {day}
              </span>
              {dayTasks.slice(0, 3).map((t) => {
                const c = t.categoryId ? catById[t.categoryId]?.color : undefined;
                const col = t.critical ? "var(--tj-danger)" : (c ?? "var(--tj-accent)");
                return (
                  <button
                    key={t.id}
                    onClick={(e) => { e.stopPropagation(); onOpenTask(t.id); }}
                    title={t.title}
                    style={{
                      display: "flex", alignItems: "center", gap: 3, width: "100%", textAlign: "start",
                      background: alpha(col, 14), color: mixToInk(col), border: "none",
                      borderRadius: 6, padding: "2px 5px", fontSize: 9.5, fontWeight: 600,
                      overflow: "hidden", whiteSpace: "nowrap",
                      cursor: "pointer", fontFamily: "inherit",
                      textDecoration: isDone(t) ? "line-through" : "none",
                    }}
                  >
                    <span style={{ width: 5, height: 5, borderRadius: 99, background: col, flexShrink: 0 }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{t.title || "ללא שם"}</span>
                  </button>
                );
              })}
              {dayTasks.length > 3 && (
                <span className="num" style={{ fontSize: 9, color: T.ink3 }}>‎+{dayTasks.length - 3}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// טקסט על צ'יפ צבעוני בלוח — מעמיק לכיוון שחור בבהיר ומבהיר לכיוון לבן בכהה
function mixToInk(color: string): string {
  return `color-mix(in srgb, ${color} 62%, var(--tj-chipmix))`;
}

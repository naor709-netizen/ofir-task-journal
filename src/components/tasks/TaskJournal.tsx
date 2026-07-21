"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { useToast } from "@/components/Toast";
import {
  type JournalData, type Task, type TaskCategory, type TaskNature, type TaskStatus,
  subscribeJournal, getJournalSnapshot, getServerJournalSnapshot, setJournalData,
  subscribeSyncState, getSyncState, getServerSyncState, getSyncDetail, initJournalSync,
  emptyTask, uid, isDone,
  replaceTaskInTree, removeTaskFromTree, findTaskInTree, flattenTasks, countSubtasks,
  toDateKey, formatDateHe,
  NATURE_LABELS, NATURE_COLORS, STATUS_LABELS, STATUS_COLORS,
  HE_MONTHS, HE_WEEKDAYS, HE_WEEKDAYS_FULL, CATEGORY_COLOR_CHOICES,
} from "@/lib/tasks";
import { pushPermission, isSubscribed, enablePush, diagnosePush, showLocalNotification, sendTestPush } from "@/lib/push";
import { parseQuickAdd, hebrewDateToday } from "@/lib/quickadd";
import { celebrate } from "@/lib/celebrate";
import { T, alpha, card, tintCard, chip, inputStyle, Ic, StatusIcon } from "./ui";
import { TaskModal } from "./TaskModal";
import { WeekView, TableView, BoardView, StatsView } from "./views";

gsap.registerPlugin(useGSAP);

type ViewKey = "dashboard" | "week" | "table" | "board" | "stats";

const VIEWS: { key: ViewKey; label: string; icon: (s?: number) => React.ReactNode }[] = [
  { key: "dashboard", label: "דשבורד", icon: Ic.grid },
  { key: "week", label: "השבוע", icon: Ic.week },
  { key: "table", label: "טבלה", icon: Ic.table },
  { key: "board", label: "קנבן", icon: Ic.board },
  { key: "stats", label: "אנליטיקות", icon: Ic.chart },
];

export default function TaskJournal() {
  const { toast } = useToast();
  const journal = useSyncExternalStore(subscribeJournal, getJournalSnapshot, getServerJournalSnapshot);
  const syncState = useSyncExternalStore(subscribeSyncState, getSyncState, getServerSyncState);

  const [view, setView] = useState<ViewKey>("dashboard");

  // filters
  const [catFilter, setCatFilter] = useState<Set<string>>(new Set());
  const [natureFilter, setNatureFilter] = useState<Set<TaskNature>>(new Set());
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "done">("all");
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // calendar
  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());

  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
    })();
    return () => { cancelled = true; };
  }, []);
  const [testingPush, setTestingPush] = useState(false);
  async function showPushDiag() {
    toast("בודק את מערך ההתראות…", "info");
    const d = await diagnosePush();
    const yes = "✓", no = "✗";
    const lines: string[] = ["אבחון התראות", ""];
    lines.push(
      `הרשאת דפדפן: ${d.permission === "granted" ? `${yes} אושרה` : d.permission === "denied" ? `${no} נדחתה` : d.permission === "unsupported" ? `${no} לא נתמך` : "○ טרם נתבקשה"}`
    );
    lines.push(`המכשיר הזה רשום להתראות: ${d.deviceSubscribed ? yes : no}`);
    lines.push(`מפתח VAPID בבנייה: ${d.vapidBaked ? yes : `${no} חסר NEXT_PUBLIC_VAPID_PUBLIC_KEY`}`);
    lines.push(
      d.server
        ? `הגדרות שרת: מפתח פרטי ${d.server.vapidPrivate ? yes : no} · CRON_SECRET ${d.server.cronSecret ? yes : no} · Supabase ${d.server.supabase ? yes : no}`
        : `הגדרות שרת: ${no} הנתיב /api/send-reminders לא זמין`
    );
    lines.push(
      d.cloudSubscriptions === null
        ? `טבלאות ההתראות ב-Supabase: ${no} ${d.cloudError ?? "לא קיימות"}`
        : `מכשירים רשומים בענן: ${d.cloudSubscriptions}`
    );
    const hbAgeMin = d.heartbeatAt ? Math.round((Date.now() - new Date(d.heartbeatAt).getTime()) / 60000) : null;
    lines.push(
      hbAgeMin === null
        ? `שרת התזכורות (cron): ${no} מעולם לא רץ`
        : `שרת התזכורות (cron): רץ לאחרונה לפני ${hbAgeMin} דק׳ ${hbAgeMin <= 3 ? yes : no}`
    );
    lines.push("");
    if (!d.vapidBaked || (d.server && (!d.server.vapidPrivate || !d.server.cronSecret))) {
      lines.push("← הבעיה: חסרים משתני VAPID/CRON_SECRET ב-Vercel. יש להוסיף אותם ולפרוס מחדש (README, שלב 1).");
    } else if (d.cloudSubscriptions === null) {
      lines.push("← הבעיה: יש להריץ את supabase-reminders.sql ב-SQL Editor של Supabase (README, שלב 2).");
    } else if (hbAgeMin === null) {
      lines.push("← הבעיה: משימת ה-cron לא רצה מעולם. יש להפעיל את התוספים pg_cron ו-pg_net ב-Supabase ולהריץ את supabase-reminders.sql (README, שלב 2).");
    } else if (hbAgeMin > 3) {
      lines.push(`← הבעיה: ה-cron הפסיק לרוץ (לפני ${hbAgeMin} דק׳). יש לבדוק את המשימה ofir-reminders ב-Supabase ואת כתובת הפריסה בקובץ ה-SQL.`);
    } else if (d.permission !== "granted" || !d.deviceSubscribed) {
      lines.push(d.ios && !d.standalone
        ? "← הבעיה: באייפון התראות עובדות רק כשהיומן מותקן — שיתוף ← הוסף למסך הבית, ואז \"הפעל התראות\" מתוך האפליקציה."
        : "← הבעיה: המכשיר הזה לא רשום — יש ללחוץ \"הפעל התראות\" ולאשר.");
    } else if (d.cloudSubscriptions === 0) {
      lines.push("← הבעיה: אף מכשיר לא רשום בענן — יש ללחוץ \"הפעל התראות\" מחדש.");
    } else {
      lines.push("← הכול תקין: תזכורות יגיעו גם כשהיומן סגור.");
    }
    // אם הכול מוגדר — שולחים גם התראת-אמת מיידית, שהמשתמש יראה שהמסירה עובדת בפועל
    if (d.deviceSubscribed && d.vapidBaked && d.cloudSubscriptions && d.cloudSubscriptions > 0) {
      const t = await sendTestPush();
      lines.push("");
      lines.push(t.ok
        ? "התראת בדיקה נשלחה עכשיו ✓ — אמורה להופיע כהתראת מערכת תוך כמה שניות."
        : `שליחת התראת בדיקה נכשלה ✗ (${t.reason ?? ""})`);
    }
    alert(lines.join("\n"));
  }

  async function togglePush() {
    if (pushState !== "off") { setTestingPush(true); await showPushDiag(); setTestingPush(false); return; }
    const r = await enablePush();
    if (r.ok) { setPushState("on"); toast("התראות הופעלו — תזכורות יגיעו גם כשהיומן סגור", "success"); }
    else if (r.reason === "denied") { setPushState("denied"); toast("ההרשאה נדחתה — יש לאשר התראות בהגדרות הדפדפן", "error"); }
    else if (r.reason === "unsupported") { setPushState("unsupported"); await showPushDiag(); }
    else if (r.reason === "no-vapid") { await showPushDiag(); }
    else { toast("הפעלת ההתראות נכשלה: " + (r.reason ?? ""), "error"); }
  }

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
      if (flattenTasks(j.tasks).some((t) => t.reminders.length > 0) &&
          typeof Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission();
      }
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
            showLocalNotification("יומן המשימות של אופיר", body, r.id);
          }
        }
      }
      if (changed) setJournalData({ ...j, tasks });
    }
    const t = setTimeout(check, 800);
    const iv = setInterval(check, 20000);
    return () => { clearTimeout(t); clearInterval(iv); };
  }, [toast]);

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

  const filteredTasks = useMemo(() => {
    // חיפוש סלחני: לא תלוי רישיות או סדר מילים — כל מילה צריכה להופיע איפשהו במשימה
    const qWords = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    // שלבים הם משימות לכל דבר — שורש עובר סינון אם הוא או אחד השלבים שלו עונה על כל התנאים
    const matches = (t: Task): boolean => {
      if (expandedCatFilter.size > 0 && !(t.categoryId && expandedCatFilter.has(t.categoryId))) return false;
      if (natureFilter.size > 0 && !(t.nature && natureFilter.has(t.nature))) return false;
      if (statusFilter === "active" && isDone(t)) return false;
      if (statusFilter === "done" && !isDone(t)) return false;
      if (criticalOnly && !t.critical) return false;
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
  }, [journal, expandedCatFilter, natureFilter, statusFilter, criticalOnly, search, selectedDate, catById]);

  const criticalTasks = filteredTasks.filter((t) => t.critical && !isDone(t));
  // משימות שהושלמו לא נשארות ברשימה הראשית — הן עוברות לרשימה מרוכזת מתחת ללוח השנה
  const regularTasks = filteredTasks.filter((t) => !isDone(t) && !t.critical);
  const doneTasks = [...filteredTasks.filter(isDone)]
    .sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""));
  const activeCount = filteredTasks.length - doneTasks.length;

  const allFlat = useMemo(() => flattenTasks(journal?.tasks ?? []), [journal]);
  const todayKey = toDateKey(today);
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
      `📋 היומן של אופיר — יום ${HE_WEEKDAYS_FULL[today.getDay()]} ${today.getDate()}.${today.getMonth() + 1}`,
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

  function createTask() {
    if (!journal) return;
    const t = { ...emptyTask(), title: "", dueDate: todayKey };
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
    toast("המשימה נמחקה", "info", {
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

  const openRoot = openTaskId && journal
    ? journal.tasks.find((root) => [root, ...flattenTasks(root.subtasks)].some((t) => t.id === openTaskId)) ?? null
    : null;

  const filtersActive = catFilter.size > 0 || natureFilter.size > 0 || statusFilter !== "all" || criticalOnly || !!search.trim() || !!selectedDate;

  // ---- GSAP choreography ----
  const rootRef = useRef<HTMLDivElement>(null);
  const entranceDone = useRef(false);
  const viewFirst = useRef(true);

  useGSAP(() => {
    if (!journal || entranceDone.current) return;
    entranceDone.current = true;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const tl = gsap.timeline({ defaults: { ease: "power3.out", duration: 0.55 } });
      tl.from("header", { y: -16, opacity: 0, duration: 0.4, clearProps: "opacity,transform" })
        .from(".tj-toolbar", { y: 12, opacity: 0, duration: 0.4, clearProps: "opacity,transform" }, "-=0.22")
        .from(".tj-kpis > div", { y: 20, opacity: 0, stagger: 0.06, clearProps: "opacity,transform" }, "-=0.2")
        .from(".tj-layout .tj-card", { y: 24, opacity: 0, stagger: 0.07, clearProps: "opacity,transform" }, "-=0.38");
      gsap.utils.toArray<HTMLElement>(".tj-kpi-num").forEach((el) => {
        const end = parseInt(el.textContent || "0", 10) || 0;
        if (end > 0) {
          gsap.fromTo(el, { textContent: 0 },
            { textContent: end, duration: 0.9, delay: 0.3, ease: "power2.out", snap: { textContent: 1 } });
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
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.32, ease: "power2.out", clearProps: "opacity,transform" });
  }, { scope: rootRef, dependencies: [view] });

  const sync = {
    local:   { icon: Ic.cloudOff(13), label: "מקומי בלבד", color: T.ink3 },
    syncing: { icon: Ic.cloud(13),    label: "מסנכרן…",    color: T.amber },
    synced:  { icon: Ic.cloud(13),    label: "מסונכרן",    color: T.mint },
    error:   { icon: Ic.alert(13),    label: "שגיאת סנכרון", color: T.danger },
  }[syncState];

  if (!journal) {
    return (
      <div style={{ minHeight: "100vh", background: T.bg }}>
        <Header sync={sync} />
        <div style={{ padding: 40, display: "grid", gap: 12 }}>
          <div style={{ height: 110, borderRadius: 16, background: T.surface }} />
          <div style={{ height: 340, borderRadius: 16, background: T.surface }} />
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} style={{ minHeight: "100vh", color: T.ink }}>
      <Header sync={sync} />

      {/* ===== toolbar: view tabs + new task ===== */}
      <div className="tj-toolbar" style={{
        maxWidth: 1252, margin: "12px auto 0", padding: "8px 10px",
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        position: "sticky", top: 8, zIndex: 40,
        background: "var(--tj-glass)",
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        border: `1px solid ${T.line}`, borderRadius: 20,
        boxShadow: "inset 0 1px 0 var(--tj-bezel), 0 12px 32px -16px var(--tj-shadow-strong)",
      }}>
        <nav className="no-scrollbar" style={{
          display: "flex", gap: 2, background: T.surface, border: `1px solid ${T.line}`,
          borderRadius: 12, padding: 3, overflowX: "auto", maxWidth: "100%", boxShadow: T.shadowSm,
        }}>
          {VIEWS.map((v) => {
            const active = view === v.key;
            return (
              <button key={v.key} onClick={() => setView(v.key)} style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                background: active ? "linear-gradient(135deg, rgba(37,99,235,0.14), rgba(15,164,126,0.12))" : "transparent",
                color: active ? T.ink : T.ink2,
                border: "none", borderRadius: 9, padding: "8px 14px",
                fontSize: 13, fontWeight: active ? 700 : 400, cursor: "pointer",
                whiteSpace: "nowrap", fontFamily: "inherit",
                boxShadow: active ? `inset 0 0 0 1px ${T.accent}3A` : "none",
              }}>
                <span style={{ color: active ? T.accent : T.ink3, display: "inline-flex" }}>{v.icon(15)}</span>
                {v.label}
              </button>
            );
          })}
        </nav>

        <div style={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <button
            title="לחיצה מציגה אבחון סנכרון"
            onClick={() => {
              const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
              const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
              alert(
                `אבחון סנכרון\n` +
                `מצב: ${sync.label}\n` +
                `כתובת Supabase בבנייה: ${url || "❌ חסרה"}\n` +
                `מפתח anon בבנייה: ${key ? "✓ קיים (" + key.slice(0, 12) + "…)" : "❌ חסר"}\n` +
                `שגיאה אחרונה: ${getSyncDetail() || "אין"}`
              );
            }}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5,
              color: sync.color, border: `1px solid ${T.line}`, borderRadius: 99, padding: "5px 12px",
              background: "transparent", cursor: "pointer", fontFamily: "inherit",
            }}>
            {sync.icon}{sync.label}
          </button>
          <button onClick={toggleTheme} title={theme === "dark" ? "מעבר למצב בהיר" : "מעבר למצב כהה"} style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 30, height: 30, borderRadius: 99, border: `1px solid ${T.line}`,
            background: "transparent", color: T.ink2, cursor: "pointer",
          }}>
            {theme === "dark" ? Ic.sun(14) : Ic.moon(14)}
          </button>
          <button onClick={togglePush} disabled={testingPush}
            title={pushState === "on" ? "התראות פעילות — לחיצה מריצה אבחון ושולחת התראת בדיקה" : pushState === "off" ? "הפעלת התראות" : "לחיצה מציגה אבחון התראות"}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontFamily: "inherit",
              border: `1px solid ${pushState === "on" ? `${alpha(T.mint, 40)}` : T.line}`, borderRadius: 99, padding: "5px 12px",
              background: pushState === "on" ? T.mintSoft : "transparent",
              color: pushState === "on" ? T.mint : pushState === "denied" ? T.danger : T.ink2,
              cursor: testingPush ? "default" : "pointer", opacity: testingPush ? 0.6 : 1,
            }}>
            {Ic.bell(13)} {testingPush ? "בודק…" : pushState === "on" ? "התראות פעילות" : pushState === "denied" ? "התראות חסומות" : pushState === "unsupported" ? "התראות — נדרשת התקנה" : "הפעל התראות"}
          </button>
          <button onClick={createTask} className="tj-newbtn" style={{
            display: "inline-flex", alignItems: "center", gap: 9,
            background: T.grad, color: "#fff", border: "none", borderRadius: 99,
            padding: "7px 8px 7px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer",
            fontFamily: "var(--font-display)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25), 0 10px 24px -10px rgba(29,79,215,0.65)",
          }}>
            <span className="tj-newbtn-orb" style={{
              width: 26, height: 26, borderRadius: 99, background: "rgba(255,255,255,0.18)",
              display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>{Ic.plus(14)}</span>
            משימה חדשה
          </button>
        </div>
      </div>

      {/* ===== body ===== */}
      <div className="tj-layout" style={{
        maxWidth: 1280, margin: "0 auto", padding: "16px 18px 60px",
        display: "flex", gap: 16, alignItems: "flex-start",
      }}>

        {/* ---- sidebar ---- */}
        <aside className={sidebarOpen ? "tj-card" : "tj-sidebar tj-card"} style={{
          ...card, width: 258, flexShrink: 0, padding: 16,
          position: "sticky", top: 14,
          display: sidebarOpen ? "block" : undefined,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12, color: T.ink2, fontSize: 12, fontWeight: 600 }}>
            {Ic.filter(14)} סינון
            {filtersActive && (
              <button onClick={() => {
                setCatFilter(new Set()); setNatureFilter(new Set()); setStatusFilter("all");
                setCriticalOnly(false); setSearch(""); setSelectedDate(null);
              }} style={{
                marginInlineStart: "auto", background: "none", border: "none",
                color: T.accent, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
              }}>
                ניקוי
              </button>
            )}
          </div>

          <button className="tj-apply-mobile" onClick={() => { setSidebarOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{
            display: "none", width: "100%", alignItems: "center", justifyContent: "center", gap: 8,
            background: T.grad, color: "#fff", border: "none", borderRadius: 11,
            padding: "11px 0", fontSize: 13.5, fontWeight: 700, cursor: "pointer",
            fontFamily: "var(--font-display)", marginBottom: 14,
          }}>
            הצגת {filteredTasks.length} תוצאות {Ic.chevL(15)}
          </button>

          <div style={{ position: "relative", marginBottom: 10 }}>
            {/* בלי pointer-events האייקון בולע הקשות על השדה בנייד */}
            <span style={{ position: "absolute", insetInlineStart: 10, top: "50%", transform: "translateY(-50%)", color: T.ink3, pointerEvents: "none" }}>
              {Ic.search(14)}
            </span>
            <input
              type="search" inputMode="search" placeholder="חיפוש משימה…" value={search}
              onChange={(e) => { setSearch(e.target.value); if (selectedDate) setSelectedDate(null); }}
              onKeyDown={(e) => {
                // מקש "חיפוש" במקלדת של הנייד = Enter — מיישם את הסינון ומציג את התוצאות
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                  setSidebarOpen(false);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }
              }}
              style={{ ...inputStyle, width: "100%", paddingInlineStart: 32 }}
            />
          </div>

          {/* פידבק חי בזמן הקלדה — בנייד התוצאות מוסתרות מאחורי הפאנל */}
          {search.trim() !== "" && (
            <div className="tj-search-live" style={{
              display: "none", flexDirection: "column", gap: 5, marginBottom: 14,
              background: T.bg2, border: `1px solid ${T.line}`, borderRadius: 11, padding: 10,
            }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: filteredTasks.length === 0 ? T.danger : T.ink2 }}>
                {filteredTasks.length === 0 ? "לא נמצאו משימות תואמות" : `נמצאו ${filteredTasks.length} משימות — הקשה פותחת:`}
              </span>
              {filteredTasks.slice(0, 5).map((t) => (
                <button key={t.id} onClick={() => setOpenTaskId(t.id)} style={{
                  display: "flex", alignItems: "center", gap: 8, textAlign: "start",
                  background: T.surface, border: `1px solid ${T.line}`, borderRadius: 9,
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
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 10 }}>
            {[...categories.filter((c) => !c.parentId).flatMap((parent) => [parent, ...categories.filter((k) => k.parentId === parent.id)])].map((c) => {
              const active = catFilter.has(c.id);
              const count = filteredCountByCat(journal.tasks, c.id);
              return (
                <div key={c.id} className="tj-catrow" style={{ display: "flex", alignItems: "center", gap: 2, paddingInlineStart: c.parentId ? 18 : 0 }}>
                  <button
                    onClick={() => toggleSet(catFilter, c.id, setCatFilter)}
                    style={{
                      flex: 1, display: "flex", alignItems: "center", gap: 9, textAlign: "start",
                      background: active ? `${c.color}1C` : "transparent",
                      border: `1px solid ${active ? `${c.color}66` : "transparent"}`,
                      borderRadius: 9, padding: "7px 10px", cursor: "pointer",
                      fontSize: 12.5, fontWeight: active ? 600 : 400,
                      color: active ? T.ink : T.ink2, fontFamily: "inherit",
                    }}>
                    <span style={{ width: c.parentId ? 7 : 9, height: c.parentId ? 7 : 9, borderRadius: 3, background: c.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: c.parentId ? 12 : undefined }}>{c.name}</span>
                    <span className="num" style={{ fontSize: 10.5, color: T.ink3 }}>{count}</span>
                  </button>
                  {!c.parentId && (
                    <button title="הוספת תת-קטגוריה" onClick={() => { setNewCatParent(c.id); setNewCatName(""); }}
                      className="tj-catdel"
                      style={{ background: "transparent", border: "none", color: T.accent, cursor: "pointer", padding: 4, borderRadius: 6 }}>
                      {Ic.plus(11)}
                    </button>
                  )}
                  <button title="מחיקת קטגוריה" onClick={() => deleteCategory(c.id)}
                    className="tj-catdel"
                    style={{ background: "transparent", border: "none", color: T.ink3, cursor: "pointer", padding: 4, borderRadius: 6 }}>
                    {Ic.x(11)}
                  </button>
                </div>
              );
            })}
          </div>

          {/* add category */}
          <div style={{ background: T.bg2, border: `1px solid ${T.line}`, borderRadius: 11, padding: 10, marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: T.ink2, marginBottom: 7, display: "flex", alignItems: "center", gap: 5 }}>
              {Ic.plus(12)}
              {newCatParent && catById[newCatParent]
                ? <>תת-קטגוריה בתוך <b style={{ color: catById[newCatParent].color }}>{catById[newCatParent].name}</b>
                    <button onClick={() => setNewCatParent(null)} title="ביטול"
                      style={{ background: "none", border: "none", color: T.ink3, cursor: "pointer", display: "inline-flex", padding: 2 }}>
                      {Ic.x(10)}
                    </button>
                  </>
                : "קטגוריה חדשה"}
            </div>
            <input
              placeholder="שם הקטגוריה" value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && newCatName.trim()) { addCategory(newCatName, newCatColor, newCatParent); setNewCatName(""); setNewCatParent(null); } }}
              style={{ ...inputStyle, width: "100%", padding: "7px 10px", fontSize: 12, marginBottom: 8 }}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
              {CATEGORY_COLOR_CHOICES.map((col) => (
                <button key={col} onClick={() => setNewCatColor(col)} style={{
                  width: 18, height: 18, borderRadius: 6, background: col, cursor: "pointer",
                  border: "none",
                  outline: newCatColor === col ? `2px solid ${T.ink}` : "none", outlineOffset: 1,
                }} />
              ))}
              <input type="color" value={newCatColor} onChange={(e) => setNewCatColor(e.target.value)}
                title="צבע חופשי"
                style={{ width: 18, height: 18, padding: 0, border: "none", borderRadius: 6, cursor: "pointer", background: "transparent" }} />
            </div>
            <button
              onClick={() => { if (newCatName.trim()) { addCategory(newCatName, newCatColor, newCatParent); setNewCatName(""); setNewCatParent(null); } }}
              disabled={!newCatName.trim()}
              style={{
                width: "100%", border: "none", borderRadius: 9, padding: "8px 0",
                fontSize: 12, fontWeight: 600, fontFamily: "inherit",
                background: newCatName.trim() ? T.accentSoft : T.surface,
                color: newCatName.trim() ? T.accent : T.ink3,
                cursor: newCatName.trim() ? "pointer" : "default",
                boxShadow: newCatName.trim() ? `inset 0 0 0 1px ${alpha(T.accent, 33)}` : `inset 0 0 0 1px ${T.line}`,
              }}>
              הוספה
            </button>
          </div>

          <SectionTitle>מהות</SectionTitle>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
            {(Object.keys(NATURE_LABELS) as TaskNature[]).map((n) => (
              <button key={n} onClick={() => toggleSet(natureFilter, n, setNatureFilter)}
                style={chip(NATURE_COLORS[n], natureFilter.has(n))}>
                {NATURE_LABELS[n]}
              </button>
            ))}
          </div>

          <SectionTitle>סטטוס</SectionTitle>
          <div style={{ display: "flex", gap: 5, marginBottom: 16 }}>
            {([["all", "הכל"], ["active", "פעילות"], ["done", "הושלמו"]] as const).map(([v, label]) => (
              <button key={v} onClick={() => setStatusFilter(v)} style={{
                flex: 1, borderRadius: 9, padding: "7px 0", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
                border: `1px solid ${statusFilter === v ? `${alpha(T.accent, 40)}` : T.line}`,
                background: statusFilter === v ? T.accentSoft : "transparent",
                color: statusFilter === v ? T.accent : T.ink2, fontWeight: statusFilter === v ? 600 : 400,
              }}>{label}</button>
            ))}
          </div>

          <button onClick={() => setCriticalOnly(!criticalOnly)} style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%",
            background: criticalOnly ? T.dangerSoft : "transparent",
            border: `1px solid ${criticalOnly ? `${alpha(T.danger, 33)}` : T.line}`,
            borderRadius: 9, padding: "8px 10px", fontSize: 12.5, cursor: "pointer",
            color: criticalOnly ? T.danger : T.ink2, fontWeight: criticalOnly ? 600 : 400,
            fontFamily: "inherit", marginBottom: 18,
          }}>
            <span style={{ color: T.danger, display: "inline-flex" }}>{Ic.flame(14)}</span>
            רק משימות קריטיות
          </button>

          {upcomingReminders.length > 0 && (
            <>
              <SectionTitle>תזכורות קרובות</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {upcomingReminders.map(({ task, r }) => (
                  <button key={r.id} onClick={() => setOpenTaskId(task.id)} style={{
                    textAlign: "start", background: T.bg2, border: `1px solid ${T.line}`,
                    borderRadius: 9, padding: "8px 10px", cursor: "pointer", fontFamily: "inherit",
                    display: "flex", gap: 8, alignItems: "flex-start",
                  }}>
                    <span style={{ color: T.mint, marginTop: 1 }}>{Ic.clock(13)}</span>
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
            display: "none", ...card, padding: "10px 14px", fontSize: 13, fontWeight: 600,
            color: T.ink2, cursor: "pointer", textAlign: "start", fontFamily: "inherit",
            alignItems: "center", gap: 8,
          }}>
            {sidebarOpen ? <>{Ic.x(14)} סגירת סינון</> : <>{Ic.filter(14)} סינון וקטגוריות</>}
          </button>

          {view === "dashboard" && (
            <>
              {/* hero — ברכה אישית + הוספה מהירה */}
              <section className="tj-card" style={{ ...card, padding: "16px 18px", background: `linear-gradient(135deg, ${T.surface} 60%, ${T.accentSoft})` }}>
                {(() => {
                  const h = today.getHours();
                  const greet = h < 5 ? "לילה טוב" : h < 12 ? "בוקר טוב" : h < 17 ? "צהריים טובים" : h < 22 ? "ערב טוב" : "לילה טוב";
                  const emoji = h < 5 ? "🌙" : h < 12 ? "☀️" : h < 17 ? "🌤️" : h < 22 ? "🌇" : "🌙";
                  const todayCount = allFlat.filter((t) => !isDone(t) && t.dueDate === todayKey).length;
                  const bits: string[] = [];
                  if (todayCount > 0) bits.push(`${todayCount} משימות להיום`);
                  if (overdueCount > 0) bits.push(`${overdueCount} באיחור`);
                  if (criticalCount > 0) bits.push(`${criticalCount} קריטיות`);
                  const heb = hebrewDateToday(today);
                  return (
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{
                          display: "inline-block", fontSize: 9.5, fontWeight: 600, letterSpacing: "0.18em",
                          color: T.accent, background: T.accentSoft, borderRadius: 99,
                          padding: "3px 11px", marginBottom: 8,
                        }}>
                          סקירה יומית
                        </span>
                        <div style={{ fontSize: 26, fontWeight: 800, fontFamily: "var(--font-display)", letterSpacing: "-0.025em", lineHeight: 1.1, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <span>{emoji} {greet}, אופיר</span>
                          {streak >= 2 && (
                            <span className="num" title={`${streak} ימים ברצף עם משימות שהושלמו`} style={{
                              fontSize: 11.5, fontWeight: 700, color: "#C2410C", background: "#FFEDD5",
                              borderRadius: 99, padding: "3px 10px",
                            }}>
                              🔥 רצף {streak} ימים
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: T.ink2, marginTop: 3 }}>
                          יום {HE_WEEKDAYS_FULL[today.getDay()]}, <span className="num">{today.getDate()}.{today.getMonth() + 1}</span>
                          {heb ? <> · {heb}</> : null}
                          {" · "}
                          {bits.length ? bits.join(" · ") : "אין משימות להיום — יום נקי ✨"}
                        </div>
                      </div>
                      <button onClick={shareDay} title="שיתוף סיכום היום (וואטסאפ וכו׳)" style={{
                        display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0,
                        background: "transparent", border: `1px solid ${T.line}`, color: T.ink2,
                        borderRadius: 99, padding: "6px 13px", fontSize: 11.5, fontWeight: 600,
                        cursor: "pointer", fontFamily: "inherit",
                      }}>
                        {Ic.share(13)} שיתוף היום
                      </button>
                    </div>
                  );
                })()}
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ position: "relative", flex: 1 }}>
                    <span style={{ position: "absolute", insetInlineStart: 11, top: "50%", transform: "translateY(-50%)", color: T.accent, pointerEvents: "none" }}>
                      {Ic.plus(14)}
                    </span>
                    <input
                      value={quickText}
                      onChange={(e) => setQuickText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") quickAdd(); }}
                      placeholder={'הוספה מהירה — נסה: "להתקשר לדני מחר ב-10:00"'}
                      style={{ ...inputStyle, width: "100%", paddingInlineStart: 33 }}
                    />
                  </div>
                  <button onClick={quickAdd} disabled={!quickText.trim()} style={{
                    border: "none", borderRadius: 10, padding: "0 18px", fontSize: 13, fontWeight: 700,
                    fontFamily: "var(--font-display)", cursor: quickText.trim() ? "pointer" : "default",
                    background: quickText.trim() ? T.grad : T.surface2,
                    color: quickText.trim() ? "#fff" : T.ink3,
                  }}>
                    הוספה
                  </button>
                </div>
              </section>

              {/* KPI strip */}
              <div className="tj-kpis" style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr 1fr 1fr", gap: 10 }}>
                {(() => {
                  const doneAll = allFlat.filter(isDone).length;
                  const totalAll = allFlat.length;
                  const pct = totalAll ? Math.round((doneAll / totalAll) * 100) : 0;
                  return (
                    <div className="tj-kpi-hero" style={{ ...card, padding: "14px 16px", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{
                          width: 38, height: 38, borderRadius: 11, flexShrink: 0,
                          background: T.accentSoft, color: T.accent,
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                        }}>{Ic.circle(16)}</span>
                        <div>
                          <div className="num tj-kpi-num" style={{ fontSize: 30, fontWeight: 800, lineHeight: 1, color: T.ink }}>{openCount}</div>
                          <div style={{ fontSize: 11, color: T.ink2, fontWeight: 500 }}>משימות פתוחות</div>
                        </div>
                      </div>
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: T.ink3, marginBottom: 4 }}>
                          <span>התקדמות כוללת</span>
                          <span className="num" style={{ color: T.mint, fontWeight: 700 }}>{pct}%</span>
                        </div>
                        <div style={{ height: 5, borderRadius: 99, background: T.surface2, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${pct}%`, borderRadius: 99, background: T.mint, transition: "width .8s cubic-bezier(0.32,0.72,0,1)" }} />
                        </div>
                      </div>
                    </div>
                  );
                })()}
                <Kpi label="בתהליך" value={inProgressCount} icon={Ic.progress(15)} />
                <Kpi label="קריטיות" value={criticalCount} icon={Ic.flame(15)} alert={criticalCount > 0} />
                <Kpi label="באיחור" value={overdueCount} icon={Ic.alert(15)} alert={overdueCount > 0} />
              </div>

              {/* critical strip */}
              {criticalTasks.length > 0 && (
                <section className="tj-card" style={{
                  ...tintCard(T.danger), padding: 16, position: "relative", overflow: "hidden",
                }}>
                  <div style={{ position: "absolute", insetInline: 0, top: 0, height: 3, background: `linear-gradient(90deg, ${T.danger}, ${T.danger}66)` }} />
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 13 }}>
                    <IcChip icon={Ic.flame(16)} color={T.danger} />
                    <h2 style={{ margin: 0, fontSize: 15.5, fontWeight: 800, fontFamily: "var(--font-display)" }}>משימות קריטיות</h2>
                    <span className="num" style={{ fontSize: 11.5, fontWeight: 700, color: "#fff", background: T.danger, borderRadius: 99, padding: "2px 10px" }}>
                      {criticalTasks.length}
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", gap: 8 }}>
                    {criticalTasks.map((t) => (
                      <TaskRow key={t.id} task={t} cat={t.categoryId ? catById[t.categoryId] : undefined}
                        critical todayKey={todayKey}
                        onOpen={() => setOpenTaskId(t.id)} onCycle={() => cycleStatus(t)} compact />
                    ))}
                  </div>
                </section>
              )}

              {/* tasks (main, right) + calendar (left column) side by side */}
              <div className="tj-dash-cols" style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
              <section className="tj-card" style={{ ...card, padding: 16, position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", insetInline: 0, top: 0, height: 3, background: T.grad }} />
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 13 }}>
                  <IcChip icon={Ic.layers(16)} color={T.accent} />
                  <h2 style={{ margin: 0, fontSize: 15.5, fontWeight: 800, fontFamily: "var(--font-display)" }}>המשימות שלי</h2>
                  <span className="num" style={{ fontSize: 11.5, fontWeight: 700, color: T.accent, background: T.accentSoft, borderRadius: 99, padding: "2px 10px" }}>
                    {activeCount}
                  </span>
                </div>

                {activeCount === 0 ? (
                  doneTasks.length > 0 ? (
                    <div style={{ textAlign: "center", padding: "34px 20px", color: T.mint, fontSize: 14, fontWeight: 600 }}>
                      🎉 כל המשימות הושלמו — כל הכבוד!
                    </div>
                  ) : (
                    <Empty filtersActive={filtersActive} onCreate={createTask} />
                  )
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {regularTasks.map((t) => (
                      <TaskRow key={t.id} task={t} cat={t.categoryId ? catById[t.categoryId] : undefined}
                        todayKey={todayKey}
                        onOpen={() => setOpenTaskId(t.id)} onCycle={() => cycleStatus(t)} />
                    ))}
                  </div>
                )}
              </section>
                </div>
                <div className="tj-dash-cal" style={{ width: 452, flexShrink: 0, position: "sticky", top: 14 }}>
              <section className="tj-card" style={{ ...card, padding: 16, position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", insetInline: 0, top: 0, height: 3, background: T.grad }} />
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                  <IcChip icon={Ic.calendar(16)} color={T.accent} />
                  <h2 style={{ margin: 0, fontSize: 15.5, fontWeight: 800, fontFamily: "var(--font-display)" }}>לוח שנה</h2>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginInlineStart: "auto" }}>
                    <NavBtn onClick={() => { const m = calMonth - 1; if (m < 0) { setCalMonth(11); setCalYear(calYear - 1); } else setCalMonth(m); }}>{Ic.chevR(14)}</NavBtn>
                    <div className="num" style={{ minWidth: 118, textAlign: "center", fontWeight: 600, fontSize: 13.5 }}>
                      {HE_MONTHS[calMonth]} {calYear}
                    </div>
                    <NavBtn onClick={() => { const m = calMonth + 1; if (m > 11) { setCalMonth(0); setCalYear(calYear + 1); } else setCalMonth(m); }}>{Ic.chevL(14)}</NavBtn>
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
                    <span style={{ color: T.mint, background: T.mintSoft, borderRadius: 99, padding: "3px 12px" }}>
                      מסונן לתאריך {formatDateHe(selectedDate)}
                    </span>
                    <button onClick={() => setSelectedDate(null)} style={{ background: "none", border: "none", color: T.ink3, cursor: "pointer", fontSize: 11.5, textDecoration: "underline", fontFamily: "inherit" }}>
                      הצגת הכל
                    </button>
                  </div>
                )}
              </section>

              {/* המשימות שהושלמו — רשימה מרוכזת מתחת ללוח השנה (בקשה של אופיר) */}
              <section className="tj-card" style={{ ...card, padding: 16, marginTop: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: doneTasks.length > 0 ? 12 : 0 }}>
                  <span style={{ color: T.mint }}>{Ic.checkCircle(16)}</span>
                  <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, fontFamily: "var(--font-display)" }}>הושלמו</h2>
                  <span className="num" style={{ fontSize: 11.5, color: T.mint, background: T.mintSoft, borderRadius: 99, padding: "2px 9px" }}>
                    {doneTasks.length}
                  </span>
                </div>
                {doneTasks.length === 0 ? (
                  <div style={{ fontSize: 12, color: T.ink3, marginTop: 8 }}>
                    משימות שתסמנו כ&quot;הושלמו&quot; יעברו לכאן.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 7, maxHeight: 380, overflowY: "auto" }}>
                    {doneTasks.map((t) => (
                      <TaskRow key={t.id} task={t} cat={t.categoryId ? catById[t.categoryId] : undefined}
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

      {openRoot && (
        <TaskModal
          root={openRoot}
          isNew={openRoot.id === freshId}
          focusId={openTaskId!}
          categories={categories}
          onSave={saveTask}
          onDelete={deleteTask}
          onAddCategory={addCategory}
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

      <style>{`
        ::selection { background: rgba(61,126,255,0.4); }
        @media (max-width: 1290px) { .tj-toolbar { margin-inline: 12px !important; } }
        .tj-newbtn:hover .tj-newbtn-orb { transform: rotate(90deg) scale(1.08); }
        .tj-newbtn-orb { transition: transform .45s cubic-bezier(0.32,0.72,0,1); }
        .tj-catdel { opacity: 0; transition: opacity .15s; }
        .tj-catrow:hover .tj-catdel { opacity: 0.7; }
        .tj-card { transition: box-shadow .18s, transform .18s, border-color .18s; }
        input::placeholder, textarea::placeholder { color: #5E7089; }
        @media (max-width: 520px) { .tj-synctext { display: none; } }
        @media (max-width: 1180px) {
          .tj-dash-cols { flex-direction: column !important; }
          .tj-dash-cal { width: 100% !important; position: static !important; }
        }
        @media (max-width: 900px) {
          .tj-sidebar { display: none; }
          .tj-sidebar-toggle { display: flex !important; }
          .tj-layout { flex-direction: column; }
          .tj-layout > aside { width: 100% !important; position: static !important; }
          .tj-catdel { opacity: 0.7; }
          .tj-apply-mobile { display: flex !important; }
          .tj-search-live { display: flex !important; }
        }
        input[type="search"]::-webkit-search-cancel-button { -webkit-appearance: none; }
        @media (max-width: 640px) {
          /* פונט מתחת ל-16px גורם לזום אוטומטי של iOS בפוקוס על שדה */
          input, textarea, select { font-size: 16px !important; }
          .tj-toolbar { padding: 7px 8px !important; margin: 8px 8px 0 !important; top: 6px !important; }
          .tj-layout { padding: 10px 10px 40px !important; gap: 10px !important; }
          .tj-card { padding: 12px !important; }
          .tj-kpis { grid-template-columns: repeat(2,1fr) !important; }
          .tj-kpi-hero { grid-column: 1 / -1; }
          .tj-newbtn { flex: 1; justify-content: center; }
          .tj-calday { min-height: 52px !important; padding: 3px 3px !important; }
          .tj-calday button { font-size: 8.5px !important; padding: 1px 3px !important; }
        }
      `}</style>
    </div>
  );
}

function filteredCountByCat(tasks: Task[], catId: string): number {
  return flattenTasks(tasks).filter((t) => t.categoryId === catId && !isDone(t)).length;
}

// ============ pieces ============

function Header({ sync }: { sync: { icon: React.ReactNode; label: string; color: string } }) {
  return (
    <header style={{
      position: "relative",
      background: "linear-gradient(180deg, rgba(255,255,255,0.92), rgba(247,250,253,0.82))",
      backdropFilter: "saturate(1.4) blur(8px)",
      borderBottom: `1px solid ${T.line}`,
      padding: "11px 18px", display: "flex", alignItems: "center", gap: 12,
      boxShadow: "0 1px 0 rgba(255,255,255,0.7) inset, 0 6px 18px -14px rgba(23,43,77,0.5)",
    }}>
      <div style={{ position: "absolute", insetInline: 0, bottom: 0, height: 3, background: T.grad, opacity: 0.9 }} />
      <div style={{
        background: "#fff", borderRadius: 12, padding: "5px 8px", display: "flex", alignItems: "center",
        border: `1px solid ${T.line}`, boxShadow: T.shadowSm,
      }}>
        <Image src="/logo-histadrut.svg" alt="ההסתדרות" width={40} height={34}
          style={{ height: 32, width: "auto" }} />
      </div>
      <div style={{ lineHeight: 1.15 }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 17, color: "#F2554A", letterSpacing: "-0.02em" }}>
          ההסתדרות
        </div>
        <div style={{ fontSize: 10.5, color: T.ink2, fontWeight: 500 }}>
          הבית של העובדים בישראל
        </div>
      </div>
      <div style={{ width: 1, height: 30, background: `linear-gradient(${T.line}, transparent)`, marginInline: 6 }} />
      <div style={{ lineHeight: 1.2, minWidth: 0 }}>
        <div style={{
          fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 15.5,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          background: T.grad, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
        }}>
          יומן המשימות של אופיר
        </div>
        <div className="num" style={{ fontSize: 10, color: T.ink3, letterSpacing: "0.14em" }}>
          TASK JOURNAL
        </div>
      </div>
      <span style={{
        marginInlineStart: "auto", color: sync.color, display: "inline-flex", alignItems: "center", gap: 6,
        background: T.surface, border: `1px solid ${T.line}`, borderRadius: 99, padding: "5px 11px",
        fontSize: 11, fontWeight: 600, boxShadow: T.shadowSm,
      }} title={sync.label}>
        {sync.icon}<span className="tj-synctext">{sync.label}</span>
      </span>
    </header>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 7,
      fontSize: 10.5, fontWeight: 700, color: T.ink3, marginBottom: 9,
      letterSpacing: "0.06em", textTransform: "uppercase",
    }}>
      <span style={{ width: 3, height: 12, borderRadius: 99, background: T.grad }} />
      {children}
    </div>
  );
}

// אייקון בתוך צ'יפ צבעוני מדורג — נותן משקל ויזואלי לכותרות מקטעים
function IcChip({ icon, color, size = 30 }: { icon: React.ReactNode; color: string; size?: number }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: 9, flexShrink: 0,
      background: `linear-gradient(135deg, ${color}, ${color}C4)`, color: "#fff",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      boxShadow: `0 5px 14px -6px ${color}AA`,
    }}>{icon}</span>
  );
}

function NavBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      width: 28, height: 28, borderRadius: 8, border: `1px solid ${T.line}`,
      background: "transparent", cursor: "pointer", color: T.ink2,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
    }}>{children}</button>
  );
}

// KPI אחיד: לבן + כחול המותג; אדום מופיע רק כשיש באמת בעיה (alert)
function Kpi({ label, value, icon, alert }: { label: string; value: number; icon: React.ReactNode; alert?: boolean }) {
  const c = alert ? T.danger : T.accent;
  return (
    <div style={{ ...card, padding: "13px 15px", display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{
        width: 38, height: 38, borderRadius: 11, flexShrink: 0,
        background: alert ? T.dangerSoft : T.accentSoft, color: c,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div className="num tj-kpi-num" style={{ fontSize: 23, fontWeight: 800, lineHeight: 1.05, color: alert ? T.danger : T.ink }}>{value}</div>
        <div style={{ fontSize: 11, color: T.ink2, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      </div>
    </div>
  );
}

function Empty({ filtersActive, onCreate }: { filtersActive: boolean; onCreate: () => void }) {
  return (
    <div style={{ textAlign: "center", padding: "44px 20px", color: T.ink3 }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 12, color: T.ink3 }}>{Ic.layers(34)}</div>
      <div style={{ fontSize: 14, fontWeight: 500, color: T.ink2 }}>
        {filtersActive ? "אין משימות שתואמות את הסינון" : "היומן ריק — זה הזמן להתחיל"}
      </div>
      {!filtersActive && (
        <button onClick={onCreate} style={{
          marginTop: 14, display: "inline-flex", alignItems: "center", gap: 7,
          background: T.grad, color: "#fff", border: "none",
          borderRadius: 10, padding: "9px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer",
          fontFamily: "var(--font-display)",
        }}>{Ic.plus(14)} משימה ראשונה</button>
      )}
    </div>
  );
}

export function TaskRow({ task, cat, onOpen, onCycle, critical, compact, todayKey }: {
  task: Task;
  cat?: TaskCategory;
  onOpen: () => void;
  onCycle: () => void;
  critical?: boolean;
  compact?: boolean;
  todayKey: string;
}) {
  const sub = countSubtasks(task);
  const done = isDone(task);
  const overdue = !done && task.dueDate && task.dueDate < todayKey;
  const accent = critical ? T.danger : (cat?.color ?? T.ink3);

  return (
    <div
      data-task-row
      onClick={onOpen}
      style={{
        display: "flex", alignItems: "center", gap: 11, cursor: "pointer",
        background: T.bg2, border: "1px solid transparent",
        borderInlineStart: `3px solid ${accent}`,
        borderRadius: 13, padding: compact ? "9px 12px" : "11px 13px",
        opacity: done ? 0.55 : 1,
        transition: "border-color .35s cubic-bezier(0.32,0.72,0,1), background .35s cubic-bezier(0.32,0.72,0,1)",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = T.surface2; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = T.bg2; }}
    >
      <button
        title={`סטטוס: ${STATUS_LABELS[task.status]} (לחיצה מקדמת)`}
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
        <StatusIcon status={task.status} size={18} />
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
          <span className="num" style={{ fontSize: 10, color: T.ink3, flexShrink: 0 }}>
            נפתחה {formatDateHe(task.createdAt)}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 5, flexWrap: "wrap" }}>
          {task.critical && (
            <Meta color={T.danger}>{Ic.flame(11)} קריטית</Meta>
          )}
          {cat && (
            <Meta color={cat.color}>
              <span style={{ width: 7, height: 7, borderRadius: 2.5, background: cat.color }} />
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
          if (day === null) return <div key={i} className="tj-calday" style={{ minHeight: 72, borderRadius: 10 }} />;
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
                minHeight: 72, borderRadius: 10, padding: "4px 5px", cursor: "pointer",
                background: isSelected ? T.mintSoft : T.bg2,
                border: `1px solid ${isSelected ? `${alpha(T.mint, 40)}` : isToday ? T.accent : "transparent"}`,
                display: "flex", flexDirection: "column", gap: 3, overflow: "hidden",
              }}
            >
              <span className="num" style={{
                fontSize: 10.5, fontWeight: isToday ? 700 : 400,
                color: isToday ? T.accent : T.ink3,
              }}>
                {day}
              </span>
              {dayTasks.slice(0, 3).map((t) => {
                const c = t.categoryId ? catById[t.categoryId]?.color : undefined;
                const col = t.critical ? T.danger : (c ?? T.accent);
                return (
                  <button
                    key={t.id}
                    onClick={(e) => { e.stopPropagation(); onOpenTask(t.id); }}
                    title={t.title}
                    style={{
                      display: "block", width: "100%", textAlign: "start",
                      background: `${col}26`, color: mixToInk(col), border: "none",
                      borderInlineStart: `2.5px solid ${col}`,
                      borderRadius: 5, padding: "2px 5px", fontSize: 9.5, fontWeight: 500,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      cursor: "pointer", fontFamily: "inherit",
                      textDecoration: isDone(t) ? "line-through" : "none",
                    }}
                  >
                    {t.title || "ללא שם"}
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
function mixToInk(hex: string): string {
  return `color-mix(in srgb, ${hex} 62%, var(--tj-chipmix))`;
}

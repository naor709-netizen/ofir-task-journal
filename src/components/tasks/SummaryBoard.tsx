"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useToast } from "@/components/Toast";
import {
  type Task, type TaskCategory, type TaskStatus,
  STATUS_LABELS, isDone, toDateKey, countSubtasks, findTaskInTree, sharedPartners,
} from "@/lib/tasks";
import {
  subscribeTeamData, getTeamData, getServerTeamData, initTeamData,
  patchJournalTask, upsertJournalRoot, deleteJournalRoot, addJournalCategory,
} from "@/lib/team";
import { firstName, type PersonColor } from "@/lib/journals";
import { T, alpha, card, Ic, Avatar, primaryBtn, ghostBtn, inputStyle, IconChip, Toggle } from "./ui";
import { TaskModal } from "./TaskModal";
import { AssignDialog, type Person } from "./TeamView";

// ============================================
// בורד — עמוד סיכום בסגנון מונדיי:
// טבלת סיכום (שורה לכל אדם) + קבוצה לכל אדם עם כל המשימות בטבלה,
// עמודת סטטוס צבעונית שמשנים בלחיצה, וסרגל סיכום מתחת לכל קבוצה.
// אופיר רואה את כל הצוות; איש צוות רואה את שלו ואת המשימות ששותפו איתו.
// ============================================

type PersonLite = { id: string; name: string; color: PersonColor; role?: string };

type Group = {
  key: string;
  person: PersonLite;
  title: string;
  sub?: string;
  jid: string; // היומן שבו נשמרות המשימות של הקבוצה
  source: "own" | "remote"; // own = היומן הפתוח (מאגר היומן), remote = יומן של איש צוות (מאגר הצוות)
  tasks: Task[];
  cats: Record<string, TaskCategory>;
  add: "own" | "assign" | null;
};

// ---- צבעי מונדיי (לבקשת המשתמש, 19.11.2026) — רק בבורד ----
// סטטוס: ירוק "הושלם", כתום "בתהליך", אפור "לביצוע" — כמו התוויות של מונדיי, טקסט לבן מודגש.
const MONDAY_STATUS: Record<TaskStatus, { bg: string; fg: string }> = {
  done: { bg: "#00C875", fg: "#fff" },
  in_progress: { bg: "#FDAB3D", fg: "#fff" },
  todo: { bg: "#C4C4C4", fg: "#323338" }, // על האפור הבהיר — טקסט כהה, כדי שיהיה קריא
};
const MONDAY_RED = "#E2445C"; // "תקוע" של מונדיי — לתאריך שעבר
const statusBg = (s: TaskStatus) => MONDAY_STATUS[s].bg;
const statusFg = (s: TaskStatus) => MONDAY_STATUS[s].fg;
// צבע הקבוצה לפי הצבע האישי — בגוונים של מונדיי
const GROUP_COLOR: Record<PersonColor, string> = {
  blue: "#579BFC", teal: "#00C875", orange: "#FDAB3D", fuchsia: "#FF158A", rose: "#E2445C", violet: "#A25DDC",
};
const dm = (k: string) => `${parseInt(k.slice(8, 10), 10)}.${parseInt(k.slice(5, 7), 10)}`;
const catMap = (cats: TaskCategory[] | undefined) => Object.fromEntries((cats ?? []).map((c) => [c.id, c]));

function shift(todayKey: string, n: number): string {
  const d = new Date(`${todayKey}T12:00:00`);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

function statsOf(tasks: Task[], todayKey: string) {
  const weekAgo = shift(todayKey, -6);
  const open = tasks.filter((t) => !isDone(t));
  return {
    total: tasks.length,
    open: open.length,
    todo: open.filter((t) => t.status === "todo").length,
    inProgress: open.filter((t) => t.status === "in_progress").length,
    overdue: open.filter((t) => t.dueDate && t.dueDate < todayKey).length,
    critical: open.filter((t) => t.critical).length,
    done: tasks.length - open.length,
    doneWeek: tasks.filter((t) => isDone(t) && t.endDate && t.endDate >= weekAgo).length,
  };
}

// סדר בתוך קבוצה: פתוחות קודם (באיחור ← קריטיות ← בתהליך ← לפי תאריך יעד), שהושלמו בסוף
function sortTasks(list: Task[], todayKey: string): Task[] {
  const rank = (t: Task) => (isDone(t) ? 9 : t.dueDate && t.dueDate < todayKey ? 0 : t.critical ? 1 : t.status === "in_progress" ? 2 : 3);
  return [...list].sort((a, b) =>
    rank(a) - rank(b) ||
    (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
    b.createdAt.localeCompare(a.createdAt));
}

// סרגל "סוללה" — חלוקת הסטטוסים בקבוצה, כמו במונדיי
function Battery({ s, width = "100%", height = 10 }: { s: ReturnType<typeof statsOf>; width?: number | string; height?: number }) {
  const parts: { k: TaskStatus; n: number }[] = [
    { k: "done", n: s.done }, { k: "in_progress", n: s.inProgress }, { k: "todo", n: s.todo },
  ].filter((p) => p.n > 0) as { k: TaskStatus; n: number }[];
  const label = `${s.done} הושלמו · ${s.inProgress} בתהליך · ${s.todo} לביצוע`;
  return (
    <span role="img" aria-label={label} title={label} style={{
      display: "flex", gap: 2, width, height, borderRadius: 99, overflow: "hidden", background: T.surface2, flexShrink: 0,
    }}>
      {parts.map((p) => (
        <span key={p.k} style={{ flex: p.n, background: statusBg(p.k), minWidth: 4 }} />
      ))}
    </span>
  );
}

export function SummaryBoard({
  journalId, isManager, people, myTasks, myCats, todayKey, labelOf,
  onOpenOwn, onSetOwnStatus, onCreate, onCreateShared,
}: {
  journalId: string;
  isManager: boolean;
  people: PersonLite[]; // כולם, כולל אופיר
  myTasks: Task[];
  myCats: Record<string, TaskCategory>;
  todayKey: string;
  labelOf: (t: Task) => string | null;
  onOpenOwn: (id: string) => void;
  onSetOwnStatus: (t: Task, s: TaskStatus) => void;
  onCreate: () => void;
  onCreateShared: () => void;
}) {
  const { toast } = useToast();
  const team = useSyncExternalStore(subscribeTeamData, getTeamData, getServerTeamData);
  useEffect(() => { if (isManager) initTeamData(); }, [isManager]);

  const [query, setQuery] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState<string | null>(null); // `${group}:${task}`
  const [openRemote, setOpenRemote] = useState<{ jid: string; taskId: string } | null>(null);
  const [assignTo, setAssignTo] = useState<string | null>(null);

  // סגירת בורר הסטטוס בלחיצה בחוץ / Escape
  useEffect(() => {
    if (!picker) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent && (e.target as HTMLElement)?.closest?.("[data-picker]")) return;
      setPicker(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [picker]);

  const me = people.find((p) => p.id === journalId) ?? { id: journalId, name: "אני", color: "blue" as PersonColor };
  const members = people.filter((p) => p.id !== journalId);

  const groups: Group[] = useMemo(() => {
    const out: Group[] = [{
      key: journalId, person: me, title: me.name, sub: isManager ? "מנהל" : undefined, jid: journalId, source: "own",
      tasks: myTasks.filter((t) => !t.ownerId), cats: myCats, add: "own",
    }];
    if (isManager) {
      for (const m of members) {
        const slice = team.journals[m.id];
        out.push({
          key: m.id, person: m, title: m.name, sub: m.role, jid: m.id, source: "remote",
          tasks: (slice?.tasks ?? []).filter((t) => !t.ownerId), cats: catMap(slice?.categories), add: "assign",
        });
      }
    } else {
      // איש צוות: משימות ששותפו איתו — קבוצה לכל מי שיצר אותן
      const byOwner = new Map<string, Task[]>();
      for (const t of myTasks) if (t.ownerId) byOwner.set(t.ownerId, [...(byOwner.get(t.ownerId) ?? []), t]);
      for (const [owner, list] of byOwner) {
        const p = people.find((x) => x.id === owner) ?? { id: owner, name: "אחר", color: "teal" as PersonColor };
        out.push({ key: `sh-${owner}`, person: p, title: `משותפות מ${firstName(p.name)}`, jid: journalId, source: "own", tasks: list, cats: myCats, add: null });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journalId, isManager, myTasks, myCats, team.journals, people]);

  const q = query.trim().toLowerCase();
  const matches = (t: Task, cats: Record<string, TaskCategory>) =>
    !q || [t.title, t.description, t.categoryId ? cats[t.categoryId]?.name : ""].some((x) => (x ?? "").toLowerCase().includes(q));

  const remoteLoading = isManager && !team.loaded;

  function setStatus(g: Group, t: Task, s: TaskStatus) {
    setPicker(null);
    if (s === t.status) return;
    if (g.source === "own") return onSetOwnStatus(t, s);
    patchJournalTask(g.jid, t.id, { status: s, endDate: s === "done" ? t.endDate ?? todayKey : t.endDate })
      .then(() => toast(`עודכן ביומן של ${firstName(g.person.name)}: ${STATUS_LABELS[s]}`, "success"))
      .catch(() => toast("השמירה נכשלה", "error"));
  }

  function open(g: Group, t: Task) {
    if (g.source === "own") onOpenOwn(t.id);
    else setOpenRemote({ jid: g.jid, taskId: t.id });
  }

  const remoteRoot = openRemote
    ? (team.journals[openRemote.jid]?.tasks ?? []).find((r) => r.id === openRemote.taskId || findTaskInTree(r.subtasks, openRemote.taskId)) ?? null
    : null;

  const allStats = statsOf(groups.flatMap((g) => g.tasks), todayKey);
  const scrollTo = (key: string) => document.getElementById(`tj-bg-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="tj-board" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ===== כותרת + פעולות ===== */}
      <section className="tj-card" style={{ ...card, padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <IconChip pal="plum" size={40} radius={13}>{Ic.rows(18)}</IconChip>
          <div style={{ flex: "1 1 220px", minWidth: 0 }}>
            <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, letterSpacing: "-0.02em" }}>בורד</h2>
            <div style={{ fontSize: 12.5, color: T.ink2, marginTop: 2 }}>
              {isManager ? "כל המשימות של כל הצוות במקום אחד — מי עושה מה, ומה המצב" : "המשימות שלך והמשימות ששותפו איתך, במקום אחד"}
            </div>
          </div>
          <div className="tj-board-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={onCreateShared} style={{ ...ghostBtn, height: 38, padding: "0 14px", fontSize: 13 }}>{Ic.share(14)} משימה משותפת</button>
            <button onClick={onCreate} style={{ ...primaryBtn, height: 38, padding: "0 16px", fontSize: 13 }}>{Ic.plus(14)} משימה חדשה</button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
          <label style={{ position: "relative", flex: "1 1 240px", display: "flex" }}>
            <span style={{ position: "absolute", insetInlineStart: 12, top: "50%", transform: "translateY(-50%)", color: T.ink3, display: "inline-flex" }}>{Ic.search(15)}</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש בבורד…" aria-label="חיפוש בבורד"
              style={{ ...inputStyle, width: "100%", height: 40, paddingInlineStart: 36 }} />
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: T.ink2, cursor: "pointer" }}>
            <Toggle on={showDone} onChange={setShowDone} label="הצגת משימות שהושלמו" />
            הצגת שהושלמו
          </label>
        </div>
      </section>

      {/* ===== טבלת סיכום ===== */}
      <section className="tj-card" style={{ ...card, padding: 0, overflow: "hidden" }} aria-label="סיכום">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px 10px" }}>
          <IconChip pal="lavender" size={30} radius={10}>{Ic.chart(15)}</IconChip>
          <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 15.5 }}>סיכום</h3>
          <span style={{ fontSize: 12, color: T.ink3 }}>
            <span className="num">{allStats.open}</span> פתוחות · <span className="num">{allStats.doneWeek}</span> הושלמו השבוע
          </span>
        </div>
        <div role="table" aria-label="סיכום לפי אדם" className="tj-sum">
          <div role="row" className="tj-sum-row tj-sum-head">
            <span role="columnheader">שם</span>
            <span role="columnheader">פתוחות</span>
            <span role="columnheader">בתהליך</span>
            <span role="columnheader">באיחור</span>
            <span role="columnheader" className="tj-sum-hide">קריטיות</span>
            <span role="columnheader">הושלמו השבוע</span>
            <span role="columnheader" className="tj-sum-hide">התקדמות</span>
          </div>
          {groups.map((g) => {
            const s = statsOf(g.tasks, todayKey);
            const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
            const loading = g.source === "remote" && remoteLoading;
            return (
              <div key={g.key} role="row" className="tj-sum-row" onClick={() => scrollTo(g.key)}
                style={{ boxShadow: `inset -5px 0 0 ${GROUP_COLOR[g.person.color]}` }}>
                <span role="cell" style={{ minWidth: 0 }}>
                  <button onClick={(e) => { e.stopPropagation(); scrollTo(g.key); }} aria-label={`מעבר למשימות של ${g.title}`} style={{
                    all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 9, minWidth: 0, maxWidth: "100%",
                  }}>
                    <Avatar name={g.person.name} color={g.person.color} size={28} />
                    <span style={{ minWidth: 0, textAlign: "start" }}>
                      <span style={{ display: "block", fontWeight: 700, fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.title}</span>
                      {g.sub && <span style={{ display: "block", fontSize: 11, color: T.ink3 }}>{g.sub}</span>}
                    </span>
                  </button>
                </span>
                {loading ? (
                  <span role="cell" style={{ gridColumn: "2 / -1" }}><span className="tj-skel" style={{ display: "block", height: 14, borderRadius: 6 }} /></span>
                ) : (
                  <>
                    <span role="cell" className="num tj-sum-n">{s.open}</span>
                    <span role="cell" className="num tj-sum-n" style={{ color: s.inProgress ? "#E8940F" : T.ink3 }}>{s.inProgress}</span>
                    <span role="cell" className="num tj-sum-n" style={{ color: s.overdue ? MONDAY_RED : T.ink3, fontWeight: s.overdue ? 800 : 600 }}>{s.overdue}</span>
                    <span role="cell" className="num tj-sum-n tj-sum-hide" style={{ color: s.critical ? MONDAY_RED : T.ink3 }}>{s.critical}</span>
                    <span role="cell" className="num tj-sum-n" style={{ color: s.doneWeek ? "#00A35E" : T.ink3 }}>{s.doneWeek}</span>
                    <span role="cell" className="tj-sum-hide" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Battery s={s} width={110} height={9} />
                      <span className="num" style={{ fontSize: 12, fontWeight: 700, color: T.ink2, minWidth: 34 }}>{pct}%</span>
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ===== קבוצות — אחת לכל אדם ===== */}
      {groups.map((g) => {
        const s = statsOf(g.tasks, todayKey);
        const visible = sortTasks(g.tasks.filter((t) => (showDone || !isDone(t)) && matches(t, g.cats)), todayKey);
        const hiddenDone = showDone ? 0 : g.tasks.filter((t) => isDone(t) && matches(t, g.cats)).length;
        const isCollapsed = collapsed.has(g.key);
        const loading = g.source === "remote" && remoteLoading;
        return (
          <section key={g.key} id={`tj-bg-${g.key}`} className="tj-card tj-bgroup" style={{ ...card, padding: 0, overflow: "visible", scrollMarginTop: 80 }}>
            <header style={{
              display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: isCollapsed ? "none" : `1px solid ${T.line}`,
              borderRadius: isCollapsed ? 20 : "20px 20px 0 0",
            }}>
              <button onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })}
                aria-expanded={!isCollapsed} aria-label={isCollapsed ? `הצגת ${g.title}` : `כיווץ ${g.title}`} style={{
                  width: 30, height: 30, borderRadius: 99, border: `1px solid ${alpha(GROUP_COLOR[g.person.color], 45)}`, background: T.surface, color: GROUP_COLOR[g.person.color], cursor: "pointer",
                  display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  transform: isCollapsed ? "rotate(90deg)" : "none", transition: "transform .2s var(--ease-out)",
                }}>{Ic.chevD(14)}</button>
              <Avatar name={g.person.name} color={g.person.color} size={32} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 17, color: GROUP_COLOR[g.person.color], whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.title}</h3>
                <div style={{ fontSize: 11.5, color: T.ink3 }}>
                  <span className="num">{s.open}</span> פתוחות
                  {s.overdue > 0 && <> · <span style={{ color: T.danger, fontWeight: 700 }}><span className="num">{s.overdue}</span> באיחור</span></>}
                  {g.sub && <> · {g.sub}</>}
                </div>
              </div>
              <span className="tj-bg-battery"><Battery s={s} width={120} height={8} /></span>
            </header>

            {!isCollapsed && (
              <div role="table" aria-label={`המשימות של ${g.title}`} style={{ ["--grp" as string]: GROUP_COLOR[g.person.color] }}>
                <div role="row" className="tj-brow tj-bhead">
                  <span role="columnheader">משימה</span>
                  <span role="columnheader">סטטוס</span>
                  <span role="columnheader">יעד</span>
                  <span role="columnheader" className="tj-bcol-cat">קטגוריה</span>
                  <span role="columnheader" className="tj-bcol-pri">עדיפות</span>
                  <span role="columnheader" className="tj-bcol-sh">משותפת</span>
                </div>
                {loading ? (
                  <div style={{ padding: 14, display: "grid", gap: 8 }}>
                    <div className="tj-skel" style={{ height: 40 }} /><div className="tj-skel" style={{ height: 40 }} />
                  </div>
                ) : visible.length === 0 ? (
                  <div style={{ padding: "16px 16px", fontSize: 12.5, color: T.ink3 }}>
                    {q ? "אין משימות שתואמות את החיפוש." : g.tasks.length ? "אין משימות פתוחות — הכל הושלם." : "אין משימות עדיין."}
                  </div>
                ) : visible.map((t) => {
                  const done = isDone(t);
                  const overdue = !done && !!t.dueDate && t.dueDate < todayKey;
                  const cat = t.categoryId ? g.cats[t.categoryId] : undefined;
                  const sub = countSubtasks(t);
                  const viewer = g.source === "remote" ? g.jid : journalId;
                  const partners = sharedPartners(t, viewer).map((id) => people.find((p) => p.id === id)).filter((p): p is PersonLite => !!p);
                  const pk = `${g.key}:${t.id}`;
                  return (
                    <div key={t.id} role="row" className="tj-brow" data-done={done || undefined}>
                      <span role="cell" className="tj-bcell-title">
                        <button onClick={() => open(g, t)} style={{
                          all: "unset", cursor: "pointer", display: "block", minWidth: 0, width: "100%",
                        }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13.5, fontWeight: 600, color: T.ink, minWidth: 0, opacity: done ? 0.65 : 1 }}>
                            {t.critical && !done && <span className="tj-bflame" aria-label="קריטית" style={{ color: T.danger, display: "none", flexShrink: 0 }}>{Ic.flame(12)}</span>}
                            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: done ? "line-through" : "none" }}>{t.title || "ללא שם"}</span>
                          </span>
                          {(sub.total > 0 || t.assignedBy) && (
                            <span style={{ display: "flex", gap: 8, fontSize: 11, color: T.ink3, marginTop: 1 }}>
                              {sub.total > 0 && <span>שלבים <span className="num">{sub.done}/{sub.total}</span></span>}
                              {t.assignedBy && <span style={{ color: T.accent, fontWeight: 600 }}>הוקצתה ע״י המנהל</span>}
                            </span>
                          )}
                        </button>
                      </span>
                      <span role="cell" className="tj-bcell-status" style={{ position: "relative" }} data-picker>
                        <button onClick={() => setPicker(picker === pk ? null : pk)} aria-haspopup="menu" aria-expanded={picker === pk}
                          aria-label={`סטטוס: ${STATUS_LABELS[t.status]} — לשינוי`} style={{
                            width: "100%", height: 32, borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "inherit",
                            background: statusBg(t.status), color: statusFg(t.status), fontSize: 12.5, fontWeight: 700,
                          }}>
                          {STATUS_LABELS[t.status]}
                        </button>
                        {picker === pk && (
                          <span role="menu" style={{
                            position: "absolute", top: 36, insetInlineStart: 0, zIndex: 30, minWidth: 150, padding: 6,
                            background: T.surface, border: `1px solid ${T.lineStrong}`, borderRadius: 12, boxShadow: T.shadowMd,
                            display: "grid", gap: 4,
                          }}>
                            {(["todo", "in_progress", "done"] as TaskStatus[]).map((st) => (
                              <button key={st} role="menuitemradio" aria-checked={t.status === st} onClick={() => setStatus(g, t, st)} style={{
                                height: 34, borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "inherit",
                                background: statusBg(st), color: statusFg(st), fontSize: 12.5, fontWeight: 700,
                                outline: t.status === st ? `2px solid ${T.ink}` : "none", outlineOffset: 1,
                              }}>{STATUS_LABELS[st]}</button>
                            ))}
                          </span>
                        )}
                      </span>
                      <span role="cell" className="tj-bcell-due num" style={{ fontSize: 12.5, whiteSpace: "nowrap", color: overdue ? MONDAY_RED : t.dueDate ? T.ink2 : T.ink3, fontWeight: overdue ? 700 : 500 }}>
                        {t.dueDate ? dm(t.dueDate) : "—"}
                        {overdue && <span className="tj-bdue-tag" style={{ fontFamily: "inherit" }}> · באיחור</span>}
                      </span>
                      <span role="cell" className="tj-bcol-cat tj-bcell-cat" style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, fontSize: 12.5, color: T.ink2 }}>
                        {cat ? (
                          <>
                            <span style={{ width: 8, height: 8, borderRadius: 99, background: cat.color, flexShrink: 0 }} />
                            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cat.name}</span>
                          </>
                        ) : <span style={{ color: T.ink3 }}>—</span>}
                      </span>
                      <span role="cell" className="tj-bcol-pri tj-bcell-pri">
                        {t.critical ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 24, padding: "0 9px", borderRadius: 99, background: T.dangerSoft, color: T.danger, fontSize: 11.5, fontWeight: 700 }}>
                            {Ic.flame(11)} קריטית
                          </span>
                        ) : <span style={{ color: T.ink3, fontSize: 12.5 }}>—</span>}
                      </span>
                      <span role="cell" className="tj-bcol-sh tj-bcell-sh" title={labelOf(t) ?? (partners.length ? `משותפת עם ${partners.map((p) => firstName(p.name)).join(" ו")}` : undefined)}>
                        {partners.length ? (
                          <span style={{ display: "inline-flex" }} aria-label={`משותפת עם ${partners.map((p) => p.name).join(", ")}`}>
                            {partners.slice(0, 3).map((p, i) => (
                              <span key={p.id} style={{ marginInlineStart: i ? -7 : 0, borderRadius: 99, boxShadow: "0 0 0 2px var(--tj-surface)", display: "inline-flex" }}>
                                <Avatar name={p.name} color={p.color} size={24} />
                              </span>
                            ))}
                          </span>
                        ) : <span style={{ color: T.ink3, fontSize: 12.5 }}>—</span>}
                      </span>
                    </div>
                  );
                })}

                {/* תחתית הקבוצה: הוספה + סיכום */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 14px 12px", borderTop: `1px solid ${T.line}` }}>
                  {g.add === "own" && (
                    <button onClick={onCreate} style={{ ...ghostBtn, height: 34, padding: "0 12px", fontSize: 12.5, border: "none", color: T.accent }}>
                      {Ic.plus(13)} הוספת משימה
                    </button>
                  )}
                  {g.add === "assign" && (
                    <button onClick={() => setAssignTo(g.jid)} style={{ ...ghostBtn, height: 34, padding: "0 12px", fontSize: 12.5, border: "none", color: T.accent }}>
                      {Ic.send(13)} הקצאת משימה ל{firstName(g.person.name)}
                    </button>
                  )}
                  {hiddenDone > 0 && (
                    <button onClick={() => setShowDone(true)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, color: T.ink3 }}>
                      ועוד <span className="num">{hiddenDone}</span> שהושלמו
                    </button>
                  )}
                  <span style={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: T.ink3 }}>
                    <Battery s={s} width={140} height={10} />
                    <span><span className="num">{s.done}</span>/<span className="num">{s.total}</span> הושלמו</span>
                  </span>
                </div>
              </div>
            )}
          </section>
        );
      })}

      {openRemote && remoteRoot && (
        <TaskModal
          root={remoteRoot}
          focusId={openRemote.taskId}
          categories={team.journals[openRemote.jid]?.categories ?? []}
          onSave={(updated) => { upsertJournalRoot(openRemote.jid, updated).catch(() => toast("השמירה נכשלה", "error")); }}
          onDelete={(id) => {
            if (id === remoteRoot.id) deleteJournalRoot(openRemote.jid, id);
            setOpenRemote(null);
            toast("המשימה נמחקה", "info");
          }}
          onAddCategory={(name, color) => addJournalCategory(openRemote.jid, name, color)}
          share={{ journalId: openRemote.jid, people, canEdit: true }}
          onClose={() => setOpenRemote(null)}
        />
      )}
      {assignTo && (
        <AssignDialog
          people={members.map((m): Person => ({ ...m, isManager: false }))}
          initial={assignTo}
          todayKey={todayKey}
          onClose={() => setAssignTo(null)}
          onAssigned={(p, t) => { setAssignTo(null); toast(`נשלח ל${p.name}: ${t.title}`, "success"); }}
        />
      )}

      <style>{`
        .tj-sum { display: block; }
        .tj-sum-row {
          display: grid; grid-template-columns: minmax(150px, 1.6fr) repeat(3, minmax(56px, .6fr)) minmax(56px, .6fr) minmax(76px, .7fr) minmax(150px, 1.2fr);
          align-items: center; gap: 10px; padding: 9px 16px; width: 100%;
          border: none; border-top: 1px solid var(--tj-line); background: transparent; color: var(--tj-ink);
          font-family: inherit; text-align: start; cursor: pointer;
        }
        .tj-sum-row:not(.tj-sum-head):hover { background: var(--tj-bg2); }
        .tj-sum-head { cursor: default; font-size: 11.5px; font-weight: 700; color: var(--tj-ink3); padding-top: 8px; padding-bottom: 8px; background: var(--tj-bg2); }
        .tj-sum-n { font-size: 15px; font-weight: 700; }
        .tj-brow {
          display: grid; grid-template-columns: minmax(0, 1fr) 128px 112px 140px 92px 92px;
          align-items: center; gap: 10px; padding: 7px 14px; border-top: 1px solid var(--tj-line);
        }
        .tj-brow:first-child { border-top: none; }
        /* כמו במונדיי: פס בצבע הקבוצה בתחילת כל שורה */
        .tj-brow:not(.tj-bhead) { box-shadow: inset -6px 0 0 var(--grp, transparent); }
        .tj-brow:not(.tj-bhead):hover { background: var(--tj-bg2); }
        .tj-bhead { font-size: 11.5px; font-weight: 700; color: var(--tj-ink3); padding-top: 8px; padding-bottom: 8px; }
        .tj-bdue-tag { font-size: 11px; }
        @media (max-width: 1180px) { .tj-bcol-cat { display: none !important; } .tj-brow { grid-template-columns: minmax(0, 1fr) 124px 112px 92px 84px; } }
        @media (max-width: 900px) { .tj-sum-hide { display: none !important; } .tj-sum-row { grid-template-columns: minmax(120px, 1.6fr) repeat(4, minmax(48px, .6fr)); } }
        /* טלפון: כל משימה ככרטיס קומפקטי — שם וסטטוס בשורה, הפרטים מתחת */
        @media (max-width: 760px) {
          .tj-bhead { display: none !important; }
          .tj-brow {
            grid-template-columns: minmax(0, 1fr) 112px; gap: 4px 10px; padding: 10px 12px;
            grid-template-areas: "title status" "meta status";
          }
          .tj-bcell-title { grid-area: title; }
          .tj-bcell-status { grid-area: status; }
          .tj-bcell-due, .tj-bcell-cat, .tj-bcell-pri, .tj-bcell-sh { grid-area: meta; }
          .tj-brow > .tj-bcell-due { justify-self: start; }
          .tj-brow > .tj-bcol-pri, .tj-brow > .tj-bcol-sh { display: none !important; }
          .tj-bg-battery { display: none; }
          .tj-bflame { display: inline-flex !important; }
          .tj-sum-row { padding: 9px 12px; gap: 6px; }
          .tj-board-actions { width: 100%; }
          .tj-board-actions > button { flex: 1; }
        }
      `}</style>
    </div>
  );
}

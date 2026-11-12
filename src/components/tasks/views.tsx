"use client";

import { useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { Flip } from "gsap/Flip";
import { useGSAP } from "@gsap/react";
import {
  type Task, type TaskCategory, type TaskStatus,
  isDone, flattenTasks, countSubtasks, formatDateHe, toDateKey,
  STATUS_LABELS, STATUS_COLORS, NATURE_LABELS, NATURE_COLORS,
  HE_WEEKDAYS, HE_WEEKDAYS_FULL,
} from "@/lib/tasks";
import { T, card, alpha, Ic, StatusIcon, IconChip, type Pal } from "./ui";
import { Donut, Legend, DayBars, DayBarsLegend, Columns, SplitBars, Heatmap } from "./charts";

gsap.registerPlugin(Flip, useGSAP);

// צבעי הגרפים — מלוח הצבעים (נבדקו ב-validate_palette: הפרדה גם לעיוורי צבעים).
// הבהירים מקבלים קו מתאר ומספרים/מקרא, כי על לבן הם מתחת ל-3:1. טקסט נשאר ב-STATUS_COLORS.
const STATUS_FILL: Record<TaskStatus, string> = {
  todo: "var(--pal-purple)",
  in_progress: "var(--pal-blue)",
  done: "var(--pal-lime)",
};
const HEAT_FILLS = [alpha("var(--tj-ink3)", 11), "var(--heat-1)", "var(--heat-2)", "var(--heat-3)", "var(--heat-4)"];

interface ViewProps {
  roots: Task[];
  catById: Record<string, TaskCategory>;
  todayKey: string;
  onOpen: (id: string) => void;
}

function SectionCard({ title, icon, badge, children, extra, pal = "blue" }: {
  title: string; icon: React.ReactNode; badge?: React.ReactNode; children: React.ReactNode; extra?: React.ReactNode; pal?: Pal;
}) {
  return (
    <section className="tj-card" style={{ ...card, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <IconChip pal={pal} size={32}>{icon}</IconChip>
        <h2 style={{ margin: 0, fontSize: 15.5, fontWeight: 800, fontFamily: "var(--font-display)", letterSpacing: "-0.015em" }}>{title}</h2>
        {badge}
        {extra}
      </div>
      {children}
    </section>
  );
}

function MiniCard({ t, cat, todayKey, onOpen }: { t: Task; cat?: TaskCategory; todayKey: string; onOpen: (id: string) => void }) {
  const done = isDone(t);
  const overdue = !done && t.dueDate && t.dueDate < todayKey;
  return (
    <div onClick={() => onOpen(t.id)} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(t.id); }}
      style={{
      background: t.critical ? alpha(T.danger, 6) : T.surface,
      boxShadow: `inset 0 0 0 1px ${t.critical ? alpha(T.danger, 22) : T.line}`,
      borderRadius: 11, padding: "8px 10px", cursor: "pointer",
      opacity: done ? 0.55 : 1,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: STATUS_COLORS[t.status], display: "inline-flex", flexShrink: 0 }}>
          <StatusIcon status={t.status} size={13} />
        </span>
        <span style={{
          fontSize: 12, fontWeight: 600, color: T.ink, minWidth: 0,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          textDecoration: done ? "line-through" : "none",
        }}>{t.title || "ללא שם"}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
        {t.critical && <span style={{ color: T.danger, display: "inline-flex" }}>{Ic.flame(10)}</span>}
        {(t.ownerId || t.sharedWith?.length) && <span title="משימה משותפת" aria-label="משימה משותפת" style={{ color: T.ink3, display: "inline-flex" }}>{Ic.users(11)}</span>}
        {cat && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9.5, color: T.ink2 }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: cat.color }} />{cat.name}
          </span>
        )}
        {t.dueDate && (
          <span className="num" style={{ fontSize: 9.5, color: overdue ? T.danger : T.ink3 }}>
            {formatDateHe(t.dueDate)}{overdue ? " · באיחור" : ""}
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================
// WeekView — אג'נדה שבועית
// ============================================

export function WeekView({ roots, catById, todayKey, onOpen }: ViewProps) {
  const all = useMemo(() => roots.flatMap((r) => [r, ...flattenTasks(r.subtasks)]), [roots]);

  const days = useMemo(() => {
    const out: { key: string; date: Date }[] = [];
    const base = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      out.push({ key, date: d });
    }
    return out;
  }, []);

  const overdue = all.filter((t) => !isDone(t) && t.dueDate && t.dueDate < todayKey)
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {overdue.length > 0 && (
        <SectionCard title="באיחור" icon={Ic.alert(16)} pal="crimson"
          badge={<span className="num" style={{ fontSize: 11.5, color: T.danger, background: T.dangerSoft, borderRadius: 99, padding: "2px 9px" }}>{overdue.length}</span>}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 8 }}>
            {overdue.map((t) => (
              <MiniCard key={t.id} t={t} cat={t.categoryId ? catById[t.categoryId] : undefined} todayKey={todayKey} onOpen={onOpen} />
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard title="שבעת הימים הקרובים" icon={Ic.week(16)} pal="blue">
        <div className="tj-week" style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 8 }}>
          {days.map(({ key, date }, i) => {
            const dayTasks = all.filter((t) => t.dueDate === key);
            const isToday = key === todayKey;
            return (
              <div key={key} style={{
                background: isToday ? T.accentSoft : T.bg2, borderRadius: 14, padding: 8, minHeight: 120,
                boxShadow: isToday ? `inset 0 0 0 1.5px ${T.accent}` : "none",
                display: "flex", flexDirection: "column", gap: 6,
              }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: isToday ? T.accent : T.ink2 }}>
                    {i === 0 ? "היום" : i === 1 ? "מחר" : HE_WEEKDAYS_FULL[date.getDay()]}
                  </span>
                  <span className="num" style={{ fontSize: 10, color: T.ink3 }}>
                    {date.getDate()}.{date.getMonth() + 1}
                  </span>
                </div>
                {dayTasks.length === 0 ? (
                  <span style={{ fontSize: 10, color: T.ink3, opacity: 0.6 }}>—</span>
                ) : dayTasks.map((t) => (
                  <MiniCard key={t.id} t={t} cat={t.categoryId ? catById[t.categoryId] : undefined} todayKey={todayKey} onOpen={onOpen} />
                ))}
              </div>
            );
          })}
        </div>
        <style>{`@media (max-width: 900px) { .tj-week { grid-template-columns: 1fr !important; } .tj-week > div { min-height: 0 !important; } }`}</style>
      </SectionCard>
    </div>
  );
}

// ============================================
// TableView — טבלה ממיינת
// ============================================

type SortKey = "title" | "category" | "createdAt" | "dueDate" | "status";

export function TableView({ roots, catById, todayKey, onOpen, onCycle }: ViewProps & { onCycle: (t: Task) => void }) {
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [asc, setAsc] = useState(false);

  const statusOrder: Record<TaskStatus, number> = { todo: 0, in_progress: 1, done: 2 };

  const sorted = useMemo(() => {
    const val = (t: Task): string | number => {
      switch (sortKey) {
        case "title": return t.title;
        case "category": return t.categoryId ? (catById[t.categoryId]?.name ?? "") : "";
        case "createdAt": return t.createdAt;
        case "dueDate": return t.dueDate ?? "9999";
        case "status": return statusOrder[t.status];
      }
    };
    return [...roots].sort((a, b) => {
      const av = val(a), bv = val(b);
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), "he");
      return asc ? cmp : -cmp;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots, sortKey, asc, catById]);

  function header(label: string, key: SortKey) {
    const active = sortKey === key;
    return (
      <th style={{ padding: "9px 12px", textAlign: "start", whiteSpace: "nowrap" }}>
        <button onClick={() => { if (active) setAsc(!asc); else { setSortKey(key); setAsc(key === "title" || key === "category"); } }}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none",
            color: active ? T.ink : T.ink3, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
          }}>
          {label}
          <span style={{ opacity: active ? 1 : 0.4, display: "inline-flex", transform: active && asc ? "scaleY(-1)" : "none" }}>
            {Ic.sort(11)}
          </span>
        </button>
      </th>
    );
  }

  return (
    <SectionCard title="טבלת משימות" icon={Ic.table(16)} pal="purple"
      badge={<span className="num" style={{ fontSize: 11.5, color: T.ink2, background: T.surface2, borderRadius: 99, padding: "2px 9px" }}>{roots.length}</span>}>
      <div style={{ overflowX: "auto", margin: "0 -16px", padding: "0 16px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${T.lineStrong}` }}>
              {header("משימה", "title")}
              {header("קטגוריה", "category")}
              {header("נפתחה", "createdAt")}
              {header("יעד", "dueDate")}
              <th style={{ padding: "9px 12px", textAlign: "start", fontSize: 11.5, fontWeight: 600, color: T.ink3 }}>שלבים</th>
              {header("סטטוס", "status")}
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => {
              const cat = t.categoryId ? catById[t.categoryId] : undefined;
              const sub = countSubtasks(t);
              const done = isDone(t);
              const overdue = !done && t.dueDate && t.dueDate < todayKey;
              return (
                <tr key={t.id} onClick={() => onOpen(t.id)}
                  style={{ borderBottom: `1px solid ${T.line}`, cursor: "pointer", opacity: done ? 0.55 : 1 }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = T.surface2; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <td style={{ padding: "10px 12px", maxWidth: 260 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      {t.critical && <span style={{ color: T.danger, display: "inline-flex", flexShrink: 0 }}>{Ic.flame(12)}</span>}
                      {(t.ownerId || t.sharedWith?.length) && <span title="משימה משותפת" aria-label="משימה משותפת" style={{ color: T.ink3, display: "inline-flex", flexShrink: 0 }}>{Ic.users(12)}</span>}
                      <span style={{
                        fontSize: 12.5, fontWeight: 600, color: T.ink,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        textDecoration: done ? "line-through" : "none",
                      }}>{t.title || "ללא שם"}</span>
                      {t.nature && <span style={{ fontSize: 10, color: NATURE_COLORS[t.nature], flexShrink: 0 }}>{NATURE_LABELS[t.nature]}</span>}
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                    {cat ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: T.ink2 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 3, background: cat.color }} />
                        {cat.name}
                      </span>
                    ) : <span style={{ color: T.ink3, fontSize: 11 }}>—</span>}
                  </td>
                  <td className="num" style={{ padding: "10px 12px", fontSize: 11.5, color: T.ink3, whiteSpace: "nowrap" }}>
                    {formatDateHe(t.createdAt)}
                  </td>
                  <td className="num" style={{ padding: "10px 12px", fontSize: 11.5, whiteSpace: "nowrap", color: overdue ? T.danger : T.ink2 }}>
                    {t.dueDate ? <>{formatDateHe(t.dueDate)}{overdue ? " · באיחור" : ""}</> : "—"}
                  </td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                    {sub.total > 0 ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 44, height: 4, borderRadius: 99, background: T.surface2, overflow: "hidden", display: "inline-block" }}>
                          <span style={{ display: "block", height: "100%", width: `${(sub.done / sub.total) * 100}%`, background: T.grad }} />
                        </span>
                        <span className="num" style={{ fontSize: 10.5, color: T.ink3 }}>{sub.done}/{sub.total}</span>
                      </span>
                    ) : <span style={{ color: T.ink3, fontSize: 11 }}>—</span>}
                  </td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                    <button onClick={(e) => { e.stopPropagation(); onCycle(t); }}
                      title="לחיצה מקדמת סטטוס"
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6,
                        background: alpha(STATUS_COLORS[t.status], 13), color: STATUS_COLORS[t.status],
                        border: "none", borderRadius: 99, padding: "4px 11px",
                        fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                      }}>
                      <StatusIcon status={t.status} size={12} />
                      {STATUS_LABELS[t.status]}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sorted.length === 0 && (
          <div style={{ textAlign: "center", padding: 30, color: T.ink3, fontSize: 13 }}>אין משימות להצגה</div>
        )}
      </div>
    </SectionCard>
  );
}

// ============================================
// BoardView — קנבן לפי סטטוס
// ============================================

export function BoardView({ roots, catById, todayKey, onOpen, onSetStatus }: ViewProps & {
  onSetStatus: (id: string, s: TaskStatus) => void;
}) {
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);
  const cols: TaskStatus[] = ["todo", "in_progress", "done"];

  const boardRef = useRef<HTMLDivElement>(null);
  const flipState = useRef<ReturnType<typeof Flip.getState> | null>(null);

  // מריץ אחרי שהעמודות התעדכנו ב-React — הקלף גולש מהמיקום הישן לחדש
  useGSAP(() => {
    if (!flipState.current) return;
    Flip.from(flipState.current, {
      targets: "[data-task-card]", duration: 0.45, ease: "power3.inOut", absolute: true,
    });
    flipState.current = null;
  }, { scope: boardRef, dependencies: [roots] });

  function captureBoard() {
    if (!boardRef.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    flipState.current = Flip.getState(boardRef.current.querySelectorAll("[data-task-card]"));
  }

  return (
    <div ref={boardRef} className="tj-board" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, alignItems: "start" }}>
      {cols.map((s) => {
        const items = roots.filter((t) => t.status === s);
        const over = dragOver === s;
        return (
          <div key={s}
            onDragOver={(e) => { e.preventDefault(); setDragOver(s); }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              const id = e.dataTransfer.getData("text/task-id");
              if (id) { captureBoard(); onSetStatus(id, s); }
            }}
            style={{
              ...card, padding: 10,
              borderColor: over ? `${STATUS_COLORS[s]}88` : T.line,
              background: over ? T.surface2 : T.surface,
              transition: "border-color .15s, background .15s",
            }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "2px 4px 10px" }}>
              <span style={{ color: STATUS_COLORS[s], display: "inline-flex" }}><StatusIcon status={s} size={14} /></span>
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>{STATUS_LABELS[s]}</span>
              <span className="num" style={{ fontSize: 10.5, color: T.ink3, background: T.surface2, borderRadius: 99, padding: "1px 8px" }}>
                {items.length}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7, minHeight: 60 }}>
              {items.map((t) => (
                <div key={t.id} draggable data-task-card data-flip-id={t.id}
                  onDragStart={(e) => { e.dataTransfer.setData("text/task-id", t.id); e.currentTarget.style.opacity = "0.45"; }}
                  onDragEnd={(e) => { e.currentTarget.style.opacity = ""; }}
                  style={{ cursor: "grab" }}>
                  <MiniCard t={t} cat={t.categoryId ? catById[t.categoryId] : undefined} todayKey={todayKey} onOpen={onOpen} />
                </div>
              ))}
              {items.length === 0 && (
                <div style={{
                  border: `1px dashed ${T.line}`, borderRadius: 10, padding: "18px 0",
                  textAlign: "center", fontSize: 11, color: T.ink3,
                }}>
                  גררו לכאן משימה
                </div>
              )}
            </div>
          </div>
        );
      })}
      <style>{`@media (max-width: 900px) { .tj-board { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

// ============================================
// StatsView — אנליטיקות: דונאט, שטח, פסים, עמודות ומפת חום
// ============================================

const MONTH_SHORT = ["ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳"];

function shiftDays(key: string, d: number): string {
  const x = new Date(`${key}T12:00:00`);
  x.setDate(x.getDate() + d);
  return toDateKey(x);
}
const dm = (key: string) => `${parseInt(key.slice(8, 10), 10)}.${parseInt(key.slice(5, 7), 10)}`;

export function StatsView({ roots, catById, todayKey }: Omit<ViewProps, "onOpen">) {
  const all = useMemo(() => roots.flatMap((r) => [r, ...flattenTasks(r.subtasks)]), [roots]);

  const total = all.length;
  const doneCount = all.filter(isDone).length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  const overdue = all.filter((t) => !isDone(t) && t.dueDate && t.dueDate < todayKey).length;
  const withDue = all.filter((t) => isDone(t) && t.dueDate && t.endDate);
  const onTime = withDue.length ? Math.round((withDue.filter((t) => t.endDate! <= t.dueDate!).length / withDue.length) * 100) : null;

  const byStatus = (["done", "in_progress", "todo"] as TaskStatus[]).map((s) => ({
    key: s, label: STATUS_LABELS[s], value: all.filter((t) => t.status === s).length, color: STATUS_FILL[s],
  }));

  // לפי קטגוריה: כמה הושלמו וכמה פתוחות
  const byCat = useMemo(() => {
    const m = new Map<string, { done: number; open: number }>();
    for (const t of all) {
      const k = t.categoryId && catById[t.categoryId] ? t.categoryId : "__none";
      const e = m.get(k) ?? { done: 0, open: 0 };
      if (isDone(t)) e.done++; else e.open++;
      m.set(k, e);
    }
    return [...m.entries()]
      .map(([k, v]) => ({
        key: k, ...v,
        label: k === "__none" ? "ללא קטגוריה" : catById[k].name,
        color: k === "__none" ? "#8A97A8" : catById[k].color,
      }))
      .sort((a, b) => b.done + b.open - (a.done + a.open))
      .slice(0, 8);
  }, [all, catById]);

  // 30 הימים האחרונים: נסגרו מול נפתחו
  const days30 = useMemo(() => Array.from({ length: 30 }, (_, i) => shiftDays(todayKey, i - 29)), [todayKey]);
  const doneSeries = days30.map((d) => all.filter((t) => isDone(t) && t.endDate === d).length);
  const newSeries = days30.map((d) => all.filter((t) => t.createdAt?.slice(0, 10) === d).length);
  const done30 = doneSeries.reduce((a, b) => a + b, 0);
  const new30 = newSeries.reduce((a, b) => a + b, 0);

  // עומס לפי חודש (תאריכי יעד, השנה הנוכחית)
  const year = parseInt(todayKey.slice(0, 4), 10);
  const curMonth = parseInt(todayKey.slice(5, 7), 10) - 1;
  const byMonth = MONTH_SHORT.map((label, i) => ({
    label,
    value: all.filter((t) => t.dueDate?.startsWith(`${year}-${String(i + 1).padStart(2, "0")}`)).length,
  }));

  // מפת חום: 12 שבועות, ראשון→שבת
  const weeks = useMemo(() => {
    const today = new Date(`${todayKey}T12:00:00`);
    const start = new Date(today);
    start.setDate(start.getDate() - today.getDay() - 7 * 11);
    const doneByDay = new Map<string, number>();
    for (const t of all) if (isDone(t) && t.endDate) doneByDay.set(t.endDate, (doneByDay.get(t.endDate) ?? 0) + 1);
    return Array.from({ length: 12 }, (_, w) => Array.from({ length: 7 }, (_, d) => {
      const x = new Date(start);
      x.setDate(start.getDate() + w * 7 + d);
      const key = toDateKey(x);
      return { key, label: `${HE_WEEKDAYS_FULL[x.getDay()]} ${dm(key)}`, value: doneByDay.get(key) ?? 0, future: key > todayKey };
    }));
  }, [all, todayKey]);
  const activeDays = weeks.flat().filter((d) => d.value > 0).length;
  const heat = useMemo(() => {
    const past = weeks.flat().filter((d) => !d.future);
    let streak = 0, run = 0;
    for (const d of past) { run = d.value > 0 ? run + 1 : 0; streak = Math.max(streak, run); }
    const peakDay = past.reduce((b, d) => (d.value > b.value ? d : b), { key: "", label: "", value: 0, future: false });
    const byWd = Array.from({ length: 7 }, (_, i) => weeks.reduce((n, w) => n + (w[i].future ? 0 : w[i].value), 0));
    const wdMax = Math.max(...byWd);
    const wd = wdMax > 0 ? byWd.indexOf(wdMax) : -1;
    return {
      streak,
      peak: peakDay.value,
      peakLabel: peakDay.value ? peakDay.label : undefined,
      bestWeekday: wd >= 0 ? `יום ${HE_WEEKDAYS_FULL[wd]}` : null,
      bestWeekdayCount: wdMax,
    };
  }, [weeks]);

  if (total === 0) {
    return (
      <SectionCard title="אנליטיקות" icon={Ic.chart(16)} pal="lavender">
        <div style={{ textAlign: "center", padding: 30, color: T.ink3, fontSize: 13 }}>אין נתונים עדיין — הוסיפו משימות</div>
      </SectionCard>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="tj-stat-top" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr)", gap: 14 }}>
        <SectionCard title="מצב המשימות" icon={Ic.checkCircle(16)} pal="lime">
          <div style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
            <Donut
              slices={byStatus}
              ariaLabel={`${pct}% מהמשימות הושלמו`}
              center={<span className="num" style={{ fontSize: 34, fontWeight: 800, lineHeight: 1, color: T.ink }}>{pct}%</span>}
              sub="הושלמו"
            />
            <div style={{ flex: 1, minWidth: 150 }}>
              <Legend items={byStatus.map((s) => ({ label: s.label, color: s.color, value: s.value }))} />
              <div style={{ marginTop: 12, fontSize: 12, color: T.ink3 }}>
                <span className="num" style={{ color: T.ink, fontWeight: 700 }}>{total}</span> משימות ושלבים בסך הכל
              </div>
            </div>
          </div>
        </SectionCard>
        <div className="tj-stat-kpis" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <BigStat label="הושלמו" value={doneCount} pal="lime" icon={Ic.checkCircle(17)} />
          <BigStat label="פעילות" value={total - doneCount} pal="blue" icon={Ic.layers(17)} />
          <BigStat label="באיחור" value={overdue} pal="crimson" danger={overdue > 0} icon={Ic.alert(17)} />
          <BigStat label="הושלמו בזמן" value={onTime === null ? "—" : `${onTime}%`} pal="cream" icon={Ic.target(17)} />
        </div>
      </div>

      <SectionCard title="קצב — 30 הימים האחרונים" icon={Ic.activity(16)} pal="blue"
        extra={<div style={{ marginInlineStart: "auto" }}><DayBarsLegend items={[
          { label: "נסגרו", color: STATUS_FILL.done, total: done30 },
          { label: "נפתחו", color: "var(--tj-accent)", total: new30 },
        ]} /></div>}>
        <DayBars
          days={days30.map((d) => ({ short: dm(d), long: `${HE_WEEKDAYS_FULL[new Date(`${d}T12:00:00`).getDay()]} ${dm(d)}` }))}
          up={{ label: "נסגרו", color: STATUS_FILL.done, values: doneSeries }}
          down={{ label: "נפתחו", color: "var(--tj-accent)", values: newSeries }}
          ariaLabel={`ב-30 הימים האחרונים נסגרו ${done30} משימות ונפתחו ${new30}`}
        />
      </SectionCard>

      <div className="tj-statgrid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}>
        <SectionCard title="לפי קטגוריה" icon={Ic.layers(16)} pal="pink">
          {byCat.length === 0 ? (
            <div style={{ color: T.ink3, fontSize: 12, padding: 10 }}>אין משימות</div>
          ) : (
            <>
              <SplitBars rows={byCat} />
              <div style={{ display: "flex", gap: 14, marginTop: 12, fontSize: 11, color: T.ink3 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 12, height: 8, borderRadius: 3, background: T.ink2 }} />הושלמו</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 12, height: 8, borderRadius: 3, background: alpha("var(--tj-ink2)", 28) }} />פתוחות</span>
              </div>
            </>
          )}
        </SectionCard>
        <SectionCard title={`עומס לפי חודש · ${year}`} icon={Ic.calendar(16)} pal="purple">
          <Columns items={byMonth} highlight={curMonth} height={214} color="var(--pal-purple)" ariaLabel={`משימות לפי חודש יעד בשנת ${year}`} />
        </SectionCard>
      </div>

      <SectionCard title="מפת פעילות — 12 שבועות" icon={Ic.grid(16)} pal="plum"
        badge={<span style={{ fontSize: 11.5, fontWeight: 700, color: T.mint, background: T.mintSoft, borderRadius: 99, padding: "2px 10px" }}><span className="num">{activeDays}</span> ימים פעילים</span>}>
        <div className="tj-heat" style={{ display: "flex", gap: 22, alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <Heatmap weeks={weeks} dayLabels={HE_WEEKDAYS} fills={HEAT_FILLS} todayKey={todayKey}
              ariaLabel={`השלמות לפי יום ב-12 השבועות האחרונים: ${activeDays} ימים עם השלמות`} />
          </div>
          <div className="tj-heat-side" style={{ flex: "0 0 210px", display: "grid", gap: 8 }}>
            <MiniStat label="היום החזק בשבוע" value={heat.bestWeekday ?? "—"} sub={heat.bestWeekday ? `${heat.bestWeekdayCount} השלמות` : undefined} />
            <MiniStat label="רצף הכי ארוך" value={<><span className="num">{heat.streak}</span> ימים</>} sub="ימים רצופים עם השלמה" />
            <MiniStat label="שיא ביום אחד" value={<><span className="num">{heat.peak}</span> משימות</>} sub={heat.peakLabel} />
          </div>
        </div>
      </SectionCard>

      <style>{`
        @media (max-width: 900px) { .tj-statgrid, .tj-stat-top { grid-template-columns: 1fr !important; } }
        @media (max-width: 720px) {
          .tj-heat { flex-direction: column; align-items: stretch !important; }
          .tj-heat-side { flex: 1 1 auto !important; width: 100%; grid-template-columns: repeat(3, minmax(0, 1fr)); }
        }
      `}</style>
    </div>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div style={{ borderRadius: 14, padding: "10px 12px", background: T.bg2, border: `1px solid ${T.line}`, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: T.ink3, fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 800, color: T.ink, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: T.ink3, marginTop: 1, lineHeight: 1.35 }}>{sub}</div>}
    </div>
  );
}

function BigStat({ label, value, pal, danger, icon }: { label: string; value: number | string; pal: Pal; danger?: boolean; icon: React.ReactNode }) {
  return (
    <div className="tj-card" style={{
      ...card, padding: "16px 16px 14px", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 10,
    }}>
      <IconChip pal={pal} size={38} radius={12}>{icon}</IconChip>
      <span>
        <span className="num" style={{ display: "block", fontSize: 32, fontWeight: 800, lineHeight: 1, color: danger ? T.danger : T.ink }}>{value}</span>
        <span style={{ display: "block", fontSize: 12.5, color: T.ink2, fontWeight: 600, marginTop: 4 }}>{label}</span>
      </span>
    </div>
  );
}

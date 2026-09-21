"use client";

import { useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { Flip } from "gsap/Flip";
import { useGSAP } from "@gsap/react";
import {
  type Task, type TaskCategory, type TaskStatus,
  isDone, flattenTasks, countSubtasks, formatDateHe,
  STATUS_LABELS, STATUS_COLORS, NATURE_LABELS, NATURE_COLORS,
  HE_MONTHS, HE_WEEKDAYS_FULL,
} from "@/lib/tasks";
import { T, alpha, card, well, Ic, StatusIcon } from "./ui";

gsap.registerPlugin(Flip, useGSAP);

// chart fills snapped to the dark-band (validated); UI text keeps STATUS_COLORS
const STATUS_FILL: Record<TaskStatus, string> = {
  todo: "#7D93A8",
  in_progress: "#C07F0E",
  done: "#0FA47E",
};

interface ViewProps {
  roots: Task[];
  catById: Record<string, TaskCategory>;
  todayKey: string;
  onOpen: (id: string) => void;
}

function SectionCard({ title, icon, badge, children }: {
  title: string; icon: React.ReactNode; badge?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="tj-card" style={{ ...card, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ color: T.accent, display: "inline-flex" }}>{icon}</span>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, fontFamily: "var(--font-display)" }}>{title}</h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

function MiniCard({ t, cat, todayKey, onOpen, hideDate }: { t: Task; cat?: TaskCategory; todayKey: string; onOpen: (id: string) => void; hideDate?: boolean }) {
  const done = isDone(t);
  const overdue = !done && t.dueDate && t.dueDate < todayKey;
  return (
    <div onClick={() => onOpen(t.id)} style={{
      background: T.bg2, border: `1px solid ${T.line}`,
      borderInlineStart: `3px solid ${t.critical ? T.danger : (cat?.color ?? T.ink3)}`,
      borderRadius: 10, padding: "8px 10px", cursor: "pointer",
      opacity: done ? 0.55 : 1, minWidth: 0,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6, minWidth: 0 }}>
        <span style={{ color: STATUS_COLORS[t.status], display: "inline-flex", flexShrink: 0, marginTop: 1 }}>
          <StatusIcon status={t.status} size={13} />
        </span>
        <span style={{
          fontSize: 12, fontWeight: 600, color: T.ink, minWidth: 0,
          // שבע עמודות משאירות ~85px לכותרת; שורה אחת עם ellipsis חתכה
          // כל משימה אחרי מילה. שתי שורות מחזירות את המשפט.
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          overflow: "hidden", overflowWrap: "anywhere", lineHeight: 1.3,
          textDecoration: done ? "line-through" : "none",
        }}>{t.title || "ללא שם"}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
        {t.critical && <span style={{ color: T.danger, display: "inline-flex" }}>{Ic.flame(10)}</span>}
        {cat && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9.5, color: T.ink2, minWidth: 0 }}>
            <span style={{ width: 6, height: 6, borderRadius: 2, background: cat.color, flexShrink: 0 }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cat.name}</span>
          </span>
        )}
        {t.dueDate && (!hideDate || overdue) && (
          <span className="num" style={{ fontSize: 9.5, color: overdue ? T.danger : T.ink3 }}>
            {hideDate ? "באיחור" : `${formatDateHe(t.dueDate)}${overdue ? " · באיחור" : ""}`}
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
        <SectionCard title="באיחור" icon={<span style={{ color: T.danger, display: "inline-flex" }}>{Ic.alert(16)}</span>}
          badge={<span className="num" style={{ fontSize: 11.5, color: T.danger, background: T.dangerSoft, borderRadius: 99, padding: "2px 9px" }}>{overdue.length}</span>}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 8 }}>
            {overdue.map((t) => (
              <MiniCard key={t.id} t={t} cat={t.categoryId ? catById[t.categoryId] : undefined} todayKey={todayKey} onOpen={onOpen} />
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard title="שבעת הימים הקרובים" icon={Ic.week(16)}>
        <div className="tj-week" style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", gap: 8 }}>
          {days.map(({ key, date }, i) => {
            const dayTasks = all.filter((t) => t.dueDate === key);
            const isToday = key === todayKey;
            return (
              <div key={key} style={{
                background: T.bg2, borderRadius: 12, padding: 8, minHeight: 120,
                border: `1px solid ${isToday ? T.accent : T.line}`,
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
                  <MiniCard key={t.id} t={t} cat={t.categoryId ? catById[t.categoryId] : undefined} todayKey={todayKey} onOpen={onOpen} hideDate />
                ))}
              </div>
            );
          })}
        </div>
        <style>{`@media (max-width: 900px) { .tj-week { grid-template-columns: minmax(0,1fr) !important; } .tj-week > div { min-height: 0 !important; } }`}</style>
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
    <SectionCard title="טבלת משימות" icon={Ic.table(16)}
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
                        background: `${STATUS_FILL[t.status]}26`, color: STATUS_COLORS[t.status],
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
    <div ref={boardRef} className="tj-board" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10, alignItems: "start" }}>
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
              borderColor: over ? alpha(STATUS_COLORS[s], 53) : T.line,
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
      <style>{`@media (max-width: 900px) { .tj-board { grid-template-columns: minmax(0,1fr) !important; } }`}</style>
    </div>
  );
}

// ============================================
// StatsView — אנליטיקות
// ============================================

export function StatsView({ roots, catById, todayKey }: Omit<ViewProps, "onOpen">) {
  const all = useMemo(() => roots.flatMap((r) => [r, ...flattenTasks(r.subtasks)]), [roots]);
  const [hoverMonth, setHoverMonth] = useState<number | null>(null);

  const total = all.length;
  const doneCount = all.filter(isDone).length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  const overdue = all.filter((t) => !isDone(t) && t.dueDate && t.dueDate < todayKey).length;

  // per category (all tasks incl. subtasks)
  const byCat = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of all) if (t.categoryId) counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
    return [...counts.entries()]
      .map(([id, count]) => ({ cat: catById[id], count }))
      .filter((x) => x.cat)
      .sort((a, b) => b.count - a.count);
  }, [all, catById]);
  const maxCat = Math.max(1, ...byCat.map((x) => x.count));

  const byStatus = (["todo", "in_progress", "done"] as TaskStatus[])
    .map((s) => ({ s, count: all.filter((t) => t.status === s).length }));

  // per month (due dates, current year)
  const year = new Date().getFullYear();
  const byMonth = useMemo(() => {
    const counts = Array(12).fill(0) as number[];
    for (const t of all) {
      if (t.dueDate?.startsWith(String(year))) counts[parseInt(t.dueDate.slice(5, 7), 10) - 1]++;
    }
    return counts;
  }, [all, year]);
  const maxMonth = Math.max(1, ...byMonth);

  if (total === 0) {
    return (
      <SectionCard title="אנליטיקות" icon={Ic.chart(16)}>
        <div style={{ textAlign: "center", padding: 30, color: T.ink3, fontSize: 13 }}>אין נתונים עדיין — הוסיפו משימות</div>
      </SectionCard>
    );
  }

  const ringR = 33, ringC = 2 * Math.PI * ringR;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* hero tiles */}
      <div className="tj-kpis" style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr 1fr 1fr", gap: 10 }}>
        <div className="tj-sheen" style={{ ...card, padding: "14px 16px", display: "flex", alignItems: "center", gap: 14 }}>
          <svg width="80" height="80" viewBox="0 0 80 80" style={{ flexShrink: 0 }} aria-hidden>
            <defs>
              <filter id="tjRingGlow" x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="4" />
              </filter>
            </defs>
            {/* תעלה שקועה: צל בקצה העליון והדגשה בתחתון — כיוון אור מלמעלה */}
            <circle cx="40" cy="40" r={ringR} fill="none" stroke="var(--tj-bezel)" strokeWidth="9"
              transform="translate(0,1.2)" />
            <circle cx="40" cy="40" r={ringR} fill="none" stroke={T.surface2} strokeWidth="9" />
            <circle cx="40" cy="40" r={ringR} fill="none" stroke="var(--tj-bezel-low)" strokeWidth="1.4"
              opacity="0.9" transform="translate(0,-0.8)" />
            {/* הילה תכולה מאחורי הקשת — האור שהקשת מטילה על המשטח */}
            <circle cx="40" cy="40" r={ringR} fill="none" stroke={T.brand[2]} strokeWidth="10"
              strokeLinecap="round" strokeDasharray={`${(pct / 100) * ringC} ${ringC}`}
              transform="rotate(-90 40 40)" filter="url(#tjRingGlow)" opacity="0.75" />
            <circle cx="40" cy="40" r={ringR} fill="none" stroke="var(--tj-mint)" strokeWidth="9"
              strokeLinecap="round" strokeDasharray={`${(pct / 100) * ringC} ${ringC}`}
              transform="rotate(-90 40 40)" />
            {/* קו אור דק לאורך הקצה העליון של הקשת — נותן לה עובי */}
            <circle cx="40" cy="40" r={ringR + 3} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.2"
              strokeLinecap="round" strokeDasharray={`${(pct / 100) * 2 * Math.PI * (ringR + 3)} ${2 * Math.PI * (ringR + 3)}`}
              transform="rotate(-90 40 40)" />
            <text x="40" y="45" textAnchor="middle" fill={T.ink} fontSize="16" fontWeight="700"
              fontFamily="var(--font-mono)">{pct}%</text>
          </svg>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>הושלמו</div>
            <div className="num" style={{ fontSize: 11.5, color: T.ink3, marginTop: 2 }}>{doneCount} מתוך {total}</div>
          </div>
        </div>
        <StatTile label="סה״כ משימות ושלבים" value={total} />
        <StatTile label="פעילות" value={total - doneCount} />
        <StatTile label="באיחור" value={overdue} danger={overdue > 0} />
      </div>

      {/* status stacked bar */}
      <SectionCard title="התפלגות סטטוס" icon={Ic.chart(16)}>
        <div style={{ ...well, display: "flex", height: 18, borderRadius: 9, overflow: "hidden", gap: 2, padding: 2 }}>
          {byStatus.filter((x) => x.count > 0).map(({ s, count }) => (
            <div key={s} title={`${STATUS_LABELS[s]}: ${count}`}
              style={{
                width: `${(count / total) * 100}%`, minWidth: 6, borderRadius: 7,
                // מילוי אנכי + קו אור עליון: המקטע מקבל עובי במקום להיות שטח צבע
                background: `linear-gradient(180deg, ${alpha(STATUS_FILL[s], 88)}, ${STATUS_FILL[s]})`,
                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.38), 0 1px 2px ${alpha(STATUS_FILL[s], 40)}`,
              }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 18, marginTop: 12, flexWrap: "wrap" }}>
          {byStatus.map(({ s, count }) => (
            <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: T.ink2 }}>
              <span style={{ color: STATUS_COLORS[s], display: "inline-flex" }}><StatusIcon status={s} size={13} /></span>
              {STATUS_LABELS[s]}
              <span className="num" style={{ color: T.ink }}>{count}</span>
            </span>
          ))}
        </div>
      </SectionCard>

      <div className="tj-statgrid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 14, alignItems: "start" }}>
        {/* by category — horizontal bars */}
        <SectionCard title="משימות לפי קטגוריה" icon={Ic.layers(16)}>
          {byCat.length === 0 ? (
            <div style={{ color: T.ink3, fontSize: 12, padding: 10 }}>אין משימות עם קטגוריה</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {byCat.map(({ cat, count }) => (
                <div key={cat.id} style={{ display: "grid", gridTemplateColumns: "84px 1fr 30px", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 11.5, color: T.ink2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "start" }}>
                    {cat.name}
                  </span>
                  <div style={{ ...well, height: 13, borderRadius: 7, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", width: `${(count / maxCat) * 100}%`, borderRadius: 7,
                      background: `linear-gradient(180deg, ${alpha(cat.color, 82)} 0%, ${cat.color} 62%, ${alpha(cat.color, 92)} 100%)`,
                      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.45), 0 2px 6px -2px ${alpha(cat.color, 65)}`,
                    }} />
                  </div>
                  <span className="num" style={{ fontSize: 11.5, color: T.ink, textAlign: "start" }}>{count}</span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* monthly load — vertical bars */}
        <SectionCard title={`עומס לפי חודש · ${year}`} icon={Ic.calendar(16)}>
          <div style={{ position: "relative" }}>
            {hoverMonth !== null && byMonth[hoverMonth] > 0 && (
              <div style={{
                position: "absolute", top: -6, insetInlineStart: `${(hoverMonth / 12) * 100}%`,
                background: T.surface2, border: `1px solid ${T.lineStrong}`, borderRadius: 8,
                padding: "4px 10px", fontSize: 11, color: T.ink, whiteSpace: "nowrap", zIndex: 2,
                transform: "translateY(-100%)",
              }}>
                {HE_MONTHS[hoverMonth]} · <span className="num">{byMonth[hoverMonth]}</span> משימות
              </div>
            )}
            {/* משטח מדידה שקוע עם קווי עזר — העמודות עומדות על רצפה, לא מרחפות */}
            <div style={{
              ...well, position: "relative", height: 132, marginTop: 14,
              borderRadius: 10, padding: "10px 6px 0",
            }}>
              {[0.25, 0.5, 0.75].map((f) => (
                <div key={f} aria-hidden style={{
                  position: "absolute", insetInline: 10, bottom: `${f * 100}%`,
                  height: 1, background: T.line, opacity: 0.7,
                }} />
              ))}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(12,minmax(0,1fr))", gap: 4, alignItems: "end", height: "100%" }}>
                {byMonth.map((count, i) => {
                  const hot = hoverMonth === i;
                  return (
                    <div key={i}
                      onMouseEnter={() => setHoverMonth(i)}
                      onMouseLeave={() => setHoverMonth(null)}
                      style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", cursor: "default" }}>
                      {count === maxMonth && count > 0 && (
                        <span className="num" style={{ fontSize: 9.5, color: T.ink2, marginBottom: 3 }}>{count}</span>
                      )}
                      <div style={{
                        width: "72%", maxWidth: 24,
                        height: `${(count / maxMonth) * 86}%`,
                        minHeight: count > 0 ? 5 : 2,
                        borderRadius: "5px 5px 2px 2px",
                        // רמפת המותג לאורך הגובה + מכסה מואר בראש העמודה,
                        // וצל צבעוני קצר שמצמיד אותה לרצפה.
                        background: count > 0
                          ? `linear-gradient(180deg, ${T.brand[3]} 0%, ${T.brand[1]} 42%, ${T.brand[0]} 100%)`
                          : T.line,
                        boxShadow: count > 0
                          ? [
                              "inset 0 1.5px 0 rgba(255,255,255,0.55)",
                              `inset -1px 0 0 ${alpha("#FFFFFF", 18)}`,
                              `0 3px 8px -3px ${alpha(T.brand[1], hot ? 90 : 55)}`,
                              hot ? `0 0 0 1px ${alpha(T.brand[3], 70)}` : "none",
                            ].filter((x) => x !== "none").join(", ")
                          : "none",
                        filter: hot ? "brightness(1.12)" : "none",
                        transition: "filter var(--t-feedback) var(--ease-arrive), box-shadow var(--t-state) var(--ease-arrive)",
                      }} />
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(12,1fr)", gap: 4, marginTop: 6 }}>
              {byMonth.map((_, i) => (
                <span key={i} className="num" style={{ fontSize: 8.5, color: T.ink3, textAlign: "center" }}>
                  {i + 1}
                </span>
              ))}
            </div>
          </div>
        </SectionCard>
      </div>
      <style>{`@media (max-width: 900px) { .tj-statgrid { grid-template-columns: minmax(0,1fr) !important; } }`}</style>
    </div>
  );
}

function StatTile({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div style={{
      ...card, padding: "14px 16px",
      display: "flex", flexDirection: "column", justifyContent: "center", minHeight: 82,
    }}>
      <div className="num" style={{ fontSize: 27, fontWeight: 800, lineHeight: 1, color: danger ? T.danger : T.ink }}>{value}</div>
      <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 5 }}>{label}</div>
    </div>
  );
}

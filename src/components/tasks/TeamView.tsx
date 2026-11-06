"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useToast } from "@/components/Toast";
import {
  type Task, type TaskStatus, flattenTasks, isDone, formatDateHe, toDateKey, findTaskInTree, emptyTask,
  countSubtasks, STATUS_COLORS, STATUS_LABELS,
} from "@/lib/tasks";
import {
  subscribeTeamMeta, getTeamMeta, getServerTeamMeta,
  subscribeTeamData, getTeamData, getServerTeamData, initTeamData, refetchTeamData,
  addMember, updateMember, removeMember, assignTask, upsertJournalRoot, deleteJournalRoot, patchJournalTask,
  addJournalCategory, savePrefs, nudgeTask,
  type JournalSlice,
} from "@/lib/team";
import {
  MANAGER_ID, MANAGER_NAME, PERSON_COLORS, MEMBER_COLOR_ORDER, SUGGESTED_MEMBER_NAME, personVar, journalPath,
  type PersonColor, type TeamMember,
} from "@/lib/journals";
import { parseQuickAdd } from "@/lib/quickadd";
import { celebrate } from "@/lib/celebrate";
import {
  T, alpha, card, inputStyle, Ic, StatusIcon, Avatar, ProgressRing, Toggle, Sheet,
  primaryBtn, ghostBtn, softBtn, useTilt,
} from "./ui";
import { TaskModal } from "./TaskModal";

type Person = { id: string; name: string; color: PersonColor; role?: string; isManager: boolean };

type PhoneChannel = "telegram" | "push" | "sms";
const CHANNEL_LABEL: Record<PhoneChannel, string> = { telegram: "טלגרם", push: "התראות פעילות", sms: "SMS" };

type PersonStats = {
  // ספירה לפי משימות (שורש), באותם כללים כמו הלשוניות ב"כל המשימות" — כדי שהמספרים יתאימו
  roots: { open: number; today: number; progress: number; overdue: number };
  all: Task[];
  open: Task[];
  dueToday: Task[];
  todayAll: Task[];
  overdue: Task[];
  critical: Task[];
  inProgress: Task[];
  doneWeek: Task[];
  pct: number;
  lastActive: string | null; // YYYY-MM-DD
};

function statsFor(roots: Task[], todayKey: string): PersonStats {
  const tree = (r: Task) => [r, ...flattenTasks(r.subtasks)];
  const rootCounts = {
    open: roots.filter((r) => !isDone(r)).length,
    today: roots.filter((r) => tree(r).some((t) => !isDone(t) && t.dueDate === todayKey)).length,
    progress: roots.filter((r) => tree(r).some((t) => t.status === "in_progress")).length,
    overdue: roots.filter((r) => tree(r).some((t) => !isDone(t) && !!t.dueDate && t.dueDate < todayKey)).length,
  };
  const all = flattenTasks(roots);
  const open = all.filter((t) => !isDone(t));
  const weekAgo = shiftKey(todayKey, -7);
  const lastActive = all
    .flatMap((t) => [t.createdAt?.slice(0, 10), t.endDate ?? undefined])
    .filter(Boolean)
    .sort()
    .pop() ?? null;
  return {
    roots: rootCounts,
    all,
    open,
    dueToday: open.filter((t) => t.dueDate === todayKey),
    todayAll: all.filter((t) => t.dueDate === todayKey),
    overdue: open.filter((t) => t.dueDate && t.dueDate < todayKey),
    critical: open.filter((t) => t.critical),
    inProgress: open.filter((t) => t.status === "in_progress"),
    doneWeek: all.filter((t) => isDone(t) && t.endDate && t.endDate >= weekAgo && t.endDate <= todayKey),
    pct: all.length ? Math.round((all.filter(isDone).length / all.length) * 100) : 0,
    lastActive,
  };
}

// "YYYY-MM-DD" ± ימים — טהור, בלי תלות בשעון הנוכחי
function shiftKey(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

function relDay(key: string | null, todayKey: string): string {
  if (!key) return "—";
  const diff = Math.round((Date.parse(todayKey) - Date.parse(key)) / 86400000);
  if (diff <= 0) return "היום";
  if (diff === 1) return "אתמול";
  if (diff < 7) return `לפני ${diff} ימים`;
  return formatDateHe(key);
}

function journalUrl(id: string): string {
  return typeof window === "undefined" ? journalPath(id) : `${window.location.origin}${journalPath(id)}`;
}

export function TeamView({ todayKey, onOpenOwnTask, onOpenNotify, focusMember }: {
  todayKey: string;
  onOpenOwnTask: (id: string) => void;
  onOpenNotify: () => void;
  focusMember?: string | null; // הגיע מהדשבורד הראשי ← פותחים ישר את כל המשימות שלו/ה
}) {
  const { toast } = useToast();
  const meta = useSyncExternalStore(subscribeTeamMeta, getTeamMeta, getServerTeamMeta);
  const data = useSyncExternalStore(subscribeTeamData, getTeamData, getServerTeamData);
  const memberIds = meta.roster.members.map((m) => m.id).join(",");

  useEffect(() => { initTeamData(); }, []);
  // איש צוות חדש נוסף/הוסר — טוענים מחדש את תמונת המצב
  useEffect(() => { if (data.loaded) refetchTeamData(); }, [memberIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const people: Person[] = useMemo(() => [
    { id: MANAGER_ID, name: MANAGER_NAME, color: "blue", isManager: true },
    ...meta.roster.members.map((m) => ({ id: m.id, name: m.name, color: m.color, role: m.role, isManager: false })),
  ], [meta.roster.members]);

  const stats = useMemo(() => {
    const out: Record<string, PersonStats> = {};
    for (const p of people) out[p.id] = statsFor(data.journals[p.id]?.tasks ?? [], todayKey);
    return out;
  }, [people, data.journals, todayKey]);

  const members = useMemo(() => people.filter((p) => !p.isManager), [people]);
  // ערוץ ההתראות של כל אחד: טלגרם / התראות מהיומן / SMS (אם הוגדר)
  const phoneChannel = (id: string): PhoneChannel | null =>
    meta.telegram[id] ? "telegram" : (meta.push[id] ?? 0) > 0 ? "push" : meta.sms[id] ? "sms" : null;
  const managerChannel = phoneChannel(MANAGER_ID);
  const suggestedName = meta.roster.members.some((m) => m.name.trim() === SUGGESTED_MEMBER_NAME) ? "" : SUGGESTED_MEMBER_NAME;
  const teamOpen = members.reduce((n, p) => n + stats[p.id].roots.open, 0);
  const teamDoneWeek = members.reduce((n, p) => n + stats[p.id].doneWeek.length, 0);
  const teamOverdue = members.reduce((n, p) => n + stats[p.id].roots.overdue, 0);
  const teamToday = members.reduce((n, p) => n + stats[p.id].roots.today, 0);

  // ---- dialogs ----
  const [adding, setAdding] = useState(false);
  const [assignTo, setAssignTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [shareFor, setShareFor] = useState<TeamMember | null>(null);
  const [openMember, setOpenMember] = useState<{ jid: string; taskId: string } | null>(null);
  // של מי המשימות שמוצגות ב"כל המשימות" (ברירת מחדל: איש הצוות הראשון)
  const [tasksOfState, setTasksOf] = useState<string | null>(focusMember ?? null);
  const tasksOf = tasksOfState && members.some((m) => m.id === tasksOfState) ? tasksOfState : members[0]?.id ?? null;

  // הגעה מהדשבורד הראשי עם איש צוות מסוים — גוללים ישר לרשימה המלאה
  useEffect(() => {
    if (!focusMember) return;
    const t = setTimeout(() => document.getElementById("tj-member-tasks")?.scrollIntoView({ behavior: "smooth", block: "start" }), 350);
    return () => clearTimeout(t);
  }, [focusMember]);

  function showTasksOf(id: string) {
    setTasksOf(id);
    requestAnimationFrame(() => document.getElementById("tj-member-tasks")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function setMemberStatus(jid: string, t: Task, status: TaskStatus) {
    if (status === "done" && t.status !== "done") celebrate();
    await patchJournalTask(jid, t.id, {
      status,
      endDate: status === "done" ? (t.endDate ?? todayKey) : t.endDate,
    });
  }

  function deleteMemberTask(jid: string, root: Task) {
    const name = people.find((p) => p.id === jid)?.name ?? "";
    if (!confirm(`למחוק את "${root.title || "ללא שם"}" מהיומן של ${name}? כולל כל השלבים.`)) return;
    deleteJournalRoot(jid, root.id);
    toast("המשימה נמחקה", "info", {
      label: "ביטול",
      onClick: () => { upsertJournalRoot(jid, root).catch(() => toast("השחזור נכשל", "error")); },
    });
  }

  function openTask(jid: string, taskId: string) {
    if (jid === MANAGER_ID) onOpenOwnTask(taskId);
    else setOpenMember({ jid, taskId });
  }

  async function quickDone(jid: string, t: Task) {
    if (jid === MANAGER_ID) { onOpenOwnTask(t.id); return; }
    celebrate();
    await patchJournalTask(jid, t.id, { status: "done", endDate: t.endDate ?? todayKey });
    toast(`סומן כבוצע ביומן של ${people.find((p) => p.id === jid)?.name ?? ""}`, "success");
  }

  const openRoot = openMember
    ? (data.journals[openMember.jid]?.tasks ?? []).find((r) => r.id === openMember.taskId || findTaskInTree(r.subtasks, openMember.taskId)) ?? null
    : null;

  // ---- needs attention (members only) ----
  const attention = members.flatMap((p) => {
    const s = stats[p.id];
    const seen = new Set<string>();
    return [...s.overdue, ...s.critical].filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)))
      .map((t) => ({ p, t, overdue: !!(t.dueDate && t.dueDate < todayKey) }));
  }).sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.t.dueDate ?? "9").localeCompare(b.t.dueDate ?? "9"));

  // ---- activity feed (members) ----
  const feed = useMemo(() => {
    const since = shiftKey(todayKey, -14);
    const items: { p: Person; t: Task; kind: "done" | "new" | "assigned"; day: string; sort: string }[] = [];
    for (const p of members) {
      for (const t of stats[p.id].all) {
        if (isDone(t) && t.endDate && t.endDate >= since) items.push({ p, t, kind: "done", day: t.endDate, sort: `${t.endDate}T23` });
        const c = t.createdAt?.slice(0, 10);
        if (c && c >= since && t.title.trim()) {
          items.push({ p, t, kind: t.assignedBy ? "assigned" : "new", day: c, sort: t.createdAt });
        }
      }
    }
    return items.sort((a, b) => b.sort.localeCompare(a.sort)).slice(0, 14);
  }, [members, stats, todayKey]);

  const loading = !data.loaded;
  const noMembers = members.length === 0;

  return (
    <>
      {/* ===== כותרת הצוות ===== */}
      <section className="tj-card tj-team-banner" style={{
        position: "relative", borderRadius: 26, padding: "22px 22px 18px", overflow: "hidden", color: "#fff",
        background: "linear-gradient(245deg, #0B1640 0%, #16307A 45%, #2563EB 100%)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18), 0 30px 60px -34px rgba(10,20,60,0.75)",
      }}>
        <div aria-hidden="true" style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: "radial-gradient(260px 160px at 8% 0%, rgba(125,211,252,0.35), transparent 70%), radial-gradient(240px 200px at 100% 100%, rgba(20,184,166,0.28), transparent 70%)",
        }} />
        <div style={{ position: "relative", display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: "flex", marginBottom: 10 }} aria-hidden="true">
              {people.slice(0, 6).map((p, i) => (
                <span key={p.id} style={{ marginInlineStart: i ? -10 : 0, borderRadius: 99, boxShadow: "0 0 0 3px #16307A", display: "inline-flex" }}>
                  <Avatar name={p.name} color={p.color} size={34} />
                </span>
              ))}
            </div>
            <h2 style={{ margin: 0, fontSize: 30, fontWeight: 800, fontFamily: "var(--font-display)", letterSpacing: "-0.035em", lineHeight: 1.08, textShadow: "0 2px 18px rgba(0,0,0,0.25)" }}>
              הצוות של {MANAGER_NAME}
            </h2>
            <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "rgba(255,255,255,0.86)", lineHeight: 1.6 }}>
              {noMembers
                ? "לכל איש צוות יומן מלא משלו. כאן רואים את כולם במבט אחד ומקבלים עדכון לטלפון."
                : `${members.length} ${members.length === 1 ? "איש צוות" : "אנשי צוות"} · ${teamToday} משימות להיום · ${teamDoneWeek} הושלמו השבוע`}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!noMembers && (
              <button onClick={() => setAssignTo(members[0]?.id ?? null)} style={{
                ...primaryBtn, height: 42, background: "#fff", color: "#16307A", boxShadow: "0 12px 26px -14px rgba(0,0,0,0.6)",
              }}>
                {Ic.send(14)} הקצאת משימה
              </button>
            )}
            <button onClick={() => setAdding(true)} style={{
              ...ghostBtn, height: 42, padding: "0 16px", fontSize: 13, color: "#fff",
              border: "1px solid rgba(255,255,255,0.35)", background: noMembers ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.1)",
            }}>
              {Ic.userPlus(15)} הוספה לצוות
            </button>
          </div>
        </div>

        {!noMembers && (
          <div className="tj-team-kpis" style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 18 }}>
            <MiniStat label="פתוחות בצוות" value={teamOpen} icon={Ic.layers(15)} />
            <MiniStat label="להיום" value={teamToday} icon={Ic.target(15)} />
            <MiniStat label="הושלמו השבוע" value={teamDoneWeek} icon={Ic.checkCircle(15)} tone="mint" />
            <MiniStat label="באיחור" value={teamOverdue} icon={Ic.alert(15)} tone={teamOverdue ? "danger" : undefined} />
          </div>
        )}
      </section>

      {noMembers ? (
        <Onboarding onAdd={() => setAdding(true)} onNotify={onOpenNotify} phoneLinked={!!phoneChannel(MANAGER_ID)} suggestedName={suggestedName} />
      ) : (
        <>
          {/* ===== כרטיסי אנשים ===== */}
          <div className="tj-people" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
            {loading
              ? people.map((p) => <div key={p.id} className="tj-skel" style={{ height: 228 }} />)
              : people.map((p) => (
                <PersonCard key={p.id} p={p} s={stats[p.id]} todayKey={todayKey}
                  channel={phoneChannel(p.id)}
                  onTasks={() => showTasksOf(p.id)}
                  onAssign={() => setAssignTo(p.id)}
                  onEdit={() => { const m = meta.roster.members.find((x) => x.id === p.id); if (m) setEditing(m); }}
                  onShare={() => { const m = meta.roster.members.find((x) => x.id === p.id); if (m) setShareFor(m); }}
                />
              ))}
          </div>

          {/* ===== כל המשימות של איש הצוות — רשימה מלאה עם שליטה ===== */}
          {tasksOf && !loading && (
            <MemberTasksPanel
              members={members}
              selected={tasksOf}
              onSelect={setTasksOf}
              slice={data.journals[tasksOf]}
              todayKey={todayKey}
              onOpen={(taskId) => openTask(tasksOf, taskId)}
              onStatus={(t, st) => setMemberStatus(tasksOf, t, st)}
              onDelete={(root) => deleteMemberTask(tasksOf, root)}
              onNudge={async (t) => {
                const name = firstWord(people.find((x) => x.id === tasksOf)?.name ?? "");
                const r = await nudgeTask(tasksOf, t.id);
                toast(
                  r === "sent" ? `נשלחה ל${name} בקשה לעדכון על "${t.title}"`
                    : r === "limited" ? "כבר נשלחה בקשה על המשימה הזו בחצי השעה האחרונה"
                    : r === "local" ? "בקשת עדכון עובדת רק כשהיומן מחובר לענן"
                    : "השליחה נכשלה — בדקו חיבור",
                  r === "sent" ? "success" : r === "limited" ? "info" : "error"
                );
              }}
              onAssign={() => setAssignTo(tasksOf)}
            />
          )}

          <div className="tj-team-cols" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.35fr) minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
              {/* ---- דורש תשומת לב ---- */}
              <section className="tj-card" style={{ ...card, padding: 16 }}>
                <Head icon={Ic.alert(15)} title="דורש תשומת לב" count={attention.length} tone={attention.length ? "danger" : "mint"} />
                {attention.length === 0 ? (
                  <EmptyLine icon={Ic.sparkle(16)} text="אין משימות באיחור או קריטיות אצל הצוות." />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {attention.slice(0, 10).map(({ p, t, overdue }) => (
                      <TeamTaskRow key={`${p.id}-${t.id}`} p={p} t={t} todayKey={todayKey}
                        hint={overdue ? `באיחור · יעד ${formatDateHe(t.dueDate)}` : "קריטית"}
                        hintTone="danger"
                        onOpen={() => openTask(p.id, t.id)} onDone={() => quickDone(p.id, t)} />
                    ))}
                    {attention.length > 10 && <span style={{ fontSize: 11.5, color: T.ink3, padding: "4px 2px" }}>ועוד {attention.length - 10}…</span>}
                  </div>
                )}
              </section>

              {/* ---- היום, לפי אדם ---- */}
              <section className="tj-card" style={{ ...card, padding: 16 }}>
                <Head icon={Ic.target(15)} title="היום בצוות" />
                <div className="tj-lanes no-scrollbar" style={{ display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(200px, 1fr)", gap: 10, overflowX: "auto", paddingBottom: 2 }}>
                  {people.map((p) => {
                    const list = [...stats[p.id].todayAll].sort((a, b) => Number(isDone(a)) - Number(isDone(b)));
                    return (
                      <div key={p.id} style={{ background: T.bg2, borderRadius: 16, padding: 10, minHeight: 120 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
                          <Avatar name={p.name} color={p.color} size={24} />
                          <span style={{ fontSize: 12.5, fontWeight: 700 }}>{p.name}</span>
                          <span className="num" style={{ marginInlineStart: "auto", fontSize: 10.5, color: T.ink3 }}>
                            {list.filter(isDone).length}/{list.length}
                          </span>
                        </div>
                        {list.length === 0 ? (
                          <span style={{ fontSize: 11.5, color: T.ink3 }}>אין משימות להיום</span>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                            {list.slice(0, 6).map((t) => (
                              <button key={t.id} onClick={() => openTask(p.id, t.id)} style={{
                                display: "flex", alignItems: "center", gap: 7, textAlign: "start", width: "100%",
                                background: T.surface, border: "none", borderRadius: 10, padding: "7px 9px",
                                cursor: "pointer", fontFamily: "inherit", fontSize: 12, color: T.ink,
                                boxShadow: `inset 0 0 0 1px ${t.critical && !isDone(t) ? alpha(T.danger, 30) : T.line}`,
                                opacity: isDone(t) ? 0.55 : 1,
                              }}>
                                <span style={{ color: STATUS_COLORS[t.status], display: "inline-flex", flexShrink: 0 }}><StatusIcon status={t.status} size={13} /></span>
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: isDone(t) ? "line-through" : "none" }}>{t.title || "ללא שם"}</span>
                              </button>
                            ))}
                            {list.length > 6 && <span style={{ fontSize: 11, color: T.ink3 }}>ועוד {list.length - 6}</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              <PaceChart people={people} stats={stats} todayKey={todayKey} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
              {/* ---- פעילות אחרונה ---- */}
              <section className="tj-card" style={{ ...card, padding: 16 }}>
                <Head icon={Ic.activity(15)} title="פעילות אחרונה" />
                {feed.length === 0 ? (
                  <EmptyLine icon={Ic.inbox(16)} text="עוד אין פעילות בשבועיים האחרונים." />
                ) : (
                  <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
                    {feed.map(({ p, t, kind, day }, i) => (
                      <li key={`${kind}-${p.id}-${t.id}`} style={{ display: "flex", gap: 10, position: "relative", paddingBottom: i === feed.length - 1 ? 0 : 12 }}>
                        {i !== feed.length - 1 && (
                          <span aria-hidden="true" style={{ position: "absolute", insetInlineStart: 11, top: 26, bottom: 0, width: 1.5, background: T.line }} />
                        )}
                        <Avatar name={p.name} color={p.color} size={24} />
                        <button onClick={() => openTask(p.id, t.id)} style={{
                          flex: 1, minWidth: 0, textAlign: "start", background: "none", border: "none", padding: 0,
                          cursor: "pointer", fontFamily: "inherit", color: T.ink,
                        }}>
                          <span style={{ display: "block", fontSize: 11.5, color: T.ink3 }}>
                            <b style={{ color: T.ink2 }}>{p.name}</b>
                            {" · "}
                            <span style={{ color: kind === "done" ? T.mint : T.accent, fontWeight: 600 }}>
                              {kind === "done" ? "הושלמה" : kind === "assigned" ? `הוקצתה מ${MANAGER_NAME}` : "משימה חדשה"}
                            </span>
                            {" · "}{relDay(day, todayKey)}
                          </span>
                          <span style={{ display: "block", fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {t.title}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              {/* ---- ניהול הצוות: מי בצוות, עריכה, קישור, הסרה ---- */}
              <section className="tj-card" style={{ ...card, padding: 16 }}>
                <Head icon={Ic.users(15)} title="ניהול הצוות" count={members.length} />
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {meta.roster.members.map((m) => {
                    const ch = phoneChannel(m.id);
                    return (
                      <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, background: T.bg2, borderRadius: 14, padding: "10px 12px" }}>
                        <Avatar name={m.name} color={m.color} size={36} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</div>
                          <div style={{ fontSize: 11, color: T.ink3 }}>
                            {m.role ? `${m.role} · ` : ""}בצוות מאז {new Date(m.createdAt).toLocaleDateString("he-IL")}
                            {" · "}<span style={{ color: ch ? T.mint : T.ink3 }}>{ch ? CHANNEL_LABEL[ch] : "בלי התראות"}</span>
                          </div>
                        </div>
                        <IconAction label={`עריכת ${m.name}`} onClick={() => setEditing(m)} color={T.ink2}>{Ic.pencil(13)}</IconAction>
                        <IconAction label={`הקישור של ${m.name}`} onClick={() => setShareFor(m)} color={T.ink2}>{Ic.link(13)}</IconAction>
                        <IconAction label={`הסרת ${m.name} מהצוות`} onClick={async () => {
                          if (!confirm(`להסיר את ${m.name} מהצוות?\n\nהיומן שלו/ה וכל המשימות יימחקו, והקישור יפסיק לעבוד.\nעותק נשמר בגיבוי הלילי.`)) return;
                          await removeMember(m.id);
                          toast(`${m.name} הוסר/ה מהצוות`, "info");
                        }} color={T.danger}>{Ic.trash(13)}</IconAction>
                      </div>
                    );
                  })}
                </div>
                <button onClick={() => setAdding(true)} style={{ ...softBtn, width: "100%", height: 38, marginTop: 10 }}>
                  {Ic.userPlus(13)} הוספה לצוות
                </button>
              </section>

              {/* ---- הגדרות מנהל ---- */}
              <section className="tj-card" style={{ ...card, padding: 16 }}>
                <Head icon={Ic.sliders(15)} title="עדכונים לטלפון" />
                <button onClick={onOpenNotify} style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "start",
                  background: managerChannel ? T.mintSoft : T.accentSoft, border: "none", borderRadius: 14,
                  padding: "11px 12px", cursor: "pointer", fontFamily: "inherit", marginBottom: 12,
                }}>
                  <span style={{ color: managerChannel ? T.mint : T.accent, display: "inline-flex" }}>{Ic.bell(17)}</span>
                  <span style={{ flex: 1 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: T.ink }}>
                      {managerChannel ? `התראות לטלפון שלך · ${CHANNEL_LABEL[managerChannel]}` : "הפעלת התראות לטלפון שלך (חינם)"}
                    </span>
                    <span style={{ display: "block", fontSize: 11.5, color: T.ink2 }}>
                      {managerChannel ? "תזכורות ועדכוני הצוות קופצים בטלפון" : "כך תדע מיד כשמישהו בצוות מסיים או מוסיף משימה"}
                    </span>
                  </span>
                  {Ic.chevL(14)}
                </button>
                <PrefRow label="כשמישהו בצוות מסיים משימה" on={meta.prefs.memberDone}
                  onChange={(v) => savePrefs({ ...meta.prefs, memberDone: v })} />
                <PrefRow label="כשמישהו בצוות מוסיף משימה" on={meta.prefs.memberNew}
                  onChange={(v) => savePrefs({ ...meta.prefs, memberNew: v })} />
                <PrefRow label="תמונת מצב הצוות בבריף הבוקר ובסיכום השבועי" on={meta.prefs.teamBrief}
                  onChange={(v) => savePrefs({ ...meta.prefs, teamBrief: v })} />
              </section>
            </div>
          </div>
        </>
      )}

      {data.error && (
        <div style={{ fontSize: 12, color: T.danger }}>שגיאה בטעינת הצוות: {data.error}</div>
      )}

      {/* ===== dialogs ===== */}
      {adding && (
        <AddMemberDialog
          initialName={suggestedName}
          usedColors={meta.roster.members.map((m) => m.color)}
          onClose={() => setAdding(false)}
          onCreated={(m) => { setAdding(false); setShareFor(m); }}
        />
      )}
      {assignTo && (
        <AssignDialog
          people={members}
          initial={assignTo === MANAGER_ID ? members[0]?.id ?? null : assignTo}
          todayKey={todayKey}
          onClose={() => setAssignTo(null)}
          onAssigned={(p, t) => {
            setAssignTo(null);
            toast(`נשלח ל${p.name}: ${t.title}${phoneChannel(p.id) ? " · תקפוץ התראה בטלפון" : ""}`, "success");
          }}
        />
      )}
      {editing && (
        <EditMemberDialog member={editing} onClose={() => setEditing(null)}
          onShare={() => { setShareFor(editing); setEditing(null); }} />
      )}
      {shareFor && <ShareDialog member={shareFor} onClose={() => setShareFor(null)} />}

      {openMember && openRoot && (
        <TaskModal
          root={openRoot}
          focusId={openMember.taskId}
          categories={data.journals[openMember.jid]?.categories ?? []}
          onSave={(updated) => { upsertJournalRoot(openMember.jid, updated).catch(() => toast("השמירה נכשלה", "error")); }}
          onDelete={(id) => {
            if (id === openRoot.id) deleteJournalRoot(openMember.jid, id);
            setOpenMember(null);
            toast("המשימה נמחקה", "info");
          }}
          onAddCategory={(name, color) => addJournalCategory(openMember.jid, name, color)}
          onClose={() => setOpenMember(null)}
        />
      )}

      <style>{`
        @media (max-width: 1100px) { .tj-team-cols { grid-template-columns: 1fr !important; } }
        .tj-card.tj-flush { padding: 0 !important; }
        @media (max-width: 640px) {
          .tj-card.tj-flush { padding: 0 !important; }
          .tj-team-kpis { grid-template-columns: repeat(2, 1fr) !important; }
          .tj-people { grid-template-columns: 1fr !important; }
          .tj-lanes { grid-auto-columns: 78% !important; }
        }
      `}</style>
    </>
  );
}

// ============ pieces ============

function Head({ icon, title, count, tone }: { icon: React.ReactNode; title: string; count?: number; tone?: "danger" | "mint" }) {
  const c = tone === "danger" ? T.danger : tone === "mint" ? T.mint : T.accent;
  const bg = tone === "danger" ? T.dangerSoft : tone === "mint" ? T.mintSoft : T.accentSoft;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 13 }}>
      <span style={{
        width: 32, height: 32, borderRadius: 11, color: "#fff", flexShrink: 0,
        background: `linear-gradient(140deg, ${c}, color-mix(in srgb, ${c} 68%, #000))`,
        boxShadow: `0 8px 18px -10px ${alpha(c, 90)}`,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}>{icon}</span>
      <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 800, fontFamily: "var(--font-display)", letterSpacing: "-0.015em" }}>{title}</h3>
      {count !== undefined && (
        <span className="num" style={{ fontSize: 11.5, fontWeight: 700, color: c, background: bg, borderRadius: 99, padding: "2px 10px" }}>{count}</span>
      )}
    </div>
  );
}

function EmptyLine({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: T.ink3, padding: "6px 2px" }}>
      <span style={{ color: T.mint, display: "inline-flex" }}>{icon}</span>{text}
    </div>
  );
}

function MiniStat({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone?: "danger" | "mint" }) {
  const c = tone === "danger" ? "#FDA4AF" : tone === "mint" ? "#6EE7B7" : "#BFDBFE";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, borderRadius: 16, padding: "11px 13px",
      background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.18)",
      backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
    }}>
      <span style={{ color: c, display: "inline-flex" }}>{icon}</span>
      <span>
        <span className="num" style={{ display: "block", fontSize: 24, fontWeight: 800, lineHeight: 1, color: tone === "danger" && value ? "#FDA4AF" : "#fff" }}>{value}</span>
        <span style={{ display: "block", fontSize: 11.5, color: "rgba(255,255,255,0.82)", marginTop: 3 }}>{label}</span>
      </span>
    </div>
  );
}

function PrefRow({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 2px", borderTop: `1px solid ${T.line}` }}>
      <span style={{ flex: 1, fontSize: 12.5, color: T.ink }}>{label}</span>
      <Toggle on={on} onChange={onChange} label={label} />
    </div>
  );
}

function PersonCard({ p, s, todayKey, channel, onTasks, onAssign, onEdit, onShare }: {
  p: Person; s: PersonStats; todayKey: string; channel: PhoneChannel | null;
  onTasks: () => void; onAssign: () => void; onEdit: () => void; onShare: () => void;
}) {
  const tilt = useTilt<HTMLDivElement>(4);
  return (
    <div ref={tilt} className="tj-tilt">
      <article className="tj-card tj-flush" style={{ ...card, padding: 0, overflow: "hidden" }}>
        {/* כריכה אישית בגוון של האדם */}
        <div style={{
          position: "relative", padding: "16px 16px 14px", color: "#fff",
          background: `linear-gradient(245deg, ${PERSON_COLORS[p.color].b} 0%, ${PERSON_COLORS[p.color].a} 100%)`,
        }}>
          <div aria-hidden="true" style={{
            position: "absolute", inset: 0, pointerEvents: "none",
            background: "radial-gradient(120px 120px at 12% 20%, rgba(255,255,255,0.28), transparent 70%), radial-gradient(200px 90px at 90% 120%, rgba(0,0,0,0.22), transparent 70%)",
          }} />
          <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ borderRadius: 99, padding: 3, background: "rgba(255,255,255,0.25)", display: "inline-flex" }}>
              <Avatar name={p.name} color={p.color} size={48} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, fontFamily: "var(--font-display)", letterSpacing: "-0.02em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textShadow: "0 1px 10px rgba(0,0,0,0.2)" }}>
                  {p.name}
                </h3>
                {p.isManager && <span style={{ display: "inline-flex" }} title="מנהל">{Ic.crown(14)}</span>}
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.88)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                {p.isManager ? "היומן שלך" : p.role || "איש צוות"}
                <span>·</span>
                <span title={channel ? "מקבל/ת התראות לטלפון" : "עוד לא הופעלו התראות לטלפון"} style={{
                  display: "inline-flex", alignItems: "center", gap: 3, fontWeight: 700,
                  background: channel ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.18)", borderRadius: 99, padding: "1px 8px",
                }}>
                  {Ic.bell(10)} {channel ? CHANNEL_LABEL[channel] : "בלי התראות"}
                </span>
              </div>
            </div>
            <ProgressRing value={s.pct / 100} size={56} stroke={5} color="#fff" track="rgba(255,255,255,0.28)" label={`${s.pct}% מהמשימות הושלמו`}>
              <span className="num" style={{ fontSize: 13.5, fontWeight: 800, color: "#fff" }}>{s.pct}%</span>
            </ProgressRing>
          </div>
        </div>
        <div style={{ padding: "0 16px 16px" }}>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginTop: 14 }}>
          <Cell label="להיום" value={s.roots.today} />
          <Cell label="בתהליך" value={s.roots.progress} />
          <Cell label="באיחור" value={s.roots.overdue} danger={s.roots.overdue > 0} />
          <Cell label="השבוע ✓" value={s.doneWeek.length} mint />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 11.5, color: T.ink3 }}>
          {Ic.clock(12)} פעילות אחרונה: {relDay(s.lastActive, todayKey)}
          <span style={{ marginInlineStart: "auto" }} className="num">{s.roots.open} פתוחות</span>
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
          {p.isManager ? (
            <a href={journalPath(p.id)} style={{ ...ghostBtn, textDecoration: "none", flex: 1, whiteSpace: "nowrap" }}>
              {Ic.arrowUpLeft(12)} ליומן שלי
            </a>
          ) : (
            <button onClick={onTasks} style={{ ...softBtn, flex: 1.4, whiteSpace: "nowrap" }}>{Ic.layers(12)} כל המשימות</button>
          )}
          {!p.isManager && (
            <>
              <button onClick={onAssign} style={{ ...ghostBtn, flex: 1, whiteSpace: "nowrap" }}>{Ic.send(12)} הקצאה</button>
              <button onClick={onShare} aria-label={`שיתוף הקישור של ${p.name}`} title="שיתוף הקישור" style={{ ...ghostBtn, padding: "7px 10px" }}>{Ic.share(13)}</button>
              <button onClick={onEdit} aria-label={`עריכת ${p.name}`} title="עריכה" style={{ ...ghostBtn, padding: "7px 10px" }}>{Ic.dots(14)}</button>
            </>
          )}
        </div>
        </div>
      </article>
    </div>
  );
}

function Cell({ label, value, danger, mint }: { label: string; value: number; danger?: boolean; mint?: boolean }) {
  return (
    <div style={{ background: T.bg2, borderRadius: 12, padding: "8px 6px", textAlign: "center" }}>
      <div className="num" style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.1, color: danger ? T.danger : mint ? T.mint : T.ink }}>{value}</div>
      <div style={{ fontSize: 10.5, color: T.ink3, marginTop: 1 }}>{label}</div>
    </div>
  );
}

function TeamTaskRow({ p, t, hint, hintTone, onOpen, onDone }: {
  p: Person; t: Task; todayKey: string; hint: string; hintTone: "danger"; onOpen: () => void; onDone: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: alpha(T.danger, 4), borderRadius: 14, padding: "9px 11px" }}>
      <Avatar name={p.name} color={p.color} size={28} />
      <button onClick={onOpen} style={{ flex: 1, minWidth: 0, textAlign: "start", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", color: T.ink }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title || "ללא שם"}</span>
        <span style={{ display: "block", fontSize: 11, color: hintTone === "danger" ? T.danger : T.ink3 }}>
          {p.name} · {hint} · {STATUS_LABELS[t.status]}
        </span>
      </button>
      <button onClick={onDone} title="סימון כבוצע" aria-label={`סימון "${t.title}" כבוצע`} style={{
        width: 32, height: 32, borderRadius: 99, border: `1px solid ${T.line}`, background: T.surface,
        color: T.mint, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>{Ic.check(14)}</button>
    </div>
  );
}

// ---- קצב השלמה: עמודות מוערמות לפי אדם, 14 ימים ----
function PaceChart({ people, stats, todayKey }: { people: Person[]; stats: Record<string, PersonStats>; todayKey: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const days = useMemo(() => {
    const base = new Date(`${todayKey}T12:00:00`);
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(base.getTime() - (13 - i) * 86400000);
      return { key: toDateKey(d), d };
    });
  }, [todayKey]);
  const counts = days.map(({ key }) =>
    people.map((p) => stats[p.id].all.filter((t) => isDone(t) && t.endDate === key).length));
  const totals = counts.map((c) => c.reduce((a, b) => a + b, 0));
  const max = Math.max(1, ...totals);
  const total = totals.reduce((a, b) => a + b, 0);
  const H = 120;

  return (
    <section className="tj-card" style={{ ...card, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ width: 30, height: 30, borderRadius: 10, background: T.accentSoft, color: T.accent, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{Ic.chart(15)}</span>
        <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 800, fontFamily: "var(--font-display)", letterSpacing: "-0.015em" }}>משימות שהושלמו · 14 ימים</h3>
        <span style={{ fontSize: 11.5, color: T.ink3, marginInlineStart: "auto" }}>סה״כ <span className="num" style={{ color: T.ink, fontWeight: 700 }}>{total}</span></span>
      </div>
      {/* מקרא — הזהות לא נשענת על צבע בלבד */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 12 }}>
        {people.map((p) => (
          <span key={p.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: T.ink2 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: personVar(p.color) }} />{p.name}
          </span>
        ))}
      </div>
      <div style={{ position: "relative" }}>
        {hover !== null && (
          <div role="tooltip" style={{
            position: "absolute", bottom: H + 8, zIndex: 3, pointerEvents: "none",
            insetInlineStart: `clamp(0px, calc(${(hover / 14) * 100}% - 60px), calc(100% - 150px))`,
            background: T.surface, border: `1px solid ${T.lineStrong}`, borderRadius: 12, padding: "8px 10px",
            boxShadow: T.shadowMd, minWidth: 140, fontSize: 11.5,
          }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              {days[hover].d.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "numeric" })}
            </div>
            {people.map((p, i) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, color: T.ink2 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: personVar(p.color) }} />
                {p.name}<span className="num" style={{ marginInlineStart: "auto", color: T.ink, fontWeight: 600 }}>{counts[hover][i]}</span>
              </div>
            ))}
          </div>
        )}
        {/* הזמן זורם מימין לשמאל, כמו לוח השנה וציר היום */}
        <div style={{ position: "relative", height: H, display: "grid", gridTemplateColumns: "repeat(14, 1fr)", gap: 4, alignItems: "end" }}
          onMouseLeave={() => setHover(null)}>
          <span aria-hidden="true" className="num" style={{ position: "absolute", top: -6, insetInlineEnd: 0, fontSize: 9.5, color: T.ink3 }}>{max}</span>
          <span aria-hidden="true" style={{ position: "absolute", top: 0, insetInlineStart: 0, insetInlineEnd: 18, height: 1, background: T.line, opacity: 0.7 }} />
          {days.map((day, i) => {
            const segs = people.map((p, j) => ({ p, n: counts[i][j] })).filter((x) => x.n > 0);
            return (
              <div key={day.key} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}
                aria-label={`${day.d.toLocaleDateString("he-IL")}: ${totals[i]} הושלמו`}
                style={{
                  height: "100%", display: "flex", flexDirection: "column-reverse", gap: 2, cursor: "default", outline: "none",
                  // מסילה לכל יום: גם יום ריק נראה כעמודה, לא כקו
                  background: hover === i ? alpha("var(--tj-accent)", 10) : alpha("var(--tj-ink3)", 8), borderRadius: 8, overflow: "hidden",
                }}>
                {segs.map(({ p, n }, k) => (
                  <span key={p.id} style={{
                    height: `${(n / max) * (H - 18)}px`, minHeight: 6,
                    background: `linear-gradient(180deg, ${personVar(p.color)}, color-mix(in srgb, ${personVar(p.color)} 70%, transparent))`,
                    borderRadius: k === segs.length - 1 ? "8px 8px 2px 2px" : 2,
                    opacity: hover === null || hover === i ? 1 : 0.45,
                    transition: "opacity .2s",
                  }} />
                ))}
              </div>
            );
          })}
        </div>
        <div style={{ height: 1, background: T.lineStrong }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(14, 1fr)", gap: 4, marginTop: 5 }}>
          {days.map((day, i) => (
            <span key={day.key} className="num" style={{ fontSize: 9, color: day.key === todayKey ? T.accent : T.ink3, textAlign: "center", fontWeight: day.key === todayKey ? 700 : 400 }}>
              {i % 2 === 1 || day.key === todayKey ? `${day.d.getDate()}.${day.d.getMonth() + 1}` : ""}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function Onboarding({ onAdd, onNotify, phoneLinked, suggestedName }: { onAdd: () => void; onNotify: () => void; phoneLinked: boolean; suggestedName: string }) {
  const steps = [
    { icon: Ic.userPlus(18), title: "מוסיפים איש צוות", text: "שם וצבע — ונוצר יומן מלא משלו, עם כל היכולות שיש לך." },
    { icon: Ic.share(18), title: "שולחים את הקישור", text: "בוואטסאפ או בהעתקה. מוסיפים למסך הבית ומפעילים התראות — בחינם." },
    { icon: Ic.users(18), title: "רואים את כולם כאן", text: "מה פתוח, מה באיחור, מה הושלם — ומקצים משימות בלחיצה." },
    { icon: Ic.phone(18), title: "עדכון ישר לטלפון", text: "כשמישהו בצוות מסיים או מוסיף משימה — התראה קופצת בטלפון שלך." },
  ];
  return (
    <section className="tj-card" style={{ ...card, padding: "22px 20px" }}>
      <div className="tj-onboard" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {steps.map((s, i) => (
          <div key={s.title} style={{ background: T.bg2, borderRadius: 18, padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ width: 38, height: 38, borderRadius: 12, background: T.accentSoft, color: T.accent, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{s.icon}</span>
              <span className="num" style={{ fontSize: 11, color: T.ink3, marginInlineStart: "auto" }}>{i + 1}/4</span>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--font-display)" }}>{s.title}</div>
            <div style={{ fontSize: 12.5, color: T.ink2, lineHeight: 1.6, marginTop: 4 }}>{s.text}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        <button onClick={onAdd} style={{ ...primaryBtn, height: 44 }}>{Ic.userPlus(15)} {suggestedName ? `הוספת ${suggestedName} לצוות` : "הוספת איש צוות ראשון"}</button>
        {!phoneLinked && <button onClick={onNotify} style={{ ...softBtn, height: 44, padding: "0 16px" }}>{Ic.bell(13)} קודם, התראות לטלפון שלי</button>}
      </div>
      <style>{`@media (max-width: 900px) { .tj-onboard { grid-template-columns: 1fr 1fr !important; } } @media (max-width: 520px) { .tj-onboard { grid-template-columns: 1fr !important; } }`}</style>
    </section>
  );
}

// ============ כל המשימות של איש צוות: רשימה מלאה עם שליטה מלאה ============

type TasksTab = "open" | "progress" | "overdue" | "critical" | "done" | "all";
type TasksSort = "due" | "updated" | "created";

const TAB_LABEL: Record<TasksTab, string> = {
  open: "פתוחות", progress: "בתהליך", overdue: "באיחור", critical: "קריטיות", done: "הושלמו", all: "הכל",
};

function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(toKey) - Date.parse(fromKey)) / 86400000);
}

function updatedLabel(iso: string | undefined, todayKey: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const key = toDateKey(d);
  if (key === todayKey) return `עודכן היום ${d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}`;
  return `עודכן ${relDay(key, todayKey)}`;
}

function MemberTasksPanel({ members, selected, onSelect, slice, todayKey, onOpen, onStatus, onDelete, onNudge, onAssign }: {
  members: Person[];
  selected: string;
  onSelect: (id: string) => void;
  slice: JournalSlice | undefined;
  todayKey: string;
  onOpen: (taskId: string) => void;
  onStatus: (t: Task, s: TaskStatus) => void;
  onDelete: (root: Task) => void;
  onNudge: (t: Task) => void;
  onAssign: () => void;
}) {
  const [tab, setTab] = useState<TasksTab>("open");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<TasksSort>("due");
  const person = members.find((m) => m.id === selected) ?? members[0];
  const roots = useMemo(() => slice?.tasks ?? [], [slice]);
  const cats = useMemo(() => new Map((slice?.categories ?? []).map((c) => [c.id, c])), [slice]);

  const tree = (r: Task) => [r, ...flattenTasks(r.subtasks)];
  const isOverdue = (t: Task) => !isDone(t) && !!t.dueDate && t.dueDate < todayKey;
  const match: Record<TasksTab, (r: Task) => boolean> = {
    open: (r) => !isDone(r),
    progress: (r) => tree(r).some((t) => t.status === "in_progress"),
    overdue: (r) => tree(r).some(isOverdue),
    critical: (r) => tree(r).some((t) => t.critical && !isDone(t)),
    done: (r) => isDone(r),
    all: () => true,
  };
  const counts = (Object.keys(TAB_LABEL) as TasksTab[]).map((k) => [k, roots.filter(match[k]).length] as const);

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = roots
    .filter(match[tab])
    .filter((r) => !words.length || tree(r).some((t) => {
      const hay = [t.title, t.description, t.notes, t.categoryId ? cats.get(t.categoryId)?.name : ""].join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    }))
    .sort((a, b) => {
      if (sort === "updated") return (slice?.updatedAt?.[b.id] ?? b.createdAt).localeCompare(slice?.updatedAt?.[a.id] ?? a.createdAt);
      if (sort === "created") return b.createdAt.localeCompare(a.createdAt);
      return (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
    });

  const order: TaskStatus[] = ["todo", "in_progress", "done"];

  return (
    <section id="tj-member-tasks" className="tj-card" style={{ ...card, padding: 16, scrollMarginTop: 84 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <Avatar name={person.name} color={person.color} size={34} />
        <div style={{ flex: 1, minWidth: 160 }}>
          <h3 style={{ margin: 0, fontSize: 16.5, fontWeight: 800, fontFamily: "var(--font-display)", letterSpacing: "-0.015em" }}>
            כל המשימות של {person.name}
          </h3>
          <div style={{ fontSize: 11.5, color: T.ink3 }}>שינוי כאן נשמר ישר ביומן שלה ומתעדכן אצלה מיד</div>
        </div>
        <button onClick={onAssign} style={{ ...softBtn, height: 34 }}>{Ic.send(12)} משימה חדשה ל{firstWord(person.name)}</button>
        <a href={journalPath(person.id)} style={{ ...ghostBtn, height: 34, textDecoration: "none" }}>{Ic.arrowUpLeft(12)} היומן שלה</a>
      </div>

      {members.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }} role="radiogroup" aria-label="של מי">
          {members.map((m) => {
            const on = m.id === selected;
            return (
              <button key={m.id} role="radio" aria-checked={on} onClick={() => onSelect(m.id)} style={{
                display: "inline-flex", alignItems: "center", gap: 7, padding: "4px 12px 4px 5px", borderRadius: 99,
                border: `1px solid ${on ? alpha(personVar(m.color), 55) : T.line}`,
                background: on ? alpha(personVar(m.color), 12) : "transparent",
                cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: on ? 700 : 500, color: T.ink,
              }}>
                <Avatar name={m.name} color={m.color} size={22} /> {m.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="no-scrollbar" role="tablist" aria-label="סינון לפי מצב" style={{ display: "flex", gap: 4, overflowX: "auto", background: T.bg2, borderRadius: 13, padding: 3, marginBottom: 10 }}>
        {counts.map(([k, n]) => {
          const on = tab === k;
          const warn = (k === "overdue" || k === "critical") && n > 0;
          return (
            <button key={k} role="tab" aria-selected={on} onClick={() => setTab(k)} style={{
              display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0,
              border: "none", borderRadius: 10, padding: "7px 12px", cursor: "pointer", fontFamily: "inherit",
              fontSize: 12.5, fontWeight: on ? 700 : 500,
              background: on ? T.surface : "transparent",
              boxShadow: on ? `0 1px 2px var(--tj-shadow), inset 0 0 0 1px ${T.line}` : "none",
              color: on ? T.ink : T.ink2,
            }}>
              {TAB_LABEL[k]}
              <span className="num" style={{
                fontSize: 11, fontWeight: 700, borderRadius: 99, padding: "0 7px",
                color: warn ? T.danger : on ? T.accent : T.ink3,
                background: warn ? T.dangerSoft : on ? T.accentSoft : "transparent",
              }}>{n}</span>
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
          <span style={{ position: "absolute", insetInlineStart: 11, top: "50%", transform: "translateY(-50%)", color: T.ink3, pointerEvents: "none" }}>{Ic.search(14)}</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`חיפוש במשימות של ${firstWord(person.name)}…`}
            aria-label="חיפוש במשימות" style={{ ...inputStyle, width: "100%", paddingInlineStart: 33, height: 38 }} />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value as TasksSort)} aria-label="מיון" style={{ ...inputStyle, height: 38, padding: "0 10px" }}>
          <option value="due">לפי תאריך יעד</option>
          <option value="updated">לפי עדכון אחרון</option>
          <option value="created">לפי תאריך פתיחה</option>
        </select>
      </div>

      {list.length === 0 ? (
        <EmptyLine icon={tab === "overdue" || tab === "critical" ? Ic.sparkle(16) : Ic.inbox(16)}
          text={roots.length === 0 ? `ביומן של ${firstWord(person.name)} עוד אין משימות.` : q ? "אין משימות שתואמות לחיפוש." : `אין משימות ${TAB_LABEL[tab]}.`} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {list.map((r) => {
            const done = isDone(r);
            const cat = r.categoryId ? cats.get(r.categoryId) : undefined;
            const sub = countSubtasks(r);
            const late = isOverdue(r) ? daysBetween(r.dueDate!, todayKey) : 0;
            const subLate = !late && tree(r).slice(1).some(isOverdue);
            const upd = updatedLabel(slice?.updatedAt?.[r.id], todayKey);
            return (
              <div key={r.id} style={{
                display: "flex", alignItems: "center", gap: 10, borderRadius: 14, padding: "10px 12px",
                background: r.critical && !done ? alpha(T.danger, 5) : T.bg2, opacity: done ? 0.62 : 1,
              }}>
                <button onClick={() => onStatus(r, order[(order.indexOf(r.status) + 1) % 3])}
                  title={`סטטוס: ${STATUS_LABELS[r.status]} (לחיצה מקדמת)`} aria-label={`סטטוס: ${STATUS_LABELS[r.status]} — לחיצה מקדמת`}
                  style={{ background: "none", border: "none", padding: 2, cursor: "pointer", color: STATUS_COLORS[r.status], display: "inline-flex", flexShrink: 0 }}>
                  <StatusIcon status={r.status} size={20} />
                </button>
                <button onClick={() => onOpen(r.id)} style={{
                  flex: 1, minWidth: 0, textAlign: "start", background: "none", border: "none", padding: 0,
                  cursor: "pointer", fontFamily: "inherit", color: T.ink,
                }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, textDecoration: done ? "line-through" : "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                      {r.title || "ללא שם"}
                    </span>
                    {r.critical && !done && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, fontWeight: 700, color: T.danger }}>{Ic.flame(11)} קריטית</span>}
                    {r.assignedBy && <span style={{ fontSize: 10, fontWeight: 700, color: T.accent, background: T.accentSoft, borderRadius: 99, padding: "1px 8px" }}>מ{MANAGER_NAME}</span>}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 4, fontSize: 11, color: T.ink3 }}>
                    <span style={{ color: T.ink2, fontWeight: 600 }}>{STATUS_LABELS[r.status]}</span>
                    {cat && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: T.ink2 }}><span style={{ width: 7, height: 7, borderRadius: 99, background: cat.color }} />{cat.name}</span>}
                    {r.dueDate && (
                      <span className="num" style={{ color: late ? T.danger : T.ink2, fontWeight: late ? 700 : 400 }}>
                        {late ? `באיחור ${late === 1 ? "יום" : `${late} ימים`} · ` : "יעד "}{formatDateHe(r.dueDate)}
                      </span>
                    )}
                    {subLate && <span style={{ color: T.danger }}>שלב באיחור</span>}
                    {sub.total > 0 && <span className="num">שלבים {sub.done}/{sub.total}</span>}
                    {r.reminders.some((x) => !x.fired) && <span style={{ display: "inline-flex" }} title="יש תזכורת">{Ic.clock(11)}</span>}
                    {upd && <span>{upd}</span>}
                  </span>
                </button>
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  {!done && (
                    <IconAction label={`בקשת עדכון מ${firstWord(person.name)} על "${r.title}"`} onClick={() => onNudge(r)} color={T.accent}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></svg>
                    </IconAction>
                  )}
                  {!done ? (
                    <IconAction label={`סימון "${r.title}" כבוצע`} onClick={() => onStatus(r, "done")} color={T.mint}>{Ic.check(14)}</IconAction>
                  ) : (
                    <IconAction label={`פתיחה מחדש של "${r.title}"`} onClick={() => onStatus(r, "todo")} color={T.ink2}>{Ic.refresh(13)}</IconAction>
                  )}
                  <IconAction label={`מחיקת "${r.title}"`} onClick={() => onDelete(r)} color={T.ink3}>{Ic.trash(13)}</IconAction>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function IconAction({ label, onClick, color, children }: { label: string; onClick: () => void; color: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} style={{
      width: 32, height: 32, borderRadius: 99, border: `1px solid ${T.line}`, background: T.surface,
      color, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
    }}>{children}</button>
  );
}

function firstWord(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

// ============ פס הצוות בדשבורד הראשי של אופיר ============

export function TeamStrip({ todayKey, onOpenMember }: { todayKey: string; onOpenMember: (id: string) => void }) {
  const meta = useSyncExternalStore(subscribeTeamMeta, getTeamMeta, getServerTeamMeta);
  const data = useSyncExternalStore(subscribeTeamData, getTeamData, getServerTeamData);
  const members = meta.roster.members;
  useEffect(() => { if (members.length) initTeamData(); }, [members.length]);
  if (!members.length) return null;
  return (
    <section className="tj-card" style={{ ...card, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ width: 30, height: 30, borderRadius: 10, background: T.accentSoft, color: T.accent, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{Ic.users(15)}</span>
        <h2 style={{ margin: 0, fontSize: 15.5, fontWeight: 800, fontFamily: "var(--font-display)", letterSpacing: "-0.015em" }}>הצוות</h2>
        <span style={{ fontSize: 11.5, color: T.ink3 }}>לחיצה פותחת את כל המשימות</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
        {members.map((m) => {
          const slice = data.journals[m.id];
          const s = statsFor(slice?.tasks ?? [], todayKey);
          const loading = !data.loaded;
          return (
            <button key={m.id} onClick={() => onOpenMember(m.id)} style={{
              display: "flex", alignItems: "center", gap: 10, textAlign: "start", width: "100%",
              background: s.roots.overdue ? alpha(T.danger, 5) : T.bg2, border: "none", borderRadius: 14,
              padding: "10px 12px", cursor: "pointer", fontFamily: "inherit", color: T.ink,
            }}>
              <Avatar name={m.name} color={m.color} size={34} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 700 }}>{m.name}</span>
                <span className="num" style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11.5, color: T.ink2, marginTop: 2 }}>
                  {loading ? <span style={{ color: T.ink3 }}>טוען…</span> : (
                    <>
                      <span>{s.roots.open} פתוחות</span>
                      <span>{s.roots.today} להיום</span>
                      <span style={{ color: s.roots.overdue ? T.danger : T.ink2, fontWeight: s.roots.overdue ? 700 : 400 }}>{s.roots.overdue} באיחור</span>
                      <span style={{ color: T.mint }}>{s.doneWeek.length} הושלמו השבוע</span>
                    </>
                  )}
                </span>
              </span>
              <span style={{ color: T.ink3, opacity: 0.7 }}>{Ic.chevL(14)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ============ dialogs ============

function ColorPicker({ value, onChange }: { value: PersonColor; onChange: (c: PersonColor) => void }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="radiogroup" aria-label="צבע">
      {(["teal", "orange", "fuchsia", "rose", "violet", "blue"] as PersonColor[]).map((c) => (
        <button key={c} role="radio" aria-checked={value === c} aria-label={PERSON_COLORS[c].label} onClick={() => onChange(c)} style={{
          width: 34, height: 34, borderRadius: 99, border: "none", cursor: "pointer",
          background: `linear-gradient(140deg, ${PERSON_COLORS[c].a}, ${PERSON_COLORS[c].b})`,
          boxShadow: value === c ? `0 0 0 2px ${T.surface}, 0 0 0 4px ${PERSON_COLORS[c].solid}` : "none",
          display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff",
        }}>{value === c ? Ic.check(14) : null}</button>
      ))}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: T.ink2, margin: "0 0 6px" }}>{children}</label>;
}

function AddMemberDialog({ initialName = "", usedColors, onClose, onCreated }: {
  initialName?: string; usedColors: PersonColor[]; onClose: () => void; onCreated: (m: TeamMember) => void;
}) {
  const [name, setName] = useState(initialName);
  const [role, setRole] = useState("");
  const [color, setColor] = useState<PersonColor>(MEMBER_COLOR_ORDER.find((c) => !usedColors.includes(c)) ?? "teal");
  const [busy, setBusy] = useState(false);
  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try { onCreated(await addMember(name, color, role)); } finally { setBusy(false); }
  }
  return (
    <Sheet title="הוספה לצוות" icon={Ic.userPlus(16)} onClose={onClose} side="center" width={440}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, background: T.bg2, borderRadius: 16, padding: 12 }}>
            <Avatar name={name || "?"} color={color} size={48} ring />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 800, fontFamily: "var(--font-display)" }}>היומן של {name || "…"}</div>
              <div style={{ fontSize: 11.5, color: T.ink3 }}>כל היכולות של היומן שלך · צבע אישי · קישור משלו</div>
            </div>
          </div>
          <FieldLabel>שם</FieldLabel>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`למשל: ${SUGGESTED_MEMBER_NAME}`} autoFocus aria-label="שם"
            onKeyDown={(e) => { if (e.key === "Enter") create(); }} style={{ ...inputStyle, width: "100%" }} />
          <div style={{ height: 12 }} />
          <FieldLabel>תפקיד (לא חובה)</FieldLabel>
          <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="למשל: רכזת תוכן" aria-label="תפקיד" style={{ ...inputStyle, width: "100%" }} />
          <div style={{ height: 14 }} />
          <FieldLabel>צבע היומן</FieldLabel>
          <ColorPicker value={color} onChange={setColor} />
          <button onClick={create} disabled={!name.trim() || busy} style={{
            ...primaryBtn, width: "100%", height: 46, marginTop: 18, borderRadius: 14,
            ...(name.trim() ? {} : { background: T.surface2, color: T.ink3, boxShadow: "none" }),
          }}>
            {Ic.userPlus(15)} {busy ? "יוצר…" : "יצירת היומן"}
          </button>
        </div>
    </Sheet>
  );
}

function ShareDialog({ member, onClose }: { member: TeamMember; onClose: () => void }) {
  const { toast } = useToast();
  const url = journalUrl(member.id);
  const msg = [
    `היי ${member.name}!`,
    `זה יומן המשימות שלך: ${url}`,
    "",
    "כדאי: להוסיף אותו למסך הבית (שיתוף ← הוספה למסך הבית),",
    "ולהפעיל התראות בכפתור הפעמון (חינם) — כך תזכורות ומשימות חדשות יקפצו בטלפון.",
  ].join("\n");
  async function copy() {
    try { await navigator.clipboard.writeText(url); toast("הקישור הועתק", "success"); }
    catch { toast("ההעתקה נכשלה — סמנו והעתיקו ידנית", "error"); }
  }
  return (
    <Sheet title={`הקישור של ${member.name}`} icon={Ic.link(16)} onClose={onClose} side="center" width={460}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <Avatar name={member.name} color={member.color} size={44} ring />
        <p style={{ margin: 0, fontSize: 13, color: T.ink2, lineHeight: 1.6 }}>
          זה הקישור היחיד ליומן של {member.name}. כל מי שמחזיק בו יכול לפתוח את היומן — שלחו אותו רק אליו/אליה.
        </p>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", background: T.bg2, borderRadius: 14, padding: 6 }}>
        <input readOnly value={url} aria-label="קישור ליומן" onFocus={(e) => e.currentTarget.select()}
          className="num" style={{ ...inputStyle, flex: 1, border: "none", background: "transparent", fontSize: 12.5, direction: "ltr" }} />
        <button onClick={copy} style={softBtn}>{Ic.copy(13)} העתקה</button>
      </div>
      <a href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer"
        style={{ ...primaryBtn, width: "100%", height: 46, marginTop: 12, borderRadius: 14, textDecoration: "none" }}>
        {Ic.share(14)} שליחה בוואטסאפ
      </a>
      <a href={journalPath(member.id)} style={{ ...ghostBtn, width: "100%", height: 40, marginTop: 8, textDecoration: "none" }}>
        {Ic.arrowUpLeft(12)} פתיחת היומן של {member.name}
      </a>
    </Sheet>
  );
}

function EditMemberDialog({ member, onClose, onShare }: { member: TeamMember; onClose: () => void; onShare: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(member.name);
  const [role, setRole] = useState(member.role ?? "");
  const [color, setColor] = useState<PersonColor>(member.color);
  async function save() {
    if (!name.trim()) return;
    await updateMember(member.id, { name: name.trim(), role: role.trim() || undefined, color });
    toast("נשמר", "success");
    onClose();
  }
  async function remove() {
    if (!confirm(`להסיר את ${member.name} מהצוות?\nהיומן וכל המשימות שלו/ה יימחקו (הגיבוי הלילי שומר עותק), והקישור יפסיק לעבוד.`)) return;
    await removeMember(member.id);
    toast(`${member.name} הוסר/ה מהצוות`, "info");
    onClose();
  }
  return (
    <Sheet title={`עריכת ${member.name}`} icon={Ic.pencil(15)} onClose={onClose} side="center" width={440}>
      <FieldLabel>שם</FieldLabel>
      <input value={name} onChange={(e) => setName(e.target.value)} aria-label="שם" style={{ ...inputStyle, width: "100%" }} />
      <div style={{ height: 12 }} />
      <FieldLabel>תפקיד</FieldLabel>
      <input value={role} onChange={(e) => setRole(e.target.value)} aria-label="תפקיד" style={{ ...inputStyle, width: "100%" }} />
      <div style={{ height: 14 }} />
      <FieldLabel>צבע היומן</FieldLabel>
      <ColorPicker value={color} onChange={setColor} />
      <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
        <button onClick={save} disabled={!name.trim()} style={{ ...primaryBtn, flex: 1, height: 44, borderRadius: 14 }}>שמירה</button>
        <button onClick={onShare} style={{ ...ghostBtn, height: 44 }}>{Ic.link(13)} קישור</button>
      </div>
      <button onClick={remove} style={{
        marginTop: 18, width: "100%", background: "transparent", border: `1px solid ${alpha(T.danger, 30)}`,
        color: T.danger, borderRadius: 12, padding: "9px 0", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
      }}>{Ic.trash(13)} הסרה מהצוות</button>
    </Sheet>
  );
}

function AssignDialog({ people, initial, todayKey, onClose, onAssigned }: {
  people: Person[];
  initial: string | null;
  todayKey: string;
  onClose: () => void;
  onAssigned: (p: Person, t: Task) => void;
}) {
  const [to, setTo] = useState<string | null>(initial);
  const [text, setText] = useState("");
  const [desc, setDesc] = useState("");
  const [due, setDue] = useState(todayKey);
  const [critical, setCritical] = useState(false);
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [busy, setBusy] = useState(false);
  const parsed = text.trim() ? parseQuickAdd(text) : null;

  // תאריך/דחיפות שזוהו מהטקסט החופשי ממלאים את השדות (אפשר לשנות אחר כך)
  function onText(v: string) {
    setText(v);
    const p = v.trim() ? parseQuickAdd(v) : null;
    if (p?.dueDate) setDue(p.dueDate);
    if (p?.critical) setCritical(true);
  }

  const person = people.find((p) => p.id === to) ?? null;

  async function send() {
    if (!person || !parsed?.title) return;
    setBusy(true);
    try {
      const t = await assignTask(person.id, {
        ...emptyTask(),
        title: parsed.title,
        description: desc.trim(),
        dueDate: due || null,
        critical,
        status,
        reminders: parsed.reminder ? [{ id: crypto.randomUUID?.() ?? String(Date.now()), datetime: parsed.reminder, note: "", fired: false }] : [],
      });
      onAssigned(person, t);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="הקצאת משימה" icon={Ic.send(16)} onClose={onClose} side="center" width={480}>
      <FieldLabel>למי</FieldLabel>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }} role="radiogroup" aria-label="למי">
        {people.map((p) => {
          const on = to === p.id;
          return (
            <button key={p.id} role="radio" aria-checked={on} onClick={() => setTo(p.id)} style={{
              display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 12px 5px 6px", borderRadius: 99,
              border: `1px solid ${on ? alpha(personVar(p.color), 55) : T.line}`,
              background: on ? alpha(personVar(p.color), 12) : "transparent",
              cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: on ? 700 : 500, color: T.ink,
            }}>
              <Avatar name={p.name} color={p.color} size={26} /> {p.name}
            </button>
          );
        })}
      </div>
      <FieldLabel>המשימה</FieldLabel>
      <input value={text} onChange={(e) => onText(e.target.value)} autoFocus aria-label="המשימה"
        placeholder={'למשל: "להכין מצגת לישיבה ביום חמישי ב-10:00"'}
        onKeyDown={(e) => { if (e.key === "Enter") send(); }}
        style={{ ...inputStyle, width: "100%", height: 46 }} />
      {parsed?.reminder && (
        <div style={{ fontSize: 11.5, color: T.accent, marginTop: 6 }}>
          {Ic.clock(11)} תזכורת תישלח אליו/אליה ב-{new Date(parsed.reminder).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}
        </div>
      )}
      <div style={{ height: 12 }} />
      <FieldLabel>פרטים (לא חובה)</FieldLabel>
      <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} aria-label="פרטים"
        style={{ ...inputStyle, width: "100%", resize: "vertical", lineHeight: 1.5 }} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
        <div>
          <FieldLabel>תאריך יעד</FieldLabel>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="תאריך יעד" style={{ ...inputStyle, width: "100%" }} />
        </div>
        <div>
          <FieldLabel>סטטוס</FieldLabel>
          <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} aria-label="סטטוס" style={{ ...inputStyle, width: "100%" }}>
            <option value="todo">{STATUS_LABELS.todo}</option>
            <option value="in_progress">{STATUS_LABELS.in_progress}</option>
          </select>
        </div>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, fontSize: 13, cursor: "pointer" }}>
        <Toggle on={critical} onChange={setCritical} label="קריטית" />
        <span style={{ color: critical ? T.danger : T.ink2, fontWeight: critical ? 700 : 500, display: "inline-flex", alignItems: "center", gap: 5 }}>
          {Ic.flame(13)} משימה קריטית
        </span>
      </label>
      <button onClick={send} disabled={!person || !parsed?.title || busy} style={{
        ...primaryBtn, width: "100%", height: 48, marginTop: 18, borderRadius: 14,
        ...(person && parsed?.title ? {} : { background: T.surface2, color: T.ink3, boxShadow: "none" }),
      }}>
        {Ic.send(15)} {busy ? "שולח…" : person ? `שליחה ל${person.name}` : "בחרו למי"}
      </button>
      <p style={{ margin: "10px 0 0", fontSize: 11.5, color: T.ink3, textAlign: "center" }}>
        המשימה תופיע ביומן עם הסימון ״מ{MANAGER_NAME}״, ותישלח התראה לטלפון.
      </p>
    </Sheet>
  );
}

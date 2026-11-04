"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useToast } from "@/components/Toast";
import {
  type Task, type TaskStatus, flattenTasks, isDone, formatDateHe, toDateKey, findTaskInTree, emptyTask,
  STATUS_COLORS, STATUS_LABELS,
} from "@/lib/tasks";
import {
  subscribeTeamMeta, getTeamMeta, getServerTeamMeta,
  subscribeTeamData, getTeamData, getServerTeamData, initTeamData, refetchTeamData,
  addMember, updateMember, removeMember, assignTask, upsertJournalRoot, deleteJournalRoot, patchJournalTask,
  addJournalCategory, savePrefs, setManagerPin, lockManager,
} from "@/lib/team";
import {
  MANAGER_ID, MANAGER_NAME, PERSON_COLORS, MEMBER_COLOR_ORDER, personVar, journalPath,
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

type PersonStats = {
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
  const all = flattenTasks(roots);
  const open = all.filter((t) => !isDone(t));
  const weekAgo = shiftKey(todayKey, -7);
  const lastActive = all
    .flatMap((t) => [t.createdAt?.slice(0, 10), t.endDate ?? undefined])
    .filter(Boolean)
    .sort()
    .pop() ?? null;
  return {
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

export function TeamView({ todayKey, onOpenOwnTask, onOpenNotify }: {
  todayKey: string;
  onOpenOwnTask: (id: string) => void;
  onOpenNotify: () => void;
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
  const teamOpen = members.reduce((n, p) => n + stats[p.id].open.length, 0);
  const teamDoneWeek = members.reduce((n, p) => n + stats[p.id].doneWeek.length, 0);
  const teamOverdue = members.reduce((n, p) => n + stats[p.id].overdue.length, 0);
  const teamToday = members.reduce((n, p) => n + stats[p.id].dueToday.length, 0);

  // ---- dialogs ----
  const [adding, setAdding] = useState(false);
  const [assignTo, setAssignTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [shareFor, setShareFor] = useState<TeamMember | null>(null);
  const [pinFlow, setPinFlow] = useState<"change" | null>(null);
  const [openMember, setOpenMember] = useState<{ jid: string; taskId: string } | null>(null);

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
      <section className="tj-card" style={{
        ...card, padding: "18px 20px", overflow: "hidden",
        background: `radial-gradient(110% 150% at 100% 0%, ${T.accentSoft}, transparent 55%), ${T.surface}`,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2 style={{ margin: 0, fontSize: 27, fontWeight: 800, fontFamily: "var(--font-display)", letterSpacing: "-0.03em", lineHeight: 1.1 }}>
              הצוות של {MANAGER_NAME}
            </h2>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: T.ink2, lineHeight: 1.6 }}>
              {noMembers
                ? "לכל איש צוות יומן מלא משלו. כאן רואים את כולם במבט אחד ומקבלים עדכון לטלפון."
                : `${members.length} ${members.length === 1 ? "איש צוות" : "אנשי צוות"} · ${teamToday} משימות להיום · ${teamDoneWeek} הושלמו השבוע`}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!noMembers && (
              <button onClick={() => setAssignTo(members[0]?.id ?? null)} style={{ ...primaryBtn, height: 42 }}>
                {Ic.send(14)} הקצאת משימה
              </button>
            )}
            <button onClick={() => setAdding(true)} style={{ ...(noMembers ? primaryBtn : softBtn), height: 42, padding: "0 16px", fontSize: 13 }}>
              {Ic.userPlus(15)} הוספה לצוות
            </button>
          </div>
        </div>

        {!noMembers && (
          <div className="tj-team-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 16 }}>
            <MiniStat label="פתוחות בצוות" value={teamOpen} icon={Ic.layers(15)} />
            <MiniStat label="להיום" value={teamToday} icon={Ic.target(15)} />
            <MiniStat label="הושלמו השבוע" value={teamDoneWeek} icon={Ic.checkCircle(15)} tone="mint" />
            <MiniStat label="באיחור" value={teamOverdue} icon={Ic.alert(15)} tone={teamOverdue ? "danger" : undefined} />
          </div>
        )}
      </section>

      {noMembers ? (
        <Onboarding onAdd={() => setAdding(true)} onNotify={onOpenNotify} telegramLinked={!!meta.telegram[MANAGER_ID]} />
      ) : (
        <>
          {/* ===== כרטיסי אנשים ===== */}
          <div className="tj-people" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
            {loading
              ? people.map((p) => <div key={p.id} className="tj-skel" style={{ height: 228 }} />)
              : people.map((p) => (
                <PersonCard key={p.id} p={p} s={stats[p.id]} todayKey={todayKey}
                  telegram={!!meta.telegram[p.id]}
                  onAssign={() => setAssignTo(p.id)}
                  onEdit={() => { const m = meta.roster.members.find((x) => x.id === p.id); if (m) setEditing(m); }}
                  onShare={() => { const m = meta.roster.members.find((x) => x.id === p.id); if (m) setShareFor(m); }}
                />
              ))}
          </div>

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

              {/* ---- הגדרות מנהל ---- */}
              <section className="tj-card" style={{ ...card, padding: 16 }}>
                <Head icon={Ic.sliders(15)} title="עדכונים ופרטיות" />
                <button onClick={onOpenNotify} style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "start",
                  background: meta.telegram[MANAGER_ID] ? T.mintSoft : T.accentSoft, border: "none", borderRadius: 14,
                  padding: "11px 12px", cursor: "pointer", fontFamily: "inherit", marginBottom: 12,
                }}>
                  <span style={{ color: meta.telegram[MANAGER_ID] ? T.mint : T.accent, display: "inline-flex" }}>{Ic.send(17)}</span>
                  <span style={{ flex: 1 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: T.ink }}>
                      {meta.telegram[MANAGER_ID] ? "טלגרם מחובר לטלפון שלך" : "חיבור טלגרם לטלפון שלך"}
                    </span>
                    <span style={{ display: "block", fontSize: 11.5, color: T.ink2 }}>
                      {meta.telegram[MANAGER_ID] ? "עדכוני הצוות מגיעים לשם, כולל כפתורי פעולה" : "כך תדע מיד כשמישהו בצוות מסיים או מוסיף משימה"}
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
                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <button onClick={() => setPinFlow("change")} style={ghostBtn}>{Ic.lock(12)} {meta.pin ? "החלפת קוד" : "הגדרת קוד"}</button>
                  {meta.pin && (
                    <button onClick={() => { lockManager(); window.location.reload(); }} style={ghostBtn}>{Ic.logout(12)} נעילה עכשיו</button>
                  )}
                </div>
                {!meta.pin && (
                  <p style={{ margin: "10px 0 0", fontSize: 11.5, color: T.danger, lineHeight: 1.5 }}>
                    אין קוד ליומן שלך — כל מי שמחזיק בכתובת הראשית יכול לפתוח אותו.
                  </p>
                )}
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
          needsPin={!meta.pin}
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
            toast(`נשלח ל${p.name}: ${t.title}${meta.telegram[p.id] ? " · יקבל/תקבל עדכון בטלגרם" : ""}`, "success");
          }}
        />
      )}
      {editing && (
        <EditMemberDialog member={editing} onClose={() => setEditing(null)}
          onShare={() => { setShareFor(editing); setEditing(null); }} />
      )}
      {shareFor && <ShareDialog member={shareFor} onClose={() => setShareFor(null)} />}
      {pinFlow && (
        <Sheet title={meta.pin ? "החלפת קוד המנהל" : "הגדרת קוד המנהל"} icon={Ic.lock(16)} onClose={() => setPinFlow(null)} side="center" width={400}>
          <PinSetup onDone={() => { setPinFlow(null); toast("הקוד נשמר", "success"); }} />
        </Sheet>
      )}
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
        @media (max-width: 640px) {
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
      <span style={{ width: 30, height: 30, borderRadius: 10, background: bg, color: c, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</span>
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
  const c = tone === "danger" ? T.danger : tone === "mint" ? T.mint : T.accent;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: T.bg2, borderRadius: 15, padding: "10px 12px" }}>
      <span style={{ color: c, display: "inline-flex" }}>{icon}</span>
      <span>
        <span className="num" style={{ display: "block", fontSize: 21, fontWeight: 800, lineHeight: 1, color: tone === "danger" ? T.danger : T.ink }}>{value}</span>
        <span style={{ display: "block", fontSize: 11, color: T.ink2, marginTop: 2 }}>{label}</span>
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

function PersonCard({ p, s, todayKey, telegram, onAssign, onEdit, onShare }: {
  p: Person; s: PersonStats; todayKey: string; telegram: boolean;
  onAssign: () => void; onEdit: () => void; onShare: () => void;
}) {
  const tilt = useTilt<HTMLDivElement>(4);
  const pc = personVar(p.color);
  return (
    <div ref={tilt} className="tj-tilt">
      <article className="tj-card" style={{
        ...card, padding: 16, overflow: "hidden",
        background: `radial-gradient(90% 120% at 100% 0%, ${alpha(pc, 11)}, transparent 60%), ${T.surface}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Avatar name={p.name} color={p.color} size={46} ring />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <h3 style={{ margin: 0, fontSize: 16.5, fontWeight: 800, fontFamily: "var(--font-display)", letterSpacing: "-0.015em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.name}
              </h3>
              {p.isManager && <span style={{ color: pc, display: "inline-flex" }} title="מנהל">{Ic.crown(13)}</span>}
            </div>
            <div style={{ fontSize: 11.5, color: T.ink3, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              {p.isManager ? "היומן שלך" : p.role || "איש צוות"}
              <span>·</span>
              <span title={telegram ? "מחובר לטלגרם" : "לא מחובר לטלגרם"} style={{ display: "inline-flex", alignItems: "center", gap: 3, color: telegram ? T.mint : T.ink3 }}>
                {Ic.send(10)} {telegram ? "טלגרם" : "ללא טלגרם"}
              </span>
            </div>
          </div>
          <ProgressRing value={s.pct / 100} size={54} stroke={5} color={pc} label={`${s.pct}% מהמשימות הושלמו`}>
            <span className="num" style={{ fontSize: 13, fontWeight: 800 }}>{s.pct}%</span>
          </ProgressRing>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginTop: 14 }}>
          <Cell label="להיום" value={s.dueToday.length} />
          <Cell label="בתהליך" value={s.inProgress.length} />
          <Cell label="באיחור" value={s.overdue.length} danger={s.overdue.length > 0} />
          <Cell label="השבוע ✓" value={s.doneWeek.length} mint />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 11.5, color: T.ink3 }}>
          {Ic.clock(12)} פעילות אחרונה: {relDay(s.lastActive, todayKey)}
          <span style={{ marginInlineStart: "auto" }} className="num">{s.open.length} פתוחות</span>
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
          <a href={journalPath(p.id)} style={{ ...ghostBtn, textDecoration: "none", flex: 1, whiteSpace: "nowrap" }}>
            {Ic.arrowUpLeft(12)} {p.isManager ? "ליומן שלי" : "ליומן"}
          </a>
          {!p.isManager && (
            <>
              <button onClick={onAssign} style={{ ...softBtn, flex: 1, whiteSpace: "nowrap" }}>{Ic.send(12)} הקצאה</button>
              <button onClick={onShare} aria-label={`שיתוף הקישור של ${p.name}`} title="שיתוף הקישור" style={{ ...ghostBtn, padding: "7px 10px" }}>{Ic.share(13)}</button>
              <button onClick={onEdit} aria-label={`עריכת ${p.name}`} title="עריכה" style={{ ...ghostBtn, padding: "7px 10px" }}>{Ic.dots(14)}</button>
            </>
          )}
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
        <span className="num" style={{ fontSize: 11.5, color: T.ink3, marginInlineStart: "auto" }}>סה״כ {total}</span>
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
                style={{ height: "100%", display: "flex", flexDirection: "column-reverse", gap: 2, cursor: "default", outline: "none" }}>
                {segs.length === 0 ? (
                  <span style={{ height: 2, borderRadius: 2, background: T.surface2 }} />
                ) : segs.map(({ p, n }, k) => (
                  <span key={p.id} style={{
                    height: `${(n / max) * (H - 18)}px`, minHeight: 3,
                    background: personVar(p.color),
                    borderRadius: k === segs.length - 1 ? "4px 4px 1px 1px" : 1,
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

function Onboarding({ onAdd, onNotify, telegramLinked }: { onAdd: () => void; onNotify: () => void; telegramLinked: boolean }) {
  const steps = [
    { icon: Ic.userPlus(18), title: "מוסיפים איש צוות", text: "שם וצבע — ונוצר יומן מלא משלו, עם כל היכולות שיש לך." },
    { icon: Ic.share(18), title: "שולחים את הקישור", text: "בוואטסאפ או בהעתקה. מוסיפים למסך הבית ומחברים טלגרם." },
    { icon: Ic.users(18), title: "רואים את כולם כאן", text: "מה פתוח, מה באיחור, מה הושלם — ומקצים משימות בלחיצה." },
    { icon: Ic.phone(18), title: "עדכון ישר לטלפון", text: "כשמישהו בצוות מסיים או מוסיף משימה — הודעה מיידית בטלגרם." },
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
        <button onClick={onAdd} style={{ ...primaryBtn, height: 44 }}>{Ic.userPlus(15)} הוספת איש צוות ראשון</button>
        {!telegramLinked && <button onClick={onNotify} style={{ ...softBtn, height: 44, padding: "0 16px" }}>{Ic.send(13)} קודם, חיבור טלגרם לטלפון שלי</button>}
      </div>
      <style>{`@media (max-width: 900px) { .tj-onboard { grid-template-columns: 1fr 1fr !important; } } @media (max-width: 520px) { .tj-onboard { grid-template-columns: 1fr !important; } }`}</style>
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

function PinSetup({ onDone }: { onDone: () => void }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!/^\d{4}$/.test(a)) { setErr("הקוד צריך להיות 4 ספרות"); return; }
    if (a !== b) { setErr("שני הקודים לא תואמים"); return; }
    setBusy(true);
    try { await setManagerPin(a); onDone(); } catch { setErr("השמירה נכשלה — בדקו חיבור"); }
    setBusy(false);
  }
  const pinInput: React.CSSProperties = { ...inputStyle, width: "100%", fontSize: 22, letterSpacing: "0.5em", textAlign: "center", fontFamily: "var(--font-mono)", height: 52, direction: "ltr" };
  return (
    <div>
      <p style={{ margin: "0 0 14px", fontSize: 12.5, color: T.ink2, lineHeight: 1.6 }}>
        היומן שלך ודשבורד הצוות ייפתחו רק עם הקוד, פעם אחת בכל מכשיר. היומנים של הצוות נשארים פתוחים בלי קוד.
      </p>
      <FieldLabel>קוד בן 4 ספרות</FieldLabel>
      <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} value={a}
        onChange={(e) => { setA(e.target.value.replace(/\D/g, "")); setErr(""); }} style={pinInput} aria-label="קוד חדש" autoFocus />
      <div style={{ height: 10 }} />
      <FieldLabel>שוב, לאימות</FieldLabel>
      <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} value={b}
        onChange={(e) => { setB(e.target.value.replace(/\D/g, "")); setErr(""); }}
        onKeyDown={(e) => { if (e.key === "Enter") save(); }} style={pinInput} aria-label="אימות הקוד" />
      {err && <div role="alert" style={{ color: T.danger, fontSize: 12, marginTop: 8 }}>{err}</div>}
      <button onClick={save} disabled={busy} style={{ ...primaryBtn, width: "100%", height: 46, marginTop: 14, borderRadius: 14 }}>
        {Ic.lock(14)} {busy ? "שומר…" : "שמירת הקוד"}
      </button>
    </div>
  );
}

function AddMemberDialog({ needsPin, usedColors, onClose, onCreated }: {
  needsPin: boolean; usedColors: PersonColor[]; onClose: () => void; onCreated: (m: TeamMember) => void;
}) {
  const [step, setStep] = useState<"pin" | "details">(needsPin ? "pin" : "details");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [color, setColor] = useState<PersonColor>(MEMBER_COLOR_ORDER.find((c) => !usedColors.includes(c)) ?? "teal");
  const [busy, setBusy] = useState(false);
  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try { onCreated(await addMember(name, color, role)); } finally { setBusy(false); }
  }
  return (
    <Sheet title={step === "pin" ? "קודם — קוד למנהל" : "הוספה לצוות"} icon={step === "pin" ? Ic.lock(16) : Ic.userPlus(16)} onClose={onClose} side="center" width={440}>
      {step === "pin" ? (
        <PinSetup onDone={() => setStep("details")} />
      ) : (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, background: T.bg2, borderRadius: 16, padding: 12 }}>
            <Avatar name={name || "?"} color={color} size={48} ring />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 800, fontFamily: "var(--font-display)" }}>היומן של {name || "…"}</div>
              <div style={{ fontSize: 11.5, color: T.ink3 }}>כל היכולות של היומן שלך · צבע אישי · קישור משלו</div>
            </div>
          </div>
          <FieldLabel>שם</FieldLabel>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: נועה" autoFocus aria-label="שם"
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
      )}
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
    "ולחבר טלגרם מתוך היומן (כפתור הפעמון) — כך תזכורות ומשימות חדשות יגיעו ישר לטלפון.",
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

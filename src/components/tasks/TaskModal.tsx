"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/Toast";
import {
  type Task, type TaskCategory, type TaskFile, type TaskNature, type TaskStatus,
  emptyTask, uid, isDone, updateTaskInTree, removeTaskFromTree, countSubtasks,
  formatDateHe, formatDateTimeHe, isoToLocalInput, localInputToIso,
  NATURE_LABELS, NATURE_COLORS, STATUS_LABELS, STATUS_COLORS, CATEGORY_COLOR_CHOICES,
} from "@/lib/tasks";
import { T, alpha, chip, inputStyle, Ic, StatusIcon } from "./ui";
import { celebrate } from "@/lib/celebrate";

const MAX_FILE_BYTES = 1.5 * 1024 * 1024;

function pathToTask(root: Task, id: string): string[] | null {
  if (root.id === id) return [root.id];
  for (const s of root.subtasks) {
    const p = pathToTask(s, id);
    if (p) return [root.id, ...p];
  }
  return null;
}

function taskAtPath(root: Task, path: string[]): Task {
  let cur = root;
  for (const id of path.slice(1)) {
    const next = cur.subtasks.find((s) => s.id === id);
    if (!next) return cur;
    cur = next;
  }
  return cur;
}

export function TaskModal({ root, focusId, categories, onSave, onDelete, onAddCategory, onClose, isNew }: {
  root: Task;
  focusId: string;
  isNew?: boolean;
  categories: TaskCategory[];
  onSave: (updated: Task) => void;
  onDelete: (id: string) => void;
  onAddCategory: (name: string, color: string) => TaskCategory | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Task>(() => structuredClone(root));
  const [path, setPath] = useState<string[]>(() => pathToTask(root, focusId) ?? [root.id]);
  const [dirty, setDirty] = useState(false);

  const [addingCat, setAddingCat] = useState(false);
  const [catName, setCatName] = useState("");
  const [catColor, setCatColor] = useState(CATEGORY_COLOR_CHOICES[0]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const current = useMemo(() => taskAtPath(draft, path), [draft, path]);
  const isRoot = path.length === 1;

  // סגירה בכל דרך שאינה "ביטול" שומרת שינויים אוטומטית — בלי זה, הקשה על הרקע
  // בנייד (או Escape) הייתה זורקת את כל מה שהוקלד, כולל משימה חדשה שלמה
  function requestClose() {
    const titled = draft.title.trim().length > 0;
    if (dirty && titled) {
      onSave(draft);
      toast("נשמר", "success");
      onClose();
      return;
    }
    if (dirty && !titled && !isNew && !confirm("למשימה אין שם והשינויים לא יישמרו — לסגור בכל זאת?")) return;
    onClose();
  }
  const requestCloseRef = useRef(requestClose);
  useEffect(() => { requestCloseRef.current = requestClose; });

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") requestCloseRef.current(); }
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, []);

  function patch(p: Partial<Task>) {
    setDraft((d) => {
      const asRoot = d.id === current.id ? { ...d, ...p } : null;
      return asRoot ?? { ...d, subtasks: updateTaskInTree(d.subtasks, current.id, p) };
    });
    setDirty(true);
  }

  function setStatus(s: TaskStatus) {
    if (s === "done" && current.status !== "done") celebrate();
    patch({
      status: s,
      endDate: s === "done" && !current.endDate ? new Date().toISOString().slice(0, 10) : current.endDate,
    });
  }

  function save() {
    if (!draft.title.trim()) {
      toast("למשימה חייב להיות שם", "error");
      return;
    }
    onSave(draft);
    setDirty(false);
    toast("נשמר", "success");
    onClose();
  }

  function addSubtask() {
    const sub: Task = { ...emptyTask(), title: "" };
    setDraft((d) =>
      d.id === current.id
        ? { ...d, subtasks: [...d.subtasks, sub] }
        : { ...d, subtasks: updateTaskInTree(d.subtasks, current.id, { subtasks: [...current.subtasks, sub] }) }
    );
    setDirty(true);
    setPath((p) => [...p, sub.id]);
  }

  function deleteCurrent() {
    if (isRoot) {
      if (confirm("למחוק את המשימה כולה, כולל כל השלבים?")) onDelete(draft.id);
      return;
    }
    if (!confirm("למחוק את השלב הזה, כולל תתי-השלבים שלו?")) return;
    const idToRemove = current.id;
    setDraft((d) => ({ ...d, subtasks: removeTaskFromTree(d.subtasks, idToRemove) }));
    setDirty(true);
    setPath((p) => p.slice(0, -1));
  }

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const added: TaskFile[] = [];
    for (const f of Array.from(list)) {
      if (f.size > MAX_FILE_BYTES) {
        toast(`"${f.name}" גדול מדי (מקסימום 1.5MB לקובץ)`, "error");
        continue;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(f);
      }).catch(() => null as string | null);
      if (dataUrl) added.push({ id: uid(), name: f.name, type: f.type, size: f.size, dataUrl });
    }
    if (added.length) patch({ files: [...current.files, ...added] });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function submitNewCategory() {
    if (!catName.trim()) return;
    const cat = onAddCategory(catName, catColor);
    if (cat) {
      patch({ categoryId: cat.id });
      setCatName("");
      setAddingCat(false);
    }
  }

  const breadcrumbTasks = path.map((_, i) => taskAtPath(draft, path.slice(0, i + 1)));

  return (
    <div
      onClick={requestClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100, background: "rgba(4,9,18,0.72)",
        backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 14,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-mobile-full"
        style={{
          background: T.surface, borderRadius: 18, width: "100%", maxWidth: 680,
          maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden",
          border: `1px solid ${T.lineStrong}`, color: T.ink,
          boxShadow: "0 24px 70px rgba(0,0,0,0.55)",
        }}
      >
        {/* header */}
        <div style={{ padding: "16px 20px 14px", borderBottom: `1px solid ${T.line}`, flexShrink: 0, position: "relative" }}>
          <div style={{ position: "absolute", top: 0, insetInline: 0, height: 2.5, background: T.grad }} />
          {path.length > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", marginBottom: 10, fontSize: 11.5 }}>
              {breadcrumbTasks.map((t, i) => (
                <span key={t.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  {i > 0 && <span style={{ color: T.ink3, display: "inline-flex" }}>{Ic.chevL(10)}</span>}
                  {i < breadcrumbTasks.length - 1 ? (
                    <button onClick={() => setPath(path.slice(0, i + 1))} style={{
                      background: T.surface2, border: "none", color: T.ink2,
                      borderRadius: 99, padding: "3px 11px", fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                    }}>
                      {t.title || "ללא שם"}
                    </button>
                  ) : (
                    <span style={{ fontWeight: 600, color: T.ink2, padding: "3px 4px", fontSize: 11 }}>{t.title || "שלב חדש"}</span>
                  )}
                </span>
              ))}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <input
                value={current.title}
                onChange={(e) => patch({ title: e.target.value })}
                placeholder={isRoot ? "שם המשימה…" : "שם השלב…"}
                autoFocus={!current.title}
                style={{
                  width: "100%", background: "transparent", border: "none", outline: "none",
                  color: T.ink, fontSize: 19, fontWeight: 700, fontFamily: "var(--font-display)",
                  borderBottom: `1px dashed ${T.lineStrong}`, paddingBottom: 5,
                }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8, fontSize: 11, color: T.ink3 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  {Ic.calendar(12)} <span className="num">נפתחה ב־{formatDateHe(current.createdAt)}</span>
                </span>
                {current.critical && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: T.danger }}>
                    {Ic.flame(12)} קריטית
                  </span>
                )}
              </div>
            </div>
            <button onClick={requestClose} title="סגירה" style={{
              background: T.surface2, border: "none", color: T.ink2,
              width: 30, height: 30, borderRadius: 9, cursor: "pointer", flexShrink: 0,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}>{Ic.x(14)}</button>
          </div>
        </div>

        {/* body */}
        <div style={{ overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16, background: T.bg2 }}>

          {/* status + flags */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "inline-flex", gap: 2, background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10, padding: 3 }}>
              {(Object.keys(STATUS_LABELS) as TaskStatus[]).map((s) => {
                const active = current.status === s;
                return (
                  <button key={s} onClick={() => setStatus(s)} style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    background: active ? `${STATUS_COLORS[s]}22` : "transparent",
                    color: active ? STATUS_COLORS[s] : T.ink3,
                    border: "none", borderRadius: 8, padding: "6px 13px",
                    fontSize: 12, fontWeight: active ? 700 : 400, cursor: "pointer", fontFamily: "inherit",
                  }}>
                    <StatusIcon status={s} size={13} />
                    {STATUS_LABELS[s]}
                  </button>
                );
              })}
            </div>
            <button onClick={() => patch({ critical: !current.critical })} style={{
              ...chip(T.danger, current.critical),
              padding: "7px 14px",
            }}>
              {Ic.flame(13)} {current.critical ? "קריטית" : "סימון כקריטית"}
            </button>
          </div>

          {/* nature */}
          <Field label="מהות" icon={Ic.flag(13)}>
            <div style={{ display: "inline-flex", gap: 6 }}>
              {(Object.keys(NATURE_LABELS) as TaskNature[]).map((n) => {
                const active = current.nature === n;
                return (
                  <button key={n} onClick={() => patch({ nature: active ? null : n })}
                    style={chip(NATURE_COLORS[n], active)}>
                    {NATURE_LABELS[n]}
                  </button>
                );
              })}
            </div>
          </Field>

          {/* category */}
          <Field label="קטגוריה" icon={Ic.layers(13)}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {[...categories.filter((c) => !c.parentId).flatMap((parent) => [parent, ...categories.filter((k) => k.parentId === parent.id)])].map((c) => {
                const active = current.categoryId === c.id;
                const parent = c.parentId ? categories.find((k) => k.id === c.parentId) : null;
                return (
                  <button key={c.id} onClick={() => patch({ categoryId: active ? null : c.id })}
                    style={chip(c.color, active)}>
                    <span style={{ width: 8, height: 8, borderRadius: 3, background: c.color }} />
                    {parent ? `${parent.name} ‹ ${c.name}` : c.name}
                  </button>
                );
              })}
              <button onClick={() => setAddingCat((v) => !v)} style={{
                ...chip(T.ink2, false), borderStyle: "dashed",
              }}>{Ic.plus(11)} חדשה</button>
            </div>
            {addingCat && (
              <div style={{ marginTop: 8, background: T.surface, border: `1px solid ${T.line}`, borderRadius: 11, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                <input placeholder="שם הקטגוריה" value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitNewCategory(); }}
                  style={{ ...inputStyle, padding: "7px 10px", fontSize: 12 }} />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
                  {CATEGORY_COLOR_CHOICES.map((col) => (
                    <button key={col} onClick={() => setCatColor(col)} style={{
                      width: 18, height: 18, borderRadius: 6, background: col, cursor: "pointer", border: "none",
                      outline: catColor === col ? `2px solid ${T.ink}` : "none", outlineOffset: 1,
                    }} />
                  ))}
                  <input type="color" value={catColor} onChange={(e) => setCatColor(e.target.value)} title="צבע חופשי"
                    style={{ width: 18, height: 18, padding: 0, border: "none", background: "transparent", cursor: "pointer" }} />
                  <button onClick={submitNewCategory} disabled={!catName.trim()} style={{
                    marginInlineStart: "auto", border: "none", borderRadius: 8, padding: "6px 16px",
                    fontSize: 12, fontWeight: 600, fontFamily: "inherit",
                    background: catName.trim() ? T.accentSoft : T.bg2,
                    color: catName.trim() ? T.accent : T.ink3,
                    cursor: catName.trim() ? "pointer" : "default",
                  }}>הוספה</button>
                </div>
              </div>
            )}
          </Field>

          {/* description */}
          <Field label="מהות המשימה" icon={Ic.note(13)}>
            <textarea
              rows={2} value={current.description}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder="מה צריך לעשות?"
              style={{ ...inputStyle, width: "100%", resize: "vertical" }}
            />
          </Field>

          {/* dates */}
          <div className="tj-dates" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="תאריך יעד (מוצג בלוח השנה)" icon={Ic.target(13)}>
              <input type="date" value={current.dueDate ?? ""}
                onChange={(e) => patch({ dueDate: e.target.value || null })}
                style={{ ...inputStyle, width: "100%", minWidth: 0 }} />
            </Field>
            <Field label="תאריך סיום" icon={Ic.flag(13)}>
              <input type="date" value={current.endDate ?? ""}
                onChange={(e) => patch({ endDate: e.target.value || null })}
                style={{ ...inputStyle, width: "100%", minWidth: 0 }} />
            </Field>
          </div>
          <style>{`@media (max-width: 560px) { .tj-dates { grid-template-columns: 1fr !important; } }`}</style>

          {/* reminders */}
          <Field label="תזכורות" icon={Ic.clock(13)}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {current.reminders.map((r) => (
                <div key={r.id} style={{
                  display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap",
                  background: T.surface, border: `1px solid ${r.fired ? T.line : `${alpha(T.mint, 27)}`}`,
                  borderRadius: 10, padding: "7px 9px",
                }}>
                  <input
                    type="datetime-local" value={isoToLocalInput(r.datetime)}
                    onChange={(e) => patch({
                      reminders: current.reminders.map((x) => x.id === r.id ? { ...x, datetime: localInputToIso(e.target.value), fired: false } : x),
                    })}
                    style={{ ...inputStyle, padding: "5px 8px", fontSize: 12 }}
                  />
                  <input
                    placeholder="הערה לתזכורת (לא חובה)" value={r.note}
                    onChange={(e) => patch({
                      reminders: current.reminders.map((x) => x.id === r.id ? { ...x, note: e.target.value } : x),
                    })}
                    style={{ ...inputStyle, flex: 1, minWidth: 110, padding: "5px 8px", fontSize: 12 }}
                  />
                  {r.fired && <span style={{ fontSize: 10, color: T.ink3 }}>נשלחה</span>}
                  <button onClick={() => patch({ reminders: current.reminders.filter((x) => x.id !== r.id) })} style={{
                    background: "transparent", border: "none", color: T.danger, cursor: "pointer", display: "inline-flex",
                  }}>{Ic.x(12)}</button>
                </div>
              ))}
              <button onClick={() => {
                const dt = new Date(Date.now() + 60 * 60 * 1000);
                dt.setSeconds(0, 0);
                patch({ reminders: [...current.reminders, { id: uid(), datetime: dt.toISOString(), note: "", fired: false }] });
              }} style={addBtnStyle}>
                {Ic.plus(12)} הוספת תזכורת
              </button>
            </div>
          </Field>

          {/* notes */}
          <Field label="הערות" icon={Ic.pencil(13)}>
            <textarea
              rows={3} value={current.notes}
              onChange={(e) => patch({ notes: e.target.value })}
              placeholder="הערות חופשיות…"
              style={{ ...inputStyle, width: "100%", resize: "vertical" }}
            />
          </Field>

          {/* files */}
          <Field label="קבצים מצורפים" icon={Ic.clip(13)}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {current.files.map((f) => (
                <div key={f.id} style={{
                  display: "flex", alignItems: "center", gap: 9,
                  background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10, padding: "7px 10px",
                }}>
                  <span style={{ color: T.ink3, display: "inline-flex" }}>{Ic.clip(13)}</span>
                  <a href={f.dataUrl} download={f.name} style={{
                    flex: 1, minWidth: 0, fontSize: 12.5, color: T.accent, textDecoration: "none",
                    fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {f.name}
                  </a>
                  <span className="num" style={{ fontSize: 10.5, color: T.ink3 }}>{(f.size / 1024).toFixed(0)}KB</span>
                  <button onClick={() => patch({ files: current.files.filter((x) => x.id !== f.id) })} style={{
                    background: "transparent", border: "none", color: T.danger, cursor: "pointer", display: "inline-flex",
                  }}>{Ic.x(12)}</button>
                </div>
              ))}
              <input ref={fileInputRef} type="file" multiple style={{ display: "none" }}
                onChange={(e) => handleFiles(e.target.files)} />
              <button onClick={() => fileInputRef.current?.click()} style={addBtnStyle}>
                {Ic.plus(12)} צירוף קובץ
              </button>
            </div>
          </Field>

          {/* subtasks */}
          <Field label={`שלבים (${countSubtasks(current).done}/${countSubtasks(current).total})`} icon={Ic.layers(13)}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {current.subtasks.map((s) => {
                const sc = countSubtasks(s);
                const sDone = isDone(s);
                return (
                  <div key={s.id}
                    onClick={() => setPath((p) => [...p, s.id])}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
                      background: T.surface, border: `1px solid ${T.line}`,
                      borderInlineStart: `3px solid ${s.critical ? T.danger : T.mint}`,
                      borderRadius: 11, padding: "9px 11px", opacity: sDone ? 0.55 : 1,
                    }}>
                    <button
                      title="קידום סטטוס"
                      onClick={(e) => {
                        e.stopPropagation();
                        const order: TaskStatus[] = ["todo", "in_progress", "done"];
                        const nextS = order[(order.indexOf(s.status) + 1) % 3];
                        setDraft((d) => ({
                          ...d,
                          subtasks: updateTaskInTree(d.subtasks, s.id, {
                            status: nextS,
                            endDate: nextS === "done" && !s.endDate ? new Date().toISOString().slice(0, 10) : s.endDate,
                          }),
                        }));
                        setDirty(true);
                      }}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: STATUS_COLORS[s.status], display: "inline-flex", flexShrink: 0 }}>
                      <StatusIcon status={s.status} size={15} />
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: T.ink, textDecoration: sDone ? "line-through" : "none" }}>
                          {s.title || "ללא שם"}
                        </span>
                        <span className="num" style={{ fontSize: 9.5, color: T.ink3 }}>נפתחה {formatDateHe(s.createdAt)}</span>
                      </div>
                      <div style={{ display: "flex", gap: 8, marginTop: 3, flexWrap: "wrap", alignItems: "center" }}>
                        {s.critical && <span style={{ color: T.danger, display: "inline-flex" }}>{Ic.flame(10)}</span>}
                        {s.nature && <span style={{ fontSize: 9.5, color: NATURE_COLORS[s.nature] }}>{NATURE_LABELS[s.nature]}</span>}
                        {s.dueDate && <span className="num" style={{ fontSize: 9.5, color: T.ink3, display: "inline-flex", alignItems: "center", gap: 3 }}>{Ic.target(9)} {formatDateHe(s.dueDate)}</span>}
                        {s.files.length > 0 && <span className="num" style={{ fontSize: 9.5, color: T.ink3, display: "inline-flex", alignItems: "center", gap: 3 }}>{Ic.clip(9)} {s.files.length}</span>}
                        {sc.total > 0 && <span className="num" style={{ fontSize: 9.5, color: T.ink3 }}>{sc.done}/{sc.total} שלבים</span>}
                      </div>
                    </div>
                    <span style={{ color: T.ink3, opacity: 0.6, display: "inline-flex" }}>{Ic.chevL(13)}</span>
                  </div>
                );
              })}
              <button onClick={addSubtask} style={{ ...addBtnStyle, color: T.accent, borderColor: `${alpha(T.accent, 33)}`, background: T.accentSoft }}>
                {Ic.plus(12)} הוספת שלב
              </button>
              <div style={{ fontSize: 10.5, color: T.ink3 }}>
                לכל שלב יש את כל המאפיינים של משימה — קטגוריה, תאריכים, תזכורות, הערות, קבצים ותתי-שלבים.
              </div>
            </div>
          </Field>

          {isDone(current) && current.endDate && (
            <div style={{
              fontSize: 12, color: T.mint, background: T.mintSoft, borderRadius: 10, padding: "8px 12px",
              display: "flex", alignItems: "center", gap: 7,
            }}>
              {Ic.check(13)} הושלמה · תאריך סיום {formatDateHe(current.endDate)} · נפתחה {formatDateTimeHe(current.createdAt)}
            </div>
          )}
        </div>

        {/* footer */}
        <div style={{
          flexShrink: 0, borderTop: `1px solid ${T.line}`, padding: "12px 20px",
          display: "flex", alignItems: "center", gap: 8, background: T.surface,
        }}>
          <button onClick={deleteCurrent} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "transparent", border: `1px solid ${alpha(T.danger, 33)}`, color: T.danger,
            borderRadius: 10, padding: "8px 14px", fontSize: 12.5, cursor: "pointer", fontWeight: 500, fontFamily: "inherit",
          }}>
            {Ic.trash(13)} {isRoot ? "מחיקת משימה" : "מחיקת שלב"}
          </button>
          {!isRoot && (
            <button onClick={() => setPath((p) => p.slice(0, -1))} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: "transparent", border: `1px solid ${T.line}`, color: T.ink2,
              borderRadius: 10, padding: "8px 14px", fontSize: 12.5, cursor: "pointer", fontFamily: "inherit",
            }}>
              {Ic.chevR(12)} חזרה למשימה
            </button>
          )}
          <div style={{ marginInlineStart: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            {dirty && <span style={{ fontSize: 10.5, color: T.ink3 }}>נשמר אוטומטית בסגירה</span>}
            <button onClick={() => { if (!dirty || confirm("לבטל את השינויים שהוקלדו?")) onClose(); }} style={{
              background: "transparent", border: `1px solid ${T.line}`, color: T.ink2,
              borderRadius: 10, padding: "8px 16px", fontSize: 12.5, cursor: "pointer", fontFamily: "inherit",
            }}>ביטול</button>
            <button onClick={save} style={{
              background: T.grad, border: "none", color: "#fff",
              borderRadius: 10, padding: "8px 26px", fontSize: 13, fontWeight: 700, cursor: "pointer",
              fontFamily: "var(--font-display)",
            }}>{isNew ? "הוספה ליומן" : "שמירה"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const addBtnStyle: React.CSSProperties = {
  alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6,
  background: "transparent", border: `1px dashed ${T.lineStrong}`,
  borderRadius: 9, padding: "7px 14px", fontSize: 12, color: T.ink2, cursor: "pointer",
  fontWeight: 500, fontFamily: "inherit",
};

function Field({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: 11, fontWeight: 600, color: T.ink2, marginBottom: 7,
        display: "flex", alignItems: "center", gap: 5,
      }}>
        {icon && <span style={{ color: T.ink3, display: "inline-flex" }}>{icon}</span>}
        {label}
      </div>
      {children}
    </div>
  );
}

"use client";

import { useEffect, useSyncExternalStore } from "react";
import { setActiveJournal } from "@/lib/tasks";
import { subscribeTeamMeta, getTeamMeta, getServerTeamMeta, initTeamMeta } from "@/lib/team";
import { MANAGER_ID, MANAGER_NAME, memberById, type TeamMember } from "@/lib/journals";
import TaskJournal from "./TaskJournal";
import { T, Ic, useSpotlight } from "./ui";

// מעטפת היומן: בוחרת את היומן הפעיל וצובעת אותו בגוון האישי.
// אין מסך נעילה — היומן של אופיר והדשבורד נפתחים ישר (לבקשת המשתמש).
export default function JournalApp({ journalId, initialMember }: { journalId: string; initialMember?: TeamMember | null }) {
  setActiveJournal(journalId);
  const meta = useSyncExternalStore(subscribeTeamMeta, getTeamMeta, getServerTeamMeta);
  useEffect(() => { initTeamMeta(); }, []);
  useSpotlight();

  const isManager = journalId === MANAGER_ID;
  const member = isManager ? null : memberById(meta.roster, journalId) ?? (meta.loaded ? null : initialMember ?? null);
  const color = isManager ? "blue" : member?.color ?? initialMember?.color ?? "teal";
  const name = isManager ? MANAGER_NAME : member?.name ?? initialMember?.name ?? "";

  let gate: "loading" | "open" | "missing";
  if (isManager || member) gate = "open";
  else if (!meta.loaded) gate = "loading";
  else gate = meta.mode === "cloud" ? "missing" : "open";

  return (
    <div className="tj-app" data-person={color}>
      <div className="tj-aurora" aria-hidden="true"><i /><i /><i /></div>
      {gate === "open" && <TaskJournal journalId={journalId} personName={name || "היומן שלי"} personColor={color} />}
      {gate === "loading" && <LoadingShell />}
      {gate === "missing" && <MissingJournal />}
    </div>
  );
}

function LoadingShell() {
  return (
    <div style={{ maxWidth: 1252, margin: "0 auto", padding: "18px 18px", display: "grid", gap: 14 }} aria-busy="true">
      <div className="tj-skel" style={{ height: 58 }} />
      <div className="tj-skel" style={{ height: 52, borderRadius: 20 }} />
      <div className="tj-skel" style={{ height: 180 }} />
      <div className="tj-skel" style={{ height: 360 }} />
    </div>
  );
}

function MissingJournal() {
  return (
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div className="tj-pop" style={{ textAlign: "center", maxWidth: 360 }}>
        <div style={{ display: "flex", justifyContent: "center", color: T.ink3, marginBottom: 14 }}>{Ic.inbox(40)}</div>
        <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 800 }}>היומן הזה לא נמצא</h1>
        <p style={{ color: T.ink2, fontSize: 14, lineHeight: 1.6, marginTop: 8 }}>
          ייתכן שהקישור שגוי, או שהיומן הוסר מהצוות. כדאי לבקש מאופיר קישור חדש.
        </p>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { setActiveJournal } from "@/lib/tasks";
import {
  subscribeTeamMeta, getTeamMeta, getServerTeamMeta, initTeamMeta, isUnlocked, verifyManagerPin,
  unlockWithBiometric, watchAutoLock, setLockOnOpen,
} from "@/lib/team";
import {
  biometricAvailable, biometricEnrolled, biometricLabel, enrollBiometric, bioOfferDismissed, dismissBioOffer,
} from "@/lib/biometric";
import { MANAGER_ID, MANAGER_NAME, memberById, type TeamMember } from "@/lib/journals";
import TaskJournal from "./TaskJournal";
import { T, Ic, useSpotlight, primaryBtn, ghostBtn } from "./ui";

// מעטפת היומן: בוחרת את היומן הפעיל, צובעת אותו בגוון האישי,
// ושומרת על האזור של אופיר מאחורי קוד (כשיש צוות).
export default function JournalApp({ journalId, initialMember }: { journalId: string; initialMember?: TeamMember | null }) {
  setActiveJournal(journalId);
  const meta = useSyncExternalStore(subscribeTeamMeta, getTeamMeta, getServerTeamMeta);
  const [, setUnlockTick] = useState(0);
  useEffect(() => { initTeamMeta(); }, []);
  useSpotlight();

  const isManager = journalId === MANAGER_ID;
  const member = isManager ? null : memberById(meta.roster, journalId) ?? (meta.loaded ? null : initialMember ?? null);
  const color = isManager ? "blue" : member?.color ?? initialMember?.color ?? "teal";
  const name = isManager ? MANAGER_NAME : member?.name ?? initialMember?.name ?? "";

  let gate: "loading" | "lock" | "open" | "missing";
  if (isManager) {
    if (meta.pin) gate = isUnlocked(meta.pin) ? "open" : "lock";
    else gate = meta.loaded ? "open" : "loading";
  } else if (member) gate = "open";
  else if (!meta.loaded) gate = "loading";
  else gate = meta.mode === "cloud" ? "missing" : "open";

  // "נעילה בכל פתיחה": חזרה ליומן אחרי 5 דקות ברקע מחזירה את מסך הנעילה
  const watching = isManager && !!meta.pin && gate === "open";
  useEffect(() => {
    if (!watching) return;
    return watchAutoLock(() => setUnlockTick((n) => n + 1));
  }, [watching]);

  return (
    <div className="tj-app" data-person={color}>
      <div className="tj-aurora" aria-hidden="true"><i /><i /><i /></div>
      {gate === "open" && <TaskJournal journalId={journalId} personName={name || "היומן שלי"} personColor={color} />}
      {gate === "loading" && <LoadingShell />}
      {gate === "lock" && <ManagerLock onUnlock={() => setUnlockTick((n) => n + 1)} />}
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

// ---------- נעילת המנהל: לוח מקשים בן 4 ספרות ----------

function ManagerLock({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fails, setFails] = useState(0);
  const [coolUntil, setCoolUntil] = useState(0);
  const [now, setNow] = useState(0);
  // טביעת אצבע / Face ID: "ready" — רשום במכשיר הזה; "offer" — אפשר להציע אחרי קוד נכון
  const [bio, setBio] = useState<"none" | "ready" | "offer">("none");
  const [bioBusy, setBioBusy] = useState(false);
  const [offering, setOffering] = useState(false);
  const label = biometricLabel();
  const autoTried = useRef(false);

  async function tryBio() {
    setBioBusy(true);
    const ok = await unlockWithBiometric();
    setBioBusy(false);
    if (ok) onUnlock();
  }

  useEffect(() => {
    let cancelled = false;
    biometricAvailable().then((avail) => {
      if (cancelled || !avail) return;
      if (biometricEnrolled()) {
        setBio("ready");
        // ניסיון אוטומטי אחד — דפדפנים שדורשים לחיצה פשוט ידחו, והכפתור נשאר
        if (!autoTried.current) { autoTried.current = true; tryBio(); }
      } else if (!bioOfferDismissed()) setBio("offer");
    });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function enableBio() {
    setBioBusy(true);
    const r = await enrollBiometric(MANAGER_NAME);
    setBioBusy(false);
    if (r.ok) setLockOnOpen(true);
    dismissBioOffer();
    onUnlock();
  }

  useEffect(() => {
    if (!coolUntil) return;
    const iv = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= coolUntil) { setCoolUntil(0); setFails(0); }
    }, 250);
    return () => clearInterval(iv);
  }, [coolUntil]);
  const cooling = coolUntil > 0 && now < coolUntil;

  async function submit(code: string) {
    setBusy(true);
    const ok = await verifyManagerPin(code);
    setBusy(false);
    if (ok) {
      // קוד נכון במכשיר שתומך בביומטריה — הצעה חד-פעמית לפעם הבאה
      if (bio === "offer") { setOffering(true); return; }
      onUnlock();
      return;
    }
    setError(true);
    setPin("");
    const f = fails + 1;
    setFails(f);
    try { navigator.vibrate?.([30, 40, 30]); } catch { /* ignore */ }
    if (f >= 5) { const until = Date.now() + 30000; setNow(Date.now()); setCoolUntil(until); }
    setTimeout(() => setError(false), 520);
  }

  function press(d: string) {
    if (busy || cooling || pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) submit(next);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

  if (offering) {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div className="tj-pop" style={{
          width: "min(360px, 100%)", textAlign: "center", padding: "30px 24px 24px",
          background: "var(--tj-glass)", backdropFilter: "blur(20px) saturate(1.4)", WebkitBackdropFilter: "blur(20px) saturate(1.4)",
          border: `1px solid ${T.line}`, borderRadius: 28,
          boxShadow: "inset 0 1px 0 var(--tj-bezel), 0 40px 80px -36px var(--tj-shadow-strong)",
        }}>
          <span style={{
            width: 64, height: 64, borderRadius: 20, margin: "0 auto 14px",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: T.accentSoft, color: T.accent,
          }}>{Ic.fingerprint(32)}</span>
          <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em" }}>
            בפעם הבאה — עם {label}?
          </h1>
          <p style={{ margin: "8px 0 18px", fontSize: 13, color: T.ink2, lineHeight: 1.65 }}>
            במקום להקליד קוד, היומן ייפתח עם {label}. הוא יבקש שוב בכל פתיחה אחרי 5 דקות בחוץ.
            נשמר רק במכשיר הזה — שום דבר לא נשמר בענן או ביומן.
          </p>
          <button onClick={enableBio} disabled={bioBusy} style={{ ...primaryBtn, width: "100%", height: 48, borderRadius: 16 }}>
            {Ic.fingerprint(17)} {bioBusy ? "ממתין לאישור…" : `הפעלת ${label}`}
          </button>
          <button onClick={() => { dismissBioOffer(); onUnlock(); }} disabled={bioBusy} style={{ ...ghostBtn, width: "100%", height: 42, marginTop: 8, border: "none" }}>
            לא עכשיו
          </button>
          <p style={{ margin: "10px 0 0", fontSize: 11, color: T.ink3 }}>אפשר להפעיל או לכבות בכל עת בטאב הצוות ← עדכונים ופרטיות.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div className="tj-pop" style={{
        width: "min(360px, 100%)", textAlign: "center", padding: "30px 24px 26px",
        background: "var(--tj-glass)", backdropFilter: "blur(20px) saturate(1.4)", WebkitBackdropFilter: "blur(20px) saturate(1.4)",
        border: `1px solid ${T.line}`, borderRadius: 28,
        boxShadow: "inset 0 1px 0 var(--tj-bezel), 0 40px 80px -36px var(--tj-shadow-strong)",
      }}>
        <span style={{
          width: 58, height: 58, borderRadius: 18, margin: "0 auto 14px",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: T.grad, color: "#fff", boxShadow: `0 14px 30px -14px ${T.glow}`,
        }}>{Ic.lock(24)}</span>
        <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 21, fontWeight: 800, letterSpacing: "-0.02em" }}>
          האזור של אופיר
        </h1>
        <p style={{ margin: "6px 0 20px", fontSize: 13, color: T.ink2 }}>
          {cooling ? `יותר מדי ניסיונות — נסו שוב בעוד ${Math.ceil((coolUntil - now) / 1000)} שניות` : "היומן ודשבורד הצוות. הזינו את הקוד בן 4 הספרות."}
        </p>
        {bio === "ready" && (
          <button onClick={tryBio} disabled={bioBusy || cooling} style={{
            ...primaryBtn, width: "100%", height: 50, borderRadius: 16, marginBottom: 18, fontSize: 14.5,
          }}>
            {Ic.fingerprint(19)} {bioBusy ? "ממתין לאישור…" : `כניסה עם ${label}`}
          </button>
        )}
        {bio === "ready" && (
          <div style={{ fontSize: 11.5, color: T.ink3, margin: "-6px 0 14px" }}>או בקוד:</div>
        )}
        <div className={error ? "tj-shake" : undefined} style={{ display: "flex", justifyContent: "center", gap: 14, marginBottom: 22, direction: "ltr" }}
          aria-live="polite" aria-label={`${pin.length} מתוך 4 ספרות`}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} style={{
              width: 14, height: 14, borderRadius: 99,
              background: error ? T.danger : i < pin.length ? T.accent : "transparent",
              boxShadow: `inset 0 0 0 2px ${error ? T.danger : i < pin.length ? T.accent : T.lineStrong}`,
              transform: i < pin.length ? "scale(1.08)" : "scale(1)",
              transition: "background .2s, transform .25s var(--ease-out), box-shadow .2s",
            }} />
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, direction: "ltr" }}>
          {keys.map((k, i) => k === "" ? <span key={i} /> : (
            <button key={i} disabled={busy || cooling}
              aria-label={k === "⌫" ? "מחיקה" : k}
              onClick={() => (k === "⌫" ? setPin((p) => p.slice(0, -1)) : press(k))}
              style={{
                height: 58, borderRadius: 18, border: `1px solid ${T.line}`,
                background: k === "⌫" ? "transparent" : T.surface, color: T.ink,
                fontSize: 22, fontWeight: 600, fontFamily: "var(--font-mono)", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: k === "⌫" ? "none" : "inset 0 1px 0 var(--tj-bezel), 0 1px 2px var(--tj-shadow)",
                opacity: cooling ? 0.4 : 1,
              }}>
              {k === "⌫" ? Ic.backspace(20) : k}
            </button>
          ))}
        </div>
        <p style={{ margin: "18px 0 0", fontSize: 11, color: T.ink3, lineHeight: 1.5 }}>
          שכחת את הקוד? ההוראות לאיפוס נמצאות ב-README.
        </p>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { PERSON_COLORS, personVar, type PersonColor } from "@/lib/journals";

// ============================================
// יומן המשימות — טוקנים, פרימיטיבים וסט אייקונים
// ============================================

// טוקנים כ-CSS variables — הערכים (בהיר/כהה, וגוון אישי לכל יומן) מוגדרים ב-globals.css
export const T = {
  bg: "var(--tj-bg)",
  bg2: "var(--tj-bg2)",
  surface: "var(--tj-surface)",
  surface2: "var(--tj-surface2)",
  line: "var(--tj-line)",
  lineStrong: "var(--tj-line-strong)",
  ink: "var(--tj-ink)",
  ink2: "var(--tj-ink2)",
  ink3: "var(--tj-ink3)",
  accent: "var(--tj-accent)",
  accentSoft: "var(--tj-accent-soft)",
  accentLine: "var(--tj-accent-line)",
  mint: "var(--tj-mint)",
  mintSoft: "var(--tj-mint-soft)",
  // רמפה חד-גונית בגוון היומן — לא "גרדיאנט AI" כחול-סגול
  grad: "var(--tj-grad)",
  glow: "var(--tj-glow)",
  danger: "var(--tj-danger)",
  dangerSoft: "var(--tj-danger-soft)",
  amber: "var(--tj-amber)",
  amberSoft: "var(--tj-amber-soft)",
  shadowSm: "0 1px 2px var(--tj-shadow)",
  shadowMd: "0 1px 2px var(--tj-shadow), 0 10px 28px -14px var(--tj-shadow)",
  shadowLg: "0 24px 70px var(--tj-shadow)",
  r: 14,
};

// שקיפות מעל טוקן/צבע — עובד גם על var() וגם על hex
export function alpha(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

// Double-Bezel: קו-שיער חיצוני + הדגשת-אור פנימית עליונה + צל אמביינטי רך ומפוזר
export const card: React.CSSProperties = {
  position: "relative",
  background: T.surface,
  border: `1px solid ${T.line}`,
  borderRadius: 20,
  boxShadow: "inset 0 1px 0 var(--tj-bezel), 0 1px 2px var(--tj-shadow), 0 24px 48px -30px var(--tj-shadow-strong)",
};

// כרטיס עם גוון סמנטי עדין (רצועת קריטיות)
export function tintCard(color: string): React.CSSProperties {
  return {
    ...card,
    background: `linear-gradient(180deg, ${alpha(color, 6)} 0%, ${alpha(color, 2)} 40%, ${T.surface} 80%)`,
    border: `1px solid ${alpha(color, 20)}`,
  };
}

export function chip(color: string, active: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 6,
    borderRadius: 99, padding: "5px 12px", fontSize: 12, cursor: "pointer",
    fontFamily: "inherit", fontWeight: active ? 600 : 500,
    border: `1px solid ${active ? alpha(color, 45) : T.line}`,
    background: active ? alpha(color, 12) : "transparent",
    color: active ? color : T.ink2,
  };
}

export const inputStyle: React.CSSProperties = {
  background: "var(--tj-input)",
  border: `1px solid ${T.lineStrong}`,
  borderRadius: 12,
  color: T.ink,
  padding: "10px 12px",
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
};

// כפתור ראשי: גלולה בגוון היומן עם זוהר מותאם
export const primaryBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
  background: T.grad, color: "#fff", border: "none", borderRadius: 99,
  padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer",
  fontFamily: "var(--font-display)",
  boxShadow: `inset 0 1px 0 rgba(255,255,255,0.25), 0 10px 24px -12px ${T.glow}`,
};

export const ghostBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
  background: "transparent", color: T.ink2, border: `1px solid ${T.line}`, borderRadius: 99,
  padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};

export const softBtn: React.CSSProperties = {
  ...ghostBtn,
  background: T.accentSoft, color: T.accent, border: "none",
  boxShadow: `inset 0 0 0 1px ${T.accentLine}`,
};

// ---------- icons (stroke, currentColor) ----------

function I({ d, size = 16, sw = 1.8, children }: { d?: string; size?: number; sw?: number; children?: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"
      stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, display: "block" }}>
      {d && <path d={d} />}
      {children}
    </svg>
  );
}

export const Ic = {
  plus: (s?: number) => <I size={s} d="M12 5v14M5 12h14" />,
  search: (s?: number) => <I size={s}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></I>,
  calendar: (s?: number) => <I size={s}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></I>,
  grid: (s?: number) => <I size={s}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></I>,
  week: (s?: number) => <I size={s}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18M9 10v11M15 10v11" /></I>,
  table: (s?: number) => <I size={s}><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M3 9.5h18M3 15h18M10 4v16" /></I>,
  board: (s?: number) => <I size={s}><rect x="3" y="4" width="5.4" height="16" rx="1.5" /><rect x="9.8" y="4" width="5.4" height="11" rx="1.5" /><rect x="16.6" y="4" width="5.4" height="7" rx="1.5" /></I>,
  chart: (s?: number) => <I size={s}><path d="M4 20V10M10 20V4M16 20v-7M21 20H3" /></I>,
  clock: (s?: number) => <I size={s}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></I>,
  clip: (s?: number) => <I size={s} d="m21 11.5-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8L13 3.9a3.7 3.7 0 1 1 5.2 5.2L10 17.3a1.9 1.9 0 0 1-2.6-2.6l7.8-7.8" />,
  flame: (s?: number) => <I size={s} d="M12 3c.5 3-1.5 4.5-2.7 6C8 10.6 7 12.3 7 14.3A5 5 0 0 0 17 14c0-1.8-.8-3.2-1.8-4.5-.4 1-.9 1.6-1.7 2.2.3-2.8-.4-6.4-1.5-8.7Z" />,
  layers: (s?: number) => <I size={s}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></I>,
  target: (s?: number) => <I size={s}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.8" /></I>,
  flag: (s?: number) => <I size={s} d="M5 21V4c4-2.5 8 2.5 12 0v9c-4 2.5-8-2.5-12 0" />,
  x: (s?: number) => <I size={s} d="M6 6l12 12M18 6 6 18" />,
  check: (s?: number) => <I size={s} d="m5 12.5 4.5 4.5L19 7.5" />,
  trash: (s?: number) => <I size={s}><path d="M4 7h16M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2M6.5 7l1 12.2A2 2 0 0 0 9.5 21h5a2 2 0 0 0 2-1.8L17.5 7" /></I>,
  pencil: (s?: number) => <I size={s} d="M17 4a2.1 2.1 0 0 1 3 3L8.5 18.5 4 20l1.5-4.5L17 4Z" />,
  sort: (s?: number) => <I size={s} d="m8 9 4-4 4 4M8 15l4 4 4-4" />,
  chevR: (s?: number) => <I size={s} d="m9 5 7 7-7 7" />,
  chevL: (s?: number) => <I size={s} d="m15 5-7 7 7 7" />,
  chevD: (s?: number) => <I size={s} d="m6 9 6 6 6-6" />,
  cloud: (s?: number) => <I size={s} d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 10a4 4 0 0 1-.5 8H7Z" />,
  cloudOff: (s?: number) => <I size={s}><path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 10a4 4 0 0 1-.5 8H7Z" /><path d="m4 4 16 16" /></I>,
  filter: (s?: number) => <I size={s} d="M4 5h16l-6.5 7.5V19l-3 1.5v-8L4 5Z" />,
  note: (s?: number) => <I size={s}><path d="M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M8.5 8h7M8.5 12h7M8.5 16h4" /></I>,
  circle: (s?: number) => <I size={s}><circle cx="12" cy="12" r="8.5" /></I>,
  progress: (s?: number) => <I size={s}><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5A8.5 8.5 0 0 1 20.5 12H12V3.5Z" fill="currentColor" stroke="none" /></I>,
  checkCircle: (s?: number) => <I size={s}><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></I>,
  alert: (s?: number) => <I size={s}><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 10v4.5M12 17.5v.1" /></I>,
  bell: (s?: number) => <I size={s}><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" /><path d="M10.5 20a2 2 0 0 0 3 0" /></I>,
  share: (s?: number) => <I size={s}><circle cx="6" cy="12" r="2.5" /><circle cx="17.5" cy="5.5" r="2.5" /><circle cx="17.5" cy="18.5" r="2.5" /><path d="m8.3 10.8 6.9-4M8.3 13.2l6.9 4" /></I>,
  moon: (s?: number) => <I size={s} d="M20 13.5A8 8 0 1 1 10.5 4 6.5 6.5 0 0 0 20 13.5Z" />,
  sun: (s?: number) => <I size={s}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5 5l1.8 1.8M17.2 17.2 19 19M19 5l-1.8 1.8M6.8 17.2 5 19" /></I>,
  sunrise: (s?: number) => <I size={s}><path d="M3 18h18M6.3 18a5.7 5.7 0 0 1 11.4 0" /><path d="M12 3v4M4.6 9.6l1.8 1.3M19.4 9.6l-1.8 1.3M8.5 21h7" /></I>,
  sunset: (s?: number) => <I size={s}><path d="M3 18h18M6.3 18a5.7 5.7 0 0 1 11.4 0" /><path d="M12 9V5M9.5 6.5 12 9l2.5-2.5M4.6 11.6l1.8 1.3M19.4 11.6l-1.8 1.3" /></I>,
  users: (s?: number) => <I size={s}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 20a6.5 6.5 0 0 0-3.2-5.6" /></I>,
  userPlus: (s?: number) => <I size={s}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6" /></I>,
  send: (s?: number) => <I size={s} d="M21 3 3 10.5l7 2.5 2.5 7L21 3ZM10 13l4.5-4.5" />,
  lock: (s?: number) => <I size={s}><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></I>,
  link: (s?: number) => <I size={s}><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" /><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" /></I>,
  copy: (s?: number) => <I size={s}><rect x="8.5" y="8.5" width="12" height="12" rx="2.5" /><path d="M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" /></I>,
  sliders: (s?: number) => <I size={s}><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></I>,
  sparkle: (s?: number) => <I size={s} d="M12 3c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7Z" />,
  arrowUpLeft: (s?: number) => <I size={s} d="M17 17 7 7M7 15V7h8" />,
  arrowR: (s?: number) => <I size={s} d="M5 12h14M13 6l6 6-6 6" />,
  dots: (s?: number) => <I size={s}><circle cx="5.5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="18.5" cy="12" r="1" fill="currentColor" /></I>,
  activity: (s?: number) => <I size={s} d="M3 12h4l3-7 4 14 3-7h4" />,
  phone: (s?: number) => <I size={s}><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M10.5 18.5h3" /></I>,
  inbox: (s?: number) => <I size={s}><path d="M3 13.5 5.5 5h13l2.5 8.5V19a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19v-5.5Z" /><path d="M3 13.5h5l1.5 2.5h5l1.5-2.5h5" /></I>,
  refresh: (s?: number) => <I size={s}><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8" /><path d="M4 3.5V8h4.5M4 13a8 8 0 0 0 14.5 4.5L20 16" /><path d="M20 20.5V16h-4.5" /></I>,
  crown: (s?: number) => <I size={s} d="M4 18h16M4.5 15 3 7l5 3.5L12 5l4 5.5L21 7l-1.5 8h-15Z" />,
  backspace: (s?: number) => <I size={s}><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z" /><path d="m12.5 9.5 5 5M17.5 9.5l-5 5" /></I>,
  logout: (s?: number) => <I size={s}><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M9 16l-4-4 4-4M5 12h11" /></I>,
};

export function StatusIcon({ status, size = 16 }: { status: "todo" | "in_progress" | "done"; size?: number }) {
  if (status === "done") return Ic.checkCircle(size);
  if (status === "in_progress") return Ic.progress(size);
  return Ic.circle(size);
}

// ---------- אדם: אווטר עם ראשי תיבות בגוון האישי ----------

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function Avatar({ name, color, size = 34, ring }: { name: string; color: PersonColor; size?: number; ring?: boolean }) {
  const p = PERSON_COLORS[color];
  return (
    <span aria-hidden="true" style={{
      width: size, height: size, borderRadius: 99, flexShrink: 0,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      background: `linear-gradient(140deg, ${p.a}, ${p.b})`, color: "#fff",
      fontFamily: "var(--font-display)", fontWeight: 700, fontSize: Math.round(size * 0.38),
      letterSpacing: "-0.02em",
      boxShadow: ring
        ? `0 0 0 2px var(--tj-surface), 0 0 0 4px ${alpha(personVar(color), 45)}, 0 8px 18px -8px ${alpha(p.b, 70)}`
        : `inset 0 1px 0 rgba(255,255,255,0.3), 0 6px 14px -8px ${alpha(p.b, 80)}`,
    }}>
      {initials(name)}
    </span>
  );
}

// ---------- טבעת התקדמות (נתון אמיתי בלבד, לא קישוט) ----------

export function ProgressRing({ value, size = 64, stroke = 6, color = T.mint, track = T.surface2, children, label }: {
  value: number; // 0..1
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: React.ReactNode;
  label?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, isFinite(value) ? value : 0));
  return (
    <div role="img" aria-label={label} style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block", transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle className="tj-ring-arc" cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v)} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
        {children}
      </div>
    </div>
  );
}

// ---------- הטיה תלת-ממדית (רק בעכבר, מכבד reduced-motion) ----------

export function useTilt<T extends HTMLElement>(max = 5) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    function move(e: PointerEvent) {
      const r = el!.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      el!.classList.add("is-tilting");
      el!.style.setProperty("--ry", `${(x * max).toFixed(2)}deg`);
      el!.style.setProperty("--rx", `${(-y * max).toFixed(2)}deg`);
    }
    function leave() {
      el!.classList.remove("is-tilting");
      el!.style.setProperty("--ry", "0deg");
      el!.style.setProperty("--rx", "0deg");
    }
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerleave", leave); };
  }, [max]);
  return ref;
}

// ---------- אור-זרקור לכרטיסים: מאזין יחיד לכל העמוד ----------

export function useSpotlight() {
  useEffect(() => {
    if (!window.matchMedia("(hover: hover)").matches) return;
    let raf = 0;
    function move(e: PointerEvent) {
      const card = (e.target as HTMLElement | null)?.closest?.(".tj-card") as HTMLElement | null;
      if (!card) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${e.clientX - r.left}px`);
        card.style.setProperty("--my", `${e.clientY - r.top}px`);
      });
    }
    window.addEventListener("pointermove", move, { passive: true });
    return () => { window.removeEventListener("pointermove", move); cancelAnimationFrame(raf); };
  }, []);
}

// ---------- מתג ----------

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} style={{
      width: 40, height: 24, borderRadius: 99, border: "none", padding: 2, cursor: "pointer", flexShrink: 0,
      background: on ? T.accent : T.surface2,
      boxShadow: on ? "none" : `inset 0 0 0 1px ${T.lineStrong}`,
      display: "inline-flex", justifyContent: "flex-start",
    }}>
      <span style={{
        width: 20, height: 20, borderRadius: 99, background: "#fff",
        boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
        transform: on ? "translateX(-16px)" : "none",
        transition: "transform .3s var(--ease-out)",
      }} />
    </button>
  );
}

// ---------- מעטפת לדיאלוג / גיליון ----------

export function Sheet({ title, icon, onClose, children, width = 440, side = "end" }: {
  title: string;
  icon?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
  side?: "end" | "center";
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  const center = side === "center";
  return (
    <div role="dialog" aria-modal="true" aria-label={title} style={{ position: "fixed", inset: 0, zIndex: 120 }}>
      <div className="tj-scrim" onClick={onClose} style={{
        position: "absolute", inset: 0, background: "rgba(8,14,28,0.42)",
        backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)",
      }} />
      <div className={`${center ? "tj-pop" : "tj-sheet"} tj-sheet-panel`} style={{
        position: "absolute",
        ...(center
          ? { top: "50%", left: "50%", translate: "-50% -50%", width: `min(${width}px, calc(100vw - 24px))`, maxHeight: "calc(100dvh - 32px)", borderRadius: 24 }
          : { top: 10, bottom: 10, left: 10, width: `min(${width}px, calc(100vw - 20px))`, borderRadius: 24 }),
        background: T.surface, border: `1px solid ${T.line}`,
        boxShadow: "inset 0 1px 0 var(--tj-bezel), 0 40px 90px -30px rgba(8,14,28,0.55)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 18px 12px", borderBottom: `1px solid ${T.line}` }}>
          {icon && <span style={{ color: T.accent, display: "inline-flex" }}>{icon}</span>}
          <h2 style={{ margin: 0, fontSize: 16.5, fontWeight: 800, fontFamily: "var(--font-display)", letterSpacing: "-0.015em", flex: 1 }}>{title}</h2>
          <button onClick={onClose} aria-label="סגירה" style={{
            width: 32, height: 32, borderRadius: 99, border: `1px solid ${T.line}`, background: "transparent",
            color: T.ink2, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}>{Ic.x(14)}</button>
        </div>
        <div style={{ overflowY: "auto", padding: 18, flex: 1 }}>{children}</div>
      </div>
      <style>{`@media (max-width: 640px) { .tj-sheet-panel:not(.tj-pop) { top: auto !important; left: 0 !important; bottom: 0 !important; width: 100% !important; max-height: 92dvh; border-radius: 24px 24px 0 0 !important; } }`}</style>
    </div>
  );
}

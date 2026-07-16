"use client";

// ============================================
// יומן המשימות — light premium theme + icon set
// ============================================

// טוקנים כ-CSS variables — הערכים (בהיר/כהה) מוגדרים ב-globals.css
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
  mint: "var(--tj-mint)",
  mintSoft: "var(--tj-mint-soft)",
  grad: "linear-gradient(120deg,#2563EB 0%,#0FA47E 100%)",
  danger: "var(--tj-danger)",
  dangerSoft: "var(--tj-danger-soft)",
  amber: "var(--tj-amber)",
  r: 14,
};

// שקיפות מעל טוקן/צבע — עובד גם על var() וגם על hex
export function alpha(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

export const card: React.CSSProperties = {
  background: T.surface,
  border: `1px solid ${T.line}`,
  borderRadius: 16,
  boxShadow: "0 1px 3px var(--tj-shadow)",
};

export function chip(color: string, active: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 6,
    borderRadius: 8, padding: "5px 11px", fontSize: 12, cursor: "pointer",
    fontFamily: "inherit", fontWeight: active ? 600 : 400,
    border: `1px solid ${active ? color : T.line}`,
    background: active ? alpha(color, 12) : "transparent",
    color: active ? color : T.ink2,
    transition: "border-color .15s, background .15s, color .15s",
  };
}

export const inputStyle: React.CSSProperties = {
  background: "var(--tj-input)",
  border: `1px solid ${T.lineStrong}`,
  borderRadius: 10,
  color: T.ink,
  padding: "9px 12px",
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
};

// ---------- icons (stroke, currentColor) ----------

function I({ d, size = 16, sw = 1.8, children }: { d?: string; size?: number; sw?: number; children?: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
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
};

export function StatusIcon({ status, size = 16 }: { status: "todo" | "in_progress" | "done"; size?: number }) {
  if (status === "done") return Ic.checkCircle(size);
  if (status === "in_progress") return Ic.progress(size);
  return Ic.circle(size);
}

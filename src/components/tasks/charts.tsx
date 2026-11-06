"use client";

import { useState } from "react";
import { T, alpha } from "./ui";

// ============================================
// גרפים — SVG ידני, בלי ספריות. צבעי טקסט מהטוקנים (בהיר/כהה),
// הזמן זורם מימין לשמאל כמו בשאר היומן, ולכל גרף יש tooltip.
// ============================================

export type Slice = { key: string; label: string; value: number; color: string };

// ---------- דונאט: חלוקה לחלקים, מספר במרכז ----------
export function Donut({ slices, size = 168, thickness = 22, center, sub, ariaLabel }: {
  slices: Slice[];
  size?: number;
  thickness?: number;
  center: React.ReactNode;
  sub?: string;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const total = slices.reduce((n, s) => n + s.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const gap = slices.filter((s) => s.value > 0).length > 1 ? 3 : 0; // רווח בין פרוסות
  let offset = 0;
  const h = slices.find((s) => s.key === hover);
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }} role="img" aria-label={ariaLabel}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)", display: "block" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={T.surface2} strokeWidth={thickness} />
        {total > 0 && slices.map((s) => {
          if (!s.value) return null;
          const len = (s.value / total) * c;
          const seg = (
            <circle key={s.key} cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={s.color} strokeWidth={hover === s.key ? thickness + 6 : thickness}
              strokeDasharray={`${Math.max(0, len - gap)} ${c}`} strokeDashoffset={-offset}
              strokeLinecap="butt"
              onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)}
              style={{ transition: "stroke-width .25s var(--ease-out), stroke-dasharray .9s var(--ease-out)", cursor: "default" }} />
          );
          offset += len;
          return seg;
        })}
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", pointerEvents: "none" }}>
        {h ? (
          <>
            <span className="num" style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, color: T.ink }}>{h.value}</span>
            <span style={{ fontSize: 11.5, color: T.ink2, marginTop: 4, maxWidth: size - thickness * 2 - 10 }}>{h.label}</span>
          </>
        ) : (
          <>
            {center}
            {sub && <span style={{ fontSize: 11.5, color: T.ink3, marginTop: 4 }}>{sub}</span>}
          </>
        )}
      </div>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; value?: number | string }[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      {items.map((it) => (
        <div key={it.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: T.ink2 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: it.color, flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
          {it.value !== undefined && <span className="num" style={{ color: T.ink, fontWeight: 700 }}>{it.value}</span>}
        </div>
      ))}
    </div>
  );
}

// ---------- עמודות יומיות דו-כיווניות: נסגרו למעלה, נפתחו למטה ----------
// עמודה מלאה לכל יום (לא קו), מסילה עדינה מאחור, tooltip בריחוף/מגע/מקלדת.
// בסדר הקריאה RTL: הימים הישנים מימין, היום — בקצה השמאלי.
export type DaySeries = { label: string; color: string; values: number[] };

export function DayBars({ days, up, down, height = 190, ariaLabel, showValues }: {
  days: { short: string; long: string }[]; // ישן → חדש
  up: DaySeries;
  down: DaySeries;
  height?: number;
  ariaLabel: string;
  showValues?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const n = days.length;
  const max = Math.max(1, ...up.values, ...down.values);
  const values = showValues ?? n <= 16;
  const labelH = 20;
  const half = (height - labelH - 10) / 2; // 10 = מרווח לקו האמצע
  const every = n <= 8 ? 1 : Math.ceil(n / 7);
  const gap = n > 20 ? 3 : 5;
  const bar = (v: number, color: string, dir: "up" | "down", on: boolean) => {
    const h = v ? Math.max(6, (v / max) * (half - (values ? 14 : 2))) : 0;
    return (
      <div style={{ height: half, display: "flex", flexDirection: "column", justifyContent: dir === "up" ? "flex-end" : "flex-start", alignItems: "center", gap: 2 }}>
        {values && dir === "up" && v > 0 && <span className="num" style={{ fontSize: 10, fontWeight: 700, color: on ? T.ink : T.ink3, lineHeight: 1 }}>{v}</span>}
        <div style={{
          width: "100%", height: h,
          borderRadius: dir === "up" ? "7px 7px 2px 2px" : "2px 2px 7px 7px",
          background: dir === "up"
            ? `linear-gradient(180deg, ${color}, color-mix(in srgb, ${color} 62%, transparent))`
            : `linear-gradient(0deg, color-mix(in srgb, ${color} 85%, transparent), color-mix(in srgb, ${color} 40%, transparent))`,
          boxShadow: on && v ? `0 ${dir === "up" ? 8 : -8}px 18px -8px ${alpha(color, 80)}` : "none",
          transition: "height .7s var(--ease-out), box-shadow .2s",
        }} />
        {values && dir === "down" && v > 0 && <span className="num" style={{ fontSize: 10, fontWeight: 700, color: on ? T.ink : T.ink3, lineHeight: 1 }}>{v}</span>}
      </div>
    );
  };
  const pos = hover === null ? 0 : ((hover + 0.5) / n) * 100; // מימין
  return (
    <div style={{ position: "relative" }} role="group" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gap, height: height - labelH, position: "relative" }}>
        {/* קו האמצע */}
        <span aria-hidden="true" style={{ position: "absolute", insetInline: 0, top: half + 4, height: 2, borderRadius: 2, background: T.lineStrong, pointerEvents: "none" }} />
        {days.map((d, i) => {
          const on = hover === i;
          const today = i === n - 1;
          return (
            <div key={i} tabIndex={0}
              aria-label={`${d.long}: ${up.values[i]} ${up.label}, ${down.values[i]} ${down.label}`}
              onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
              onTouchStart={() => setHover(i)}
              style={{
                display: "flex", flexDirection: "column", justifyContent: "space-between", minWidth: 0,
                borderRadius: 8, outline: "none",
                background: on ? alpha("var(--tj-accent)", 9) : today ? alpha("var(--tj-accent)", 5) : alpha("var(--tj-ink3)", 5),
                padding: "0 1px", transition: "background .2s",
              }}>
              {bar(up.values[i], up.color, "up", on)}
              {bar(down.values[i], down.color, "down", on)}
            </div>
          );
        })}
      </div>
      <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gap, height: labelH, alignItems: "end" }}>
        {days.map((d, i) => {
          const today = i === n - 1;
          const show = today || (n - 1 - i) % every === 0;
          return (
            <span key={i} className={today ? undefined : "num"} style={{
              fontSize: 10, textAlign: "center", whiteSpace: "nowrap", overflow: "visible",
              color: today ? T.accent : T.ink3, fontWeight: today ? 700 : 400, visibility: show ? "visible" : "hidden",
            }}>{today ? "היום" : d.short}</span>
          );
        })}
      </div>
      {hover !== null && (
        <div role="tooltip" style={{
          position: "absolute", top: -6, right: `clamp(0px, calc(${pos}% - 75px), calc(100% - 150px))`,
          width: 150, background: T.surface, border: `1px solid ${T.lineStrong}`, borderRadius: 12,
          padding: "8px 10px", boxShadow: T.shadowMd, fontSize: 12, zIndex: 3, pointerEvents: "none",
        }}>
          <div style={{ fontWeight: 700, marginBottom: 4, color: T.ink }}>{days[hover].long}</div>
          {[up, down].map((s) => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6, color: T.ink2 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
              {s.label}
              <span className="num" style={{ marginInlineStart: "auto", color: T.ink, fontWeight: 700 }}>{s.values[hover]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// מקרא קטן לגרף היומי (נקודה מלאה לכל סדרה + סכום)
export function DayBarsLegend({ items }: { items: { label: string; color: string; total: number }[] }) {
  return (
    <div style={{ display: "flex", gap: 14, fontSize: 12, color: T.ink2, flexWrap: "wrap" }}>
      {items.map((it) => (
        <span key={it.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: it.color }} />
          {it.label} <b className="num" style={{ color: T.ink }}>{it.total}</b>
        </span>
      ))}
    </div>
  );
}

// ---------- עמודות עבות עם מעבר צבע, ערך מעל כל עמודה ----------
export function Columns({ items, height = 170, color = "var(--tj-accent)", highlight, ariaLabel }: {
  items: { label: string; value: number; title?: string }[];
  height?: number;
  color?: string;
  highlight?: number; // אינדקס העמודה המודגשת (למשל החודש הנוכחי)
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div role="img" aria-label={ariaLabel}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${items.length}, 1fr)`, gap: 6, alignItems: "end", height }}>
        {items.map((it, i) => {
          const on = hover === i || highlight === i;
          const h = it.value ? Math.max(10, (it.value / max) * (height - 24)) : 0;
          return (
            <div key={i} title={it.title ?? `${it.label}: ${it.value}`}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", gap: 4 }}>
              <span className="num" style={{ fontSize: 11, fontWeight: 700, color: on ? T.ink : T.ink3, opacity: it.value ? 1 : 0 }}>{it.value}</span>
              {/* מסילה מלאה לכל עמודה — גם בלי נתונים זה נראה כמו גרף, לא כמו קו */}
              <div style={{
                width: "100%", maxWidth: 38, height: height - 24, borderRadius: 10, background: alpha("var(--tj-ink3)", 9),
                display: "flex", alignItems: "flex-end", overflow: "hidden",
                outline: highlight === i ? `2px solid ${alpha(color, 45)}` : "none", outlineOffset: 2,
              }}>
                <div style={{
                  width: "100%", height: it.value ? h : 0, borderRadius: 10,
                  background: `linear-gradient(180deg, ${color} 0%, color-mix(in srgb, ${color} 60%, transparent) 100%)`,
                  boxShadow: on && it.value ? `0 10px 22px -10px ${alpha(color, 85)}` : "none",
                  transition: "height .8s var(--ease-out), box-shadow .25s",
                }} />
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${items.length}, 1fr)`, gap: 6, marginTop: 6 }}>
        {items.map((it, i) => (
          <span key={i} style={{ fontSize: 10.5, textAlign: "center", whiteSpace: "nowrap", color: highlight === i ? T.accent : T.ink3, fontWeight: highlight === i ? 700 : 400 }}>{it.label}</span>
        ))}
      </div>
    </div>
  );
}

// ---------- פסים אופקיים עבים: הושלם (מלא) + פתוח (שקוף) ----------
export function SplitBars({ rows }: { rows: { key: string; label: string; color: string; done: number; open: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.done + r.open));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {rows.map((r) => {
        const total = r.done + r.open;
        const pct = total ? Math.round((r.done / total) * 100) : 0;
        return (
          <div key={r.key} title={`${r.label}: ${r.done} הושלמו · ${r.open} פתוחות`}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: r.color, flexShrink: 0, alignSelf: "center" }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: T.ink, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
              <span className="num" style={{ fontSize: 11.5, color: T.ink3 }}>{r.done}/{total}</span>
              <span className="num" style={{ fontSize: 12, fontWeight: 800, color: T.ink, minWidth: 36, textAlign: "start" }}>{pct}%</span>
            </div>
            <div style={{ display: "flex", height: 16, borderRadius: 99, overflow: "hidden", background: T.surface2, width: `${Math.max(18, (total / max) * 100)}%` }}>
              {r.done > 0 && <div style={{ width: `${(r.done / total) * 100}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${r.color} 80%, #000), ${r.color})` }} />}
              {r.open > 0 && <div style={{ flex: 1, background: alpha(r.color, 28), borderInlineStart: r.done ? `2px solid var(--tj-surface)` : undefined }} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- מפת חום: השלמות לפי יום, 12 שבועות — תאים גמישים שממלאים את הרוחב ----------
export function Heatmap({ weeks, color = "var(--tj-mint)", dayLabels, ariaLabel, todayKey }: {
  weeks: { key: string; label: string; value: number; future?: boolean }[][]; // כל שבוע = 7 ימים (א׳→ש׳)
  color?: string;
  dayLabels: string[];
  ariaLabel: string;
  todayKey?: string;
}) {
  const [hover, setHover] = useState<{ key: string; label: string; value: number } | null>(null);
  const max = Math.max(1, ...weeks.flat().map((d) => d.value));
  const level = (v: number) => (v === 0 ? 0 : v / max <= 0.25 ? 1 : v / max <= 0.5 ? 2 : v / max <= 0.75 ? 3 : 4);
  const fills = [alpha("var(--tj-ink3)", 11), alpha(color, 32), alpha(color, 56), alpha(color, 80), color];
  return (
    <div role="img" aria-label={ariaLabel} style={{ minWidth: 0 }}>
      <div style={{ display: "flex", gap: 5 }}>
        <div style={{ display: "grid", gridTemplateRows: "repeat(7, minmax(0, 1fr))", gap: 5, width: 16, flexShrink: 0 }}>
          {dayLabels.map((d, i) => (
            <span key={i} style={{ fontSize: 10, color: T.ink3, display: "flex", alignItems: "center" }}>{i % 2 === 0 ? d : ""}</span>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 0, maxWidth: weeks.length * 42, display: "grid", gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))`, gap: 5 }}>
          {weeks.map((w, wi) => (
            <div key={wi} style={{ display: "grid", gridTemplateRows: "repeat(7, auto)", gap: 5 }}>
              {w.map((d) => {
                const on = hover?.key === d.key;
                const today = d.key === todayKey;
                return (
                  <span key={d.key} onMouseEnter={() => setHover(d)} onMouseLeave={() => setHover(null)}
                    title={`${d.label}: ${d.value} הושלמו`}
                    style={{
                      display: "block", width: "100%", aspectRatio: "1", borderRadius: 6,
                      background: d.future ? "transparent" : fills[level(d.value)],
                      boxShadow: d.future ? `inset 0 0 0 1px ${T.line}`
                        : today ? `0 0 0 2px var(--tj-surface), 0 0 0 3.5px var(--tj-accent)`
                        : on ? `0 0 0 2px var(--tj-surface), 0 0 0 3.5px ${alpha(color, 70)}` : "none",
                      transform: on ? "scale(1.12)" : "none",
                      transition: "transform .18s var(--ease-out), box-shadow .18s",
                    }} />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, fontSize: 11, color: T.ink3, minHeight: 18 }}>
        {hover ? <span style={{ color: T.ink2, fontWeight: 600 }}>{hover.label} · <span className="num">{hover.value}</span> הושלמו</span> : (
          <>
            פחות
            {fills.map((f, i) => <span key={i} style={{ width: 12, height: 12, borderRadius: 3, background: f }} />)}
            יותר
          </>
        )}
      </div>
    </div>
  );
}

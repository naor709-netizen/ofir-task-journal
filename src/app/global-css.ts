// ============================================
// העיצוב הגלובלי של היומן — משובץ ישירות בתוך ה-HTML (תגית <style> ב-layout),
// ולא כקובץ CSS נפרד.
//
// למה: אצל אופיר (Chrome באנדרואיד, נפתח מקישור בוואטסאפ) קובץ ה-CSS הנפרד לא
// נטען, והיומן הוצג "ריק" — בלי רקע, בלי כרטיסים, כפתור "משימה חדשה" שקוף.
// כשהעיצוב חלק מהדף עצמו הוא מגיע תמיד יחד איתו (וגם חוסך בקשה ברשת).
// ~9KB — זניח.
// ============================================

export const GLOBAL_CSS = `
:root {
  --font: 'Heebo', system-ui, sans-serif;
  --font-display: 'Rubik', 'Heebo', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
  color-scheme: light;

  /* תנועה — יציאה אקספוננציאלית; אף פעם לא linear/ease-in-out */
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-soft: cubic-bezier(0.32, 0.72, 0, 1);

  /* ערכת נושא — בהיר (ברירת מחדל) */
  --tj-bg: #F1F4F9;
  --tj-bg2: #F6F8FC;
  --tj-surface: #FFFFFF;
  --tj-surface2: #E9EEF6;
  --tj-input: #FFFFFF;
  --tj-line: rgba(23,43,77,0.11);
  --tj-line-strong: rgba(23,43,77,0.22);
  --tj-ink: #13223B;
  --tj-ink2: #475B76;
  --tj-ink3: #6F8199;
  --tj-mint: #0B9A76;
  --tj-mint-soft: rgba(11,154,118,0.12);
  --tj-danger: #D42020;
  --tj-danger-soft: rgba(212,32,32,0.09);
  --tj-amber: #B45309;
  --tj-amber-soft: rgba(180,83,9,0.10);
  --tj-chipmix: #000000;
  --tj-shadow: rgba(23,43,77,0.06);
  --tj-shadow-strong: rgba(23,43,77,0.17);
  --tj-glass: rgba(255,255,255,0.70);
  --tj-bezel: rgba(255,255,255,0.7);
  --tj-aurora-2: #0FA47E;

  /* צבעי אנשים (אומתו כפלטה קטגורית) */
  --p-blue: #2563EB; --p-teal: #0D9488; --p-orange: #EA580C;
  --p-fuchsia: #C026D3; --p-rose: #E11D48; --p-violet: #7C3AED;

  /* גוון היומן הפעיל — ברירת מחדל: כחול המותג (אופיר) */
  --tj-accent: #2563EB;
  --tj-grad-a: #3B82F6;
  --tj-grad-b: #1D4FD7;
}

html[data-theme="dark"] {
  color-scheme: dark;
  --tj-bg: #0A101D;
  --tj-bg2: #0E1627;
  --tj-surface: #121B2E;
  --tj-surface2: #1A2741;
  --tj-input: #0E1627;
  --tj-line: rgba(148,178,255,0.13);
  --tj-line-strong: rgba(148,178,255,0.28);
  --tj-ink: #E8EFFA;
  --tj-ink2: #A9B9D2;
  --tj-ink3: #7F92B2;
  --tj-mint: #2BC29A;
  --tj-mint-soft: rgba(43,194,154,0.15);
  --tj-danger: #F47272;
  --tj-danger-soft: rgba(244,114,114,0.13);
  --tj-amber: #E8A13D;
  --tj-amber-soft: rgba(232,161,61,0.14);
  --tj-chipmix: #FFFFFF;
  --tj-shadow: rgba(0,0,0,0.34);
  --tj-shadow-strong: rgba(0,0,0,0.56);
  --tj-glass: rgba(14,22,39,0.70);
  --tj-bezel: rgba(148,178,255,0.07);
  --tj-aurora-2: #12A594;

  --p-blue: #5B8CFF; --p-teal: #12A594; --p-orange: #E2600F;
  --p-fuchsia: #D946EF; --p-rose: #F43F5E; --p-violet: #8B5CF6;

  --tj-accent: #5B8CFF;
}

/* ---- גוון אישי ליומן: כל אחד מאנשי הצוות מקבל צבע משלו לכרום ---- */
[data-person="teal"]    { --tj-accent: #0D9488; --tj-grad-a: #14B8A6; --tj-grad-b: #0F766E; }
[data-person="orange"]  { --tj-accent: #DB5209; --tj-grad-a: #F97316; --tj-grad-b: #C2410C; }
[data-person="fuchsia"] { --tj-accent: #B91FCB; --tj-grad-a: #D946EF; --tj-grad-b: #A21CAF; }
[data-person="rose"]    { --tj-accent: #DB1A45; --tj-grad-a: #F43F5E; --tj-grad-b: #BE123C; }
[data-person="violet"]  { --tj-accent: #7C3AED; --tj-grad-a: #8B5CF6; --tj-grad-b: #6427D6; }
html[data-theme="dark"] [data-person="teal"]    { --tj-accent: #2DD4BF; }
html[data-theme="dark"] [data-person="orange"]  { --tj-accent: #FB923C; }
html[data-theme="dark"] [data-person="fuchsia"] { --tj-accent: #E879F9; }
html[data-theme="dark"] [data-person="rose"]    { --tj-accent: #FB7185; }
html[data-theme="dark"] [data-person="violet"]  { --tj-accent: #A78BFA; }

/* נגזרות מהגוון — מוגדרות על עטיפת האפליקציה כדי להתחשב בגוון האישי */
.tj-app {
  --tj-accent-soft: color-mix(in srgb, var(--tj-accent) 10%, transparent);
  --tj-accent-line: color-mix(in srgb, var(--tj-accent) 30%, transparent);
  --tj-grad: linear-gradient(135deg, var(--tj-grad-a) 0%, var(--tj-grad-b) 100%);
  --tj-glow: color-mix(in srgb, var(--tj-grad-b) 55%, transparent);
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  color: var(--tj-ink);
}
html[data-theme="dark"] .tj-app {
  --tj-accent-soft: color-mix(in srgb, var(--tj-accent) 16%, transparent);
  --tj-accent-line: color-mix(in srgb, var(--tj-accent) 36%, transparent);
}

* { box-sizing: border-box; }

html { direction: rtl; }

body {
  margin: 0;
  background: var(--tj-bg);
  color: var(--tj-ink);
  font-family: var(--font);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  transition: background .3s var(--ease-out), color .3s var(--ease-out);
}

/* ---- אורורה חיה: שלוש הילות בגוון היומן שנודדות לאט מאוד מאחורי התוכן ---- */
.tj-aurora {
  position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden;
}
.tj-aurora i {
  position: absolute; display: block; border-radius: 50%;
  filter: blur(64px); opacity: 0.78; will-change: transform;
}
.tj-aurora i:nth-child(1) {
  width: 62vmax; height: 46vmax; top: -24vmax; inset-inline-start: -14vmax;
  background: radial-gradient(closest-side, color-mix(in srgb, var(--tj-grad-a) 34%, transparent), transparent);
  animation: tj-drift-a 38s var(--ease-soft) infinite alternate;
}
.tj-aurora i:nth-child(2) {
  width: 52vmax; height: 40vmax; bottom: -22vmax; inset-inline-end: -12vmax;
  background: radial-gradient(closest-side, color-mix(in srgb, var(--tj-accent) 26%, transparent), transparent);
  animation: tj-drift-b 46s var(--ease-soft) infinite alternate;
}
.tj-aurora i:nth-child(3) {
  width: 34vmax; height: 30vmax; top: 30vh; inset-inline-start: 38vw;
  background: radial-gradient(closest-side, color-mix(in srgb, var(--tj-aurora-2) 16%, transparent), transparent);
  animation: tj-drift-c 52s var(--ease-soft) infinite alternate;
}
html[data-theme="dark"] .tj-aurora i { opacity: 0.85; }
@keyframes tj-drift-a { to { transform: translate3d(9vw, 6vh, 0) scale(1.12); } }
@keyframes tj-drift-b { to { transform: translate3d(-8vw, -7vh, 0) scale(1.08); } }
@keyframes tj-drift-c { to { transform: translate3d(-14vw, 10vh, 0) scale(1.2); } }

.tj-app > :not(.tj-aurora) { position: relative; z-index: 1; }

/* גרעון עדין שובר את הסטריליות של משטחים שטוחים — שכבת טקסטורה קבועה */
body::after {
  content: "";
  position: fixed; inset: 0; z-index: 2; pointer-events: none;
  opacity: 0.024;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
html[data-theme="dark"] body::after { opacity: 0.045; }

button {
  transition: background .3s var(--ease-soft), border-color .3s var(--ease-soft),
    box-shadow .3s var(--ease-soft), color .3s var(--ease-soft), transform .14s var(--ease-out), opacity .2s;
  font-family: inherit;
}
button:active:not(:disabled) { transform: scale(0.97); }
button:disabled { cursor: default; }

/* ---- כרטיסים: אור-זרקור שעוקב אחרי הסמן (נצבע בגוון היומן) ---- */
.tj-card {
  isolation: isolate;
  transition: box-shadow .45s var(--ease-soft), border-color .45s var(--ease-soft);
}
.tj-card::before {
  content: ""; position: absolute; inset: 0; border-radius: inherit; z-index: -1;
  pointer-events: none; opacity: 0; transition: opacity .5s var(--ease-out);
  background: radial-gradient(420px circle at var(--mx, 50%) var(--my, 0%),
    color-mix(in srgb, var(--tj-accent) 7%, transparent), transparent 62%);
}
@media (hover: hover) {
  .tj-card:hover::before { opacity: 1; }
  .tj-card:hover {
    box-shadow: inset 0 1px 0 var(--tj-bezel), 0 2px 4px var(--tj-shadow), 0 32px 64px -30px var(--tj-shadow-strong) !important;
  }
}

/* ---- הטיה תלת-ממדית עדינה לכרטיסי אנשים ומדדים ---- */
.tj-tilt {
  transform: perspective(900px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg)) translateZ(0);
  transition: transform .5s var(--ease-out);
  transform-style: preserve-3d;
}
.tj-tilt.is-tilting { transition: transform .08s linear; }

/* ---- טאב פעיל: גלולה שגולשת בין הטאבים (clip-path — בלי הנפשת רוחב) ---- */
.tj-tabpill {
  position: absolute; top: 3px; bottom: 3px; right: 0; pointer-events: none;
  background: var(--tj-grad);
  transition: clip-path .42s var(--ease-out);
}

/* ---- נקודת "עכשיו" חיה ---- */
.tj-live { position: relative; }
.tj-live::after {
  content: ""; position: absolute; inset: -5px; border-radius: 50%;
  background: currentColor; opacity: 0.35; animation: tj-ping 2.2s var(--ease-out) infinite;
}
@keyframes tj-ping { 0% { transform: scale(0.6); opacity: 0.45; } 80%, 100% { transform: scale(1.9); opacity: 0; } }

/* ---- שלד טעינה ---- */
.tj-skel {
  background: linear-gradient(90deg, var(--tj-surface) 0%, var(--tj-surface2) 40%, var(--tj-surface) 80%);
  background-size: 200% 100%; animation: tj-shimmer 1.6s var(--ease-soft) infinite; border-radius: 18px;
}
@keyframes tj-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }

/* ---- טבעות התקדמות: הציור "נמתח" בכניסה ---- */
.tj-ring-arc { transition: stroke-dashoffset 1.1s var(--ease-out), stroke .3s; }

/* ---- רטט שגיאה (קוד PIN שגוי) ---- */
@keyframes tj-shake {
  10%, 90% { transform: translateX(-1px); } 20%, 80% { transform: translateX(3px); }
  30%, 50%, 70% { transform: translateX(-6px); } 40%, 60% { transform: translateX(6px); }
}
.tj-shake { animation: tj-shake .5s var(--ease-out); }

/* ---- גיליון צד (מרכז העדכונים) ---- */
@keyframes tj-sheet-in { from { transform: translateX(-104%); } to { transform: none; } }
@keyframes tj-sheet-up { from { transform: translateY(104%); } to { transform: none; } }
@keyframes tj-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes tj-pop-in { from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: none; } }
.tj-sheet { animation: tj-sheet-in .46s var(--ease-out); }
.tj-scrim { animation: tj-fade-in .3s var(--ease-out); }
.tj-pop { animation: tj-pop-in .36s var(--ease-out); }
@media (max-width: 640px) { .tj-sheet { animation-name: tj-sheet-up; } }

/* ---- הצלחה: סימן וי שמצטייר ---- */
.tj-check-draw { stroke-dasharray: 24; stroke-dashoffset: 24; animation: tj-draw .6s .15s var(--ease-out) forwards; }
@keyframes tj-draw { to { stroke-dashoffset: 0; } }

:focus-visible { outline: 2px solid var(--tj-accent, #2563EB); outline-offset: 2px; }

input, textarea, select { font-family: inherit; }
input::placeholder, textarea::placeholder { color: var(--tj-ink3); opacity: 1; }

.num { font-family: var(--font-mono); font-feature-settings: 'tnum'; letter-spacing: -0.02em; }

.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

.softblob { position: absolute; border-radius: 50%; filter: blur(48px); opacity: 0.35; pointer-events: none; }

::selection { background: color-mix(in srgb, var(--tj-accent, #2563EB) 24%, transparent); }

/* native date/time popups + scrollbars in dark */
::-webkit-calendar-picker-indicator { opacity: 0.7; }

.tj-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

@media (max-width: 768px) {
  .modal-mobile-full {
    max-width: 100% !important; margin: 0 !important;
    border-radius: 0 !important; min-height: 100dvh; max-height: 100dvh !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  .tj-aurora i, .tj-live::after, .tj-skel { animation: none !important; }
  .tj-tilt { transform: none !important; }
  .tj-sheet, .tj-scrim, .tj-pop, .tj-shake { animation: none !important; }
  .tj-check-draw { animation: none; stroke-dashoffset: 0; }
  .tj-ring-arc, .tj-tabpill { transition: none !important; }
}
`;

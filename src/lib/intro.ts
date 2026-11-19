// ============================================
// פתיח: שם האפליקציה על רקע כחול, וי שמצטייר, ואז מעבר הדרגתי לאפליקציה (כ-1.3 שניות).
// (עד 19.11.2026 היה כאן סרטון עם תמונה — הוסר לבקשת אופיר.)
//
// HTML סטטי + סקריפט קטן שמוטמע בדף: מופיע מיד, בלי לחכות לטעינת האפליקציה,
// והיומן נטען מתחתיו. פעם אחת בכל פתיחה של האפליקציה. נגיעה בכל מקום מדלגת.
// הפונקציה עומדת בפני עצמה (בלי משתנים מבחוץ) — היא נשלחת לדפדפן כמו שהיא (toString).
// ============================================

export const INTRO_KEY = "tj-intro-seen";

// רץ לפני שהפתיח מצויר: אם כבר ראו אותו בסשן הזה — הוא לא מופיע בכלל (בלי הבזק)
export const INTRO_SKIP_SCRIPT =
  `try{if(sessionStorage.getItem("${INTRO_KEY}"))document.documentElement.setAttribute("data-intro","skip")}catch(e){}`;

function introBoot() {
  const KEY = "tj-intro-seen";
  const FADE_MS = 480; // תואם ל-transition ב-global-css
  const html = document.documentElement;
  const root = document.getElementById("tj-intro");
  if (!root) return;
  if (html.getAttribute("data-intro") === "skip") { root.setAttribute("data-phase", "gone"); return; }

  let done = false;
  const timers: number[] = [];
  const prevOverflow = html.style.overflow;
  html.style.overflow = "hidden";

  function finish() {
    if (done) return;
    done = true;
    try { sessionStorage.setItem(KEY, "1"); } catch { /* מצב פרטי */ }
    for (let i = 0; i < timers.length; i++) window.clearTimeout(timers[i]);
    document.removeEventListener("keydown", onKey);
    html.style.overflow = prevOverflow;
    root!.setAttribute("data-phase", "leaving");
    try { window.dispatchEvent(new Event("tj-intro-leave")); } catch { /* ignore */ } // היומן נכנס עכשיו
    window.setTimeout(function () { root!.setAttribute("data-phase", "gone"); }, FADE_MS);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape" || e.key === "Enter" || e.key === " ") { e.preventDefault(); finish(); }
  }

  root.addEventListener("click", finish);
  document.addEventListener("keydown", onKey);
  const reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  timers.push(window.setTimeout(finish, reduced ? 900 : 1300));
}

export const INTRO_BOOT_SCRIPT = `(${introBoot.toString()})()`;

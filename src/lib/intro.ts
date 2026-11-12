// ============================================
// פתיח: סרטון בלי קול על כל המסך ברגע שנכנסים, ואז מעבר הדרגתי ליומן.
//
// הכל רץ מסקריפט קטן שמוטמע ב-HTML עצמו (לא תלוי ב-React ולא מחכה לטעינת האפליקציה),
// כך שהסרטון מתחיל מיד, והיומן נטען מתחתיו בינתיים. פעם אחת בכל פתיחה של האפליקציה.
// הפונקציה עומדת בפני עצמה (בלי משתנים מבחוץ) — היא נשלחת לדפדפן כמו שהיא (toString).
// ============================================

export const INTRO_KEY = "tj-intro-seen";

// רץ לפני שהפתיח מצויר: אם כבר ראו אותו בסשן הזה — הוא לא מופיע בכלל (בלי הבזק)
export const INTRO_SKIP_SCRIPT =
  `try{if(sessionStorage.getItem("${INTRO_KEY}"))document.documentElement.setAttribute("data-intro","skip")}catch(e){}`;

function introBoot() {
  const KEY = "tj-intro-seen";
  const FADE_MS = 480; // תואם ל-transition ב-global-css
  const SPEED = 1.25; // הסרטון רץ מעט מהר יותר: 5 שניות → 4
  const html = document.documentElement;
  const root = document.getElementById("tj-intro");
  const video = document.getElementById("tj-intro-video") as HTMLVideoElement | null;
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
    window.setTimeout(function () {
      root!.setAttribute("data-phase", "gone");
      if (video) { try { video.pause(); video.removeAttribute("src"); video.load(); } catch { /* ignore */ } }
    }, FADE_MS);
  }
  function later(fn: () => void, ms: number) { timers.push(window.setTimeout(fn, ms)); }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape" || e.key === "Enter" || e.key === " ") { e.preventDefault(); finish(); }
  }

  root.addEventListener("click", finish);
  document.addEventListener("keydown", onKey);

  const reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  if (!video || reduced) { later(finish, 1500); return; } // בלי תנועה: הפריים הראשון לרגע, ונכנסים

  video.muted = true; // גם בלי ערוץ שמע — כך כל הדפדפנים מרשים ניגון אוטומטי
  video.defaultMuted = true;
  video.setAttribute("playsinline", "");
  video.addEventListener("ended", finish);
  video.addEventListener("error", function () { later(finish, 900); });
  video.addEventListener("playing", function () { root!.setAttribute("data-playing", "1"); });
  video.src = "/intro.mp4";
  video.defaultPlaybackRate = SPEED;
  video.playbackRate = SPEED;
  const p = video.play();
  if (p && typeof p.catch === "function") p.catch(function () { later(finish, 1500); }); // ניגון אוטומטי נחסם
  later(function () { if (video!.readyState < 2) finish(); }, 4500); // רשת איטית — לא תוקעים את הכניסה
  later(finish, 8000); // תקרה (הסרטון רץ כ-4 שניות)
}

export const INTRO_BOOT_SCRIPT = `(${introBoot.toString()})()`;

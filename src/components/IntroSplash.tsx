"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { INTRO_KEY } from "@/lib/intro";

// ============================================
// פתיח: סרטון קצר בלי קול לפני הכניסה ליומן.
// פעם אחת בכל פתיחה של האפליקציה (sessionStorage), עם "דילוג".
// היומן נטען מתחת בזמן שהסרטון רץ. סקריפט מוקדם ב-layout מסתיר את הפתיח
// לפני הציור הראשון כשכבר ראו אותו — כך אין הבזק ברענון.
// ============================================

const noSub = () => () => {};
function seenSnapshot(): boolean {
  try { return !!sessionStorage.getItem(INTRO_KEY); } catch { return false; }
}
const reducedSnapshot = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export default function IntroSplash() {
  // בשרת: מציגים (רקע + פריים ראשון) — הסקריפט המוקדם מסתיר אם כבר ראו
  const seen = useSyncExternalStore(noSub, seenSnapshot, () => false);
  const reduced = useSyncExternalStore(noSub, reducedSnapshot, () => false);
  // הסרטון נכנס לדף רק בדפדפן, אחרי שהוחלט שמציגים — בשרת יש רק את הפריים הראשון (רקע CSS),
  // כך שברענון באותו סשן (הפתיח מוסתר) הסרטון לא נטען בכלל
  const client = useSyncExternalStore(noSub, () => true, () => false);
  const [phase, setPhase] = useState<"play" | "leaving" | "gone">("play");
  const [progress, setProgress] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const leaving = useRef(false);

  const visible = !seen && phase !== "gone";

  const finish = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    try { sessionStorage.setItem(INTRO_KEY, "1"); } catch { /* מצב פרטי */ }
    setPhase("leaving");
    setTimeout(() => setPhase("gone"), 520);
  }, []);

  useEffect(() => {
    if (!visible || !client) return;
    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    html.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") { e.preventDefault(); finish(); }
    };
    window.addEventListener("keydown", onKey);

    const v = videoRef.current;
    let started = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (reduced || !v) {
      // בלי תנועה: הפריים הראשון לרגע, ונכנסים
      timers.push(setTimeout(finish, 1600));
    } else {
      v.muted = true; // iOS מנגן אוטומטית רק סרטון מושתק
      v.play().then(() => { started = true; }).catch(() => {
        // חיסכון בסוללה / חסימת ניגון — לא תוקעים את הכניסה
        timers.push(setTimeout(finish, 1800));
      });
      // רשת איטית: אם לא התחיל תוך 3.5 שניות — נכנסים
      timers.push(setTimeout(() => { if (!started && v.paused) finish(); }, 3500));
      // תקרה: הסרטון באורך 5 שניות
      timers.push(setTimeout(finish, 9000));
    }
    return () => {
      window.removeEventListener("keydown", onKey);
      html.style.overflow = prevOverflow;
      timers.forEach(clearTimeout);
    };
  }, [visible, client, reduced, finish]);

  if (!visible) return null;

  return (
    <div className="tj-intro" data-phase={phase} aria-label="פתיח — היומן השיתופי של אופיר">
      <div className="tj-intro-stage">
        <div className="tj-intro-frame">
          {client && <video
            ref={videoRef}
            src="/intro.mp4"
            poster="/intro-poster.jpg"
            muted
            playsInline
            autoPlay={!reduced}
            preload="auto"
            disablePictureInPicture
            disableRemotePlayback
            aria-label="היומן השיתופי של אופיר"
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              if (v.duration) setProgress(Math.min(1, v.currentTime / v.duration));
            }}
            onEnded={finish}
          />}
        </div>
        <div className="tj-intro-bar" aria-hidden="true">
          <span style={{ transform: `scaleX(${progress})` }} />
        </div>
        <button type="button" className="tj-intro-skip" onClick={finish}>
          כניסה ליומן
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}

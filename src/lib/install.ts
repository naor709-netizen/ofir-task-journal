// ============================================
// התקנת היומן כאפליקציה (PWA) — זיהוי סביבה + הנחיית ההתקנה של כרום
// האירוע beforeinstallprompt נתפס כבר בסקריפט מוקדם ב-layout (window.__tjBIP),
// כי הוא יכול להגיע לפני שהקומפוננטות עולות.
// ============================================

export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

declare global {
  interface Window {
    __tjBIP?: BIPEvent | null;
    __tjInstalled?: boolean;
  }
}

export interface InstallEnv {
  os: "ios" | "android" | "other";
  browser: "safari" | "chrome" | "samsung" | "firefox" | "edge" | "other";
  inApp: string | null; // שם האפליקציה שבתוכה נפתח הקישור (וואטסאפ, אינסטגרם…) — שם אי אפשר להתקין
  standalone: boolean; // כבר רץ כאפליקציה מהמסך הבית
  mobile: boolean;
}

let envCache: InstallEnv | null = null;

export function installEnv(): InstallEnv | null {
  if (typeof window === "undefined") return null;
  if (envCache) return envCache;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const iosBrowser = /CriOS/.test(ua) ? "chrome" : /FxiOS/.test(ua) ? "firefox" : /EdgiOS/.test(ua) ? "edge" : "safari";
  const browser: InstallEnv["browser"] = ios
    ? iosBrowser
    : /SamsungBrowser/i.test(ua) ? "samsung"
    : /Firefox/i.test(ua) ? "firefox"
    : /EdgA?\//.test(ua) ? "edge"
    : /Chrome/i.test(ua) ? "chrome" : "other";
  const inApp =
    /WhatsApp/i.test(ua) ? "וואטסאפ"
    : /Instagram/i.test(ua) ? "אינסטגרם"
    : /FBAN|FBAV|FB_IAB|FBIOS/i.test(ua) ? "פייסבוק"
    : /Telegram/i.test(ua) ? "טלגרם"
    : /Line\//.test(ua) ? "Line"
    : /GSA\//.test(ua) ? "אפליקציית גוגל"
    : android && /; wv\)/.test(ua) ? "דפדפן פנימי"
    // באייפון: דפדפן פנימי (WKWebView) לא מזדהה כ-Safari
    : ios && iosBrowser === "safari" && !/Safari\//.test(ua) ? "דפדפן פנימי"
    : null;
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.matchMedia?.("(display-mode: fullscreen)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  envCache = {
    os: ios ? "ios" : android ? "android" : "other",
    browser,
    inApp,
    standalone: !!standalone || !!window.__tjInstalled,
    mobile: ios || android || !!window.matchMedia?.("(pointer: coarse)").matches,
  };
  return envCache;
}

// ---- הנחיית ההתקנה המובנית (כרום / אדג׳ / סמסונג באנדרואיד ובמחשב) ----

export function subscribeInstall(cb: () => void): () => void {
  window.addEventListener("tj-bip", cb);
  return () => window.removeEventListener("tj-bip", cb);
}

export function canPromptInstall(): boolean {
  return typeof window !== "undefined" && !!window.__tjBIP;
}

export async function promptInstall(): Promise<InstallOutcome> {
  const e = typeof window !== "undefined" ? window.__tjBIP : null;
  if (!e) return "unavailable";
  try {
    await e.prompt();
    const { outcome } = await e.userChoice;
    window.__tjBIP = null; // אפשר להשתמש בכל אירוע פעם אחת בלבד
    window.dispatchEvent(new Event("tj-bip"));
    return outcome;
  } catch {
    return "unavailable";
  }
}

// ---- פתיחה בדפדפן האמיתי מתוך דפדפן פנימי של וואטסאפ/אינסטגרם ----

export function openInBrowserHref(env: InstallEnv, url: string): string | null {
  const u = new URL(url);
  if (env.os === "android") {
    // intent:// פותח את כרום ישירות; אם הוא לא מותקן — חוזרים לכתובת הרגילה
    return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
  }
  if (env.os === "ios") return `x-safari-${url}`; // iOS 17 ומעלה
  return null;
}

// ---- "לא עכשיו" על הבאנר — לכל יומן בנפרד ----

const hideKey = (journalId: string) => `tj-install-hide@${journalId}`;

export function subscribeInstallHidden(cb: () => void): () => void {
  window.addEventListener("tj-install-hide", cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener("tj-install-hide", cb);
    window.removeEventListener("storage", cb);
  };
}

export function isInstallHidden(journalId: string): boolean {
  try {
    const at = Number(localStorage.getItem(hideKey(journalId)) || 0);
    return at > 0 && Date.now() - at < 14 * 86400_000; // חוזר אחרי שבועיים
  } catch {
    return false;
  }
}

export function hideInstall(journalId: string): void {
  try { localStorage.setItem(hideKey(journalId), String(Date.now())); } catch { /* מצב פרטי */ }
  window.dispatchEvent(new Event("tj-install-hide"));
}

// סקריפט מוקדם ל-layout: תופס את האירוע לפני שהאפליקציה עולה
export const INSTALL_CAPTURE_SCRIPT =
  `window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__tjBIP=e;window.dispatchEvent(new Event("tj-bip"))});` +
  `window.addEventListener("appinstalled",function(){window.__tjBIP=null;window.__tjInstalled=true;window.dispatchEvent(new Event("tj-bip"))});`;

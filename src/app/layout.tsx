import type { Metadata, Viewport } from "next";
import { GLOBAL_CSS } from "./global-css";
import { ToastProvider } from "@/components/Toast";
import { INSTALL_CAPTURE_SCRIPT } from "@/lib/install";
import { INTRO_SKIP_SCRIPT, INTRO_BOOT_SCRIPT } from "@/lib/intro";
import { APP_NAME, APP_DEPT, APP_FULL, APP_SHORT, iconUrl } from "@/lib/brand";

export const metadata: Metadata = {
  title: APP_FULL,
  description: "יומן משימות אישי — לוח שנה, קטגוריות, תזכורות, שלבים ותצוגות מרובות",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: APP_SHORT },
  icons: {
    icon: [
      { url: iconUrl("favicon-64.png"), sizes: "64x64", type: "image/png" },
      { url: iconUrl("icon-192.png"), sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: iconUrl("apple-touch-icon.png"), sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#F1F4F9",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl">
      <body>
        {/* העיצוב משובץ בדף עצמו — לא תלוי בהורדת קובץ CSS נפרד (ראו global-css.ts) */}
        <style id="tj-global" dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* קובע את ערכת הנושא לפני הציור הראשון (מונע הבזק לבן במצב כהה),
            וטוען את הפונטים בלי לחסום את הציור — פונט מערכת מוצג עד שהם מגיעים */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              `try{var t=localStorage.getItem("ofir-theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.dataset.theme="dark"}catch(e){}` +
              INSTALL_CAPTURE_SCRIPT + INTRO_SKIP_SCRIPT +
              `var f=document.createElement("link");f.rel="stylesheet";f.href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700;800&family=Rubik:wght@500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap";document.head.appendChild(f);`,
          }}
        />
        {/* פתיח: שם האפליקציה + וי שמצטייר, ואז מעבר הדרגתי (src/lib/intro.ts).
            HTML סטטי + סקריפט מוטמע — מופיע מיד, בלי לחכות לטעינת האפליקציה. */}
        <div id="tj-intro" className="tj-intro" aria-label={APP_FULL} suppressHydrationWarning>
          <div className="tj-intro-brand">
            <svg className="tj-intro-mark" width="96" height="96" viewBox="0 0 88 88" aria-hidden="true">
              <rect x="10" y="12" width="64" height="64" rx="17" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="5" />
              <path className="tj-intro-check" d="M24 45 L39 60.5 L75.5 17" fill="none" stroke="#fff" strokeWidth="9"
                strokeLinecap="round" strokeLinejoin="round" pathLength={100} />
            </svg>
            <div className="tj-intro-name">{APP_NAME}</div>
            <div className="tj-intro-dept">{APP_DEPT}</div>
          </div>
        </div>
        <script dangerouslySetInnerHTML={{ __html: INTRO_BOOT_SCRIPT }} />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}

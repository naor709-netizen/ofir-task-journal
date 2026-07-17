import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";

export const metadata: Metadata = {
  title: "יומן המשימות של אופיר",
  description: "יומן משימות אישי — לוח שנה, קטגוריות, תזכורות, שלבים ותצוגות מרובות",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "היומן של אופיר" },
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#F2F5F9",
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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* קובע את ערכת הנושא לפני הציור הראשון (מונע הבזק לבן במצב כהה),
            וטוען את הפונטים בלי לחסום את הציור — פונט מערכת מוצג עד שהם מגיעים */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              `try{var t=localStorage.getItem("ofir-theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.dataset.theme="dark"}catch(e){}` +
              `var f=document.createElement("link");f.rel="stylesheet";f.href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700;800&family=Rubik:wght@500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap";document.head.appendChild(f);`,
          }}
        />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}

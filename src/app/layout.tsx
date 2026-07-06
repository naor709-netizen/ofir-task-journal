import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";

export const metadata: Metadata = {
  title: "יומן המשימות של אופיר",
  description: "יומן משימות אישי — לוח שנה, קטגוריות, תזכורות, שלבים ותצוגות מרובות",
};

export const viewport: Viewport = {
  themeColor: "#0A1120",
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
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}

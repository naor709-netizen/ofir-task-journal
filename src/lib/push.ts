"use client";

// ============================================
// Web Push — רישום מנוי להתראות שמגיעות גם כשהיומן סגור
// ============================================

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

// applicationServerKey כ-ArrayBuffer (תמיכה רחבה יותר מהמחרוזת הגולמית)
function vapidKeyBuffer(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

export function pushSupported(): boolean {
  return typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
}

export function pushPermission(): NotificationPermission | "unsupported" {
  if (!pushSupported()) return "unsupported";
  return Notification.permission;
}

export async function isSubscribed(): Promise<boolean> {
  if (!pushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  } catch {
    return false;
  }
}

export type PushResult = { ok: boolean; reason?: string };

export async function enablePush(): Promise<PushResult> {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };
  if (!VAPID_PUBLIC) return { ok: false, reason: "no-vapid" };

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reason: "denied" };

  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKeyBuffer(VAPID_PUBLIC),
    });
  }

  const json = sub.toJSON();
  try {
    const { supabase } = await import("./supabase");
    const { error } = await supabase
      .from("push_subscriptions")
      .upsert({ endpoint: json.endpoint, subscription: json }, { onConflict: "endpoint" });
    if (error) return { ok: false, reason: error.message };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "sync-failed" };
  }
  return { ok: true };
}

export interface PushDiag {
  permission: NotificationPermission | "unsupported";
  standalone: boolean; // מותקן כ-PWA (רלוונטי לאייפון)
  ios: boolean;
  vapidBaked: boolean;
  deviceSubscribed: boolean;
  server: { vapidPublic: boolean; vapidPrivate: boolean; cronSecret: boolean; supabase: boolean } | null;
  cloudSubscriptions: number | null; // null — הטבלה לא קיימת / שגיאה
  cloudError: string | null;
  heartbeatAt: string | null; // הרצת ה-cron האחרונה בשרת
}

export async function diagnosePush(): Promise<PushDiag> {
  const diag: PushDiag = {
    permission: pushPermission(),
    standalone: typeof window !== "undefined" &&
      (window.matchMedia?.("(display-mode: standalone)").matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true),
    ios: typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent),
    vapidBaked: !!VAPID_PUBLIC,
    deviceSubscribed: await isSubscribed(),
    server: null,
    cloudSubscriptions: null,
    cloudError: null,
    heartbeatAt: null,
  };

  try {
    const res = await fetch("/api/send-reminders", { method: "GET" });
    if (res.ok) diag.server = await res.json();
  } catch {
    /* offline / route missing */
  }

  try {
    const { supabase } = await import("./supabase");
    const [subsRes, hbRes] = await Promise.all([
      supabase.from("push_subscriptions").select("endpoint", { count: "exact", head: true }),
      supabase.from("reminders_sent").select("sent_at").eq("reminder_id", "__cron_heartbeat__").maybeSingle(),
    ]);
    if (subsRes.error) diag.cloudError = subsRes.error.message;
    else diag.cloudSubscriptions = subsRes.count ?? 0;
    if (!hbRes.error && hbRes.data) diag.heartbeatAt = hbRes.data.sent_at;
  } catch (e) {
    diag.cloudError = e instanceof Error ? e.message : "cloud-unreachable";
  }

  return diag;
}

// התראת מערכת דרך ה-Service Worker (עובד באנדרואיד/PWA, בניגוד ל-new Notification)
// tag משותף עם הפוש מהשרת — אותה תזכורת לא תופיע פעמיים כשהיומן פתוח
export async function showLocalNotification(title: string, body: string, tag?: string): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted") return;
  try {
    const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.ready);
    if (reg) {
      await reg.showNotification(title, {
        body,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        dir: "rtl",
        lang: "he",
        tag,
      });
      return;
    }
  } catch {
    /* fall through */
  }
  try {
    new Notification(title, { body, icon: "/icon-192.png", tag });
  } catch {
    /* best-effort */
  }
}

// שולח התראת-אמת דרך השרת לכל המכשירים הרשומים (בדיקת מסירה)
export async function sendTestPush(): Promise<PushResult> {
  try {
    const res = await fetch("/api/test-push", { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, reason: json?.error || `http-${res.status}` };
    if ((json?.sent ?? 0) === 0) return { ok: false, reason: json?.subscriptions ? "no-delivery" : "no-subscriptions" };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "failed" };
  }
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) {
      const endpoint = sub.toJSON().endpoint;
      await sub.unsubscribe();
      const { supabase } = await import("./supabase");
      if (endpoint) await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
    }
  } catch {
    /* best-effort */
  }
}

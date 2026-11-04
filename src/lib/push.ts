"use client";

// ============================================
// Web Push + טלגרם — רישום ערוצי העדכונים של היומן הפעיל
// ============================================

import { MANAGER_ID } from "./journals";

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

async function registerOnServer(sub: PushSubscription, journalId: string): Promise<PushResult> {
  try {
    const res = await fetch("/api/push-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON(), journalId }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return { ok: false, reason: j?.error || `http-${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "sync-failed" };
  }
}

// בכל פתיחה: אם למכשיר יש מנוי — מרעננים אותו בשרת. מרפא מנוי שנמחק בצד השרת
// (410 מהדפדפן, ניקוי ידני) ומצמיד את המכשיר ליומן הנכון.
let synced = false;
export async function syncPushSubscription(journalId: string = MANAGER_ID): Promise<void> {
  if (synced || !pushSupported() || Notification.permission !== "granted") return;
  synced = true;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    // עדכון ה-SW (גרסה חדשה עם pushsubscriptionchange) גם למכשירים שכבר רשומים
    reg?.update().catch(() => { /* ignore */ });
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) await registerOnServer(sub, journalId);
  } catch { /* best-effort */ }
}

export async function enablePush(journalId: string = MANAGER_ID): Promise<PushResult> {
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

  return registerOnServer(sub, journalId);
}

export interface PushDiag {
  permission: NotificationPermission | "unsupported";
  standalone: boolean; // מותקן כ-PWA (רלוונטי לאייפון)
  ios: boolean;
  vapidBaked: boolean;
  deviceSubscribed: boolean;
  deviceInCloud: boolean | null; // המנוי של המכשיר הזה קיים בענן
  server: { vapidPublic: boolean; vapidPrivate: boolean; cronSecret: boolean; supabase: boolean; telegram?: boolean } | null;
  cloudSubscriptions: number | null; // מכשירים של היומן הזה; null — הטבלה לא קיימת / שגיאה
  cloudError: string | null;
  heartbeatAt: string | null; // הרצת ה-cron האחרונה בשרת
  pushErrors: { status: number | null; host: string }[] | null; // כשלי מסירה אחרונים מהשרת
}

export async function diagnosePush(journalId: string = MANAGER_ID): Promise<PushDiag> {
  const diag: PushDiag = {
    permission: pushPermission(),
    standalone: typeof window !== "undefined" &&
      (window.matchMedia?.("(display-mode: standalone)").matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true),
    ios: typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent),
    vapidBaked: !!VAPID_PUBLIC,
    deviceSubscribed: await isSubscribed(),
    deviceInCloud: null,
    server: null,
    cloudSubscriptions: null,
    cloudError: null,
    heartbeatAt: null,
    pushErrors: null,
  };

  const [server, health] = await Promise.all([
    fetch("/api/send-reminders", { method: "GET" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("/api/health", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
  ]);
  diag.server = server;
  diag.pushErrors = health?.pushErrors ?? null;

  try {
    const { supabase } = await import("./supabase");
    const reg = pushSupported() ? await navigator.serviceWorker.getRegistration() : null;
    const mine = reg ? (await reg.pushManager.getSubscription())?.endpoint ?? null : null;
    const [subsRes, hbRes] = await Promise.all([
      supabase.from("push_subscriptions").select("endpoint,subscription"),
      supabase.from("reminders_sent").select("sent_at").eq("reminder_id", "__cron_heartbeat__").maybeSingle(),
    ]);
    if (subsRes.error) diag.cloudError = subsRes.error.message;
    else {
      const rows = (subsRes.data ?? []) as { endpoint: string; subscription: { journalId?: string } }[];
      diag.cloudSubscriptions = rows.filter((r) => (r.subscription?.journalId || MANAGER_ID) === journalId).length;
      diag.deviceInCloud = mine ? rows.some((r) => r.endpoint === mine) : null;
    }
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
export async function sendTestPush(journalId: string = MANAGER_ID): Promise<PushResult & { telegram?: string; pushed?: number }> {
  try {
    const res = await fetch("/api/test-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ journalId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, reason: json?.error || `http-${res.status}` };
    const anyDelivered = (json?.sent ?? 0) > 0 || json?.telegram === "sent";
    if (!anyDelivered) return { ok: false, reason: json?.subscriptions ? "no-delivery" : "no-subscriptions", telegram: json?.telegram };
    return { ok: true, telegram: json?.telegram, pushed: json?.sent ?? 0 };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "failed" };
  }
}

// ---------- טלגרם ----------

export type TelegramStatus = {
  configured: boolean;
  username?: string | null;
  webhook?: "ok" | "set" | "preview-skip" | "error";
  linked?: { name: string | null; linkedAt: string } | null;
  error?: string;
};

export async function telegramStatus(journalId: string): Promise<TelegramStatus> {
  try {
    const res = await fetch(`/api/telegram?journal=${encodeURIComponent(journalId)}`, { cache: "no-store" });
    if (!res.ok) return { configured: false, error: `http-${res.status}` };
    return await res.json();
  } catch {
    return { configured: false, error: "offline" };
  }
}

export async function telegramAction(journalId: string, action: "link" | "unlink" | "test"): Promise<{ ok?: boolean; url?: string; error?: string }> {
  try {
    const res = await fetch("/api/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, journal: journalId }),
    });
    return await res.json();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "offline" };
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
      if (endpoint) {
        await fetch("/api/push-subscription", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        });
      }
    }
  } catch {
    /* best-effort */
  }
}

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

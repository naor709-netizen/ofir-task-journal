// Service worker — יומן המשימות (Web Push)
// v5: שחזור מנוי אוטומטי (pushsubscriptionchange) + ניווט ליומן הנכון בלחיצה
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : "" }; }
  const title = data.title || "יומן המשימות";
  const body = data.body || "יש לך תזכורת";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      dir: "rtl",
      lang: "he",
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  const target = new URL(url, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (list) => {
      // חלון שכבר פתוח על אותו יומן — רק מביאים לפוקוס
      const exact = list.find((c) => c.url.split("?")[0] === target.split("?")[0]);
      if (exact && "focus" in exact) return exact.focus();
      const any = list.find((c) => "navigate" in c);
      if (any) {
        try { await any.navigate(target); return any.focus(); } catch { /* fall through */ }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

// הדפדפן (בעיקר אנדרואיד/כרום) מחליף לפעמים את המנוי בעצמו. בלי הטיפול הזה
// המנוי הישן נמחק בשרת עם 410 — והמכשיר מפסיק לקבל תזכורות בשקט.
self.addEventListener("pushsubscriptionchange", (event) => {
  const oldEndpoint = event.oldSubscription ? event.oldSubscription.endpoint : null;
  const options = event.oldSubscription ? event.oldSubscription.options : null;
  event.waitUntil(
    (async () => {
      let sub = event.newSubscription;
      if (!sub && options) sub = await self.registration.pushManager.subscribe(options);
      if (!sub) return;
      await fetch("/api/push-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON(), oldEndpoint }),
      });
    })()
  );
});

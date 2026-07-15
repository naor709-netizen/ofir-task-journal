import { NextResponse } from "next/server";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// שולח התראת-בדיקה מיידית לכל המכשירים הרשומים — לאימות מסירה מקצה לקצה
export async function POST() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  if (!url || !key || !vapidPublic || !vapidPrivate) {
    return NextResponse.json({ error: "missing-env" }, { status: 500 });
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:reminders@ofir-task-journal.app",
    vapidPublic,
    vapidPrivate
  );

  const supabase = createClient(url, key);
  const { data: subs, error } = await supabase.from("push_subscriptions").select("endpoint,subscription");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const subscriptions = (subs ?? []) as { endpoint: string; subscription: webpush.PushSubscription }[];

  const payload = JSON.stringify({
    title: "בדיקת התראות ✓",
    body: "אם אתה רואה את זה — ההתראות עובדות גם כשהיומן סגור",
    tag: "test-push",
    url: "/",
  });

  let sent = 0;
  const staleEndpoints: string[] = [];
  for (const s of subscriptions) {
    try {
      await webpush.sendNotification(s.subscription, payload);
      sent++;
    } catch (e: unknown) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) staleEndpoints.push(s.endpoint);
    }
  }
  if (staleEndpoints.length) {
    await supabase.from("push_subscriptions").delete().in("endpoint", staleEndpoints);
  }

  return NextResponse.json({ sent, subscriptions: subscriptions.length });
}

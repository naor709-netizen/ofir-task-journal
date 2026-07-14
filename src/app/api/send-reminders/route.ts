import { NextResponse } from "next/server";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// --- types (mirror of the client model, minimal) ---
type Reminder = { id: string; datetime: string; note: string; fired?: boolean };
type Task = { id: string; title: string; reminders?: Reminder[]; subtasks?: Task[] };

function flatten(tasks: Task[]): Task[] {
  const out: Task[] = [];
  const walk = (list: Task[]) => {
    for (const t of list) { out.push(t); if (t.subtasks) walk(t.subtasks); }
  };
  walk(tasks);
  return out;
}

// אבחון תצורה — בוליאנים בלבד, בלי ערכים רגישים
export async function GET() {
  return NextResponse.json({
    vapidPublic: !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    vapidPrivate: !!process.env.VAPID_PRIVATE_KEY,
    cronSecret: !!process.env.CRON_SECRET,
    supabase: !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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
  const now = Date.now();

  // דופק — מאפשר לאבחון בצד הלקוח לדעת שה-cron אכן מגיע לשרת
  await supabase
    .from("reminders_sent")
    .upsert({ reminder_id: "__cron_heartbeat__", sent_at: new Date(now).toISOString() }, { onConflict: "reminder_id" });

  // 1. gather due reminders across all tasks + subtasks
  const { data: rows, error: tErr } = await supabase.from("journal_tasks").select("payload");
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });

  const due: { reminderId: string; title: string; body: string }[] = [];
  for (const row of (rows ?? []) as { payload: Task }[]) {
    for (const t of flatten([row.payload])) {
      for (const r of t.reminders ?? []) {
        const ts = r.datetime ? new Date(r.datetime).getTime() : NaN;
        if (!r.fired && !isNaN(ts) && ts <= now) {
          due.push({ reminderId: r.id, title: r.note || t.title || "תזכורת", body: t.title || "" });
        }
      }
    }
  }
  if (due.length === 0) return NextResponse.json({ sent: 0, due: 0 });

  // 2. skip reminders already sent
  const ids = due.map((d) => d.reminderId);
  const { data: sentRows } = await supabase.from("reminders_sent").select("reminder_id").in("reminder_id", ids);
  const alreadySent = new Set((sentRows ?? []).map((r: { reminder_id: string }) => r.reminder_id));
  const toSend = due.filter((d) => !alreadySent.has(d.reminderId));
  if (toSend.length === 0) return NextResponse.json({ sent: 0, due: due.length });

  // 3. fetch subscriptions
  const { data: subs } = await supabase.from("push_subscriptions").select("endpoint,subscription");
  const subscriptions = (subs ?? []) as { endpoint: string; subscription: webpush.PushSubscription }[];

  // 4. send + record
  let sent = 0;
  const staleEndpoints: string[] = [];
  for (const rem of toSend) {
    const payload = JSON.stringify({
      title: rem.title,
      body: rem.body && rem.body !== rem.title ? rem.body : "תזכורת מהיומן",
      tag: rem.reminderId,
      url: "/",
    });
    for (const s of subscriptions) {
      try {
        await webpush.sendNotification(s.subscription, payload);
        sent++;
      } catch (e: unknown) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) staleEndpoints.push(s.endpoint);
      }
    }
    await supabase.from("reminders_sent").upsert({ reminder_id: rem.reminderId }, { onConflict: "reminder_id" });
  }

  // 5. prune dead subscriptions
  if (staleEndpoints.length) {
    await supabase.from("push_subscriptions").delete().in("endpoint", staleEndpoints);
  }

  return NextResponse.json({ sent, reminders: toSend.length, subscriptions: subscriptions.length });
}

import { NextResponse } from "next/server";
import { requireEnv, db, flatten, notifyJournal, escHtml, appUrl, type Task } from "@/lib/server/automation";
import { tgConfigured } from "@/lib/server/telegram";
import { smsConfigured, smsText } from "@/lib/server/sms";
import { journalOfPayload, journalPath } from "@/lib/journals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// אבחון תצורה — בוליאנים בלבד, בלי ערכים רגישים
export async function GET() {
  return NextResponse.json({
    vapidPublic: !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    vapidPrivate: !!process.env.VAPID_PRIVATE_KEY,
    cronSecret: !!process.env.CRON_SECRET,
    supabase: !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    telegram: tgConfigured(),
    sms: smsConfigured(),
  });
}

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const env = requireEnv();
  if (!env.ok) return NextResponse.json({ error: "bad-config", detail: env.reason }, { status: 500 });
  const sb = db(env.url, env.key);

  const now = Date.now();
  const windowStart = now - 60 * 60 * 1000; // אל תשלח מחדש תזכורות ישנות מלפני שעה

  // דופק — מאפשר לאבחון בצד הלקוח לדעת שה-cron אכן מגיע לשרת
  await sb
    .from("reminders_sent")
    .upsert({ reminder_id: "__cron_heartbeat__", sent_at: new Date(now).toISOString() }, { onConflict: "reminder_id" });

  // 1. תזכורות שהגיע זמנן, בכל היומנים, כולל שלבים
  const { data: rows, error: tErr } = await sb.from("journal_tasks").select("payload");
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });

  const due: { reminderId: string; journalId: string; task: Task; note: string }[] = [];
  for (const row of (rows ?? []) as { payload: Task }[]) {
    if (!row.payload) continue;
    const journalId = journalOfPayload(row.payload);
    for (const t of flatten([row.payload])) {
      if (t.status === "done") continue; // משימה שכבר נסגרה לא מנדנדת
      for (const r of t.reminders ?? []) {
        const ts = r.datetime ? new Date(r.datetime).getTime() : NaN;
        if (!isNaN(ts) && ts <= now && ts >= windowStart) {
          due.push({ reminderId: r.id, journalId, task: t, note: r.note });
        }
      }
    }
  }
  if (due.length === 0) return NextResponse.json({ sent: 0, due: 0 });

  // 2. דילוג על מה שכבר נשלח
  const ids = due.map((d) => d.reminderId);
  const { data: sentRows } = await sb.from("reminders_sent").select("reminder_id").in("reminder_id", ids);
  const alreadySent = new Set((sentRows ?? []).map((r: { reminder_id: string }) => r.reminder_id));
  const toSend = due.filter((d) => !alreadySent.has(d.reminderId));
  if (toSend.length === 0) return NextResponse.json({ sent: 0, due: due.length });

  // 3. מסירה ליומן של כל תזכורת: פוש למכשירים שלו + טלגרם עם כפתורי פעולה
  let pushed = 0;
  let telegram = 0;
  let sms = 0;
  for (const rem of toSend) {
    // רושמים לפני השליחה — כשל באמצע לא יגרום להצפה בדקה הבאה
    await sb.from("reminders_sent").upsert({ reminder_id: rem.reminderId }, { onConflict: "reminder_id" });
    const title = rem.note || rem.task.title || "תזכורת";
    const body = rem.note && rem.task.title && rem.note !== rem.task.title ? rem.task.title : "תזכורת מהיומן";
    const html = [
      `<b>⏰ ${escHtml(title)}</b>`,
      body !== "תזכורת מהיומן" ? escHtml(body) : "",
      rem.task.critical ? "🔴 קריטית" : "",
    ].filter(Boolean).join("\n");
    const out = await notifyJournal(
      sb, rem.journalId,
      { title, body, tag: rem.reminderId, url: journalPath(rem.journalId) },
      {
        sms: smsText(`⏰ ${title}`, body !== "תזכורת מהיומן" ? body : rem.task.critical ? "קריטית" : ""),
        telegram: {
          html,
          buttons: [
            [
              { text: "✓ בוצע", callback_data: `d:${rem.task.id}` },
              { text: "⏰ עוד שעה", callback_data: `s:${rem.task.id}` },
            ],
            [{ text: "פתיחת היומן", url: `${appUrl()}${journalPath(rem.journalId)}` }],
          ],
        },
      }
    );
    pushed += out.pushed;
    if (out.telegram === "sent") telegram++;
    if (out.sms === "sent") sms++;
  }

  return NextResponse.json({ sent: pushed + telegram + sms, pushed, sms, telegram, reminders: toSend.length });
}

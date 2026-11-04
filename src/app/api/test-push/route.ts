import { NextResponse } from "next/server";
import { requireEnv, db, notifyJournal, journalSubscriptions } from "@/lib/server/automation";
import { MANAGER_ID, isValidJournalId } from "@/lib/journals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// שולח התראת-בדיקה מיידית לכל הערוצים של יומן — פוש לכל המכשירים שלו + טלגרם
export async function POST(req: Request) {
  const env = requireEnv();
  if (!env.ok) return NextResponse.json({ error: "missing-env", detail: env.reason }, { status: 500 });
  const sb = db(env.url, env.key);

  const body = (await req.json().catch(() => ({}))) as { journalId?: string };
  const journalId = body.journalId && isValidJournalId(body.journalId) ? body.journalId : MANAGER_ID;

  const subs = await journalSubscriptions(sb, journalId);
  const out = await notifyJournal(
    sb, journalId,
    { title: "בדיקת התראות ✓", body: "אם זה הגיע — העדכונים מגיעים לטלפון גם כשהיומן סגור", tag: "test-push" },
    { telegram: { html: "<b>בדיקת התראות ✓</b>\nאם זה הגיע — העדכונים מגיעים לטלפון גם כשהיומן סגור." } }
  );
  return NextResponse.json({ sent: out.pushed, subscriptions: subs.length, telegram: out.telegram, sms: out.sms });
}

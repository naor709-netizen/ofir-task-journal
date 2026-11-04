import { NextResponse } from "next/server";
import { requireEnv, db } from "@/lib/server/automation";
import { handleActivity, type ActivityType } from "@/lib/server/activity";
import { isValidJournalId } from "@/lib/journals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: ActivityType[] = ["done", "new", "assigned"];

// נקרא מהיומן אחרי שינוי שנשמר בענן. השרת מאמת כל אירוע מול הנתונים,
// ולכן גם קריאה מזויפת לא יכולה לשלוח יותר ממה שבאמת קרה ביומן.
export async function POST(req: Request) {
  const env = requireEnv();
  if (!env.ok) return NextResponse.json({ error: "bad-config", detail: env.reason }, { status: 500 });

  let body: { journalId?: string; events?: { type?: string; taskId?: string }[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad-json" }, { status: 400 }); }

  const journalId = String(body.journalId ?? "");
  if (!isValidJournalId(journalId)) return NextResponse.json({ error: "bad-journal" }, { status: 400 });
  const events = (Array.isArray(body.events) ? body.events : [])
    .filter((e) => TYPES.includes(e?.type as ActivityType) && typeof e?.taskId === "string" && e.taskId.length < 64)
    .map((e) => ({ type: e.type as ActivityType, taskId: e.taskId as string }));

  const out = await handleActivity(db(env.url, env.key), journalId, events);
  return NextResponse.json(out);
}

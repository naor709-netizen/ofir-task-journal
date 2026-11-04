import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { MANAGER_ID, isValidJournalId } from "@/lib/journals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Sub = { endpoint?: string; keys?: { p256dh?: string; auth?: string }; journalId?: string };

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? createClient(url, key) : null;
}

// רישום/ריענון מנוי פוש של מכשיר, כולל שיוך ליומן.
// נקרא בכל פתיחה של היומן (מרפא מנוי שנמחק בשרת) וגם מה-Service Worker
// כשהדפדפן מחליף מנוי בעצמו (pushsubscriptionchange).
export async function POST(req: Request) {
  const sb = client();
  if (!sb) return NextResponse.json({ error: "missing-env" }, { status: 500 });
  let body: { subscription?: Sub; journalId?: string; oldEndpoint?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad-json" }, { status: 400 }); }

  const sub = body.subscription;
  if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ error: "bad-subscription" }, { status: 400 });
  }

  let journalId = body.journalId && isValidJournalId(body.journalId) ? body.journalId : null;
  if (!journalId && body.oldEndpoint) {
    const { data } = await sb.from("push_subscriptions").select("subscription").eq("endpoint", body.oldEndpoint).maybeSingle();
    journalId = (data?.subscription as Sub | undefined)?.journalId ?? MANAGER_ID;
  }
  if (!journalId) {
    const { data } = await sb.from("push_subscriptions").select("subscription").eq("endpoint", sub.endpoint).maybeSingle();
    journalId = (data?.subscription as Sub | undefined)?.journalId ?? MANAGER_ID;
  }

  const { error } = await sb.from("push_subscriptions").upsert(
    { endpoint: sub.endpoint, subscription: { endpoint: sub.endpoint, keys: sub.keys, journalId } },
    { onConflict: "endpoint" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (body.oldEndpoint && body.oldEndpoint !== sub.endpoint) {
    await sb.from("push_subscriptions").delete().eq("endpoint", body.oldEndpoint);
  }
  return NextResponse.json({ ok: true, journalId });
}

export async function DELETE(req: Request) {
  const sb = client();
  if (!sb) return NextResponse.json({ error: "missing-env" }, { status: 500 });
  const { endpoint } = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (endpoint) await sb.from("push_subscriptions").delete().eq("endpoint", endpoint);
  return NextResponse.json({ ok: true });
}

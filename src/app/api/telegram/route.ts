import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { META, isValidJournalId } from "@/lib/journals";
import { appUrl } from "@/lib/server/automation";
import { tgConfigured, botUsername, ensureWebhook, getTelegramLink, sendTelegram } from "@/lib/server/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? createClient(url, key) : null;
}

// מצב החיבור של יומן: האם הבוט מוגדר, שם הבוט, והאם היומן כבר מחובר.
// גם מוודא שה-webhook של הבוט מכוון לפרודקשן.
export async function GET(req: Request) {
  const journalId = new URL(req.url).searchParams.get("journal") ?? "";
  if (!isValidJournalId(journalId)) return NextResponse.json({ error: "bad-journal" }, { status: 400 });
  if (!tgConfigured()) return NextResponse.json({ configured: false });
  const sb = client();
  const [username, webhook, link] = await Promise.all([
    botUsername(),
    ensureWebhook(appUrl()),
    sb ? getTelegramLink(sb, journalId) : Promise.resolve(null),
  ]);
  return NextResponse.json({
    configured: true,
    username,
    webhook,
    linked: link ? { name: link.name ?? null, linkedAt: link.linkedAt } : null,
  });
}

export async function POST(req: Request) {
  const sb = client();
  if (!sb) return NextResponse.json({ error: "missing-env" }, { status: 500 });
  if (!tgConfigured()) return NextResponse.json({ error: "telegram-not-configured" }, { status: 400 });

  const { action, journal } = (await req.json().catch(() => ({}))) as { action?: string; journal?: string };
  if (!journal || !isValidJournalId(journal)) return NextResponse.json({ error: "bad-journal" }, { status: 400 });

  if (action === "link") {
    // קוד חד-פעמי ל-30 דקות: בלעדיו כל מי שמכיר את שם הבוט היה יכול "לחטוף" עדכונים של יומן
    const code = randomBytes(9).toString("base64url").replace(/[-_]/g, "x");
    const { error } = await sb.from("journal_meta").upsert({
      key: META.telegramPending(journal),
      payload: { code, at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const [username, webhook] = await Promise.all([botUsername(), ensureWebhook(appUrl())]);
    if (!username) return NextResponse.json({ error: "bad-token" }, { status: 400 });
    return NextResponse.json({ url: `https://t.me/${username}?start=${journal}_${code}`, webhook });
  }

  if (action === "unlink") {
    const link = await getTelegramLink(sb, journal);
    await sb.from("journal_meta").delete().in("key", [META.telegram(journal), META.telegramPending(journal)]);
    if (link) await sendTelegram(link.chatId, "העדכונים מהיומן נותקו. אפשר לחבר מחדש בכל עת מתוך היומן.");
    return NextResponse.json({ ok: true });
  }

  if (action === "test") {
    const link = await getTelegramLink(sb, journal);
    if (!link) return NextResponse.json({ ok: false, error: "not-linked" });
    const ok = await sendTelegram(link.chatId, "<b>בדיקת חיבור ✓</b>\nהעדכונים מהיומן מגיעים לכאן — גם כשהיומן סגור.");
    return NextResponse.json({ ok });
  }

  return NextResponse.json({ error: "unknown-action" }, { status: 400 });
}

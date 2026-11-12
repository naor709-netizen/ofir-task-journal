import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { MANAGER_ID, META, isValidJournalId, journalPath, personName } from "@/lib/journals";
import { appUrl, escHtml, loadJournals, loadRoster, dateKey } from "@/lib/server/automation";
import { webhookSecret, sendTelegram, tg, journalOfChat, getTelegramLink, type TgLink } from "@/lib/server/telegram";
import { markTaskDone, snoozeTask } from "@/lib/server/journal-ops";
import { handleActivity } from "@/lib/server/activity";
import { summarize, todayHtml, personLine } from "@/lib/server/briefs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TgUpdate = {
  message?: { chat: { id: number }; from?: { first_name?: string }; text?: string };
  callback_query?: {
    id: string;
    data?: string;
    from?: { first_name?: string };
    message?: { chat: { id: number }; message_id: number; text?: string };
  };
};

const HELP = [
  "<b>יומן המשימות</b> 👋",
  "",
  "כאן יגיעו התזכורות והעדכונים מהיומן — גם כשהוא סגור.",
  "",
  "/today — המשימות שלך להיום",
  "/team — תמונת מצב הצוות (למנהל)",
  "/stop — ניתוק העדכונים",
].join("\n");

function sbClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? createClient(url, key) : null;
}

export async function POST(req: Request) {
  if (req.headers.get("x-telegram-bot-api-secret-token") !== webhookSecret()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sb = sbClient();
  if (!sb) return NextResponse.json({ ok: true });

  let update: TgUpdate;
  try { update = await req.json(); } catch { return NextResponse.json({ ok: true }); }

  try {
    if (update.message) await onMessage(sb, update.message);
    else if (update.callback_query) await onCallback(sb, update.callback_query);
  } catch (e) {
    console.error("telegram webhook", e);
  }
  // תמיד 200 — אחרת טלגרם שולח את אותו עדכון שוב ושוב
  return NextResponse.json({ ok: true });
}

async function onMessage(sb: SupabaseClient, m: NonNullable<TgUpdate["message"]>) {
  const chatId = m.chat.id;
  const text = (m.text ?? "").trim();

  if (text.startsWith("/start")) {
    const arg = text.split(/\s+/)[1] ?? "";
    const match = /^([a-z0-9]{4,16})_([A-Za-z0-9]{6,32})$/.exec(arg);
    if (!match) return void (await sendTelegram(chatId, HELP));
    const [, journalId, code] = match;
    if (!isValidJournalId(journalId)) return void (await sendTelegram(chatId, HELP));

    const { data } = await sb.from("journal_meta").select("payload").eq("key", META.telegramPending(journalId)).maybeSingle();
    const pending = data?.payload as { code?: string; at?: string } | undefined;
    const fresh = pending?.at && Date.now() - new Date(pending.at).getTime() < 30 * 60000;
    if (!pending || pending.code !== code || !fresh) {
      return void (await sendTelegram(chatId, "קישור החיבור פג תוקף. פתחו את היומן ולחצו שוב על <b>חיבור טלגרם</b>."));
    }

    const prev = await getTelegramLink(sb, journalId);
    const link: TgLink = { chatId, name: m.from?.first_name, linkedAt: new Date().toISOString() };
    await sb.from("journal_meta").upsert({ key: META.telegram(journalId), payload: link, updated_at: link.linkedAt });
    await sb.from("journal_meta").delete().eq("key", META.telegramPending(journalId));
    if (prev && prev.chatId !== chatId) {
      await sendTelegram(prev.chatId, "היומן חובר עכשיו לחשבון טלגרם אחר — העדכונים לא יגיעו לכאן יותר.");
    }

    const roster = await loadRoster(sb);
    const name = personName(roster, journalId);
    await sendTelegram(
      chatId,
      [
        `<b>מחובר ✓</b>`,
        `מעכשיו תזכורות ועדכונים מ<b>היומן של ${escHtml(name)}</b> יגיעו לכאן, גם כשהיומן סגור.`,
        journalId === MANAGER_ID ? "\nכמנהל, תקבל גם עדכון כשמישהו בצוות מסיים או מוסיף משימה." : "",
        "",
        "/today — המשימות להיום",
      ].filter(Boolean).join("\n"),
      [[{ text: "פתיחת היומן", url: `${appUrl()}${journalPath(journalId)}` }]]
    );
    return;
  }

  const journalId = await journalOfChat(sb, chatId);
  if (!journalId) return void (await sendTelegram(chatId, HELP));

  if (text === "/stop") {
    await sb.from("journal_meta").delete().eq("key", META.telegram(journalId));
    return void (await sendTelegram(chatId, "העדכונים נותקו. אפשר לחבר מחדש בכל עת מתוך היומן."));
  }

  const { journals } = await loadJournals(sb);
  const today = dateKey();

  if (text === "/team" || text === "צוות") {
    if (journalId !== MANAGER_ID) return void (await sendTelegram(chatId, "תמונת מצב הצוות זמינה למנהל בלבד."));
    const members = journals.filter((j) => j.id !== MANAGER_ID);
    if (!members.length) return void (await sendTelegram(chatId, "עדיין אין אנשי צוות. מוסיפים מתוך דשבורד הצוות ביומן."));
    const rows = members.map((j) => personLine(j, summarize(j.tasks, today)).html);
    return void (await sendTelegram(
      chatId,
      ["<b>👥 הצוות עכשיו</b>", "", ...rows].join("\n"),
      [[{ text: "דשבורד הצוות", url: `${appUrl()}/?view=team` }]]
    ));
  }

  // ברירת מחדל ו-/today: המשימות של היום
  const j = journals.find((x) => x.id === journalId);
  if (!j) return void (await sendTelegram(chatId, HELP));
  await sendTelegram(chatId, todayHtml(j.name, summarize(j.tasks, today)), [
    [{ text: "פתיחת היומן", url: `${appUrl()}${journalPath(journalId)}` }],
  ]);
}

async function onCallback(sb: SupabaseClient, q: NonNullable<TgUpdate["callback_query"]>) {
  const chatId = q.message?.chat.id;
  const [kind, taskId] = (q.data ?? "").split(":");
  const answer = (text: string) => tg("answerCallbackQuery", { callback_query_id: q.id, text });
  if (!chatId || !taskId) return void (await answer("פעולה לא מוכרת"));

  const journalId = await journalOfChat(sb, chatId);
  if (!journalId) return void (await answer("הצ'אט הזה לא מחובר ליומן"));

  if (kind === "d") {
    const t = await markTaskDone(sb, journalId, taskId);
    if (!t) return void (await answer("המשימה לא נמצאה — אולי נמחקה"));
    await answer("סומן כבוצע ✓");
    if (q.message) {
      await tg("editMessageText", {
        chat_id: chatId,
        message_id: q.message.message_id,
        text: `✅ <s>${escHtml(t.title)}</s>\n<i>סומן כבוצע מטלגרם</i>`,
        parse_mode: "HTML",
      });
    }
    // איש צוות → עדכון לאופיר; משימה משותפת → עדכון גם לשותף/ה (כולל כשאופיר הוא שסימן)
    await handleActivity(sb, journalId, [{ type: "done", taskId }]);
    return;
  }

  if (kind === "s") {
    const t = await snoozeTask(sb, journalId, taskId, 60);
    if (!t) return void (await answer("המשימה לא נמצאה — אולי נמחקה"));
    await answer("אזכיר שוב בעוד שעה ⏰");
    if (q.message) {
      await tg("editMessageReplyMarkup", {
        chat_id: chatId,
        message_id: q.message.message_id,
        reply_markup: { inline_keyboard: [[{ text: "⏰ נדחה בשעה", callback_data: "noop:x" }]] },
      });
    }
    return;
  }

  await answer("");
}

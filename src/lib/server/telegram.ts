import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { META } from "@/lib/journals";

// ============================================================
// טלגרם — ערוץ העדכונים האמין לטלפון.
// בוט אחד (TELEGRAM_BOT_TOKEN ב-Vercel); כל יומן מתחבר לצ'אט משלו
// דרך קישור start חד-פעמי, והכתובת נשמרת ב-journal_meta (tg:<journalId>).
// ============================================================

export type TgButton = { text: string; callback_data?: string; url?: string };

export function tgToken(): string | null {
  const t = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return t ? t : null;
}

export function tgConfigured(): boolean {
  return !!tgToken();
}

// סוד ה-webhook נגזר מהטוקן — אין צורך במשתנה סביבה נוסף
export function webhookSecret(): string {
  return createHash("sha256").update(`tg-webhook:${tgToken() ?? ""}`).digest("hex").slice(0, 48);
}

export async function tg<T = unknown>(method: string, body?: Record<string, unknown>): Promise<{ ok: boolean; result?: T; description?: string }> {
  const token = tgToken();
  if (!token) return { ok: false, description: "TELEGRAM_BOT_TOKEN missing" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      cache: "no-store",
    });
    return (await res.json()) as { ok: boolean; result?: T; description?: string };
  } catch (e) {
    return { ok: false, description: e instanceof Error ? e.message : "network" };
  }
}

export async function sendTelegram(chatId: number | string, html: string, buttons?: TgButton[][]): Promise<boolean> {
  const r = await tg("sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(buttons?.length ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
  return r.ok;
}

let cachedUsername: string | null = null;
export async function botUsername(): Promise<string | null> {
  if (cachedUsername) return cachedUsername;
  const r = await tg<{ username: string }>("getMe");
  if (r.ok && r.result?.username) cachedUsername = r.result.username;
  return cachedUsername;
}

// מבטיח שטלגרם שולח עדכונים לנתיב ה-webhook של הפרודקשן.
// פריסת preview לעולם לא "גונבת" את הבוט מהפרודקשן.
export async function ensureWebhook(appUrl: string): Promise<"ok" | "set" | "preview-skip" | "error"> {
  if (!tgConfigured()) return "error";
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return "preview-skip";
  const target = `${appUrl}/api/telegram/webhook`;
  const info = await tg<{ url: string }>("getWebhookInfo");
  if (info.ok && info.result?.url === target) return "ok";
  const set = await tg("setWebhook", {
    url: target,
    secret_token: webhookSecret(),
    allowed_updates: ["message", "callback_query"],
  });
  if (!set.ok) return "error";
  await tg("setMyCommands", {
    commands: [
      { command: "today", description: "המשימות שלי להיום" },
      { command: "team", description: "תמונת מצב הצוות (למנהל)" },
      { command: "stop", description: "ניתוק העדכונים" },
    ],
  });
  return "set";
}

export type TgLink = { chatId: number; name?: string; linkedAt: string };

export async function getTelegramLink(sb: SupabaseClient, journalId: string): Promise<TgLink | null> {
  const { data } = await sb.from("journal_meta").select("payload").eq("key", META.telegram(journalId)).maybeSingle();
  const p = data?.payload as TgLink | undefined;
  return p?.chatId ? p : null;
}

export async function journalOfChat(sb: SupabaseClient, chatId: number): Promise<string | null> {
  const { data } = await sb.from("journal_meta").select("key,payload").like("key", "tg:%");
  const row = ((data ?? []) as { key: string; payload: TgLink }[]).find((r) => r.payload?.chatId === chatId);
  return row ? row.key.slice(3) : null;
}

export async function telegramToJournal(
  sb: SupabaseClient,
  journalId: string,
  html: string,
  buttons?: TgButton[][]
): Promise<"sent" | "skipped" | "failed"> {
  if (!tgConfigured()) return "skipped";
  const link = await getTelegramLink(sb, journalId);
  if (!link) return "skipped";
  return (await sendTelegram(link.chatId, html, buttons)) ? "sent" : "failed";
}

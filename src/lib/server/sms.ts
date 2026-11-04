import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// SMS דרך Twilio — הודעה רגילה לטלפון, בלי אפליקציה.
//
// מספר הטלפון נשמר מוצפן (AES-256-GCM) ב-journal_meta (sms:<journalId>),
// כך שמי שקורא את הטבלה עם מפתח ה-anon רואה רק "050-•••-4567".
// המפתח נגזר מסוד שרת (SMS_SECRET, ואם אין — CRON_SECRET).
// ============================================================

export const SMS_META = (journalId: string) => `sms:${journalId}`;
export const SMS_PENDING = (journalId: string) => `sms-pending:${journalId}`;

export function smsConfigured(): boolean {
  return !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN &&
    (!!process.env.TWILIO_FROM || !!process.env.TWILIO_MESSAGING_SERVICE_SID);
}

function secret(): string {
  return process.env.SMS_SECRET || process.env.CRON_SECRET || process.env.TWILIO_AUTH_TOKEN || "";
}

function key(): Buffer {
  return createHash("sha256").update(`sms-phone-v1:${secret()}`).digest();
}

export function encryptPhone(phone: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(phone, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64url");
}

export function decryptPhone(blob: string): string | null {
  try {
    const raw = Buffer.from(blob, "base64url");
    const d = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null; // הסוד הוחלף — צריך לחבר את המספר מחדש
  }
}

// ברירת מחדל ישראלית: 050-1234567 / 0501234567 / 972501234567 / +972501234567
export function normalizePhone(input: string): string | null {
  const s = String(input ?? "").trim();
  const digits = s.replace(/\D/g, "");
  let e164: string;
  if (s.startsWith("+")) e164 = `+${digits}`;
  else if (digits.startsWith("972")) e164 = `+${digits}`;
  else if (digits.startsWith("0") && digits.length === 10) e164 = `+972${digits.slice(1)}`;
  else return null;
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) return null;
  if (e164.startsWith("+972") && !/^\+9725\d{8}$/.test(e164)) return null; // נייד ישראלי בלבד
  return e164;
}

export function maskPhone(e164: string): string {
  if (e164.startsWith("+972")) {
    const local = `0${e164.slice(4)}`;
    return `${local.slice(0, 3)}-•••-${local.slice(-4)}`;
  }
  return `${e164.slice(0, 4)}•••${e164.slice(-3)}`;
}

export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashCode(code: string, journalId: string): string {
  return createHash("sha256").update(`sms-code:${journalId}:${code}:${secret()}`).digest("hex");
}

export function codeMatches(code: string, journalId: string, hash: string): boolean {
  const a = Buffer.from(hashCode(code, journalId), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// עברית ב-SMS = UCS-2: 70 תווים להודעה בודדת, 67 לכל חלק בהודעה מפוצלת.
// מגבילים ל-2 חלקים כדי לשמור על העלות.
export const SMS_MAX = 134;

export function smsText(title: string, body?: string, max = SMS_MAX): string {
  const t = String(title ?? "").trim();
  const b = String(body ?? "").trim();
  const full = b && b !== t ? `${t}\n${b}` : t;
  return full.length <= max ? full : `${full.slice(0, max - 1).trimEnd()}…`;
}

export type SmsSend = { ok: true; sid: string } | { ok: false; code: number | null; message: string };

export async function sendSms(to: string, body: string): Promise<SmsSend> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return { ok: false, code: null, message: "twilio-not-configured" };
  const form = new URLSearchParams({ To: to, Body: body });
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) form.set("MessagingServiceSid", process.env.TWILIO_MESSAGING_SERVICE_SID);
  else form.set("From", process.env.TWILIO_FROM ?? "");
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as { sid?: string; code?: number; message?: string };
    if (!res.ok || !json.sid) return { ok: false, code: json.code ?? res.status, message: json.message ?? `http-${res.status}` };
    return { ok: true, sid: json.sid };
  } catch (e) {
    return { ok: false, code: null, message: e instanceof Error ? e.message : "network" };
  }
}

// הסבר בעברית לשגיאות הנפוצות של Twilio — כדי שההגדרה לא תיתקע על קוד מספרי
export function twilioHint(code: number | null): string {
  switch (code) {
    case 21608:
    case 21219: return "חשבון ניסיון של Twilio שולח רק למספרים שאומתו ב-Twilio (Verified Caller IDs). אמתו את המספר שם, או שדרגו את החשבון.";
    case 21211:
    case 21614: return "מספר הטלפון לא תקין או שאינו נייד.";
    case 21212:
    case 21606:
    case 21659: return "השולח (TWILIO_FROM) לא תקין — צריך מספר Twilio שקניתם, או שם שולח באותיות לועזיות (עד 11 תווים).";
    case 21408:
    case 21612: return "Twilio לא מורשה לשלוח לישראל מהחשבון הזה — יש להפעיל את ישראל ב-Messaging → Settings → Geo permissions.";
    case 20003: return "פרטי החשבון של Twilio שגויים (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).";
    case 21610: return "המספר הזה ביקש לא לקבל הודעות (STOP). יש לשלוח START מהטלפון כדי לבטל.";
    default: return "השליחה נכשלה. בדקו את ההגדרות ב-Twilio.";
  }
}

export type SmsLink = { enc: string; mask: string; linkedAt: string };

export async function getSmsLink(sb: SupabaseClient, journalId: string): Promise<SmsLink | null> {
  const { data } = await sb.from("journal_meta").select("payload").eq("key", SMS_META(journalId)).maybeSingle();
  const p = data?.payload as SmsLink | undefined;
  return p?.enc ? p : null;
}

export async function smsToJournal(sb: SupabaseClient, journalId: string, text: string): Promise<"sent" | "skipped" | "failed"> {
  if (!smsConfigured()) return "skipped";
  const link = await getSmsLink(sb, journalId);
  if (!link) return "skipped";
  const phone = decryptPhone(link.enc);
  if (!phone) return "failed";
  const r = await sendSms(phone, text);
  if (!r.ok) {
    try {
      await sb.from("automation_log").upsert(
        { key: "sms:errors", last_run_at: new Date().toISOString(), detail: { journalId, code: r.code, message: r.message.slice(0, 200) } },
        { onConflict: "key" }
      );
    } catch { /* ignore */ }
    return "failed";
  }
  return "sent";
}

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { MANAGER_ID, isValidJournalId, memberById, personName, firstName } from "@/lib/journals";
import { loadRoster, dateKey } from "@/lib/server/automation";
import {
  SMS_META, SMS_PENDING, smsConfigured, normalizePhone, maskPhone, encryptPhone, decryptPhone,
  newCode, hashCode, codeMatches, sendSms, twilioHint, getSmsLink, type SmsLink,
} from "@/lib/server/sms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// הגבלות עלות: כל קוד אימות הוא SMS בתשלום, והנתיב פתוח (אין התחברות)
const RESEND_SECONDS = 45;
const SENDS_PER_HOUR = 5;
const VERIFY_PER_DAY_TOTAL = 25;
const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;

type Pending = { enc: string; mask: string; codeHash: string; at: string; attempts: number; sends: number[] };

function client(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? createClient(url, key) : null;
}

async function journalExists(sb: SupabaseClient, journalId: string): Promise<boolean> {
  if (journalId === MANAGER_ID) return true;
  return !!memberById(await loadRoster(sb), journalId);
}

async function getPending(sb: SupabaseClient, journalId: string): Promise<Pending | null> {
  const { data } = await sb.from("journal_meta").select("payload").eq("key", SMS_PENDING(journalId)).maybeSingle();
  return (data?.payload as Pending | undefined) ?? null;
}

async function setMeta(sb: SupabaseClient, key: string, payload: unknown) {
  const { error } = await sb.from("journal_meta").upsert({ key, payload, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// מכסה יומית כוללת לקודי אימות — תקרה קשיחה לעלות גם במקרה של שימוש לרעה
async function takeDailyQuota(sb: SupabaseClient): Promise<boolean> {
  const today = dateKey();
  const { data } = await sb.from("automation_log").select("detail").eq("key", "sms:verify-day").maybeSingle();
  const d = (data?.detail as { day?: string; n?: number } | undefined) ?? {};
  const n = d.day === today ? d.n ?? 0 : 0;
  if (n >= VERIFY_PER_DAY_TOTAL) return false;
  await sb.from("automation_log").upsert(
    { key: "sms:verify-day", last_run_at: new Date().toISOString(), detail: { day: today, n: n + 1 } },
    { onConflict: "key" }
  );
  return true;
}

export async function GET(req: Request) {
  const journalId = new URL(req.url).searchParams.get("journal") ?? "";
  if (!isValidJournalId(journalId)) return NextResponse.json({ error: "bad-journal" }, { status: 400 });
  if (!smsConfigured()) return NextResponse.json({ configured: false });
  const sb = client();
  if (!sb) return NextResponse.json({ configured: true, linked: null });
  const [link, pending] = await Promise.all([getSmsLink(sb, journalId), getPending(sb, journalId)]);
  const fresh = pending && Date.now() - new Date(pending.at).getTime() < CODE_TTL_MIN * 60000;
  return NextResponse.json({
    configured: true,
    linked: link ? { mask: link.mask, linkedAt: link.linkedAt, readable: !!decryptPhone(link.enc) } : null,
    pending: fresh ? { mask: pending!.mask } : null,
  });
}

export async function POST(req: Request) {
  const sb = client();
  if (!sb) return NextResponse.json({ error: "missing-env" }, { status: 500 });
  if (!smsConfigured()) return NextResponse.json({ error: "sms-not-configured" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { action?: string; journal?: string; phone?: string; code?: string };
  const journalId = String(body.journal ?? "");
  if (!isValidJournalId(journalId) || !(await journalExists(sb, journalId))) {
    return NextResponse.json({ error: "bad-journal" }, { status: 400 });
  }

  // ---- שליחת קוד אימות ----
  if (body.action === "start") {
    const phone = normalizePhone(body.phone ?? "");
    if (!phone) return NextResponse.json({ error: "bad-phone", hint: "מספר נייד ישראלי, למשל 050-1234567" }, { status: 400 });

    const prev = await getPending(sb, journalId);
    const now = Date.now();
    const sends = (prev?.sends ?? []).filter((t) => now - t < 3600000);
    if (sends.length && now - sends[sends.length - 1] < RESEND_SECONDS * 1000) {
      const wait = Math.ceil((RESEND_SECONDS * 1000 - (now - sends[sends.length - 1])) / 1000);
      return NextResponse.json({ error: "too-soon", wait }, { status: 429 });
    }
    if (sends.length >= SENDS_PER_HOUR) return NextResponse.json({ error: "too-many", hint: "נסו שוב בעוד שעה" }, { status: 429 });
    if (!(await takeDailyQuota(sb))) return NextResponse.json({ error: "daily-cap", hint: "הגעתם למכסת קודי האימות להיום" }, { status: 429 });

    const code = newCode();
    const r = await sendSms(phone, `קוד האימות ליומן המשימות: ${code}\nבתוקף ל-${CODE_TTL_MIN} דקות.`);
    if (!r.ok) return NextResponse.json({ error: "send-failed", code: r.code, hint: twilioHint(r.code) }, { status: 502 });

    const pending: Pending = {
      enc: encryptPhone(phone), mask: maskPhone(phone), codeHash: hashCode(code, journalId),
      at: new Date(now).toISOString(), attempts: 0, sends: [...sends, now],
    };
    await setMeta(sb, SMS_PENDING(journalId), pending);
    return NextResponse.json({ ok: true, mask: pending.mask });
  }

  // ---- אימות הקוד ----
  if (body.action === "verify") {
    const pending = await getPending(sb, journalId);
    const code = String(body.code ?? "").replace(/\D/g, "");
    if (!pending || Date.now() - new Date(pending.at).getTime() > CODE_TTL_MIN * 60000) {
      return NextResponse.json({ error: "expired", hint: "הקוד פג תוקף — שלחו קוד חדש" }, { status: 400 });
    }
    if (pending.attempts >= MAX_ATTEMPTS) {
      return NextResponse.json({ error: "locked", hint: "יותר מדי ניסיונות — שלחו קוד חדש" }, { status: 429 });
    }
    if (code.length !== 6 || !codeMatches(code, journalId, pending.codeHash)) {
      await setMeta(sb, SMS_PENDING(journalId), { ...pending, attempts: pending.attempts + 1 });
      return NextResponse.json({ error: "wrong-code", left: MAX_ATTEMPTS - pending.attempts - 1 }, { status: 400 });
    }
    const link: SmsLink = { enc: pending.enc, mask: pending.mask, linkedAt: new Date().toISOString() };
    await setMeta(sb, SMS_META(journalId), link);
    await sb.from("journal_meta").delete().eq("key", SMS_PENDING(journalId));
    const phone = decryptPhone(link.enc);
    const name = personName(await loadRoster(sb), journalId);
    if (phone) {
      await sendSms(phone, journalId === MANAGER_ID
        ? `מחובר ✓ מעכשיו תזכורות, בריף בוקר ועדכוני הצוות יגיעו לכאן ב-SMS.`
        : `מחובר ✓ היי ${firstName(name)}, מעכשיו תזכורות ומשימות מאופיר יגיעו לכאן ב-SMS.`);
    }
    return NextResponse.json({ ok: true, mask: link.mask });
  }

  // ---- ניתוק ----
  if (body.action === "unlink") {
    await sb.from("journal_meta").delete().in("key", [SMS_META(journalId), SMS_PENDING(journalId)]);
    return NextResponse.json({ ok: true });
  }

  // ---- הודעת בדיקה (פעם בדקה לכל היותר) ----
  if (body.action === "test") {
    const link = await getSmsLink(sb, journalId);
    const phone = link ? decryptPhone(link.enc) : null;
    if (!link || !phone) return NextResponse.json({ ok: false, error: "not-linked" });
    const { data } = await sb.from("automation_log").select("last_run_at").eq("key", `sms:test:${journalId}`).maybeSingle();
    if (data?.last_run_at && Date.now() - new Date(data.last_run_at).getTime() < 60000) {
      return NextResponse.json({ ok: false, error: "too-soon" }, { status: 429 });
    }
    await sb.from("automation_log").upsert({ key: `sms:test:${journalId}`, last_run_at: new Date().toISOString(), detail: {} }, { onConflict: "key" });
    const r = await sendSms(phone, "בדיקת SMS ✓ העדכונים מהיומן מגיעים לטלפון.");
    return NextResponse.json(r.ok ? { ok: true } : { ok: false, error: "send-failed", hint: twilioHint(r.code) });
  }

  return NextResponse.json({ error: "unknown-action" }, { status: 400 });
}

"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useToast } from "@/components/Toast";
import {
  enablePush, diagnosePush, sendTestPush, telegramStatus, telegramAction, smsStatus, smsAction,
  type PushDiag, type TelegramStatus, type SmsStatus,
} from "@/lib/push";
import { subscribeTeamMeta, getTeamMeta, getServerTeamMeta } from "@/lib/team";
import { MANAGER_ID, MANAGER_NAME } from "@/lib/journals";
import { T, alpha, Ic, Sheet, primaryBtn, ghostBtn, softBtn, inputStyle, IconChip, type Pal } from "./ui";
import { InstallSteps } from "./InstallApp";

type PushState = "unsupported" | "off" | "on" | "denied";

// מרכז ההתראות: טלגרם + התראות מובנות (שניהם חינם) + SMS בתשלום רק אם הוגדר + אבחון מלא
export function NotifyCenter({ journalId, personName, pushState, setPushState, onClose }: {
  journalId: string;
  personName: string;
  pushState: PushState;
  setPushState: (s: PushState) => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const meta = useSyncExternalStore(subscribeTeamMeta, getTeamMeta, getServerTeamMeta);
  const isManager = journalId === MANAGER_ID;
  const [tg, setTg] = useState<TelegramStatus | null>(null);
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [diag, setDiag] = useState<{ d: PushDiag; at: number } | null>(null);
  const [sms, setSms] = useState<SmsStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshTg = useCallback(async () => {
    const s = await telegramStatus(journalId);
    setTg(s);
    return s;
  }, [journalId]);

  useEffect(() => {
    let cancelled = false;
    telegramStatus(journalId).then((s) => { if (!cancelled) setTg(s); });
    return () => { cancelled = true; if (pollRef.current) clearInterval(pollRef.current); };
  }, [journalId]);

  // החיבור מתעדכן גם ב-realtime דרך journal_meta — מוצג מיד, עוד לפני הסקר הבא
  const live = meta.telegram[journalId];
  const linked = tg && !tg.configured ? null : tg?.linked ?? (live ? { name: live.name ?? null, linkedAt: live.linkedAt } : null);
  const waiting = linking && !linked;

  async function connectTelegram() {
    // חלון נפתח מיד (בתוך הלחיצה) כדי שדפדפן הנייד לא יחסום אותו
    const win = window.open("", "_blank");
    setBusy("link");
    const r = await telegramAction(journalId, "link");
    setBusy(null);
    if (!r.url) {
      win?.close();
      toast(r.error === "bad-token" ? "טוקן הבוט לא תקין — בדקו את TELEGRAM_BOT_TOKEN ב-Vercel" : `החיבור נכשל: ${r.error ?? ""}`, "error");
      return;
    }
    if (win) win.location.href = r.url; else window.location.href = r.url;
    setLinking(true);
    let n = 0;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      n++;
      const s = await refreshTg();
      if (s.linked || n > 60) {
        if (pollRef.current) clearInterval(pollRef.current);
        setLinking(false);
        if (s.linked) toast("טלגרם מחובר — העדכונים יגיעו לטלפון", "success");
      }
    }, 3000);
  }

  async function tgTest() {
    setBusy("tgtest");
    const r = await telegramAction(journalId, "test");
    setBusy(null);
    toast(r.ok ? "נשלחה הודעת בדיקה לטלגרם" : "השליחה לטלגרם נכשלה", r.ok ? "success" : "error");
  }

  async function tgUnlink() {
    if (!confirm("לנתק את העדכונים בטלגרם?")) return;
    setBusy("unlink");
    await telegramAction(journalId, "unlink");
    setBusy(null);
    refreshTg();
  }

  async function turnOnPush() {
    setBusy("push");
    const r = await enablePush(journalId);
    setBusy(null);
    if (r.ok) { setPushState("on"); toast("התראות הופעלו במכשיר הזה", "success"); }
    else if (r.reason === "denied") { setPushState("denied"); toast("ההרשאה נדחתה — יש לאשר התראות בהגדרות הדפדפן", "error"); }
    else if (r.reason === "unsupported") { setPushState("unsupported"); runDiag(); }
    else if (r.reason === "no-vapid") { runDiag(); }
    else toast("הפעלת ההתראות נכשלה: " + (r.reason ?? ""), "error");
  }

  async function runDiag() {
    setBusy("diag");
    const d = await diagnosePush(journalId);
    setDiag({ d, at: Date.now() });
    setBusy(null);
  }

  async function testAll() {
    setBusy("test");
    const r = await sendTestPush(journalId);
    setBusy(null);
    if (r.ok) {
      const parts = [r.sms === "sent" ? "SMS" : "", r.pushed ? `${r.pushed} מכשירים` : "", r.telegram === "sent" ? "טלגרם" : ""].filter(Boolean).join(" + ");
      toast(`הודעת בדיקה נשלחה (${parts}) — אמורה להגיע תוך שניות`, "success");
    } else {
      toast(r.reason === "no-subscriptions" ? "אין לאן לשלוח — חברו טלגרם או הפעילו התראות" : `השליחה נכשלה (${r.reason ?? ""})`, "error");
    }
  }

  const ios = typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const standalone = typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);

  return (
    <Sheet title="התראות לטלפון" icon={Ic.bell(17)} onClose={onClose} width={460}>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: T.ink2, lineHeight: 1.6 }}>
        {isManager
          ? "התראה שקופצת בטלפון — תזכורות, בריף בוקר ועדכונים מהצוות. בחינם, גם כשהיומן סגור."
          : `התראה שקופצת בטלפון — תזכורות, בריף בוקר ומשימות ש${MANAGER_NAME} שולח. בחינם, גם כשהיומן סגור.`}
      </p>

      {/* ---- טלגרם: חינם, קופץ בכל טלפון ---- */}
      <Channel
        icon={Ic.send(18)}
        pal="sky"
        title="טלגרם"
        badge={linked ? { text: "מחובר", tone: "ok" } : { text: "מומלץ · חינם", tone: "accent" }}
        subtitle="התראה קופצת כמו הודעה רגילה — באייפון ובאנדרואיד, גם כשהיומן סגור. כולל כפתורי ״✓ בוצע״ ו״⏰ עוד שעה״."
      >
        {tg === null ? (
          <div className="tj-skel" style={{ height: 44, borderRadius: 12 }} />
        ) : !tg.configured ? (
          isManager ? <TelegramSetupSteps /> : (
            <Note tone="amber">הבוט של היומן עדיין לא הופעל. {MANAGER_NAME} צריך להפעיל אותו פעם אחת — ואז מחברים כאן בלחיצה.</Note>
          )
        ) : tg.webhook === "preview-skip" ? (
          <Note tone="amber">זו כתובת בדיקה (preview). את טלגרם מחברים מהכתובת הראשית של היומן.</Note>
        ) : linked ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 13, background: T.mintSoft, color: T.mint, fontSize: 13, fontWeight: 600 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path className="tj-check-draw" d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
              מחובר{linked.name ? ` · ${linked.name}` : ""}
              <span className="num" style={{ marginInlineStart: "auto", fontSize: 10.5, color: T.ink3, fontWeight: 500 }}>
                מאז {new Date(linked.linkedAt).toLocaleDateString("he-IL")}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button onClick={tgTest} disabled={!!busy} style={softBtn}>{Ic.send(12)} {busy === "tgtest" ? "שולח…" : "שליחת בדיקה"}</button>
              <button onClick={tgUnlink} disabled={!!busy} style={ghostBtn}>ניתוק</button>
              {tg.username && (
                <a href={`https://t.me/${tg.username}`} target="_blank" rel="noreferrer" style={{ ...ghostBtn, textDecoration: "none" }}>
                  פתיחת הבוט
                </a>
              )}
            </div>
          </div>
        ) : (
          <div>
            <button onClick={connectTelegram} disabled={busy === "link"} style={{ ...primaryBtn, width: "100%", height: 46, borderRadius: 14 }}>
              {Ic.send(15)} {busy === "link" ? "פותח את טלגרם…" : waiting ? "ממתין לאישור בטלגרם…" : "חיבור טלגרם"}
            </button>
            <ol style={{ margin: "12px 0 0", paddingInlineStart: 18, fontSize: 12, color: T.ink2, lineHeight: 1.75 }}>
              <li>אין טלגרם? מורידים בחינם מ-App Store או Google Play.</li>
              <li>לוחצים ״חיבור טלגרם״ — הבוט של היומן נפתח.</li>
              <li>לוחצים <b>Start</b> (או ״התחל״) בצ׳אט — וזהו.</li>
            </ol>
            {waiting && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 12, color: T.accent }}>
                <span className="tj-live" style={{ width: 8, height: 8, borderRadius: 99, background: T.accent, color: T.accent }} />
                ממתין ללחיצה על Start בטלגרם…
              </div>
            )}
          </div>
        )}
      </Channel>

      {/* ---- התראות מובנות: חינם, בלי אפליקציה ---- */}
      <Channel
        icon={Ic.bell(18)}
        pal="pink"
        title="התראות מהיומן עצמו"
        badge={pushState === "on" ? { text: "פעיל", tone: "ok" } : pushState === "denied" && !(ios && !standalone) ? { text: "חסום", tone: "danger" } : { text: "חינם", tone: "accent" }}
        subtitle="בלי אפליקציה נוספת. באנדרואיד עובד מיד; באייפון — אחרי הוספת היומן למסך הבית."
      >
        {pushState === "on" ? (
          <Note tone="ok">ההתראות פעילות במכשיר הזה — יקפצו גם כשהיומן סגור.</Note>
        ) : ios && !standalone ? (
          <InstallSteps os="ios" />
        ) : pushState === "denied" ? (
          <Note tone="danger">
            הטלפון חוסם התראות מהיומן.{" "}
            {ios ? "בהגדרות האייפון ← התראות ← היומן ← לאפשר התראות." : "בהגדרות הדפדפן ← הגדרות אתר ← התראות ← לאפשר ליומן, ואז לרענן."}
          </Note>
        ) : pushState === "unsupported" ? (
          <Note tone="amber">הדפדפן הזה לא תומך בהתראות. פתחו את היומן ב-Chrome (אנדרואיד) או ב-Safari (אייפון), או חברו טלגרם.</Note>
        ) : (
          <button onClick={turnOnPush} disabled={busy === "push"} style={{ ...softBtn, height: 42, width: "100%" }}>
            {Ic.bell(14)} {busy === "push" ? "מפעיל…" : "הפעלת התראות במכשיר הזה"}
          </button>
        )}
      </Channel>

      {/* ---- SMS: בתשלום — מוצג רק אם הוגדר Twilio ---- */}
      <SmsChannel journalId={journalId} liveMask={meta.sms[journalId]?.mask ?? null} onStatus={setSms} />

      {/* ---- בדיקה ואבחון ---- */}
      <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
        <button onClick={testAll} disabled={!!busy} style={{ ...softBtn, flex: 1, height: 40 }}>
          {Ic.send(13)} {busy === "test" ? "שולח…" : "שליחת בדיקה"}
        </button>
        <button onClick={runDiag} disabled={!!busy} style={{ ...ghostBtn, flex: 1, height: 40 }}>
          {Ic.activity(13)} {busy === "diag" ? "בודק…" : "אבחון מלא"}
        </button>
      </div>

      {diag && <DiagList d={diag.d} now={diag.at} telegram={tg} linked={!!linked} sms={sms} personName={personName} />}
    </Sheet>
  );
}

// ---- SMS: מספר טלפון + קוד אימות בן 6 ספרות ----
function SmsChannel({ journalId, liveMask, onStatus }: {
  journalId: string;
  liveMask: string | null;
  onStatus: (s: SmsStatus) => void;
}) {
  const { toast } = useToast();
  const [st, setSt] = useState<SmsStatus | null>(null);
  const [stage, setStage] = useState<"phone" | "code" | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    smsStatus(journalId).then((s) => {
      if (cancelled) return;
      setSt(s);
      onStatus(s);
      if (s.pending && !s.linked) { setStage("code"); setSentTo(s.pending.mask); }
    });
    return () => { cancelled = true; };
  }, [journalId, onStatus]);

  async function refresh() {
    const s = await smsStatus(journalId);
    setSt(s);
    onStatus(s);
  }

  async function sendCode() {
    setErr(null);
    setBusy("start");
    const r = await smsAction(journalId, "start", { phone });
    setBusy(null);
    if (r.ok) { setStage("code"); setSentTo(r.mask ?? null); setCode(""); return; }
    setErr(r.error === "too-soon" ? `אפשר לשלוח קוד חדש בעוד ${r.wait ?? 45} שניות` : r.hint ?? `השליחה נכשלה (${r.error ?? ""})`);
  }

  async function verify(c = code) {
    if (c.replace(/\D/g, "").length !== 6) return;
    setErr(null);
    setBusy("verify");
    const r = await smsAction(journalId, "verify", { code: c });
    setBusy(null);
    if (r.ok) {
      setStage(null);
      setCode("");
      await refresh();
      toast("המספר אומת — העדכונים יגיעו ב-SMS", "success");
      return;
    }
    setErr(r.error === "wrong-code" ? `הקוד שגוי${r.left !== undefined ? ` · נותרו ${r.left} ניסיונות` : ""}` : r.hint ?? "האימות נכשל");
    if (r.error === "expired" || r.error === "locked") setStage("phone");
  }

  async function test() {
    setBusy("test");
    const r = await smsAction(journalId, "test");
    setBusy(null);
    if (r.ok) toast("נשלח SMS לבדיקה", "success");
    else toast(r.error === "too-soon" ? "אפשר לשלוח בדיקה פעם בדקה" : r.hint ?? "השליחה נכשלה", "error");
  }

  async function unlink() {
    if (!confirm("להפסיק לקבל עדכונים ב-SMS למספר הזה?")) return;
    setBusy("unlink");
    await smsAction(journalId, "unlink");
    setBusy(null);
    await refresh();
  }

  const linked = st?.linked ?? null;
  const mask = linked?.mask ?? liveMask;
  const showLinked = !!linked && linked.readable && stage === null;

  // SMS עולה כסף — מוצג רק כשמישהו בחר להגדיר את Twilio
  if (!st?.configured) return null;

  return (
    <Channel
      icon={Ic.phone(18)}
      pal="lime"
      title="הודעות SMS"
      badge={showLinked ? { text: "מחובר", tone: "ok" } : { text: "בתשלום", tone: "accent" }}
      subtitle="הודעת SMS רגילה (Twilio, כמה סנטים להודעה)."
    >
      {showLinked ? (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 13, background: T.mintSoft, color: T.mint, fontSize: 13, fontWeight: 600 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path className="tj-check-draw" d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
            <span>מחובר</span>
            <span className="num" style={{ color: T.ink, direction: "ltr" }}>{mask}</span>
            <span className="num" style={{ marginInlineStart: "auto", fontSize: 10.5, color: T.ink3, fontWeight: 500 }}>
              מאז {new Date(linked!.linkedAt).toLocaleDateString("he-IL")}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button onClick={test} disabled={!!busy} style={softBtn}>{Ic.send(12)} {busy === "test" ? "שולח…" : "שליחת SMS לבדיקה"}</button>
            <button onClick={() => { setStage("phone"); setPhone(""); }} disabled={!!busy} style={ghostBtn}>החלפת מספר</button>
            <button onClick={unlink} disabled={!!busy} style={ghostBtn}>ניתוק</button>
          </div>
        </div>
      ) : stage === "code" ? (
        <div>
          <div style={{ fontSize: 12.5, color: T.ink2, marginBottom: 8 }}>
            שלחנו קוד בן 6 ספרות ל-<b className="num" style={{ direction: "ltr", display: "inline-block" }}>{sentTo ?? ""}</b>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={code} autoFocus aria-label="קוד אימות"
              inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="••••••"
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(v);
                if (v.length === 6) verify(v);
              }}
              onKeyDown={(e) => { if (e.key === "Enter") verify(); }}
              className="num"
              style={{ ...inputStyle, flex: 1, height: 46, fontSize: 20, letterSpacing: "0.4em", textAlign: "center", direction: "ltr" }}
            />
            <button onClick={() => verify()} disabled={busy === "verify" || code.length !== 6} style={{
              ...primaryBtn, borderRadius: 14, height: 46, padding: "0 18px",
              ...(code.length === 6 ? {} : { background: T.surface2, color: T.ink3, boxShadow: "none" }),
            }}>{busy === "verify" ? "בודק…" : "אישור"}</button>
          </div>
          {err && <div role="alert" style={{ color: T.danger, fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>{err}</div>}
          <div style={{ display: "flex", gap: 12, marginTop: 10 }}>
            <button onClick={() => { setStage("phone"); setErr(null); }} style={{ ...ghostBtn, border: "none", padding: 0 }}>שינוי המספר</button>
            <button onClick={sendCode} disabled={!!busy || !phone} style={{ ...ghostBtn, border: "none", padding: 0, opacity: phone ? 1 : 0.5 }}>שליחה חוזרת</button>
          </div>
        </div>
      ) : (
        <div>
          {linked && !linked.readable && (
            <Note tone="amber">המספר שנשמר כבר לא ניתן לפענוח (סוד השרת הוחלף). הזינו אותו שוב.</Note>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: linked && !linked.readable ? 10 : 0 }}>
            <input
              value={phone} onChange={(e) => { setPhone(e.target.value); setErr(null); }}
              onKeyDown={(e) => { if (e.key === "Enter" && phone.trim()) sendCode(); }}
              type="tel" inputMode="tel" autoComplete="tel" aria-label="מספר טלפון נייד" placeholder="050-1234567"
              className="num"
              style={{ ...inputStyle, flex: 1, height: 46, fontSize: 16, direction: "ltr", textAlign: "right" }}
            />
            <button onClick={sendCode} disabled={busy === "start" || !phone.trim()} style={{
              ...primaryBtn, borderRadius: 14, height: 46, padding: "0 16px",
              ...(phone.trim() ? {} : { background: T.surface2, color: T.ink3, boxShadow: "none" }),
            }}>{busy === "start" ? "שולח…" : "שליחת קוד"}</button>
          </div>
          {err && <div role="alert" style={{ color: T.danger, fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>{err}</div>}
          <p style={{ margin: "10px 0 0", fontSize: 11.5, color: T.ink3, lineHeight: 1.6 }}>
            נשלח קוד אימות ב-SMS כדי לוודא שהמספר נכון. המספר נשמר מוצפן ומוצג רק כ-<span className="num" style={{ direction: "ltr", display: "inline-block" }}>050-•••-1234</span>.
          </p>
        </div>
      )}
    </Channel>
  );
}

function TelegramSetupSteps() {
  return (
    <div style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.7 }}>
      <Note tone="amber">הבוט עוד לא הוגדר. זה חד-פעמי, בחינם, כ-2 דקות:</Note>
      <ol style={{ margin: "10px 0 0", paddingInlineStart: 18 }}>
        <li>בטלגרם פותחים את <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" style={{ color: T.accent, fontWeight: 600 }}>@BotFather</a> ושולחים <code className="num">/newbot</code>.</li>
        <li>בוחרים שם (למשל ״היומן של אופיר״) ושם משתמש שמסתיים ב-<code className="num">bot</code>.</li>
        <li>מעתיקים את הטוקן שמתקבל.</li>
        <li>ב-Vercel → Settings → Environment Variables מוסיפים <code className="num">TELEGRAM_BOT_TOKEN</code> עם הטוקן, ופורסים מחדש.</li>
        <li>חוזרים לכאן ולוחצים ״חיבור טלגרם״. נדין עושה את אותו הדבר מהיומן שלה.</li>
      </ol>
    </div>
  );
}

// באייפון התראות מהיומן עובדות רק כשהוא מותקן במסך הבית (iOS 16.4 ומעלה) — השלבים ב-InstallApp.tsx

function Channel({ icon, pal = "blue", title, subtitle, badge, children }: {
  icon: React.ReactNode; pal?: Pal; title: string; subtitle: string;
  badge?: { text: string; tone: "ok" | "accent" | "danger" };
  children: React.ReactNode;
}) {
  const bc = badge?.tone === "ok" ? T.mint : badge?.tone === "danger" ? T.danger : T.accent;
  return (
    <section style={{ background: T.bg2, borderRadius: 18, padding: 14, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <IconChip pal={pal} size={34} radius={11}>{icon}</IconChip>
        <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 800, fontFamily: "var(--font-display)" }}>{title}</h3>
        {badge && (
          <span style={{ marginInlineStart: "auto", fontSize: 10.5, fontWeight: 700, color: bc, background: alpha(bc, 13), borderRadius: 99, padding: "2px 9px" }}>
            {badge.text}
          </span>
        )}
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 12, color: T.ink3, lineHeight: 1.6 }}>{subtitle}</p>
      {children}
    </section>
  );
}

function Note({ tone, children }: { tone: "ok" | "amber" | "danger"; children: React.ReactNode }) {
  const c = tone === "ok" ? T.mint : tone === "danger" ? T.danger : T.amber;
  return (
    <div style={{ fontSize: 12.5, lineHeight: 1.6, color: T.ink, background: alpha(c, 11), borderRadius: 12, padding: "10px 12px" }}>
      {children}
    </div>
  );
}

function DiagList({ d, now, telegram, linked, sms, personName }: { d: PushDiag; now: number; telegram: TelegramStatus | null; linked: boolean; sms: SmsStatus | null; personName: string }) {
  const smsLinked = !!sms?.linked?.readable;
  const hbAgeMin = d.heartbeatAt ? Math.round((now - new Date(d.heartbeatAt).getTime()) / 60000) : null;
  const rows: { label: string; ok: boolean | null; detail?: string }[] = [
    { label: "בוט טלגרם מוגדר בשרת", ok: !!telegram?.configured, detail: telegram?.configured ? undefined : "חסר TELEGRAM_BOT_TOKEN ב-Vercel (חינם, README)" },
    { label: `טלגרם מחובר ליומן של ${personName}`, ok: linked },
    ...(sms?.configured ? [{ label: `SMS מחובר ליומן של ${personName}`, ok: smsLinked as boolean | null, detail: sms.linked ? (sms.linked.readable ? sms.linked.mask : "צריך לחבר את המספר מחדש") : undefined }] : []),
    { label: "הרשאת התראות בדפדפן", ok: d.permission === "granted" ? true : d.permission === "default" ? null : false, detail: d.permission === "denied" ? "נדחתה" : d.permission === "unsupported" ? "לא נתמך" : d.permission === "default" ? "טרם התבקשה" : undefined },
    { label: "המכשיר הזה רשום להתראות", ok: d.deviceSubscribed },
    { label: "הרישום של המכשיר קיים בענן", ok: d.deviceInCloud, detail: d.deviceInCloud === false ? "נמחק — לחיצה על ״הפעלת התראות״ תרשום מחדש" : undefined },
    { label: "מפתח VAPID בבנייה", ok: d.vapidBaked, detail: d.vapidBaked ? undefined : "חסר NEXT_PUBLIC_VAPID_PUBLIC_KEY" },
    { label: "הגדרות שרת (VAPID פרטי + CRON_SECRET)", ok: d.server ? d.server.vapidPrivate && d.server.cronSecret : false },
    { label: "מכשירים רשומים ליומן הזה", ok: d.cloudSubscriptions === null ? false : d.cloudSubscriptions > 0 ? true : null, detail: d.cloudSubscriptions === null ? d.cloudError ?? "הטבלה לא קיימת" : String(d.cloudSubscriptions) },
    { label: "שרת התזכורות (cron) רץ", ok: hbAgeMin !== null && hbAgeMin <= 3, detail: hbAgeMin === null ? "מעולם לא רץ — יש להריץ את supabase-cron.sql" : `לפני ${hbAgeMin} דק׳` },
    { label: "מסירת פוש אחרונה הצליחה", ok: d.pushErrors && d.pushErrors.length ? false : null, detail: d.pushErrors?.length ? d.pushErrors.map((f) => `${f.status ?? "?"} @ ${f.host}`).join(" · ") : "אין כשלים ידועים" },
  ];

  let verdict = "הכול תקין: עדכונים יגיעו לטלפון גם כשהיומן סגור.";
  if (!smsLinked && !linked && !(d.deviceSubscribed && d.permission === "granted")) verdict = telegram?.configured
    ? "אין עדיין התראות לטלפון — הכי פשוט ללחוץ ״חיבור טלגרם״ למעלה."
    : "אין עדיין התראות לטלפון. הפעילו ״התראות מהיומן עצמו״ למעלה, או הגדירו את בוט הטלגרם (חינם, README).";
  else if (hbAgeMin === null || hbAgeMin > 3) verdict = "שרת התזכורות לא רץ: תזכורות מתוזמנות לא יישלחו. יש להריץ את supabase-cron.sql ב-Supabase (README).";
  else if (d.pushErrors?.some((f) => f.status === 403)) verdict = "שרת הפוש דוחה את המפתחות (403) — כנראה שמפתחות VAPID הוחלפו. כבו והפעילו מחדש התראות בכל מכשיר, או הסתמכו על SMS.";

  return (
    <div className="tj-pop" style={{ marginTop: 14, background: T.bg2, borderRadius: 18, padding: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {rows.map((r) => (
          <div key={r.label} style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 12.5 }}>
            <span style={{
              width: 18, height: 18, borderRadius: 99, flexShrink: 0, marginTop: 1,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: r.ok === true ? T.mintSoft : r.ok === false ? T.dangerSoft : T.surface2,
              color: r.ok === true ? T.mint : r.ok === false ? T.danger : T.ink3,
            }}>
              {r.ok === true ? Ic.check(11) : r.ok === false ? Ic.x(10) : <span style={{ width: 5, height: 5, borderRadius: 99, background: "currentColor" }} />}
            </span>
            <span style={{ flex: 1, color: T.ink }}>
              {r.label}
              {r.detail && <span style={{ display: "block", fontSize: 11, color: T.ink3 }}>{r.detail}</span>}
            </span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, fontSize: 12.5, fontWeight: 600, color: T.ink, background: T.surface, borderRadius: 12, padding: "10px 12px", lineHeight: 1.6 }}>
        {verdict}
      </div>
    </div>
  );
}

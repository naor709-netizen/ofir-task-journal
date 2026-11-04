"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useToast } from "@/components/Toast";
import {
  enablePush, diagnosePush, sendTestPush, telegramStatus, telegramAction,
  type PushDiag, type TelegramStatus,
} from "@/lib/push";
import { subscribeTeamMeta, getTeamMeta, getServerTeamMeta } from "@/lib/team";
import { MANAGER_ID, MANAGER_NAME } from "@/lib/journals";
import { T, alpha, Ic, Sheet, primaryBtn, ghostBtn, softBtn } from "./ui";

type PushState = "unsupported" | "off" | "on" | "denied";

// מרכז העדכונים: טלגרם (הערוץ האמין) + התראות דפדפן + אבחון מלא
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
      const parts = [r.pushed ? `${r.pushed} מכשירים` : "", r.telegram === "sent" ? "טלגרם" : ""].filter(Boolean).join(" + ");
      toast(`התראת בדיקה נשלחה (${parts}) — אמורה להגיע תוך שניות`, "success");
    } else {
      toast(r.reason === "no-subscriptions" ? "אין לאן לשלוח — חברו טלגרם או הפעילו התראות" : `השליחה נכשלה (${r.reason ?? ""})`, "error");
    }
  }

  const ios = typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const standalone = typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);

  return (
    <Sheet title="עדכונים לטלפון" icon={Ic.phone(17)} onClose={onClose} width={460}>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: T.ink2, lineHeight: 1.6 }}>
        {isManager
          ? "תזכורות, בריף בוקר ועדכונים מהצוות — ישר לטלפון, גם כשהיומן סגור."
          : `תזכורות, בריף בוקר ומשימות ש${MANAGER_NAME} שולח — ישר לטלפון, גם כשהיומן סגור.`}
      </p>

      {/* ---- טלגרם ---- */}
      <Channel
        icon={Ic.send(18)}
        title="טלגרם"
        badge={linked ? { text: "מחובר", tone: "ok" } : { text: "מומלץ", tone: "accent" }}
        subtitle="הדרך האמינה ביותר: עובד בכל טלפון, מגיע מיד, וכולל כפתורי ״בוצע״ ו״עוד שעה״ ישר מההתראה."
      >
        {tg === null ? (
          <div className="tj-skel" style={{ height: 44, borderRadius: 12 }} />
        ) : !tg.configured ? (
          isManager ? <TelegramSetupSteps /> : (
            <Note tone="amber">הבוט של היומן עדיין לא הופעל. {MANAGER_NAME} צריך להפעיל אותו פעם אחת — ואז אפשר לחבר כאן בלחיצה.</Note>
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
              <li>לוחצים ״חיבור טלגרם״ — הבוט של היומן נפתח.</li>
              <li>לוחצים <b>Start</b> (או ״התחל״) בצ׳אט.</li>
              <li>חוזרים לכאן — החיבור מאושר אוטומטית.</li>
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

      {/* ---- התראות דפדפן ---- */}
      <Channel
        icon={Ic.bell(18)}
        title="התראות במכשיר הזה"
        badge={pushState === "on" ? { text: "פעיל", tone: "ok" } : pushState === "denied" ? { text: "חסום", tone: "danger" } : undefined}
        subtitle="התראת מערכת רגילה מהיומן. באייפון עובד רק כשהיומן מותקן במסך הבית."
      >
        {pushState === "on" ? (
          <Note tone="ok">ההתראות פעילות במכשיר הזה{ios ? "" : " — גם כשהיומן סגור"}.</Note>
        ) : pushState === "denied" ? (
          <Note tone="danger">הדפדפן חוסם התראות מהיומן. יש לאפשר אותן בהגדרות האתר בדפדפן, ואז לרענן.</Note>
        ) : pushState === "unsupported" || (ios && !standalone) ? (
          <Note tone="amber">
            {ios
              ? <>באייפון: לחצו על <b>שיתוף</b> ← <b>הוספה למסך הבית</b>, פתחו את היומן מהאייקון החדש, ואז הפעילו כאן. או פשוט חברו טלגרם למעלה.</>
              : "הדפדפן הזה לא תומך בהתראות. מומלץ לחבר טלגרם."}
          </Note>
        ) : (
          <button onClick={turnOnPush} disabled={busy === "push"} style={softBtn}>
            {Ic.bell(13)} {busy === "push" ? "מפעיל…" : "הפעלת התראות במכשיר הזה"}
          </button>
        )}
      </Channel>

      {/* ---- בדיקה ואבחון ---- */}
      <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
        <button onClick={testAll} disabled={!!busy} style={{ ...softBtn, flex: 1, height: 40 }}>
          {Ic.send(13)} {busy === "test" ? "שולח…" : "שליחת התראת בדיקה"}
        </button>
        <button onClick={runDiag} disabled={!!busy} style={{ ...ghostBtn, flex: 1, height: 40 }}>
          {Ic.activity(13)} {busy === "diag" ? "בודק…" : "אבחון מלא"}
        </button>
      </div>

      {diag && <DiagList d={diag.d} now={diag.at} telegram={tg} linked={!!linked} personName={personName} />}
    </Sheet>
  );
}

function Channel({ icon, title, subtitle, badge, children }: {
  icon: React.ReactNode; title: string; subtitle: string;
  badge?: { text: string; tone: "ok" | "accent" | "danger" };
  children: React.ReactNode;
}) {
  const bc = badge?.tone === "ok" ? T.mint : badge?.tone === "danger" ? T.danger : T.accent;
  return (
    <section style={{ background: T.bg2, borderRadius: 18, padding: 14, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <span style={{ width: 34, height: 34, borderRadius: 11, background: T.surface, color: T.accent, display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: T.shadowSm }}>{icon}</span>
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

function TelegramSetupSteps() {
  return (
    <div style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.7 }}>
      <Note tone="amber">הבוט עוד לא הוגדר. זה חד-פעמי, לוקח כ-2 דקות:</Note>
      <ol style={{ margin: "10px 0 0", paddingInlineStart: 18 }}>
        <li>בטלגרם, פותחים את <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" style={{ color: T.accent, fontWeight: 600 }}>@BotFather</a> ושולחים <code className="num">/newbot</code>.</li>
        <li>בוחרים שם (למשל ״היומן של אופיר״) ושם משתמש שמסתיים ב-<code className="num">bot</code>.</li>
        <li>מעתיקים את הטוקן שמתקבל.</li>
        <li>ב-Vercel → Settings → Environment Variables מוסיפים <code className="num">TELEGRAM_BOT_TOKEN</code> עם הטוקן, ופורסים מחדש.</li>
        <li>חוזרים לכאן ולוחצים ״חיבור טלגרם״.</li>
      </ol>
    </div>
  );
}

function DiagList({ d, now, telegram, linked, personName }: { d: PushDiag; now: number; telegram: TelegramStatus | null; linked: boolean; personName: string }) {
  const hbAgeMin = d.heartbeatAt ? Math.round((now - new Date(d.heartbeatAt).getTime()) / 60000) : null;
  const rows: { label: string; ok: boolean | null; detail?: string }[] = [
    { label: "טלגרם מוגדר בשרת", ok: !!telegram?.configured, detail: telegram?.configured ? undefined : "חסר TELEGRAM_BOT_TOKEN ב-Vercel" },
    { label: `טלגרם מחובר ליומן של ${personName}`, ok: linked },
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
  if (!linked && !(d.deviceSubscribed && d.permission === "granted")) verdict = "אין עדיין ערוץ לטלפון — הכי פשוט לחבר טלגרם למעלה.";
  else if (hbAgeMin === null || hbAgeMin > 3) verdict = "שרת התזכורות לא רץ: תזכורות מתוזמנות לא יישלחו. יש להריץ את supabase-cron.sql ב-Supabase (README).";
  else if (d.pushErrors?.some((f) => f.status === 403)) verdict = "שרת הפוש דוחה את המפתחות (403) — כנראה שמפתחות VAPID הוחלפו. כבו והפעילו מחדש התראות בכל מכשיר, או הסתמכו על טלגרם.";

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

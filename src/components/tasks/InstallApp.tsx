"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useToast } from "@/components/Toast";
import { T, Ic, alpha, card, primaryBtn, ghostBtn, Sheet } from "./ui";
import {
  installEnv, subscribeInstall, canPromptInstall, promptInstall, openInBrowserHref,
  subscribeInstallHidden, isInstallHidden, hideInstall, isAppInstalled, detectInstalledApp, type InstallEnv,
} from "@/lib/install";

// ============================================
// "היומן כאפליקציה": באנר בדשבורד + גיליון הוראות לפי הטלפון.
// אנדרואיד/כרום — התקנה בלחיצה אחת; אייפון — הוראות Safari;
// נפתח מתוך וואטסאפ — קודם יוצאים לדפדפן האמיתי.
// ============================================

const noSub = () => () => {};
export function useInstallEnv(): InstallEnv | null {
  return useSyncExternalStore(noSub, installEnv, () => null);
}
function useCanPrompt(): boolean {
  return useSyncExternalStore(subscribeInstall, canPromptInstall, () => false);
}

// אפשר להציע התקנה? לא כשהיומן כבר רץ כאפליקציה, ולא כשהוא כבר מותקן במכשיר.
// offer=true גם אחרי "לא עכשיו" על הבאנר — כפתור ההתקנה הקבוע לא נעלם אף פעם.
export function useInstallOffer(): { offer: boolean; canPrompt: boolean; env: InstallEnv | null } {
  const env = useInstallEnv();
  const canPrompt = useCanPrompt();
  const installed = useSyncExternalStore(subscribeInstall, isAppInstalled, () => false);
  useEffect(() => { detectInstalledApp(); }, []);
  // במחשב מציעים רק כשהדפדפן באמת מאפשר התקנה; בטלפון תמיד (באייפון זה דרך "הוספה למסך הבית")
  const offer = !!env && !env.standalone && !installed && (env.mobile || canPrompt);
  return { offer, canPrompt, env };
}

// התקנה בלחיצה אחת כשהדפדפן מאפשר; אחרת — גיליון ההוראות
export function useInstallAction(onOpenSheet: () => void): () => Promise<void> {
  const { toast } = useToast();
  return async () => {
    if (!canPromptInstall()) return onOpenSheet();
    const r = await promptInstall();
    if (r === "accepted") toast("היומן הותקן — האייקון מחכה במסך הבית", "success");
    else if (r === "unavailable") onOpenSheet();
  };
}

// ---------- כפתור התקנה קבוע (בכותרת) — לא תלוי בבאנר ----------
export function InstallButton({ onOpen }: { onOpen: () => void }) {
  const { offer } = useInstallOffer();
  const install = useInstallAction(onOpen);
  if (!offer) return null;
  return (
    <button onClick={install} className="tj-installbtn" aria-label="התקנת היומן כאפליקציה" title="התקנת היומן כאפליקציה" style={{
      display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 12px", borderRadius: 99,
      border: `1px solid ${T.accentLine}`, background: T.accentSoft, color: T.accent, cursor: "pointer",
      fontFamily: "inherit", fontSize: 12, fontWeight: 700, flexShrink: 0, whiteSpace: "nowrap",
    }}>
      {Ic.download(14)} <span className="tj-installbtn-text">התקנה</span>
    </button>
  );
}

const browserName = (env: InstallEnv) => (env.os === "ios" ? "Safari" : "Chrome");

// האייקון שיופיע במסך הבית — הלוגו של האפליקציה
function AppIcon({ size = 46 }: { size?: number }) {
  const src = "/icon-192.png";
  return (
    <span aria-hidden="true" style={{
      width: size, height: size, borderRadius: size * 0.28, flexShrink: 0,
      background: `url(${src}) center / cover`, display: "inline-block",
      boxShadow: `0 0 0 1px ${T.line}, 0 10px 22px -12px ${T.glow}`,
    }} />
  );
}

async function copyLink(toast: (m: string, t?: "success" | "error") => void) {
  try { await navigator.clipboard.writeText(window.location.href); toast("הקישור הועתק — מדביקים אותו בדפדפן", "success"); }
  catch { toast("ההעתקה נכשלה — מסמנים את הכתובת ומעתיקים ידנית", "error"); }
}

// ---------- באנר בראש הדשבורד (רק בטלפון / כשאפשר להתקין, ולא אם כבר מותקן) ----------
export function InstallBanner({ journalId, onOpen }: { journalId: string; onOpen: () => void }) {
  const { offer, canPrompt, env } = useInstallOffer();
  const hidden = useSyncExternalStore(subscribeInstallHidden, () => isInstallHidden(journalId), () => true);
  const install = useInstallAction(onOpen);
  if (!offer || !env || hidden) return null;

  const href = env.inApp ? openInBrowserHref(env, window.location.href) : null;

  return (
    <section className="tj-card tj-install" data-inapp={!!href} aria-label="התקנת היומן כאפליקציה" style={{
      ...card, padding: "14px 16px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
      background: `linear-gradient(135deg, ${alpha("var(--tj-accent)", 11)} 0%, ${alpha("var(--tj-accent)", 2)} 65%), var(--tj-surface)`,
      border: `1px solid ${T.accentLine}`,
    }}>
      <AppIcon />
      <div style={{ flex: "1 1 190px", minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 15, color: T.ink, letterSpacing: "-0.01em" }}>
          {env.inApp ? `היומן פתוח כרגע בתוך ${env.inApp}` : env.mobile ? "היומן כאפליקציה בטלפון" : "היומן כאפליקציה"}
        </div>
        <div className="tj-install-sub" style={{ fontSize: 12.5, color: T.ink2, marginTop: 2, lineHeight: 1.5 }}>
          {env.inApp
            ? `משם אי אפשר להתקין. פותחים ב-${browserName(env)} ומתקינים — פחות מדקה.`
            : "אייקון במסך הבית, פתיחה במסך מלא והתראות שקופצות. חינם, בלי חנות אפליקציות."}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginInlineStart: "auto" }}>
        {href ? (
          <a href={href} style={{ ...primaryBtn, textDecoration: "none", height: 40, padding: "0 18px" }}>
            {Ic.arrowUpLeft(14)} פתיחה ב-{browserName(env)}
          </a>
        ) : (
          <button onClick={install} style={{ ...primaryBtn, height: 40, padding: "0 18px" }}>
            {Ic.download(15)} {canPrompt ? "התקנה" : <><span className="tj-install-long">איך מתקינים</span><span className="tj-install-short">התקנה</span></>}
          </button>
        )}
        {href && <button onClick={onOpen} style={{ ...ghostBtn, height: 40 }}>הסבר</button>}
        <button onClick={() => hideInstall(journalId)} aria-label="לא עכשיו" title="לא עכשיו" style={{
          width: 34, height: 34, borderRadius: 99, border: "none", background: "transparent", color: T.ink3,
          display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
        }}>{Ic.x(14)}</button>
      </div>
    </section>
  );
}

// ---------- גיליון ההוראות ----------
export function InstallSheet({ personName, onClose }: { personName: string; onClose: () => void }) {
  const env = useInstallEnv();
  const canPrompt = useCanPrompt();
  const { toast } = useToast();
  const [os, setOs] = useState<"ios" | "android">(() => (installEnv()?.os === "ios" ? "ios" : "android"));
  const href = env?.inApp ? openInBrowserHref(env, window.location.href) : null;

  async function install() {
    const r = await promptInstall();
    if (r === "accepted") { toast("היומן הותקן — האייקון מחכה במסך הבית", "success"); onClose(); }
  }

  return (
    <Sheet title="התקנה כאפליקציה" icon={Ic.phone(17)} onClose={onClose} width={460}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
        <AppIcon size={58} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 17, color: T.ink }}>היומן של {personName}</div>
          <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 2 }}>חינם · בלי חנות אפליקציות · פחות מדקה</div>
        </div>
      </div>

      {env?.standalone ? (
        <Box tone="mint">{Ic.checkCircle(15)} היומן כבר פתוח כאפליקציה במכשיר הזה.</Box>
      ) : (
        <>
          {canPrompt && (
            <button onClick={install} style={{ ...primaryBtn, width: "100%", height: 48, fontSize: 15, marginBottom: 14, borderRadius: 16 }}>
              {Ic.download(16)} התקנה בלחיצה אחת
            </button>
          )}

          {env?.inApp && (
            <Box tone="amber">
              <div style={{ fontWeight: 700, marginBottom: 4 }}>הקישור נפתח בתוך {env.inApp} — משם אין אפשרות להתקין.</div>
              <div style={{ marginBottom: 10 }}>
                {env.os === "ios"
                  ? <>לוחצים על הכפתור, או על <b>⋯</b> / סמל המצפן בפינה ← <b>״פתיחה ב-Safari״</b>.</>
                  : <>לוחצים על הכפתור, או על <b>⋮</b> בפינה ← <b>״פתיחה ב-Chrome״</b>.</>}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {href && <a href={href} style={{ ...primaryBtn, textDecoration: "none", height: 38, padding: "0 16px", fontSize: 13 }}>{Ic.arrowUpLeft(13)} פתיחה ב-{browserName(env)}</a>}
                <button onClick={() => copyLink(toast)} style={{ ...ghostBtn, height: 38, background: T.surface }}>{Ic.copy(13)} העתקת הקישור</button>
              </div>
            </Box>
          )}

          <div role="group" aria-label="סוג הטלפון" style={{
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, padding: 4, borderRadius: 14,
            background: T.surface2, margin: "14px 0 14px",
          }}>
            {(["ios", "android"] as const).map((k) => (
              <button key={k} onClick={() => setOs(k)} aria-pressed={os === k} style={{
                height: 36, borderRadius: 11, border: "none", cursor: "pointer", fontFamily: "inherit",
                fontSize: 13, fontWeight: 700,
                background: os === k ? T.surface : "transparent", color: os === k ? T.ink : T.ink3,
                boxShadow: os === k ? T.shadowSm : "none",
              }}>{k === "ios" ? "אייפון" : "אנדרואיד"}</button>
            ))}
          </div>

          <InstallSteps os={os} />
        </>
      )}

      <p style={{ margin: "16px 0 0", fontSize: 12, color: T.ink3, lineHeight: 1.6 }}>
        אחרי ההתקנה פותחים את היומן מהאייקון, ומפעילים התראות בכפתור הפעמון — כך תזכורות ומשימות חדשות יקפצו בטלפון.
      </p>
    </Sheet>
  );
}

// ---------- השלבים עצמם (גם בתוך מרכז ההתראות) ----------
export function InstallSteps({ os }: { os: "ios" | "android" }) {
  const step = (n: number, body: React.ReactNode) => (
    <li key={n} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <span className="num" style={{
        width: 24, height: 24, borderRadius: 99, flexShrink: 0, background: T.grad, color: "#fff",
        display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 700,
      }}>{n}</span>
      <span style={{ paddingTop: 2 }}>{body}</span>
    </li>
  );
  const glyph = (node: React.ReactNode) => (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", verticalAlign: "-4px",
      minWidth: 22, height: 20, padding: "0 4px", borderRadius: 6, background: T.surface2, color: T.accent, fontWeight: 800,
    }}>{node}</span>
  );
  const iosShare = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="שיתוף">
      <path d="M12 3v12M8 7l4-4 4 4" /><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
    </svg>
  );
  const addBox = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="4" /><path d="M12 8.5v7M8.5 12h7" />
    </svg>
  );
  const items = os === "ios"
    ? [
        <>פותחים את הקישור ב-<b>Safari</b> (גם Chrome לאייפון עובד).</>,
        <>לוחצים על כפתור השיתוף {glyph(iosShare)}. בגרסאות החדשות הוא בתפריט — לוחצים קודם על {glyph("⋯")} בפינה ואז ״שיתוף״.</>,
        <>גוללים מטה ובוחרים <b>״הוספה למסך הבית״</b> {glyph(addBox)}.</>,
        <>משאירים את ״פתיחה כאפליקציית רשת״ דלוק (אם מופיע) ולוחצים <b>״הוסף״</b>.</>,
        <>פותחים את היומן <b>מהאייקון החדש</b> במסך הבית.</>,
      ]
    : [
        <>פותחים את הקישור ב-<b>Chrome</b>.</>,
        <>לוחצים על {glyph("⋮")} (שלוש נקודות) בפינה העליונה.</>,
        <>בוחרים <b>״התקנת אפליקציה״</b> או <b>״הוספה למסך הבית״</b> ← ״התקנה״.</>,
        <>פותחים את היומן <b>מהאייקון החדש</b> במסך הבית.</>,
      ];
  return (
    <div>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 11, fontSize: 13, color: T.ink, lineHeight: 1.6 }}>
        {items.map((it, i) => step(i + 1, it))}
      </ol>
      <p style={{ margin: "10px 0 0", fontSize: 11.5, color: T.ink3, lineHeight: 1.6 }}>
        {os === "ios"
          ? "נדרש iOS 16.4 ומעלה. לא רואים ״הוספה למסך הבית״? כנראה שהקישור פתוח בתוך וואטסאפ — פותחים אותו קודם ב-Safari."
          : "בדפדפן של סמסונג: ☰ למטה ← ״הוספת דף אל״ ← ״מסך הבית״."}
      </p>
    </div>
  );
}

function Box({ tone, children }: { tone: "mint" | "amber"; children: React.ReactNode }) {
  const c = tone === "mint" ? T.mint : T.amber;
  return (
    <div style={{
      display: "block", fontSize: 12.5, lineHeight: 1.6, color: T.ink, borderRadius: 14, padding: "12px 14px",
      background: tone === "mint" ? T.mintSoft : T.amberSoft, border: `1px solid ${alpha(c, 25)}`,
    }}>{children}</div>
  );
}

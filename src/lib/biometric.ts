"use client";

// ============================================
// כניסה בטביעת אצבע / Face ID לאזור של אופיר (WebAuthn, מאמת מובנה במכשיר)
//
// הכל נשאר במכשיר: מזהה האישור נשמר ב-localStorage בלבד, ושום דבר לא נכתב
// ל-Supabase — לא נוגעים ביומן, במשימות או בקוד המנהל.
// כמו קוד ה-PIN, זה וילון פרטיות ולא אבטחה מלאה: אין אימות חתימה בשרת.
// ============================================

const CRED_KEY = "ofir-bio-cred";
const OFFER_KEY = "ofir-bio-offer-dismissed";

function b64url(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): ArrayBuffer {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

function random(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));
}

// שם החיישן כפי שהמשתמש מכיר אותו במכשיר שלו
export function biometricLabel(): string {
  if (typeof navigator === "undefined") return "טביעת אצבע";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return "Face ID";
  if (/Macintosh/i.test(ua)) return "Touch ID";
  if (/Windows/i.test(ua)) return "Windows Hello";
  return "טביעת אצבע";
}

export async function biometricAvailable(): Promise<boolean> {
  if (typeof window === "undefined" || !window.PublicKeyCredential || !navigator.credentials) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function biometricEnrolled(): boolean {
  try { return !!localStorage.getItem(CRED_KEY); } catch { return false; }
}

export type BioResult = { ok: true } | { ok: false; reason: "unsupported" | "cancelled" | "failed" };

function reasonOf(e: unknown): "cancelled" | "failed" {
  const name = (e as { name?: string })?.name;
  return name === "NotAllowedError" || name === "AbortError" ? "cancelled" : "failed";
}

// רישום חד-פעמי במכשיר הזה — מציג את חלון טביעת האצבע / Face ID של המערכת
export async function enrollBiometric(displayName: string): Promise<BioResult> {
  if (!(await biometricAvailable())) return { ok: false, reason: "unsupported" };
  try {
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: random(32),
        rp: { name: "יומן המשימות" },
        user: { id: random(16), name: "ofir-manager", displayName },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 }, // ES256
          { type: "public-key", alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "discouraged",
        },
        attestation: "none",
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;
    if (!cred) return { ok: false, reason: "cancelled" };
    localStorage.setItem(CRED_KEY, JSON.stringify({ id: b64url(cred.rawId), at: new Date().toISOString() }));
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: reasonOf(e) };
  }
}

// אימות: רק האישור שנרשם במכשיר הזה, ורק עם אימות משתמש (UV) אמיתי
export async function verifyBiometric(): Promise<BioResult> {
  let stored: { id: string } | null = null;
  try { stored = JSON.parse(localStorage.getItem(CRED_KEY) ?? "null"); } catch { stored = null; }
  if (!stored?.id || !(await biometricAvailable())) return { ok: false, reason: "unsupported" };
  try {
    const cred = (await navigator.credentials.get({
      publicKey: {
        challenge: random(32),
        allowCredentials: [{ type: "public-key", id: fromB64url(stored.id), transports: ["internal"] }],
        userVerification: "required",
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;
    if (!cred || b64url(cred.rawId) !== stored.id) return { ok: false, reason: "failed" };
    const auth = new Uint8Array((cred.response as AuthenticatorAssertionResponse).authenticatorData);
    // דגל UV (ביט 2 בבייט 32): המערכת אכן זיהתה את בעל המכשיר
    if (auth.length < 33 || (auth[32] & 0x04) === 0) return { ok: false, reason: "failed" };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: reasonOf(e) };
  }
}

export function removeBiometric() {
  try { localStorage.removeItem(CRED_KEY); } catch { /* ignore */ }
}

// הצעה חד-פעמית אחרי כניסה בקוד ("להיכנס בפעם הבאה עם Face ID?")
export function bioOfferDismissed(): boolean {
  try { return localStorage.getItem(OFFER_KEY) === "1"; } catch { return true; }
}
export function dismissBioOffer() {
  try { localStorage.setItem(OFFER_KEY, "1"); } catch { /* ignore */ }
}

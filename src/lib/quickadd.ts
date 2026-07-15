"use client";

// ============================================
// הוספה מהירה — הבנת עברית חופשית
// "להתקשר לדני מחר ב-10:00 דחוף" ← שם, תאריך, תזכורת, קריטיות
// ============================================

import { toDateKey, HE_WEEKDAYS_FULL } from "./tasks";

export interface QuickParse {
  title: string;
  dueDate: string | null; // YYYY-MM-DD
  reminder: string | null; // ISO — נגזר משעה מפורשת
  critical: boolean;
  summary: string; // מה הובן, למשוב מיידי
}

const WEEKDAY_INDEX: Record<string, number> = {
  "ראשון": 0, "שני": 1, "שלישי": 2, "רביעי": 3, "חמישי": 4, "שישי": 5, "שבת": 6,
};

function addDays(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

export function parseQuickAdd(raw: string, now: Date = new Date()): QuickParse {
  let text = " " + raw.trim() + " ";
  let due: Date | null = null;
  let hour: number | null = null;
  let minute = 0;
  let critical = false;

  // --- קריטיות ---
  if (/[\s](דחוף|קריטי|קריטית)[\s!]/.test(text) || /!{2,}/.test(text)) {
    critical = true;
    text = text.replace(/[\s](דחוף|קריטי|קריטית)(?=[\s!])/g, " ").replace(/!+/g, " ");
  }

  // --- שעה ---
  const timePatterns = [
    /\sבשעה\s+(\d{1,2})(?::(\d{2}))?\s/, // "בשעה 14" / "בשעה 14:30"
    /\sב-?(\d{1,2}):(\d{2})\s/,          // "ב-10:00" / "ב10:00"
    /\s(\d{1,2}):(\d{2})\s/,             // "10:00"
  ];
  for (const re of timePatterns) {
    const m = text.match(re);
    if (m) {
      const h = parseInt(m[1], 10);
      const mi = m[2] ? parseInt(m[2], 10) : 0;
      if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) {
        hour = h; minute = mi;
        text = text.replace(re, " ");
        break;
      }
    }
  }

  // --- תאריך ---
  if (/\sמחרתיים\s/.test(text)) { due = addDays(now, 2); text = text.replace(/\sמחרתיים\s/, " "); }
  else if (/\sמחר\s/.test(text)) { due = addDays(now, 1); text = text.replace(/\sמחר\s/, " "); }
  else if (/\sהיום\s/.test(text)) { due = addDays(now, 0); text = text.replace(/\sהיום\s/, " "); }
  else {
    const inDays = text.match(/\sבעוד\s+(\d{1,2})\s+ימים?\s/);
    const weekday = text.match(/\sב?יום\s+(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)\s/);
    const explicit = text.match(/\s(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\s/);
    if (inDays) {
      due = addDays(now, parseInt(inDays[1], 10));
      text = text.replace(inDays[0], " ");
    } else if (weekday) {
      const target = WEEKDAY_INDEX[weekday[1]];
      let diff = (target - now.getDay() + 7) % 7;
      if (diff === 0) diff = 7; // "ביום שלישי" כשהיום שלישי = בשבוע הבא
      due = addDays(now, diff);
      text = text.replace(weekday[0], " ");
    } else if (explicit) {
      const d = parseInt(explicit[1], 10), mo = parseInt(explicit[2], 10);
      let y = explicit[3] ? parseInt(explicit[3], 10) : now.getFullYear();
      if (y < 100) y += 2000;
      if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
        due = new Date(y, mo - 1, d);
        if (!explicit[3] && due < addDays(now, 0)) due = new Date(y + 1, mo - 1, d);
        text = text.replace(explicit[0], " ");
      }
    }
  }

  // שעה בלי תאריך: היום, ואם השעה כבר עברה — מחר
  if (hour !== null && !due) {
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
    due = candidate.getTime() <= now.getTime() ? addDays(now, 1) : addDays(now, 0);
  }

  let reminder: string | null = null;
  if (hour !== null && due) {
    reminder = new Date(due.getFullYear(), due.getMonth(), due.getDate(), hour, minute).toISOString();
  }

  const title = text.replace(/\s+/g, " ").trim();

  const parts: string[] = [];
  if (due) parts.push(`ליום ${HE_WEEKDAYS_FULL[due.getDay()]} ${due.getDate()}.${due.getMonth() + 1}`);
  if (hour !== null) parts.push(`תזכורת ב-${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  if (critical) parts.push("קריטית");
  const summary = parts.length ? `נוצרה משימה ${parts.join(" · ")}` : "נוצרה משימה";

  return { title, dueDate: due ? toDateKey(due) : null, reminder, critical, summary };
}

// ============================================
// תאריך עברי — "א׳ באב תשפ״ו" (Intl נותן מספרים, ההמרה לגימטריה כאן)
// ============================================

function gematria(n: number): string {
  const hundreds = ["", "ק", "ר", "ש", "ת", "תק", "תר", "תש", "תת", "תתק"];
  const tens = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
  const ones = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
  const h = Math.floor(n / 100), rem = n % 100;
  const t = Math.floor(rem / 10), o = rem % 10;
  const body = rem === 15 ? "טו" : rem === 16 ? "טז" : tens[t] + ones[o];
  const s = hundreds[h] + body;
  if (s.length === 0) return "";
  return s.length === 1 ? s + "׳" : s.slice(0, -1) + "״" + s.slice(-1);
}

export function hebrewDateToday(now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("he-IL-u-ca-hebrew", { day: "numeric", month: "long", year: "numeric" })
      .formatToParts(now);
    const day = parseInt(parts.find((p) => p.type === "day")?.value ?? "", 10);
    const month = parts.find((p) => p.type === "month")?.value ?? "";
    const year = parseInt(parts.find((p) => p.type === "year")?.value ?? "", 10);
    if (!day || !month || !year) return "";
    return `${gematria(day)} ב${month.replace(/^ב/, "")} ${gematria(year % 1000)}`;
  } catch {
    return "";
  }
}

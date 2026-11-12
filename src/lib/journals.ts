// ============================================
// יומנים — מודל משותף לקליינט ולשרת
// אופיר הוא המנהל (היומן בכתובת "/"); לכל אשת/איש צוות יומן משלו ב-/j/<id>.
// ============================================

export const MANAGER_ID = "ofir";
export const MANAGER_NAME = "אופיר";

// העובדת של אופיר — מוצעת מראש בהוספה לצוות (השם ניתן לעריכה, ושום דבר לא נוצר
// אוטומטית: היומן שלה נפתח רק כשאופיר לוחץ "יצירת היומן", אחרי הגדרת קוד המנהל)
export const SUGGESTED_MEMBER_NAME = "נדין מזרחי";

// שם פרטי לברכות ("בוקר טוב, נדין") — שם מלא נשאר בכותרות ובדשבורד
export function firstName(name: string): string {
  return String(name ?? "").trim().split(/\s+/)[0] || name;
}

export type PersonColor = "blue" | "violet" | "teal" | "rose" | "orange" | "fuchsia";

// גוון אישי לכל יומן: הכרום (כפתור ראשי, טאב פעיל, הילת רקע) נצבע בו.
// a→b הם קצוות הרמפה החד-גונית; טקסט על הרמפה תמיד לבן במשקל 700+.
// solid/dark אומתו כפלטה קטגורית (CVD + ניגודיות) בסדר: blue, teal, orange, fuchsia, rose, violet.
export const PERSON_COLORS: Record<PersonColor, { label: string; a: string; b: string; solid: string; dark: string }> = {
  blue: { label: "כחול", a: "#3B82F6", b: "#1D4FD7", solid: "#2563EB", dark: "#5B8CFF" },
  teal: { label: "טורקיז", a: "#14B8A6", b: "#0F766E", solid: "#0D9488", dark: "#12A594" },
  orange: { label: "כתום", a: "#F97316", b: "#C2410C", solid: "#EA580C", dark: "#E2600F" },
  fuchsia: { label: "פוקסיה", a: "#D946EF", b: "#A21CAF", solid: "#C026D3", dark: "#D946EF" },
  rose: { label: "ורד", a: "#F43F5E", b: "#BE123C", solid: "#E11D48", dark: "#F43F5E" },
  violet: { label: "סגול", a: "#8B5CF6", b: "#6427D6", solid: "#7C3AED", dark: "#8B5CF6" },
};

export const MEMBER_COLOR_ORDER: PersonColor[] = ["teal", "orange", "fuchsia", "rose", "violet", "blue"];

// צבע אדם כטוקן CSS — מתחלף לבד בין בהיר לכהה (מוגדר ב-src/app/global-css.ts)
export function personVar(c: PersonColor): string {
  return `var(--p-${c})`;
}

export interface TeamMember {
  id: string;
  name: string;
  color: PersonColor;
  role?: string;
  createdAt: string;
}

export interface TeamRoster {
  members: TeamMember[];
}

export interface NotifyPrefs {
  memberDone: boolean; // אשת צוות סיימה משימה
  memberNew: boolean; // אשת צוות הוסיפה משימה
  teamBrief: boolean; // תמונת מצב הצוות בבריף הבוקר / סיכום שבועי
}

export const DEFAULT_PREFS: NotifyPrefs = { memberDone: true, memberNew: true, teamBrief: true };

// מפתחות ב-journal_meta. של אופיר נשארים בשמם המקורי (תאימות לאחור מלאה),
// של כל אשת צוות מקבלים סיומת @<id>.
export function metaKey(base: string, journalId: string): string {
  return journalId === MANAGER_ID ? base : `${base}@${journalId}`;
}

export const META = {
  team: "team",
  prefs: "notify_prefs",
  telegram: (journalId: string) => `tg:${journalId}`,
  telegramPending: (journalId: string) => `tg-pending:${journalId}`,
} as const;

// שיוך שורה ביומן: נשמר בתוך ה-payload של משימת השורש, כך שלא נדרשת שום
// מיגרציה. משימות ישנות בלי שדה שייכות לאופיר.
export function journalOfPayload(payload: { journalId?: string | null } | null | undefined): string {
  return payload?.journalId || MANAGER_ID;
}

// ---- משימה משותפת ----
// נשמרת פעם אחת, בשורה של היוצר (journalId), ומופיעה גם בכל יומן שב-sharedWith.
// כך שני הצדדים רואים ומעדכנים את אותה משימה בדיוק — בלי עותקים שמתפצלים.
export function sharedWithOfPayload(payload: { sharedWith?: unknown } | null | undefined): string[] {
  const raw = payload?.sharedWith;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((x): x is string => typeof x === "string" && isValidJournalId(x)))];
}

// כל מי שהמשימה מופיעה אצלו: הבעלים ראשון, ואחריו השותפים
export function participantsOfPayload(payload: { journalId?: string | null; sharedWith?: unknown } | null | undefined): string[] {
  const owner = journalOfPayload(payload);
  return [owner, ...sharedWithOfPayload(payload).filter((x) => x !== owner)];
}

export function payloadVisibleIn(
  payload: { journalId?: string | null; sharedWith?: unknown } | null | undefined,
  journalId: string
): boolean {
  return journalOfPayload(payload) === journalId || sharedWithOfPayload(payload).includes(journalId);
}

// מה נשמר בשורה בענן: אצל אופיר — המשימה בדיוק כמו שהייתה תמיד (בלי שדה נוסף);
// אצל איש צוות — עם journalId, כדי לדעת של מי השורה.
// ownerId קיים רק בצד הלקוח, על משימה ששותפה מיומן אחר: השורה נשארת של הבעלים
// גם כשהשותף הוא ששומר אותה.
export function rowPayload<T extends object>(task: T, journalId: string): T & { journalId?: string } {
  const copy = { ...task } as T & { journalId?: string; ownerId?: string };
  const owner = copy.ownerId || journalId;
  delete copy.ownerId;
  if (owner === MANAGER_ID) delete copy.journalId;
  else copy.journalId = owner;
  return copy;
}

export function journalPath(journalId: string): string {
  return journalId === MANAGER_ID ? "/" : `/j/${journalId}`;
}

export function memberById(roster: TeamRoster | null | undefined, id: string): TeamMember | null {
  return roster?.members.find((m) => m.id === id) ?? null;
}

export function personName(roster: TeamRoster | null | undefined, journalId: string): string {
  if (journalId === MANAGER_ID) return MANAGER_NAME;
  return memberById(roster, journalId)?.name ?? "היומן";
}

export function personColor(roster: TeamRoster | null | undefined, journalId: string): PersonColor {
  if (journalId === MANAGER_ID) return "blue";
  return memberById(roster, journalId)?.color ?? "teal";
}

// מזהה יומן: אותיות קטנות וספרות בלבד — בטוח ל-URL ולפרמטר start של טלגרם
export function newJournalId(): string {
  const abc = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

export function isValidJournalId(id: string): boolean {
  return id === MANAGER_ID || /^[a-z0-9]{6,16}$/.test(id);
}

export function normalizeRoster(raw: unknown): TeamRoster {
  const r = raw as Partial<TeamRoster> | null;
  const members = Array.isArray(r?.members) ? r!.members : [];
  return {
    members: members
      .filter((m) => m && typeof m.id === "string" && isValidJournalId(m.id) && m.id !== MANAGER_ID)
      .map((m) => ({
        id: m.id,
        name: String(m.name ?? "").trim() || "אשת צוות",
        color: (m.color && m.color in PERSON_COLORS ? m.color : "teal") as PersonColor,
        role: m.role ? String(m.role) : undefined,
        createdAt: m.createdAt ?? new Date().toISOString(),
      })),
  };
}

import { META, normalizeRoster, type TeamRoster } from "@/lib/journals";

// רשימת הצוות לעמודי שרת (כותרת, manifest) — fetch קצר עם מטמון,
// כדי שעמוד היומן לא יחכה ל-Supabase יותר מרגע.
export async function fetchRosterServer(): Promise<TeamRoster | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url}/rest/v1/journal_meta?key=eq.${META.team}&select=payload`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as { payload: unknown }[];
    return normalizeRoster(rows[0]?.payload);
  } catch {
    return null;
  }
}

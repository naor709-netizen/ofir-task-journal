import { fetchRosterServer } from "@/lib/server/roster-fetch";
import { memberById, isValidJournalId, PERSON_COLORS } from "@/lib/journals";
import { APP_FULL, APP_SHORT, iconUrl } from "@/lib/brand";

// manifest לכל יומן: "הוספה למסך הבית" פותחת את היומן הנכון ולא את של אופיר
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = isValidJournalId(id) ? memberById(await fetchRosterServer(), id) : null;
  const body = {
    // אותו שם אפליקציה לכולם; היומן האישי נפתח לפי הכתובת (start_url)
    name: member ? `${APP_FULL} · ${member.name}` : APP_FULL,
    short_name: APP_SHORT,
    description: "אפליקציית המשימות של אגף הסברה, דוברות ופרסום — לוח שנה, קטגוריות, תזכורות ותצוגות מרובות",
    id: `/j/${id}`,
    start_url: `/j/${id}`,
    scope: "/",
    display: "standalone",
    background_color: "#143E95", // כמו רקע הפתיח — מסך הפתיחה של אנדרואיד ממשיך ישר לסרטון
    theme_color: PERSON_COLORS[member?.color ?? "teal"].solid,
    dir: "rtl",
    lang: "he",
    // מאפשר לכרום לדווח אם היומן הזה כבר מותקן (getInstalledRelatedApps)
    related_applications: [{ platform: "webapp", url: `${new URL(req.url).origin}/j/${id}/manifest` }],
    prefer_related_applications: false,
    // הלוגו של האפליקציה (התמונה) — אותו לוגו לכל היומנים
    icons: [
      { src: iconUrl("icon-192.png"), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: iconUrl("icon-512.png"), sizes: "512x512", type: "image/png", purpose: "any" },
      { src: iconUrl("icon-maskable-192.png"), sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: iconUrl("icon-maskable-512.png"), sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}

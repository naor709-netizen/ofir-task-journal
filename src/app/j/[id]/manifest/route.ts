import { fetchRosterServer } from "@/lib/server/roster-fetch";
import { memberById, isValidJournalId, PERSON_COLORS } from "@/lib/journals";

// manifest לכל יומן: "הוספה למסך הבית" פותחת את היומן הנכון ולא את של אופיר
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = isValidJournalId(id) ? memberById(await fetchRosterServer(), id) : null;
  const name = member ? `היומן של ${member.name}` : "יומן המשימות";
  const body = {
    name,
    short_name: member ? member.name : "היומן",
    description: "יומן משימות אישי — לוח שנה, קטגוריות, תזכורות ותצוגות מרובות",
    id: `/j/${id}`,
    start_url: `/j/${id}`,
    scope: "/",
    display: "standalone",
    background_color: "#F1F4F9",
    theme_color: PERSON_COLORS[member?.color ?? "teal"].solid,
    dir: "rtl",
    lang: "he",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ],
  };
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}

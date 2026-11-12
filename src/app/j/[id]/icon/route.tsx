import { ImageResponse } from "next/og";
import { fetchRosterServer } from "@/lib/server/roster-fetch";
import { memberById, isValidJournalId, PERSON_COLORS } from "@/lib/journals";

// אייקון האפליקציה של כל יומן — בגוון האישי שלו, בלי השם "אופיר" שעל האייקון הראשי.
// מלא עד הקצוות (maskable): מערכת ההפעלה חותכת את הפינות בעצמה.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = isValidJournalId(id) ? memberById(await fetchRosterServer(), id) : null;
  const c = PERSON_COLORS[member?.color ?? "teal"];
  const asked = Number(new URL(req.url).searchParams.get("size"));
  const size = [180, 192, 512].includes(asked) ? asked : 192;
  const disc = Math.round(size * 0.52);
  return new ImageResponse(
    (
      <div style={{
        width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        background: `linear-gradient(140deg, ${c.a}, ${c.b})`,
      }}>
        <div style={{
          width: disc, height: disc, borderRadius: disc, display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(255,255,255,0.2)",
        }}>
          <svg width={disc * 0.66} height={disc * 0.66} viewBox="0 0 24 24" fill="none">
            <path d="M4.5 12.5 9.5 17.5 19.5 7" stroke="#fff" strokeWidth="2.9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=3600" } }
  );
}

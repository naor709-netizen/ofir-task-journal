import type { Metadata, Viewport } from "next";
import JournalApp from "@/components/tasks/JournalApp";
import { fetchRosterServer } from "@/lib/server/roster-fetch";
import { memberById, isValidJournalId } from "@/lib/journals";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const member = isValidJournalId(id) ? memberById(await fetchRosterServer(), id) : null;
  const name = member?.name ?? "היומן שלי";
  return {
    title: member ? `היומן של ${name}` : "יומן המשימות",
    description: "יומן משימות אישי — לוח שנה, קטגוריות, תזכורות, שלבים ותצוגות מרובות",
    manifest: `/j/${id}/manifest`,
    appleWebApp: { capable: true, statusBarStyle: "default", title: member ? `היומן של ${name}` : "היומן שלי" },
  };
}

export const viewport: Viewport = {
  themeColor: "#F1F4F9",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function MemberJournalPage({ params }: Props) {
  const { id } = await params;
  const member = isValidJournalId(id) ? memberById(await fetchRosterServer(), id) : null;
  return <JournalApp journalId={id} initialMember={member} />;
}

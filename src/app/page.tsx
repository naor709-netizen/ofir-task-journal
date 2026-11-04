import JournalApp from "@/components/tasks/JournalApp";
import { MANAGER_ID } from "@/lib/journals";

export default function Page() {
  return <JournalApp journalId={MANAGER_ID} />;
}

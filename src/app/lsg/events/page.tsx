import { EventsWorkspace } from "@/components/dashboard/EventsWorkspace";

export const dynamic = "force-dynamic";

export default function LsgEventsPage() {
  return <EventsWorkspace isUsg={false} />;
}
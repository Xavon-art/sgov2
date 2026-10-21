import { SectionPlanned } from "@/components/dashboard/SectionPlanned";

/**
 * LSG Events and Acts.
 *
 * The unit files an event with proof of approval and watches whether the USG
 * honoured it. The filing screen warns to send a request first. Phase 3.
 */
export default function LsgEventsPage() {
  return (
    <SectionPlanned
      eyebrow="Events and Acts"
      title="Your calendar"
      body="File an event for your unit, attach proof of approval, and follow whether the USG honoured it — plus the org-wide events they have posted."
    />
  );
}

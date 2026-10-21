import { SectionPlanned } from "@/components/dashboard/SectionPlanned";

/**
 * USG Events and Acts.
 *
 * The calendar both sides share: an LSG files an event with proof of approval and
 * the USG honours or declines it with a typed reason; the USG posts its own
 * org-wide or targeted events. Phase 3 of the remodel.
 */
export default function UsgEventsPage() {
  return (
    <SectionPlanned
      eyebrow="Events and Acts"
      title="The calendar"
      body="Every event and act filed across your federation, and the USG's own upcoming events. Honour or decline what your units file, with a reason they can read."
    />
  );
}

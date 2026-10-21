import { SectionPlanned } from "@/components/dashboard/SectionPlanned";

/**
 * LSG Request -- the answering side.
 *
 * Tasks the USG pushed down appear here, each with its thread, deadline, and the
 * requirements to submit. It is also where a unit files a personal request back
 * up to the USG. Phase 2 of the remodel.
 */
export default function LsgRequestPage() {
  return (
    <SectionPlanned
      eyebrow="Request"
      title="What the USG asked for"
      body="Every task assigned to your unit, with its thread, deadline, and requirements — and a way to file your own request back up to the USG."
    />
  );
}

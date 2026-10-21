import { SectionPlanned } from "@/components/dashboard/SectionPlanned";

/**
 * USG Request.
 *
 * The core of the federated system: tasks the USG pushes down to an LSG, each
 * with a messenger-style thread, a deadline, required documents and per-item
 * review; and the personal requests an LSG sends back up. This is Phase 2 of the
 * remodel and this file is replaced in place when it lands.
 */
export default function UsgRequestPage() {
  return (
    <SectionPlanned
      eyebrow="Request"
      title="Tasks and personal requests"
      body="Push a task down to any unit, follow it in a thread, and rule on each requirement they submit. Units also send requests back up through here."
    />
  );
}

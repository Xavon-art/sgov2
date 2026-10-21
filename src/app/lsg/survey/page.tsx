import { SectionPlanned } from "@/components/dashboard/SectionPlanned";

/**
 * LSG Survey.
 *
 * Both sides can build a form, so a unit is not only a respondent here. Phase 4.
 */
export default function LsgSurveyPage() {
  return (
    <SectionPlanned
      eyebrow="Survey"
      title="Answer, and run your own"
      body="Respond to the USG's surveys, or compose one of your own for your unit and share it by link."
    />
  );
}

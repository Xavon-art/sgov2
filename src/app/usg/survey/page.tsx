import { SectionPlanned } from "@/components/dashboard/SectionPlanned";

/**
 * USG Survey.
 *
 * The forms builder both sides can use: questions, share links, access control,
 * live result charts and Excel export. Phase 4 of the remodel.
 */
export default function UsgSurveyPage() {
  return (
    <SectionPlanned
      eyebrow="Survey"
      title="Build a form, read the answers"
      body="Compose a survey, share it by link or to named emails, and watch the responses come in as charts you can export."
    />
  );
}

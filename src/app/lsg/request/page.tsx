import { LsgRequestBudgetPanel } from "@/components/dashboard/LsgRequestBudgetPanel";
import { RequestSection } from "@/components/dashboard/RequestSection";

export const dynamic = "force-dynamic";

export default function LsgRequestPage() {
  return (
    <div className="grid gap-6 xl:grid-cols-[20rem_minmax(0,1fr)]">
      <LsgRequestBudgetPanel />
      <RequestSection isUsg={false} />
    </div>
  );
}

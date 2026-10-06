import { DashboardView } from "@/components/dashboard/DashboardView";

/**
 * What an LSG officer opens on.
 *
 * This used to be its own server page: it called `list_proposals` and rendered a
 * status strip plus a hand-written list of the two statuses an officer can act on.
 * That answer was right in spirit and wrong in coverage -- it counted proposals and
 * nothing else, so a document USG had queried about or a task that had gone overdue
 * did not appear anywhere on the screen an officer calls "Today".
 *
 * It is now the same component the USG desk uses, with the LSG links. The session
 * and the workspace side are still decided in the layout above this page; this file
 * deliberately makes no server call of its own, because the only thing it needs to
 * know is which links exist on this side.
 */
export default function LsgTodayPage() {
  return (
    <DashboardView
      links={{
        proposals: "/lsg/proposals",
        budgets: "/lsg/budgets",
        tasks: "/lsg/tasks",
        // The council's own builder. Which council that is comes from the
        // database's scoped chart, so there is no unit id to name here.
        structure: "/my-council/structure",
      }}
    />
  );
}
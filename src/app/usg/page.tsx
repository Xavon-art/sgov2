import { DashboardView } from "@/components/dashboard/DashboardView";

/**
 * The USG desk.
 *
 * This replaces `OverviewSection`, which counted invitations and told the owner what
 * two things to do next. That was true when the only modules were units and
 * invitations. Now there are proposals, documents, budgets and tasks, and the most
 * useful thing on the screen is no longer how many people you have invited -- it is
 * which of those four are waiting on you.
 *
 * The invitation counters are not lost: they still sit in the nav item they belong
 * to, and `/usg/invitations` is one click away. They were never work, they were
 * admin state.
 *
 * The links are passed in rather than written here. This file and `DashboardView`
 * are shared, and the LSG side has no business holding a `/usg` string; the same
 * arrangement that keeps `lsg-nav.ts` free of USG routes keeps this clean.
 */
export default function UsgDashboardPage() {
  return (
    <DashboardView
      links={{
        proposals: "/usg/proposals",
        budgets: "/usg/budgets",
        tasks: "/usg/tasks",
        // The organization-wide queue. No unit is named in the URL; the database
        // decides which structures this reviewer may see and decide.
        structure: "/usg/structure",
      }}
    />
  );
}
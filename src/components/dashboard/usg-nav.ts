import type { NavItem } from "@/components/dashboard/AppShell";
import type { WorkspaceRole } from "@/lib/auth/workspace";

export function buildUsgNav(input: WorkspaceRole): NavItem[] {
  const where = (input as WorkspaceRole & { unitName?: string }).unitName;
  return [
    {
      id: "overview",
      label: "Overview",
      hint: where ? `${where} · workspace` : "Workspace",
      href: "/usg",
      icon: "dashboard",
    },
  ];
}

import { redirect } from "next/navigation";
import { currentAccount, readSessionToken } from "@/lib/auth/session";
import { fetchStructureForSession, fetchOrgStructureForSession } from "@/lib/structure-server";
import type { StructureReadPayload } from "@/lib/structure";
import { OrgChartEditor } from "@/components/structure/orgchart-editor/OrgChartEditor";

export const dynamic = "force-dynamic";

export default async function StructureEditorPage({
  searchParams,
}: {
  searchParams: Promise<{ unitId?: string; returnTo?: string }>;
}) {
  const params = await searchParams;
  const account = await currentAccount();
  if (!account) redirect("/login");

  const token = await readSessionToken();
  if (!token) redirect("/login");

  const requestedUnitId = params.unitId ?? null;
  let unitId: string | null = requestedUnitId;

  if (!unitId) {
    unitId = account.unitId ?? null;
    if (!unitId) {
      const org = await fetchOrgStructureForSession(token);
      if (org?.unit?.id) unitId = org.unit.id;
    }
  }

  if (!unitId) {
    redirect(
      account.accountKind === "usg" || account.accountScope === "owner"
        ? "/usg/manage?tab=structure"
        : "/lsg/manage?tab=structure",
    );
  }

  let payload: StructureReadPayload | null = null;
  try {
    payload = await fetchStructureForSession(token, unitId);
  } catch {
    payload = null;
  }

  if (!payload?.ok || !payload.unit) {
    redirect(
      account.accountScope === "owner" ? "/usg/manage?tab=structure" : "/lsg/manage?tab=structure",
    );
  }

  const unit = payload.unit;

  return (
    <OrgChartEditor
      unitId={unit.id}
      unitName={unit.name}
      canEdit={Boolean(payload.capability?.canEdit)}
      returnTo={params.returnTo ?? undefined}
    />
  );
}

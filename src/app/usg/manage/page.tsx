import { ManageClient } from "./ManageClient";

type PageProps = {
  searchParams: Promise<{ tab?: string | string[]; q?: string | string[]; view?: string | string[] }>;
};

export default async function UsgManagePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rawTab = params.tab;
  const rawQuery = params.q;
  const rawView = params.view;
  const requestedTab = Array.isArray(rawTab) ? rawTab[0] || undefined : rawTab;
  const initialQuery = Array.isArray(rawQuery) ? rawQuery[0] || "" : rawQuery ?? "";
  const initialView = Array.isArray(rawView) ? rawView[0] || "" : rawView ?? "";

  return <ManageClient requestedTab={requestedTab} initialQuery={initialQuery} initialView={initialView} />;
}

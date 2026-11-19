import { ManageClient } from "./ManageClient";

type PageProps = {
  searchParams: Promise<{ tab?: string | string[] }>;
};

export default async function UsgManagePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rawTab = params.tab;
  const requestedTab = Array.isArray(rawTab) ? rawTab[0] || undefined : rawTab;

  return <ManageClient requestedTab={requestedTab} />;
}

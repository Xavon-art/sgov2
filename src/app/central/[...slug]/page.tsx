import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const ALLOWED_CENTRAL_SECTIONS = new Set([
  "manage",
  "request",
  "personal-requests",
  "account",
  "documents",
  "notifications",
  "help",
  "org-chart",
]);

export default async function CentralCatchAllPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const [section, ...rest] = slug;

  if (section && ALLOWED_CENTRAL_SECTIONS.has(section)) {
    const suffix = rest.length > 0 ? `/${rest.join("/")}` : "";
    const target = `/usg/${section}${suffix}`;
    redirect(target);
  }

  redirect("/usg");
}

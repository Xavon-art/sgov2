import { redirect } from "next/navigation";

export default function LsgResolutionsRedirect() {
  redirect("/lsg/request?tab=resolutions");
}

import { redirect } from "next/navigation";

export default function UsgResolutionsRedirect() {
  redirect("/usg/request?tab=resolutions");
}

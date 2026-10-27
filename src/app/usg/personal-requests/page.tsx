import { redirect } from "next/navigation";

export default function UsgPersonalRequestsRedirect() {
  redirect("/usg/request?tab=personal");
}
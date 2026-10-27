import { redirect } from "next/navigation";

export default function LsgPersonalRequestsRedirect() {
  redirect("/lsg/request?tab=personal");
}
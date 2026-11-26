import { redirect } from "next/navigation";

export default function LsgSurveyRedirect() {
  redirect("/lsg/forms?type=survey");
}
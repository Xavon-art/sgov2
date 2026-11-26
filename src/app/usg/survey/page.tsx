import { redirect } from "next/navigation";

export default function UsgSurveyRedirect() {
  redirect("/usg/forms?type=survey");
}
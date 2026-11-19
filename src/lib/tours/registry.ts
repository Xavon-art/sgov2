import type { PageTour } from "./types";
import publicHomeTour from "./pages/public-home";
import publicLoginTour from "./pages/public-login";
import publicSurveyTour from "./pages/public-survey";
import publicFeedbackTour from "./pages/public-feedback";
import inviteSetupTour from "./pages/invite-setup";
import inviteVerifyTour from "./pages/invite-verify";
import createStartTour from "./pages/create-start";
import createGovernanceModelTour from "./pages/create-governance-model";
import createAccountTour from "./pages/create-account";
import createInstitutionTour from "./pages/create-institution";
import createUnitsTour from "./pages/create-units";
import createReviewTour from "./pages/create-review";
import createVerificationTour from "./pages/create-verification";
import createActivatedTour from "./pages/create-activated";
import usgOverviewTour from "./pages/usg-overview";
import usgStructureTour from "./pages/usg-structure";
import usgOfficersTour from "./pages/usg-officers";
import usgRequestTour from "./pages/usg-request";
import usgMessagesTour from "./pages/usg-messages";
import usgManageTour from "./pages/usg-manage";
import usgEventsTour from "./pages/usg-events";
import usgSettingsTour from "./pages/usg-settings";
import usgSurveysTour from "./pages/usg-surveys";
import usgSurveyDetailTour from "./pages/usg-survey-detail";
import lsgOverviewTour from "./pages/lsg-overview";
import lsgRequestTour from "./pages/lsg-request";
import lsgMessagesTour from "./pages/lsg-messages";
import lsgManageTour from "./pages/lsg-manage";
import lsgEventsTour from "./pages/lsg-events";
import lsgSettingsTour from "./pages/lsg-settings";
import lsgSurveysTour from "./pages/lsg-surveys";
import lsgSurveyDetailTour from "./pages/lsg-survey-detail";
import orgChartTour from "./pages/org-chart";
import myCouncilTour from "./pages/my-council";
import councilStructureTour from "./pages/council-structure";
import devOutboxTour from "./pages/dev-outbox";

export const TOURS: PageTour[] = [
  publicHomeTour,
  publicLoginTour,
  createStartTour,
  createGovernanceModelTour,
  createAccountTour,
  createInstitutionTour,
  createUnitsTour,
  createReviewTour,
  createVerificationTour,
  createActivatedTour,
  usgOverviewTour,
  usgStructureTour,
  usgOfficersTour,
  usgRequestTour,
  usgMessagesTour,
  usgManageTour,
  usgEventsTour,
  usgSettingsTour,
  usgSurveysTour,
  lsgOverviewTour,
  lsgRequestTour,
  lsgMessagesTour,
  lsgManageTour,
  lsgEventsTour,
  lsgSettingsTour,
  lsgSurveysTour,
  orgChartTour,
  myCouncilTour,
  councilStructureTour,
  devOutboxTour,
  inviteVerifyTour,
  inviteSetupTour,
  publicSurveyTour,
  publicFeedbackTour,
  usgSurveyDetailTour,
  lsgSurveyDetailTour,
];

function routeRegex(route: string): RegExp {
  const pattern = route
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${pattern}$`);
}

export function matchTour(pathname: string): PageTour | null {
  const path = pathname.split(/[?#]/, 1)[0];
  for (const tour of TOURS) {
    if (routeRegex(tour.route).test(path)) {
      return tour;
    }
  }
  return null;
}

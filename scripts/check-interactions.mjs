import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = (p) => readFileSync(path.join(root, p), "utf8");
const between = (text, start, end) => {
  const a = text.indexOf(start);
  const b = a < 0 ? -1 : text.indexOf(end, a);
  return a < 0 || b < 0 ? "" : text.slice(a, b);
};
const count = (text, needle) => text.split(needle).length - 1;

let passed = 0;
let total = 0;
function check(label, ok, detail = "") {
  total += 1;
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

const signOut = src("src/components/dashboard/SignOutButton.tsx");
check(
  "sign-out checks the logout response before redirecting",
  signOut.includes('const res = await fetch("/api/auth/logout", { method: "POST" });') &&
    signOut.includes("if (res.ok) {") &&
    signOut.includes("setError("),
);
check(
  "sign-out surfaces a failed logout",
  signOut.includes("We could not sign out. Please try again.") && signOut.includes('role="alert"'),
);

const appShell = src("src/components/dashboard/AppShell.tsx");
const markRead = between(appShell, "async function markRead", "// Whether the drawer owns the screen");
check(
  "marking one notification read checks the response",
  markRead.includes("const res = await fetch(") &&
    markRead.includes("const data = await res.json();") &&
    markRead.includes("if (!res.ok || !data.ok) return;"),
);
const markAll = between(appShell, 'onClick={async () => {', "Mark all read");
check(
  "marking all notifications read checks the response",
  markAll.includes('await fetch("/api/notifications/read-all", { method: "POST" });') &&
    markAll.includes("if (!res.ok || !data.ok) return;"),
);
check(
  "notification links never hard-navigate the authenticated app",
  appShell.includes('window.open(n.link, "_blank", "noopener,noreferrer")') &&
    !appShell.includes("window.location.href = n.link"),
);

const survey = src("src/components/dashboard/SurveyDetailEditor.tsx");
const moveQuestion = between(survey, "const moveQuestion = async", "const startEdit =");
check(
  "question reorder checks both writes and reloads only on success",
  moveQuestion.includes("const aRes = await fetch(") &&
    moveQuestion.includes("const bRes = await fetch(") &&
    moveQuestion.includes("const aData = await aRes.json();") &&
    moveQuestion.includes("const bData = await bRes.json();") &&
    moveQuestion.includes("if (!aRes.ok || !aData.ok || !bRes.ok || !bData.ok) {") &&
    moveQuestion.includes("await load();"),
);

const orgChart = src("src/components/structure/OrgChartDragDrop.tsx");
check(
  "org-chart photo upload uses one file input per node",
  !orgChart.includes("const fileRef = useRef<HTMLInputElement>(null);") &&
    orgChart.includes("useRef<Record<string, HTMLInputElement | null>>({})") &&
    orgChart.includes("fileRefs.current[node.id] = el") &&
    orgChart.includes("fileRefs.current[node.id]?.click()"),
);

const structureLib = src("src/lib/structure.ts");
check(
  "structure helper rejects non-OK HTTP responses",
  structureLib.includes("if (!res.ok) throw new Error("),
);

const requests = src("src/components/dashboard/RequestSection.tsx");
check(
  "request mutations go through a response-checking helper",
  requests.includes("async function mutate(") &&
    requests.includes("if (!res.ok || json.ok !== true) {") &&
    count(requests, "await mutate(") >= 10,
  `found ${count(requests, "await mutate(")} checked mutations`,
);
check(
  "request failures are visible to the user",
  requests.includes("actionError") && requests.includes('role="alert"'),
);

const events = src("src/components/dashboard/EventsWorkspace.tsx");
const cancel = between(events, "const cancel = async", "// calendar grouping");
check(
  "event cancellation is guarded against duplicate submits",
  cancel.includes("if (saving) return;") &&
    cancel.includes("setSaving(true)") &&
    cancel.includes("setSaving(false)"),
);

const surveys = src("src/components/dashboard/SurveysListPage.tsx");
const duplicate = between(surveys, "const duplicate = async", "if (isUsg &&");
check(
  "survey duplication checks every question copy",
  duplicate.includes("const qRes = await fetch(") &&
    duplicate.includes("const qData = await qRes.json();") &&
    duplicate.includes("if (!qRes.ok || !qData.ok) throw new Error("),
);

const structureWorkspace = src("src/components/structure/StructureWorkspace.tsx");
const persist = between(structureWorkspace, "async function persist", "async function onRenew");
const renew = between(structureWorkspace, "async function onRenew", "async function onSubmit");
const submit = between(structureWorkspace, "async function onSubmit", "if (!capability.canRead)");
const saveTemplate = between(structureWorkspace, "onSaveCurrent={async () =>", "        />");
check(
  "structure save, renew, submit, and template save catch server failures",
  [persist, renew, submit, saveTemplate].every((block) => block.includes("catch (e)")),
);

const reviewQueue = src("src/components/structure/ReviewQueue.tsx");
const decide = between(reviewQueue, "async function onDecide", "const pending =");
check(
  "structure review decisions catch server failures",
  decide.includes("catch (e)") && decide.includes('kind: "error"'),
);

const umbrella = src("src/components/dashboard/UmbrellaSection.tsx");
const umbrellaSubmit = between(umbrella, "async function submit", "if (loading)");
check(
  "umbrella pause actions check HTTP status and catch network failures",
  umbrellaSubmit.includes("if (!res.ok || !body.ok)") &&
    umbrellaSubmit.includes("setNote({ kind: \"error\"") &&
    umbrellaSubmit.includes("} catch {"),
);

const profile = src("src/components/dashboard/ProfileSection.tsx");
const profilePost = between(profile, "async function post", "async function saveName");
const saveName = between(profile, "async function saveName", "async function saveEmail");
const saveEmail = between(profile, "async function saveEmail", "async function savePassword");
const savePassword = between(profile, "async function savePassword", "async function saveLook");
const saveLook = between(profile, "async function saveLook", "const showCustomisation");
check(
  "profile helper checks HTTP status and every profile action catches failures",
  profilePost.includes("res.ok && json.ok === true") &&
    [saveName, saveEmail, savePassword, saveLook].every((block) => block.includes("catch {")),
);

const messages = src("src/components/dashboard/MessagesPanel.tsx");
check(
  "message read polling cannot produce an unhandled rejection",
  messages.includes('void fetch(`/api/conversations/${convId}/read`, { method: "POST" }).catch(() => {})'),
);
check(
  "message unsend and conversation delete are guarded against duplicate submits",
  messages.includes("const [busyId, setBusyId]") &&
    messages.includes("if (!selectedId || busyId) return;") &&
    messages.includes("if (busyId) return;") &&
    messages.includes("disabled={busyId === selected.id}") &&
    messages.includes("disabled={busyId === m.id}"),
);

const orgControls = src("src/components/org-chart/OrgChartControls.tsx");
const addPosition = between(orgControls, "async function onSubmit", "return (\n    <section");
const unitToggle = between(orgControls, "async function toggle(position", "if (positions.length === 0)");
const seatInvite = between(orgControls, "async function onInvite", "async function onAssign");
const seatAssign = between(orgControls, "async function onAssign", "async function onRelease");
const seatRelease = between(orgControls, "async function onRelease", "return (\n    <li");
const orgChartPage = src("src/app/org-chart/page.tsx");
check(
  "position template creation checks the API and refreshes the chart",
  addPosition.includes("if (!res.ok || !data.ok)") &&
    addPosition.includes("router.refresh()") &&
    addPosition.includes("} catch {"),
);
check(
  "unit seat toggles guard concurrency and roll back optimistic state on failure",
  unitToggle.includes("if (inFlight) return;") &&
    unitToggle.includes("if (!res.ok || !data.ok)") &&
    unitToggle.includes("drop(position.id)") &&
    unitToggle.includes("router.refresh()"),
);
check(
  "seat invite, assign, and release check responses and guard duplicate submits",
  [seatInvite, seatAssign, seatRelease].every(
    (block) =>
      (block.includes("if (busy)") || block.includes("if (busy ||")) &&
      block.includes("if (!res.ok || !data.ok)") &&
      block.includes("showError(") &&
      block.includes("router.refresh()") &&
      block.includes("} catch {"),
  ),
);
check(
  "unit-scoped chart callers are redirected away from the owner chart",
  orgChartPage.includes('if (chart.scope === "unit") redirect("/my-council");'),
);

const usgNav = src("src/components/dashboard/usg-nav.ts");
const usgNavChildren = between(usgNav, "const manageChildren = [", "];");
check(
  "USG nav gives document tabs to the server-resolved reviewer side",
  usgNav.includes('const canReviewDocuments = role.side === "usg";') &&
    usgNavChildren.includes('{ label: "Documents", href: "/usg/manage?tab=documents" }') &&
    usgNavChildren.includes('{ label: "Search", href: "/usg/manage?tab=search" }') &&
    usgNav.includes("canReviewDocuments && (index === 4 || index === 5)"),
);
check(
  "USG nav keeps owner-only children owner-only",
  usgNavChildren.indexOf('label: "Your Umbrella"') <
    usgNavChildren.indexOf('label: "Profile and Customization"') &&
    usgNavChildren.indexOf('label: "Profile and Customization"') <
      usgNavChildren.indexOf('label: "Documents"') &&
    usgNavChildren.indexOf('label: "Documents"') <
      usgNavChildren.indexOf('label: "Search"') &&
    usgNav.includes("canManage || index === 3"),
);

const usgManage = src("src/app/usg/manage/ManageClient.tsx");
check(
  "USG manage derives document access from the server-resolved workspace role",
  usgManage.includes('const { account, role } = useDashboard();') &&
    usgManage.includes('const canReviewDocuments = role.side === "usg";') &&
    usgManage.includes('{ id: "documents", label: "Documents", access: "reviewer"') &&
    usgManage.includes('{ id: "search", label: "Search", access: "reviewer"') &&
    usgManage.includes('tab === "documents" && canReviewDocuments') &&
    usgManage.includes('tab === "search" && canReviewDocuments'),
);
check(
  "USG manage keeps umbrella, invites, and structure owner-only",
  ['umbrella', 'invites', 'structure'].every((id) =>
    usgManage.includes(`{ id: "${id}", label:`),
  ) &&
    usgManage.includes('access: "owner"') &&
    usgManage.includes('t.access === "owner" ? canManage : canReviewDocuments'),
);

const documentLibrary = src("src/components/dashboard/DocumentLibraryPanel.tsx");
check(
  "document approve controls are driven by the server canApprove flag",
  documentLibrary.includes("setCanApprove(json.canApprove === true);") &&
    documentLibrary.includes("{canApprove && (") &&
    documentLibrary.includes("Approve") &&
    documentLibrary.includes("Reject"),
);

const documentsApi = src("src/app/api/documents/route.ts");
check(
  "document review permission is computed per row from the server authority flag",
  documentsApi.includes("canApprove: reviewer && row.sourceKind === \"requirement_submission\"") &&
    documentLibrary.includes("const canApprove = catalogCanApprove && row.canApprove === true;"),
);

const profileApi = src("src/app/api/profile/route.ts");
check(
  "profile logo uses an explicit tri-state instead of treating absence as a clear",
  profileApi.includes("p_logo_data: \"logoData\" in body ? body.logoData ?? \"\" : undefined,") &&
    profile.includes("logoData?: string | null;") &&
    saveLook.includes("if (logoData !== undefined) payload.logoData = logoData;") &&
    profile.includes("setLogoData(\"\")"),
);

const photoQuery = src("src/app/api/structures/photos/route.ts");
const photoRoster = src("src/app/api/structures/photos/[rosterId]/route.ts");
check(
  "structure photo reads use the persisted DB photo and distinguish misses from failures",
  structureLib.includes("fetchHolderPhoto(unitId: string, email: string)") &&
    structureLib.includes("payload.reason === \"not_found\"") &&
    structureWorkspace.includes("fetchHolderPhoto(unitId, email)") &&
    photoQuery.includes("reason: \"invalid_uuid\"") &&
    photoQuery.includes("reason: \"not_found\"") &&
    photoRoster.includes("reason: \"forbidden\"") &&
    photoRoster.includes("reason: \"not_found\"") &&
    photoRoster.includes("status: 403") &&
    photoRoster.includes("status: 404"),
);

const claimApi = src("src/app/api/events/[id]/claim/route.ts");
check(
  "event claim note uses the canonical field and is validated before persisting",
  events.includes("body: JSON.stringify({ claimNote: claimNoteInput })") &&
    !events.includes("body: JSON.stringify({ note: claimNoteInput })") &&
    events.includes("Claim note (required)") &&
    events.includes("Enter a claim note before claiming.") &&
    claimApi.includes("body.claimNote ?? body.note") &&
    claimApi.includes("if (!claimNote) {") &&
    claimApi.includes("p_claim_note: claimNote"),
);

check(
  "extension requests use a server-derived unit instead of a client-selected unit",
  requests.includes("const { role } = useDashboard();") &&
    requests.includes("const ownUnitId = role.unitId;") &&
    requests.includes("ownUnitId={ownUnitId}") &&
    requests.includes("unitId: resolvedTargetUnitId") &&
    !requests.includes("myUnitIds[0]") &&
    requests.includes("Target unit") &&
    requests.includes("Own unit"),
);
check(
  "replacement characters are not left in request UI strings",
  !requests.includes("\uFFFD"),
);

check(
  "survey links name the public respondent path and the internal detail path",
  survey.includes("Public respondent link:") &&
    surveys.includes("Open internal survey detail"),
);

console.log(`\n${passed}/${total} interaction checks passed.`);
if (passed !== total) process.exitCode = 1;

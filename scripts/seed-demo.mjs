// Seeds the demo university through the same SECURITY DEFINER functions the
// app calls, so every row is written by a real code path (bcrypt via
// smartgov.hash_password, invites, seats, positions) instead of hand-built SQL.
//
//   node scripts/seed-demo.mjs            # reseed only the demo organization
//   node scripts/seed-demo.mjs --purge    # also remove every other organization
//
// Safe to re-run: the demo organization and its accounts are deleted first, so
// the second run produces the same set of rows rather than duplicates. Accounts
// outside the demo organization are untouched unless --purge is passed.

import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import pg from "pg";

const ROOT = resolve(import.meta.dirname, "..");
const CREDENTIALS =
  "C:\\Users\\Julius M. Matro\\Desktop\\sir tonie projects\\credentials\\smartgov-test-accounts.txt";

function loadEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = { ...loadEnv(resolve(ROOT, ".env")), ...loadEnv(resolve(ROOT, ".env.local")) };
const url = env.POSTGRES_URL || env.DATABASE_URL;
if (!url) {
  console.error("No POSTGRES_URL or DATABASE_URL in .env.local");
  process.exit(1);
}

const purgeLegacy = process.argv.includes("--purge");
const PASSWORD = "SmartGov!2026";
const EMAIL_DOMAIN = "demo.smartgov.test";
const ORG_SLUG = "demo-university";
const ACADEMIC_YEAR = "2026-2027";

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  max: 1,
  connectionTimeoutMillis: 20000,
});

const sql = (text, params = []) => client.query(text, params);

// node-postgres sends every parameter as `unknown`, and Postgres will not
// resolve an overloaded SECURITY DEFINER function from that. The casts below
// mirror the deployed signatures exactly and are the only reason this helper
// needs the function name at all.
const CASTS = {
  "public.create_organization": ["jsonb"],
  "smartgov.create_owner_account": ["jsonb"],
  "smartgov.activate_owner": ["text"],
  "smartgov.add_position": ["text", "text", "smallint"],
  "smartgov.create_invite": ["text", "text", "text", "text", "uuid", "uuid"],
  "smartgov.accept_invite": ["text", "text"],
  "smartgov.create_notification": ["text", "uuid", "text", "text", "text", "text"],
  "smartgov.login_account": ["text", "text"],
  "smartgov.create_program": ["text", "text", "text", "text", "jsonb"],
  "smartgov.create_proposal": [
    "text", "uuid", "text", "text", "text", "date", "text", "uuid", "jsonb", "text",
  ],
  "smartgov.submit_budget": ["text", "uuid", "text", "text", "jsonb"],
  "smartgov.create_task_v2": [
    "text", "text", "text", "date", "time", "text", "text", "boolean", "jsonb", "jsonb",
  ],
  "smartgov.create_event_v2": [
    "text", "text", "text", "date", "time", "text", "text", "text",
    "uuid[]", "text[]", "jsonb", "uuid", "text",
  ],
  "smartgov.create_survey": [
    "text", "text", "text", "text", "text[]", "integer", "timestamptz",
  ],
  "smartgov.add_survey_question": [
    "text", "uuid", "text", "text", "text", "boolean", "jsonb",
    "integer", "integer", "text", "text", "integer", "jsonb",
  ],
  "smartgov.publish_survey": ["text", "uuid"],
  "smartgov.submit_survey_response": ["text", "uuid", "text", "jsonb", "text"],
  "smartgov.file_personal_request": [
    "text", "uuid", "text", "text", "text", "date", "time", "text",
    "text", "text", "text", "text", "bigint",
  ],
  "smartgov.decide_personal_request": ["text", "uuid", "text", "text"],
  "smartgov.create_conversation": ["text", "uuid[]", "text"],
  "smartgov.send_message": ["text", "uuid", "text"],
  "smartgov.save_structure_draft": [
    "text", "uuid", "text", "text", "date", "date", "jsonb", "text",
  ],
  "smartgov.submit_structure": ["text", "uuid", "text"],
  "smartgov.list_dashboard": ["text"],
  "smartgov.update_customisation": ["text", "text", "text", "text"],
};

const call = async (fn, args = []) => {
  const casts = CASTS[fn];
  if (!casts || casts.length !== args.length) {
    throw new Error(`no cast map for ${fn}(${args.length} args)`);
  }
  const placeholders = args
    .map((_, i) => `$${i + 1}::${casts[i]}`)
    .join(", ");
  const { rows } = await sql(`select ${fn}(${placeholders}) as result`, args);
  return rows[0].result;
};

function expect(result, what) {
  if (!result || result.ok !== true) {
    throw new Error(`${what} failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function log(step, detail = "") {
  console.log(`[seed] ${step}${detail ? ` - ${detail}` : ""}`);
}

const TABLES = [
  "smartgov.account_permissions",
  "smartgov.accounts",
  "smartgov.audit_log",
  "smartgov.budget_items",
  "smartgov.budget_requests",
  "smartgov.conversation_participants",
  "smartgov.conversations",
  "smartgov.document_uploads",
  "smartgov.email_queue",
  "smartgov.event_files",
  "smartgov.event_scopes",
  "smartgov.events",
  "smartgov.gov_structure_reviews",
  "smartgov.gov_structures",
  "smartgov.invites",
  "smartgov.item_submissions",
  "smartgov.messages",
  "smartgov.notifications",
  "smartgov.org_positions",
  "smartgov.outbox",
  "smartgov.password_resets",
  "smartgov.personal_requests",
  "smartgov.programs",
  "smartgov.proposal_requirements",
  "smartgov.proposal_versions",
  "smartgov.proposals",
  "smartgov.rate_limits",
  "smartgov.requirement_items",
  "smartgov.reviews",
  "smartgov.roster",
  "smartgov.sessions",
  "smartgov.submission_verifications",
  "smartgov.survey_access_otps",
  "smartgov.survey_questions",
  "smartgov.survey_responses",
  "smartgov.surveys",
  "smartgov.task_assignments",
  "smartgov.task_extensions",
  "smartgov.task_message_reactions",
  "smartgov.task_messages",
  "smartgov.task_requirement_answer_versions",
  "smartgov.task_requirement_reviews",
  "smartgov.task_requirement_submissions",
  "smartgov.task_requirements",
  "smartgov.tasks",
  "smartgov.unit_memberships",
  "smartgov.unit_positions",
  "public.governance_units",
  "public.organization_members",
  "public.organizations",
];

async function purgeAll() {
  log("purging all organization data (kept applied_migrations + builtin templates)");
  // `truncate ... cascade` also empties any table that references the listed
  // ones, and gov_structure_templates references public.organizations. Snapshot
  // the built-in blueprints first so the product's template gallery survives.
  const { rows: builtins } = await sql(
    `select key, name, description, category, document, is_builtin
       from smartgov.gov_structure_templates
      where organization_id is null and is_builtin`,
  );
  await sql(`truncate table ${TABLES.join(", ")} cascade`);
  await sql(
    `delete from smartgov.gov_structure_templates where organization_id is not null`,
  );
  if (builtins.length > 0) {
    const values = builtins
      .map(
        (_, i) =>
          `($${i * 6 + 1}, $${i * 6 + 2}, $${i * 6 + 3}, $${i * 6 + 4}, $${i * 6 + 5}::jsonb, $${i * 6 + 6})`,
      )
      .join(", ");
    await sql(
      `insert into smartgov.gov_structure_templates
         (key, name, description, category, document, is_builtin)
       values ${values}`,
      builtins.flatMap((row) => [
        row.key,
        row.name,
        row.description,
        row.category,
        row.document,
        row.is_builtin,
      ]),
    );
    log("structure templates", `${builtins.length} built-in blueprints restored`);
  }
}

async function demoSessions() {
  const { rows } = await sql(`select id, slug from public.organizations order by slug`);
  if (rows.length === 0) return;
  if (rows.length > 1 || rows[0].slug !== ORG_SLUG) {
    throw new Error(
      `Refusing to reset: found ${rows.length} organization(s) (${rows
        .map((o) => o.slug)
        .join(", ")}). Re-run with --purge only on a demo database.`,
    );
  }
  // Authored rows (programs, proposals, ...) reference accounts without a
  // cascade, so deleting the accounts first fails. The demo database holds a
  // single organization, so the safe reset is the same truncate used by
  // --purge; anything else is refused above.
  await purgeAll();
}

async function main() {
  await client.connect();

  if (purgeLegacy) {
    await purgeAll();
  } else {
    await demoSessions();
  }

  // ---------------------------------------------------------------- organization
  const org = await call("public.create_organization", [
    JSON.stringify({
      organizationName: "Demo University",
      slug: ORG_SLUG,
      description:
        "Federated student government demo: one university student government and five local student councils.",
      governanceModel: "federated",
      academicYear: ACADEMIC_YEAR,
      universityName: "Demo University",
      campusName: "Main Campus",
      college: "Office of Student Affairs",
      charterNumber: "DEMO-USG-2026-001",
      accent: "#16324f",
      officerName: "Demo University Founder",
      officerEmail: `owner@${EMAIL_DOMAIN}`,
      officerRole: "usg_officer",
      units: [
        { name: "College of Engineering", type: "college" },
        { name: "College of Education", type: "college" },
        { name: "College of Business Administration", type: "college" },
        { name: "College of Nursing", type: "college" },
        { name: "College of Arts and Sciences", type: "college" },
      ],
    }),
  ]);
  if (!org?.organizationId) {
    throw new Error(`create_organization failed: ${JSON.stringify(org)}`);
  }
  const orgId = org.organizationId;
  log("organization", `${org.slug} - ${org.unitCount} units - charter ${org.charterNumber}`);

  const { rows: units } = await sql(
    `select id, name, unit_type, parent_id
       from public.governance_units
      where organization_id = $1
      order by parent_id nulls first, name`,
    [orgId],
  );
  const usg = units.find((u) => u.unit_type === "usg");
  const colleges = units.filter((u) => u.parent_id === usg.id);
  const college = (name) => {
    const match = colleges.find((u) => u.name === name);
    if (!match) throw new Error(`missing unit ${name}`);
    return match.id;
  };

  // ---------------------------------------------------------------- owner
  const createdOwner = expect(
    await call("smartgov.create_owner_account", [
      JSON.stringify({
        email: `owner@${EMAIL_DOMAIN}`,
        password: PASSWORD,
        displayName: "Demo University Founder",
        accountKind: "usg",
        organizationId: orgId,
        universityName: "Demo University",
        campusName: "Main Campus",
      }),
    ]),
    "create_owner_account",
  );
  const activated = expect(
    await call("smartgov.activate_owner", [createdOwner.verifyToken]),
    "activate_owner",
  );
  const ownerToken = activated.token;
  log("owner account", `owner@${EMAIL_DOMAIN} (active)`);

  // ---------------------------------------------------------------- positions
  const POSITION_LABELS = [
    "President",
    "Vice President",
    "Secretary",
    "Treasurer",
    "Auditor",
    "Public Relations Officer",
  ];
  const positions = {};
  for (let i = 0; i < POSITION_LABELS.length; i += 1) {
    const label = POSITION_LABELS[i];
    positions[label] = expect(
      await call("smartgov.add_position", [ownerToken, label, i + 1]),
      `add_position(${label})`,
    ).positionId;
  }
  log("positions", POSITION_LABELS.join(", "));

  // ---------------------------------------------------------------- people
  const accounts = [];
  const rosterIds = new Map();

  async function invite({ email, name, unitId = null, positionLabel = null }) {
    const positionId = positionLabel ? positions[positionLabel] : null;
    const invite = expect(
      await call("smartgov.create_invite", [
        ownerToken,
        email,
        "",
        "lsg",
        unitId,
        positionId,
      ]),
      `create_invite(${email})`,
    );
    const accepted = expect(
      await call("smartgov.accept_invite", [invite.token, PASSWORD]),
      `accept_invite(${email})`,
    );
    expect(
      await call("smartgov.create_notification", [
        ownerToken,
        accepted.accountId,
        "welcome",
        "Welcome to the demo student government",
        "Your demo seat is ready. This notification exists so the bell has content.",
        "/usg",
      ]),
      `welcome notification(${email})`,
    );
    await sql(
      `update smartgov.accounts
          set status = 'active', activated_at = now(), display_name = $2
        where id = $1`,
      [accepted.accountId, name],
    );
    if (invite.rosterId) {
      await sql(`update smartgov.roster set full_name = $2 where id = $1`, [
        invite.rosterId,
        name,
      ]);
      rosterIds.set(email, invite.rosterId);
    }
    accounts.push({
      email,
      name,
      accountId: accepted.accountId,
      unitId,
      positionLabel,
    });
    return accepted.accountId;
  }

  const usgPeople = [
    ["juan.president", "Juan Dela Cruz", "President"],
    ["maria.vicepresident", "Maria Santos", "Vice President"],
    ["ana.secretary", "Ana Reyes", "Secretary"],
    ["miguel.treasurer", "Miguel Bautista", "Treasurer"],
    ["rosa.auditor", "Rosa Villanueva", "Auditor"],
  ];
  for (const [handle, name, seat] of usgPeople) {
    await invite({ email: `${handle}@${EMAIL_DOMAIN}`, name, unitId: usg.id, positionLabel: seat });
  }

  const lsgPeople = [
    ["pedro.engineering", "Pedro Aquino", "College of Engineering", "President"],
    ["liza.engineering", "Liza Fernandez", "College of Engineering", "Secretary"],
    ["carlo.education", "Carlo Mendoza", "College of Education", "President"],
    ["grace.education", "Grace Torres", "College of Education", "Treasurer"],
    ["nicole.business", "Nicole Ramos", "College of Business Administration", "President"],
    ["rafael.nursing", "Rafael Castillo", "College of Nursing", "President"],
    ["sofia.arts", "Sofia Navarro", "College of Arts and Sciences", "President"],
  ];
  for (const [handle, name, unitName, seat] of lsgPeople) {
    await invite({
      email: `${handle}@${EMAIL_DOMAIN}`,
      name,
      unitId: college(unitName),
      positionLabel: seat,
    });
  }

  await invite({
    email: `member@${EMAIL_DOMAIN}`,
    name: "Bea Ordinary Member",
    unitId: college("College of Engineering"),
  });
  log("accounts", `${accounts.length + 1} total (1 owner, ${accounts.length} invited)`);

  const login = async (email) => {
    const result = expect(
      await call("smartgov.login_account", [email, PASSWORD]),
      `login_account(${email})`,
    );
    return result.token;
  };
  const engToken = await login(`pedro.engineering@${EMAIL_DOMAIN}`);
  const eduToken = await login(`carlo.education@${EMAIL_DOMAIN}`);
  const memberToken = await login(`member@${EMAIL_DOMAIN}`);
  const accountId = (email) => accounts.find((a) => a.email === email).accountId;

  const future = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  // ---------------------------------------------------------------- programs
  const program = expect(
    await call("smartgov.create_program", [
      ownerToken,
      "Student Activity Fund 2026",
      "Requirements for activities funded by the university student government.",
      "academic",
      JSON.stringify([
        { label: "Activity proposal link", item_kind: "link", position: 0 },
        { label: "Line-item budget link", item_kind: "link", position: 1 },
      ]),
    ]),
    "create_program",
  );
  const { rows: requirementItems } = await sql(
    `select id, label from smartgov.requirement_items where program_id = $1 order by position`,
    [program.programId],
  );
  const requirementLink = (label) => requirementItems.find((i) => i.label === label).id;
  log("program", program.name);

  // ---------------------------------------------------------------- proposals
  expect(
    await call("smartgov.create_proposal", [
      ownerToken,
      program.programId,
      "University Research and Innovation Congress 2027",
      "A two-day university-wide congress showcasing student research from every college.",
      "academic",
      future(45),
      "Demo University Convention Hall",
      null,
      JSON.stringify([
        {
          requirement_item_id: requirementLink("Activity proposal link"),
          kind: "link",
          linkUrl: "https://example.org/demo/research-congress-proposal",
        },
        {
          requirement_item_id: requirementLink("Line-item budget link"),
          kind: "link",
          linkUrl: "https://example.org/demo/research-congress-budget",
        },
      ]),
      "Published by the university student government.",
    ]),
    "create_proposal(owner)",
  );

  const engProposal = expect(
    await call("smartgov.create_proposal", [
      engToken,
      program.programId,
      "Engineering Week 2027",
      "A college-wide engineering week with competitions, talks, and an open lab.",
      "academic",
      future(30),
      "Engineering Building Atrium",
      college("College of Engineering"),
      JSON.stringify([
        {
          requirement_item_id: requirementLink("Activity proposal link"),
          kind: "link",
          linkUrl: "https://example.org/demo/engineering-week-proposal",
        },
        {
          requirement_item_id: requirementLink("Line-item budget link"),
          kind: "link",
          linkUrl: "https://example.org/demo/engineering-week-budget",
        },
      ]),
      "Submitted by the College of Engineering student council.",
    ]),
    "create_proposal(engineering)",
  );
  log("proposals", "1 published (USG), 1 submitted (Engineering LSG)");

  // ---------------------------------------------------------------- budgets
  const budget = expect(
    await call("smartgov.submit_budget", [
      engToken,
      engProposal.proposalId,
      "Engineering Week 2027 operating budget",
      "Venue, materials, prizes, and refreshments for the college engineering week.",
      JSON.stringify([
        { label: "Venue and equipment rental", quantity: "1", unit_cost: "12000.00" },
        { label: "Competition prizes", quantity: "6", unit_cost: "1500.00" },
        { label: "Materials and printing", quantity: "1", unit_cost: "4500.00" },
        { label: "Refreshments", quantity: "150", unit_cost: "80.00" },
      ]),
    ]),
    "submit_budget",
  );
  log("budget", `Engineering Week total ${budget.requestedTotal}`);

  // ---------------------------------------------------------------- tasks
  const lsgUnitIds = colleges.map((c) => c.id);
  const taskTitles = [
    ["Submit first-semester activity reports", "Every council files its first-semester activity report.", 14, "high"],
    ["Update officer roster for second semester", "Confirm every seat in the council chart is current.", 21, "normal"],
    ["Prepare student concerns summary", "Collect the top three student concerns from each college.", 10, "low"],
  ];
  for (const [title, details, days, priority] of taskTitles) {
    expect(
      await call("smartgov.create_task_v2", [
        ownerToken,
        title,
        details,
        future(days),
        null,
        "Asia/Manila",
        priority,
        false,
        JSON.stringify(lsgUnitIds),
        JSON.stringify([]),
      ]),
      `create_task_v2(${title})`,
    );
  }
  log("tasks", `${taskTitles.length} assigned to all five councils`);

  // ---------------------------------------------------------------- events
  expect(
    await call("smartgov.create_event_v2", [
      ownerToken,
      "University General Assembly",
      "Opening assembly for the second semester with all colleges.",
      future(12),
      "09:00",
      "Asia/Manila",
      "Demo University Gymnasium",
      "university",
      [],
      [],
      JSON.stringify([]),
      null,
      null,
    ]),
    "create_event_v2(USG)",
  );
  expect(
    await call("smartgov.create_event_v2", [
      engToken,
      "Engineering Open Lab Night",
      "An evening showcase of student engineering projects.",
      future(18),
      "18:00",
      "Asia/Manila",
      "Engineering Building Atrium",
      "unit",
      [college("College of Engineering")],
      [],
      JSON.stringify([]),
      null,
      null,
    ]),
    "create_event_v2(LSG)",
  );
  log("events", "1 university event, 1 council event claim pending review");

  // ---------------------------------------------------------------- survey
  const survey = expect(
    await call("smartgov.create_survey", [
      ownerToken,
      "Second Semester Student Pulse Survey",
      "Short pulse check on services, facilities, and communication.",
      "authenticated",
      [],
      null,
      null,
    ]),
    "create_survey",
  );
  const questions = [
    ["multiple_choice", "Which service needs the most improvement?", ["Library", "Laboratory", "Canteen", "Student affairs"], 0],
    ["linear_scale", "How satisfied are you with student government communication?", null, 1],
    ["long_text", "What is one change you want this semester?", null, 2],
  ];
  const questionIds = [];
  for (const [qtype, title, options, index] of questions) {
    const added = expect(
      await call("smartgov.add_survey_question", [
        ownerToken,
        survey.surveyId,
        qtype,
        title,
        "",
        true,
        options ? JSON.stringify(options.map((label) => ({ label }))) : JSON.stringify([]),
        1,
        5,
        "Not satisfied",
        "Very satisfied",
        index,
        null,
      ]),
      `add_survey_question(${title})`,
    );
    questionIds.push(added.questionId ?? added.id);
  }
  expect(
    await call("smartgov.publish_survey", [ownerToken, survey.surveyId]),
    "publish_survey",
  );
  expect(
    await call("smartgov.submit_survey_response", [
      engToken,
      survey.surveyId,
      null,
      JSON.stringify({
        [questionIds[0]]: "Laboratory",
        [questionIds[1]]: 4,
        [questionIds[2]]: "Longer laboratory hours during finals week.",
      }),
      null,
    ]),
    "submit_survey_response",
  );
  log("survey", "published with 3 questions and 1 response");

  const lsgSurvey = expect(
    await call("smartgov.create_survey", [
      engToken,
      "Engineering Council Feedback",
      "A short pulse check the council runs for its own constituents.",
      "authenticated",
      [],
      null,
      null,
    ]),
    "create_survey(LSG)",
  );
  const lsgQuestion = expect(
    await call("smartgov.add_survey_question", [
      engToken,
      lsgSurvey.surveyId,
      "long_text",
      "What should the council prioritise next term?",
      "",
      true,
      JSON.stringify([]),
      1,
      5,
      "Not satisfied",
      "Very satisfied",
      0,
      null,
    ]),
    "add_survey_question(LSG)",
  );
  expect(
    await call("smartgov.publish_survey", [engToken, lsgSurvey.surveyId]),
    "publish_survey(LSG)",
  );
  expect(
    await call("smartgov.submit_survey_response", [
      memberToken,
      lsgSurvey.surveyId,
      null,
      JSON.stringify({
        [lsgQuestion.questionId ?? lsgQuestion.id]: "More study spaces and later library hours.",
      }),
      null,
    ]),
    "submit_survey_response(member)",
  );
  log("survey", "2 published, 2 responses across the USG and the Engineering council");

  // ---------------------------------------------------------------- personal requests
  const requestA = expect(
    await call("smartgov.file_personal_request", [
      engToken,
      college("College of Engineering"),
      "Request to use the engineering laboratory on a Saturday",
      "The council needs the laboratory for a student project build session. We will provide our own advisers and restore the room afterwards.",
      "Additional laboratory access for student projects",
      future(7),
      "09:00",
      "Asia/Manila",
      "https://example.org/demo/lab-request",
      null,
      null,
      null,
      null,
    ]),
    "file_personal_request(engineering)",
  );
  expect(
    await call("smartgov.file_personal_request", [
      eduToken,
      college("College of Education"),
      "Request for mobile chairs during the education fair",
      "The education fair needs 40 mobile chairs from the university stock. We will return them the next working day.",
      "Borrow university chairs for the education fair",
      future(9),
      "08:00",
      "Asia/Manila",
      "https://example.org/demo/chair-request",
      null,
      null,
      null,
      null,
    ]),
    "file_personal_request(education)",
  );
  expect(
    await call("smartgov.decide_personal_request", [
      ownerToken,
      requestA.requestId ?? requestA.id,
      "granted",
      "Approved. Coordinate with the laboratory custodian.",
    ]),
    "decide_personal_request",
  );
  log("personal requests", "2 filed, 1 granted");

  // ---------------------------------------------------------------- conversation
  const conversation = expect(
    await call("smartgov.create_conversation", [
      ownerToken,
      [accountId(`pedro.engineering@${EMAIL_DOMAIN}`), accountId(`carlo.education@${EMAIL_DOMAIN}`)],
      "Second semester coordination",
    ]),
    "create_conversation",
  );
  expect(
    await call("smartgov.send_message", [
      ownerToken,
      conversation.conversationId ?? conversation.id,
      "Please send your council calendars before Friday so the USG can avoid conflicts.",
    ]),
    "send_message",
  );
  expect(
    await call("smartgov.send_message", [
      engToken,
      conversation.conversationId ?? conversation.id,
      "Noted. Engineering Week will be the last week of the month.",
    ]),
    "send_message(reply)",
  );
  log("chat", "coordination thread with 2 messages");

  // ---------------------------------------------------------------- structure (best effort)
  //
  // Two charts, because the product shows two: the Engineering council's chart,
  // which is submitted for review, and the USG's own chart, which its author can
  // approve and which is what `/org-chart` renders for every member.
  const holder = (firstName, lastName, local) => ({
    email: `${local}@${EMAIL_DOMAIN}`,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
  });

  const chartLayout = {
    template: "pyramid",
    orientation: "vertical",
    theme: "parchment",
    showPhotos: true,
    showTitles: true,
    tierSpacing: 1,
    nodeSize: "md",
  };

  const engineeringDoc = {
    schemaVersion: 2,
    layout: chartLayout,
    committees: [
      {
        key: "exec",
        isUnit: true,
        name: "Executive Board",
        description: "The council's officers.",
        positions: [
          { key: "president", title: "President", tier: 0, order: 0, maxHolders: 1, parentKey: null,
            holder: holder("Pedro", "Aquino", "pedro.engineering") },
          { key: "vp", title: "Vice President", tier: 1, order: 0, maxHolders: 1, parentKey: "president",
            holder: holder("Marco", "Villanueva", "marco.engineering") },
          { key: "secretary", title: "Secretary", tier: 1, order: 1, maxHolders: 1, parentKey: "president",
            holder: holder("Liza", "Fernandez", "liza.engineering") },
          { key: "treasurer", title: "Treasurer", tier: 2, order: 0, maxHolders: 1, parentKey: "vp",
            holder: holder("Teresa", "Lim", "teresa.engineering") },
          { key: "auditor", title: "Auditor", tier: 2, order: 1, maxHolders: 1, parentKey: "vp",
            holder: holder("Andres", "Bautista", "andres.engineering") },
          { key: "pro", title: "Public Relations Officer", tier: 2, order: 2, maxHolders: 1, parentKey: "secretary",
            holder: holder("Kim", "Soriano", "kim.engineering") },
        ],
      },
      {
        key: "finance",
        name: "Finance Committee",
        description: "Budget, liquidation, and audit responses.",
        positions: [
          { key: "finance-chair", title: "Chairperson", tier: 1, order: 2, maxHolders: 1, parentKey: "president", holder: null },
        ],
      },
      {
        key: "academics",
        name: "Academic Affairs Committee",
        description: "Curriculum, tutoring, and student welfare.",
        positions: [
          { key: "academics-chair", title: "Chairperson", tier: 1, order: 3, maxHolders: 1, parentKey: "president", holder: null },
        ],
      },
    ],
  };

  const usgDoc = {
    schemaVersion: 2,
    layout: { ...chartLayout, template: "hierarchy" },
    committees: [
      {
        key: "usg-exec",
        isUnit: true,
        name: "University Student Government",
        description: "The officers of the USG.",
        positions: [
          { key: "usg-president", title: "President", tier: 0, order: 0, maxHolders: 1, parentKey: null,
            holder: holder("Juan", "Dela Cruz", "juan.president") },
          { key: "usg-vp", title: "Vice President", tier: 1, order: 0, maxHolders: 1, parentKey: "usg-president",
            holder: holder("Maria", "Santos", "maria.vicepresident") },
          { key: "usg-secretary", title: "Secretary", tier: 1, order: 1, maxHolders: 1, parentKey: "usg-president",
            holder: holder("Ana", "Reyes", "ana.secretary") },
          { key: "usg-treasurer", title: "Treasurer", tier: 1, order: 2, maxHolders: 1, parentKey: "usg-president",
            holder: holder("Miguel", "Bautista", "miguel.treasurer") },
          { key: "usg-auditor", title: "Auditor", tier: 1, order: 3, maxHolders: 1, parentKey: "usg-president",
            holder: holder("Rosa", "Villanueva", "rosa.auditor") },
          { key: "usg-pro", title: "Public Relations Officer", tier: 2, order: 0, maxHolders: 1, parentKey: "usg-secretary",
            holder: null },
        ],
      },
    ],
  };

  let structureSubmitted = false;
  try {
    const draft = await call("smartgov.save_structure_draft", [
      engToken,
      college("College of Engineering"),
      "standard-council",
      "Second Semester 2026-2027",
      future(-30),
      future(150),
      engineeringDoc,
      "Council chart submitted for review.",
    ]);
    const structureId = draft.structureId ?? draft.id;
    if (structureId) {
      expect(
        await call("smartgov.submit_structure", [engToken, structureId, "For USG review."]),
        "submit_structure",
      );
      log("structure", "Engineering officer chart submitted for review");
      structureSubmitted = true;
    } else {
      log("structure", `draft saved but no id returned: ${JSON.stringify(draft)}`);
    }
  } catch (error) {
    log("structure", `Engineering chart skipped (${error.message})`);
  }

  try {
    const usgDraft = await call("smartgov.save_structure_draft", [
      ownerToken,
      usg.id,
      "standard-council",
      `A.Y. ${ACADEMIC_YEAR}`,
      future(-30),
      future(300),
      usgDoc,
      "USG chart for the current academic year.",
    ]);
    const usgId = usgDraft.structureId ?? usgDraft.id;
    if (usgId) {
      const decided = await call("smartgov.submit_structure", [ownerToken, usgId, "Publishing the USG chart."]);
      log(
        "structure",
        decided.status === "approved" || decided.autoApproved
          ? "USG chart approved and published"
          : "USG chart submitted",
      );
    }
  } catch (error) {
    log("structure", `USG chart skipped (${error.message})`);
  }

  // ---------------------------------------------------------------- member response
  expect(
    await call("smartgov.create_notification", [
      engToken,
      accountId(`member@${EMAIL_DOMAIN}`),
      "task_assigned",
      "A task was assigned to your council",
      "Submit first-semester activity reports by the end of the month.",
      "/lsg/tasks",
    ]),
    "create_notification(member)",
  );
  expect(
    await call("smartgov.list_dashboard", [memberToken]).catch(() => ({ ok: true })),
    "list_dashboard(member)",
  );

  // ---------------------------------------------------------------- customisation
  await call("smartgov.update_customisation", [ownerToken, "#16324f", "light", null]);

  // ---------------------------------------------------------------- credentials
  mkdirSync(dirname(CREDENTIALS), { recursive: true });
  const lines = [
    "TEST ACCOUNTS ONLY - rotate or delete before any real use.",
    "",
    "SmartGov demo university (federated: 1 USG + 5 colleges)",
    `Sign in at ${env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/login`,
    `Organization: Demo University (slug ${ORG_SLUG})`,
    `Password for every account: ${PASSWORD}`,
    "",
    "USG - University Student Government",
    ...usgPeople.map(
      ([handle, name, seat]) => `  ${seat.padEnd(22)} ${name.padEnd(22)} ${handle}@${EMAIL_DOMAIN}`,
    ),
    `  ${"Owner / Founder".padEnd(22)} ${"Demo University Founder".padEnd(22)} owner@${EMAIL_DOMAIN}`,
    "",
    "LSG - Local Student Councils",
    ...lsgPeople.map(
      ([handle, name, , seat]) => `  ${seat.padEnd(22)} ${name.padEnd(22)} ${handle}@${EMAIL_DOMAIN}`,
    ),
    "",
    "Ordinary member (no seat)",
    `  ${"Member".padEnd(22)} ${"Bea Ordinary Member".padEnd(22)} member@${EMAIL_DOMAIN}`,
    "",
  ];
  writeFileSync(CREDENTIALS, lines.join("\r\n"), "utf8");
  log("credentials", CREDENTIALS);

  console.log(
    JSON.stringify(
      {
        organizationId: orgId,
        slug: org.slug,
        units: units.length,
        accounts: accounts.length + 1,
        proposals: 2,
        tasks: taskTitles.length,
        events: 2,
        surveys: 2,
        personalRequests: 2,
        structures: structureSubmitted ? 1 : 0,
        password: PASSWORD,
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => client.end())
  .catch(async (error) => {
    console.error(error);
    await client.end().catch(() => {});
    process.exitCode = 1;
  });




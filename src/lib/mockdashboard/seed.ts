import type { Item, MockState } from "./db";
import type { ItemKind } from "./types";

let n = 0;
const uid = () => `seed-${++n}`;

function iso(daysAgo: number, hour = 9): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function item<T extends ItemKind>(
  kind: T,
  title: string,
  status: ItemStatus,
  filedBy: string,
  filedByEmail: string,
  daysAgo: number,
  detail: Record<string, unknown>,
  note: string,
): Item<T> {
  const filedLabel = note || "Filed for review";
  return {
    id: uid(),
    kind,
    title,
    status,
    filedBy,
    filedByEmail,
    createdAt: iso(daysAgo),
    timeline: [
      { at: iso(daysAgo), from: "none", to: status === "in_review" ? "in_review" : "pending", by: filedBy, note: filedLabel },
    ],
    review: null,
    detail,
  };
}

type ItemStatus = "pending" | "in_review" | "approved" | "returned";

export function seed(): MockState {
  n = 0;
  return {
    proposals: [
      {
        ...item("proposal", "Semestral Technical Workshop", "approved", "CCIS Student Council", "ccis.sg@univ.edu.ph", 21, { description: "Hands-on Git, React, and CI/CD workshops across the semester.", docs: ["workshop-proposal.pdf"] }, "Workshops for CS/IT majors"),
        timeline: [
          { at: iso(21), from: "none", to: "pending", by: "CCIS Student Council", note: "Filed for review" },
          { at: iso(19), from: "pending", to: "in_review", by: "USG Office", note: "Review started" },
          { at: iso(18), from: "in_review", to: "approved", by: "USG Office", note: "Approved" },
        ],
        review: { decidedBy: "USG Office", at: iso(18), comment: "Workshops align with the academic calendar." },
      },
      {
        ...item("proposal", "Engineering Week Celebration", "approved", "COE Student Council", "coe.sg@univ.edu.ph", 30, { description: "Five days of exhibits, quiz bowls, and a career fair for engineering students.", docs: ["engg-week-plan.pdf"] }, "Annual flagship event"),
        timeline: [
          { at: iso(30), from: "none", to: "pending", by: "COE Student Council", note: "Filed for review" },
          { at: iso(28), from: "pending", to: "in_review", by: "USG Office", note: "Review started" },
          { at: iso(27), from: "in_review", to: "approved", by: "USG Office", note: "Approved" },
        ],
        review: { decidedBy: "USG Office", at: iso(27), comment: "Approved. Coordinate with Events & Culture for the stage." },
      },
      {
        ...item("proposal", "Literary Merit Awards", "in_review", "CAS Student Council", "cas.sg@univ.edu.ph", 1, { description: "Recognition night for publication and creative writing achievers.", docs: ["literary-awards.md"] }, "Recognition event"),
        timeline: [
          { at: iso(1), from: "none", to: "pending", by: "CAS Student Council", note: "Filed for review" },
          { at: iso(0), from: "pending", to: "in_review", by: "USG Office", note: "Review started" },
        ],
      },
      {
        ...item("proposal", "Hackathon 2026", "in_review", "CCIS Student Council", "ccis.sg@univ.edu.ph", 2, { description: "24-hour build event with sponsor booths and prize pool.", docs: ["hackathon-2026.pdf"] }, "Biggest tech event of the year"),
        timeline: [
          { at: iso(2), from: "none", to: "pending", by: "CCIS Student Council", note: "Filed for review" },
          { at: iso(1), from: "pending", to: "in_review", by: "USG Office", note: "Review started" },
        ],
      },
      {
        ...item("proposal", "Cultural Night Fund", "returned", "CAS Student Council", "cas.sg@univ.edu.ph", 9, { description: "Campus-wide cultural showcase and food bazaar.", docs: ["cultural-night.pdf"] }, "Funding request"),
        timeline: [
          { at: iso(9), from: "none", to: "pending", by: "CAS Student Council", note: "Filed for review" },
          { at: iso(8), from: "pending", to: "in_review", by: "USG Office", note: "Review started" },
          { at: iso(7), from: "in_review", to: "returned", by: "USG Office", note: "Returned with comment" },
        ],
        review: { decidedBy: "USG Office", at: iso(7), comment: "Budget breakdown missing. Re-attach with itemized costs." },
      },
    ],

    events: [
      {
        ...item("event", "Engineering Week 2026", "approved", "COE Student Council", "coe.sg@univ.edu.ph", 26, { date: futureIso(38), venue: "Engineering Building Grounds", plannedAttendees: 1200, budgetUse: "Stage, sound, and exhibit materials" }, "Flagship week"),
        timeline: [
          { at: iso(26), from: "none", to: "pending", by: "COE Student Council", note: "Filed for review" },
          { at: iso(0), from: "pending", to: "in_review", by: "USG Office", note: "Review started" },
          { at: iso(0), from: "in_review", to: "approved", by: "USG Office", note: "Approved" },
        ],
        review: { decidedBy: "USG Office", at: iso(0), comment: "Venue confirmed with Security." },
      },
      {
        ...item("event", "Hackathon 2026: Finals Roadshow", "pending", "CCIS Student Council", "ccis.sg@univ.edu.ph", 1, { date: futureIso(21), venue: "Innovation Hub", plannedAttendees: 300, budgetUse: "Prize pool and snacks" }, "Awaiting review"),
        timeline: [{ at: iso(1), from: "none", to: "pending", by: "CCIS Student Council", note: "Filed for review" }],
      },
      {
        ...item("event", "Freshman Orientation", "approved", "CAS Student Council", "cas.sg@univ.edu.ph", 40, { date: iso(40, 8).slice(0, 10), venue: "University Gymnasium", plannedAttendees: 2000, budgetUse: "Booths and giveaways" }, "Completed"),
        timeline: [
          { at: iso(41), from: "none", to: "pending", by: "CAS Student Council", note: "Filed for review" },
          { at: iso(40, 6), from: "pending", to: "in_review", by: "USG Office", note: "Review started" },
          { at: iso(40, 7), from: "in_review", to: "approved", by: "USG Office", note: "Approved" },
        ],
        review: { decidedBy: "USG Office", at: iso(40, 7), comment: "Approved for opening semester." },
      },
    ],

    budgets: [
      {
        ...item("budget", "Operations Fund — Semester", "approved", "USG Finance", "usg.finance@univ.edu.ph", 60, { amount: 12000, spent: 9400, purpose: "Office supplies, printing, and general operations", unitName: "Finance", year: "2026" }, "Allotted"),
        timeline: [
          { at: iso(60), from: "none", to: "pending", by: "USG Finance", note: "Filed for review" },
          { at: iso(58), from: "pending", to: "in_review", by: "USG Office", note: "Review started" },
          { at: iso(57), from: "in_review", to: "approved", by: "USG Office", note: "Approved" },
        ],
        review: { decidedBy: "USG Office", at: iso(57), comment: "Aligned with operations reserve." },
      },
      {
        ...item("budget", "Events & Culture Season Budget", "approved", "USG Events & Culture", "usg.events@univ.edu.ph", 55, { amount: 25000, spent: 18000, purpose: "Stage, sound, and event production for the semester", unitName: "Events & Culture", year: "2026" }, "Allotted"),
        timeline: [
          { at: iso(55), from: "none", to: "pending", by: "USG Events & Culture", note: "Filed for review" },
          { at: iso(54), from: "pending", to: "in_review", by: "USG Office", note: "Review started" },
          { at: iso(53), from: "in_review", to: "approved", by: "USG Office", note: "Approved" },
        ],
        review: { decidedBy: "USG Office", at: iso(53), comment: "Approved for flagship events." },
      },
      {
        ...item("budget", "Academics Tutorial Program", "pending", "USG Academics", "usg.academics@univ.edu.ph", 1, { amount: 8000, spent: 0, purpose: "Peer tutorial stipends and learning materials", unitName: "Academics", year: "2026" }, "Awaiting review"),
        timeline: [{ at: iso(1), from: "none", to: "pending", by: "USG Academics", note: "Filed for review" }],
      },
      {
        ...item("budget", "Students Welfare Care Kits", "returned", "USG Students Welfare", "usg.welfare@univ.edu.ph", 12, { amount: 5000, spent: 0, purpose: "Care kits and financial assistance", unitName: "Students Welfare", year: "2026" }, "Returned"),
        timeline: [
          { at: iso(12), from: "none", to: "pending", by: "USG Students Welfare", note: "Filed for review" },
          { at: iso(11), from: "pending", to: "in_review", by: "USG Office", note: "Review started" },
          { at: iso(10), from: "in_review", to: "returned", by: "USG Office", note: "Returned with comment" },
        ],
        review: { decidedBy: "USG Office", at: iso(10), comment: "Attach a vendor quote for the care kit contents." },
      },
    ],

    announcements: [
      { id: uid(), title: "Midterms break — offices closed", body: "USG offices will be closed on midterms week. Deadline extensions apply to all pending requests.", pinned: true, at: iso(1), by: "USG Office" },
      { id: uid(), title: "New review window for events", body: "Event proposals now have a 48-hour review window. File early so deadlines are not missed.", pinned: false, at: iso(3), by: "USG Office" },
      { id: uid(), title: "Budget submission guidelines", body: "All budget requests must include an itemized breakdown to be considered for approval.", pinned: false, at: iso(5), by: "USG Office" },
    ],

    units: [
      { id: uid(), name: "Finance", lead: "Juan Dela Cruz", officers: ["Julia Reyes", "Marco Tan", "Sofia Lim"] },
      { id: uid(), name: "Events & Culture", lead: "Maria Santos", officers: ["Paolo Ong", "Katrina Villanueva", "Derrick Ramos"] },
      { id: uid(), name: "Academics", lead: "Jose Ramirez", officers: ["Liza Cruz", "Miguel Torres"] },
      { id: uid(), name: "Students Welfare", lead: "Ana Garcia", officers: ["Bryan Padilla", "Ivy Mendoza", "Neil Castillo"] },
    ],

    councils: [
      { id: uid(), name: "CCIS Student Council", officers: ["Ken Aguilar", "Alyssa Go", "Rafael Dizon", "Bianca Navarro"] },
      { id: uid(), name: "COE Student Council", officers: ["Rhea Cruz", "Joshua Yu", "Patricia Solano", "Alex Ramos"] },
      { id: uid(), name: "CAS Student Council", officers: ["Leo Bautista", "Denise Flores", "Carlo Reyes", "Mia Domingo"] },
    ],
  };
}

function futureIso(daysAhead: number, hour = 10): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}
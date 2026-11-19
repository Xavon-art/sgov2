import { NextResponse } from "next/server";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import {
  listAccomplishmentReports,
  submitAccomplishmentReport,
  UUID_RE,
  type AccomplishmentReportRow,
} from "@/lib/accomplishment-reports";

export const runtime = "nodejs";

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  return 400;
}

export async function GET(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const eventId = new URL(req.url).searchParams.get("eventId");
  if (eventId && eventId.trim() && !UUID_RE.test(eventId.trim())) {
    return NextResponse.json(
      { ok: false, message: "That event reference is not valid." },
      { status: 400 },
    );
  }

  try {
    const res = await listAccomplishmentReports(token, eventId?.trim() || null);
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({
      ok: true,
      canReview: res.canReview === true,
      rows: (res.rows ?? []) as AccomplishmentReportRow[],
    });
  } catch (error) {
    console.error("[accomplishment-reports:list]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load the accomplishment reports." },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: {
    eventId?: unknown;
    narrative?: unknown;
    highlights?: unknown;
    attachmentSubmissionId?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Send the accomplishment report as JSON." },
      { status: 400 },
    );
  }

  const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
  if (!UUID_RE.test(eventId)) {
    return NextResponse.json(
      { ok: false, message: "Choose an event before submitting a report." },
      { status: 400 },
    );
  }

  const narrative = typeof body.narrative === "string" ? body.narrative.trim() : "";
  if (narrative.length < 10 || narrative.length > 12000) {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_narrative"), reason: "invalid_narrative" },
      { status: 400 },
    );
  }

  const highlights = typeof body.highlights === "string" ? body.highlights.trim() : "";
  if (highlights.length > 2000) {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_highlights"), reason: "invalid_highlights" },
      { status: 400 },
    );
  }

  let attachmentSubmissionId: string | null = null;
  if (
    typeof body.attachmentSubmissionId === "string" &&
    body.attachmentSubmissionId.trim()
  ) {
    attachmentSubmissionId = body.attachmentSubmissionId.trim();
    if (!UUID_RE.test(attachmentSubmissionId)) {
      return NextResponse.json(
        { ok: false, message: "That attachment reference is not valid." },
        { status: 400 },
      );
    }
  }

  try {
    const res = await submitAccomplishmentReport(token, {
      eventId,
      narrative,
      highlights,
      attachmentSubmissionId,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, id: res.id });
  } catch (error) {
    console.error("[accomplishment-reports:create]", error);
    return NextResponse.json(
      { ok: false, message: "We could not file that accomplishment report." },
      { status: 500 },
    );
  }
}

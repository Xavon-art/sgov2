import { NextResponse } from "next/server";
import { messageFor } from "@/lib/auth/messages";
import {
  feedbackPublicHttpStatus,
  getPublicFeedbackForm,
  submitPublicFeedbackResponse,
} from "@/lib/feedback-forms";
import { feedbackSubmissionSchema } from "@/lib/feedback-forms-schema";

export const runtime = "nodejs";

const PUBLIC_SLUG_RE = /^[A-Za-z0-9_-]{32}$/;

const NO_STORE = { "Cache-Control": "no-store" } as const;

type RouteContext = { params: Promise<{ slug: string }> };

function failure(reason?: string, status?: number) {
  const normalized = reason === "not_found" ? "invalid_slug" : reason;
  return NextResponse.json(
    { ok: false, message: messageFor(normalized), reason: normalized },
    {
      status: status ?? feedbackPublicHttpStatus(normalized),
      headers: NO_STORE,
    },
  );
}

export async function GET(_request: Request, context: RouteContext) {
  const { slug } = await context.params;
  if (!PUBLIC_SLUG_RE.test(slug)) {
    return failure("invalid_slug", 404);
  }

  try {
    const res = await getPublicFeedbackForm(slug);
    if (!res.ok) {
      return failure(res.reason);
    }
    return NextResponse.json(
      { ok: true, form: res.form ?? null },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error("[feedback-public:get]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load this feedback form." },
      { status: 500, headers: NO_STORE },
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { slug } = await context.params;
  if (!PUBLIC_SLUG_RE.test(slug)) {
    return failure("invalid_slug", 404);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_request") },
      { status: 400, headers: NO_STORE },
    );
  }

  const parsed = feedbackSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        message: messageFor("invalid_answers"),
        reason: "invalid_answers",
      },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const res = await submitPublicFeedbackResponse(slug, parsed.data);
    if (!res.ok) {
      return failure(res.reason);
    }
    return NextResponse.json(
      { ok: true, responseId: res.responseId },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error("[feedback-public:submit]", error);
    return NextResponse.json(
      { ok: false, message: "We could not record your response." },
      { status: 500, headers: NO_STORE },
    );
  }
}

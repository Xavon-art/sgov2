import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

type SurveyRow = {
  id: string;
  title: string;
  description: string | null;
  accessMode: string;
  status: string;
  responseLimit: number | null;
  deadline: string | null;
  createdAt: string;
  createdBy: string;
  responseCount: number;
  canViewResults: boolean;
};

type ListPayload = RpcResult & { surveys?: SurveyRow[] };
type CreatePayload = RpcResult & { surveyId?: string };

function statusForReason(reason?: string): number {
  switch (reason) {
    case "unauthenticated":
      return 401;
    case "rate_limited":
      return 429;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    default:
      return 400;
  }
}

export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }
  try {
    const res = await callRpc<ListPayload>("list_surveys", { p_session_token: token });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, surveys: res.surveys ?? [] });
  } catch (error) {
    console.error("[surveys:list]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }
  let body: {
    title?: unknown;
    description?: unknown;
    accessMode?: unknown;
    allowedEmails?: unknown;
    responseLimit?: unknown;
    deadline?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ ok: false, message: "Give the survey a title." }, { status: 400 });
  }

  const allowedEmails = Array.isArray(body.allowedEmails)
    ? body.allowedEmails.map((e) => String(e).trim().toLowerCase()).filter(Boolean)
    : [];

  const responseLimit =
    typeof body.responseLimit === "number" && body.responseLimit > 0 ? body.responseLimit : null;

  const deadline = typeof body.deadline === "string" && body.deadline ? body.deadline : null;

  try {
    const res = await callRpc<CreatePayload>("create_survey", {
      p_session_token: token,
      p_title: title,
      p_description: typeof body.description === "string" ? body.description.trim() : null,
      p_access_mode: typeof body.accessMode === "string" ? body.accessMode : "public",
      p_allowed_emails: allowedEmails,
      p_response_limit: responseLimit,
      p_deadline: deadline,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, surveyId: res.surveyId });
  } catch (error) {
    console.error("[surveys:create]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}
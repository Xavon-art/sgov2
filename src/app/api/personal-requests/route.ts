import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

type RequestRow = {
  id: string;
  title: string;
  purpose: string | null;
  coverLetter: string | null;
  supportDocument: string | null;
  deadline: string | null;
  timezone: string | null;
  status: string;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
  createdBy: string;
  canDecide: boolean;
};

type ListPayload = RpcResult & { requests?: RequestRow[] };
type CreatePayload = RpcResult & { requestId?: string };

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
    const res = await callRpc<ListPayload>("list_personal_requests", { p_session_token: token });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, requests: res.requests ?? [] });
  } catch (error) {
    console.error("[personal-requests:list]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ ok: false, message: "Give the request a title." }, { status: 400 });
  }

  const deadline = typeof body.deadline === "string" && body.deadline ? body.deadline : null;

  try {
    const res = await callRpc<CreatePayload>("create_personal_request", {
      p_session_token: token,
      p_title: title,
      p_purpose: typeof body.purpose === "string" ? body.purpose.trim() : null,
      p_cover_letter: typeof body.coverLetter === "string" ? body.coverLetter.trim() : null,
      p_support_document: typeof body.supportDocument === "string" ? body.supportDocument.trim() : null,
      p_deadline: deadline,
      p_timezone: typeof body.timezone === "string" ? body.timezone.trim() : null,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, requestId: res.requestId });
  } catch (error) {
    console.error("[personal-requests:create]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}
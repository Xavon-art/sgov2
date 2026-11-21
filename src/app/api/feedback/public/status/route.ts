import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type StatusResult = RpcResult & {
  status?: string;
  submittedAt?: string | null;
  acknowledgedAt?: string | null;
};

function failure(message: string, status = 400) {
  return NextResponse.json(
    { ok: false, message },
    { status, headers: NO_STORE },
  );
}

function responseIdFrom(request: Request, body?: unknown): string | null {
  const fromQuery = new URL(request.url).searchParams.get("responseId");
  const fromBody =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).responseId
      : null;
  for (const candidate of [fromQuery, fromBody]) {
    if (typeof candidate === "string" && UUID_RE.test(candidate)) return candidate;
  }
  return null;
}

async function statusFor(request: Request, body?: unknown) {
  const responseId = responseIdFrom(request, body);
  if (!responseId) return failure("Provide a valid response ID.");

  try {
    const res = await callRpc<StatusResult>("public_feedback_response_status", {
      p_response_id: responseId,
    });
    if (!res.ok) return failure("That response was not found.", 404);

    return NextResponse.json(
      {
        ok: true,
        status: typeof res.status === "string" ? res.status : "new",
        submittedAt: typeof res.submittedAt === "string" ? res.submittedAt : null,
        acknowledgedAt:
          typeof res.acknowledgedAt === "string" ? res.acknowledgedAt : null,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error("[feedback-public:status]", error);
    return failure("We could not check your submission status.", 500);
  }
}

export async function GET(request: Request) {
  return statusFor(request);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure("Invalid request.");
  }
  return statusFor(request, body);
}

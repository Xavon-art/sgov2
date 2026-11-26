import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { readSessionToken } from "@/lib/auth/session";
import {
  BUDGET_UUID_RE,
  budgetFailure,
  budgetJson,
} from "@/lib/budget-api";

export const runtime = "nodejs";

type FilesResult = RpcResult & { files?: unknown[] };

function invalidBody(message: string) {
  return budgetJson({ ok: false, message, reason: "invalid_request" }, { status: 400 });
}

function validId(value: string): boolean {
  return BUDGET_UUID_RE.test(value);
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return budgetJson({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!validId(id)) return invalidBody("That budget reference is not valid.");

  const kind = new URL(req.url).searchParams.get("kind") ?? "";
  if (kind && kind !== "justification" && kind !== "receipt") return invalidBody("Choose a valid file category.");

  try {
    const res = await callRpc<FilesResult>("list_budget_files", {
      p_session_token: token,
      p_budget_id: id,
      p_kind: kind || null,
    });
    if (!res.ok) return budgetFailure(res);
    return budgetJson({ ok: true, files: res.files ?? [] });
  } catch (error) {
    console.error("[budget-files:list]", error);
    return budgetJson({ ok: false, message: "We could not load those budget files." }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return budgetJson({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!validId(id)) return invalidBody("That budget reference is not valid.");

  let body: { kind?: unknown; paths?: unknown };
  try {
    body = await req.json();
  } catch {
    return invalidBody("Send the file references as JSON.");
  }

  if (body.kind !== "justification" && body.kind !== "receipt") {
    return invalidBody("Choose a valid file category.");
  }
  if (!Array.isArray(body.paths) || body.paths.length === 0 || body.paths.some((path) => typeof path !== "string" || !path.trim())) {
    return invalidBody("Upload the file before attaching it.");
  }

  try {
    const res = await callRpc<RpcResult & { attached?: number }>("attach_budget_files", {
      p_session_token: token,
      p_budget_id: id,
      p_kind: body.kind,
      p_paths: body.paths,
    });
    if (!res.ok) return budgetFailure(res);
    return budgetJson({ ok: true, attached: res.attached ?? body.paths.length });
  } catch (error) {
    console.error("[budget-files:attach]", error);
    return budgetJson({ ok: false, message: "We could not attach that file." }, { status: 500 });
  }
}

import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { readSessionToken } from "@/lib/auth/session";
import { BUDGET_UUID_RE, budgetFailure, budgetJson } from "@/lib/budget-api";

export const runtime = "nodejs";

function invalidBody(message: string) {
  return budgetJson({ ok: false, message, reason: "invalid_request" }, { status: 400 });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return budgetJson({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!BUDGET_UUID_RE.test(id)) return invalidBody("That expense reference is not valid.");

  let body: { paths?: unknown };
  try {
    body = await req.json();
  } catch {
    return invalidBody("Send the file references as JSON.");
  }
  if (!Array.isArray(body.paths) || body.paths.length === 0 || body.paths.some((path) => typeof path !== "string" || !path.trim())) {
    return invalidBody("Upload the receipt before attaching it.");
  }

  try {
    const res = await callRpc<RpcResult & { storagePath?: string }>("attach_usg_expense_files", {
      p_session_token: token,
      p_expense_id: id,
      p_paths: body.paths,
    });
    if (!res.ok) return budgetFailure(res);
    return budgetJson({ ok: true, storagePath: res.storagePath ?? body.paths[0] });
  } catch (error) {
    console.error("[usg-expense-files:attach]", error);
    return budgetJson({ ok: false, message: "We could not attach that receipt." }, { status: 500 });
  }
}

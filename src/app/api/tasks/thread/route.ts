import { NextResponse } from "next/server";

import { messageFor } from "@/lib/auth/messages";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { readSessionToken } from "@/lib/auth/session";
import {
  loadCurrentAccountId,
  loadUnitRecipientIds,
  loadUsgRecipientIds,
  notifyAccounts,
} from "@/lib/notifications-server";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * The task thread: messenger-style, but scoped by the office's rules.
 *
 * GET reads it. POST writes it, and the four actions are kept on one route
 * because they all target the same resource and share the same rate budget --
 * a person replying and reacting in quick succession is normal, and splitting
 * them would either double the limits or make the burst look like abuse.
 *
 * The asymmetry that matters: `unsend` is the only delete verb, and what it
 * does depends on who is calling. The office hides a message from its own view;
 * a unit's delete clears it for both sides. That decision lives in
 * `delete_task_message` because it can only be made by knowing the caller's
 * side, which this route never sees and never pretends to.
 */
type ThreadPayload = RpcResult & {
  messages?: Array<Record<string, unknown>>;
  canClose?: boolean;
  closed?: boolean;
  messageId?: string;
  side?: string;
  on?: boolean;
  hiddenFrom?: string;
};

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "rate_limited") return 429;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  return 400;
}

export async function GET(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const taskId = new URL(req.url).searchParams.get("taskId");
  if (!taskId) {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  try {
    const res = await callRpc<ThreadPayload>("list_task_thread", {
      p_session_token: token,
      p_task_id: taskId,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: res.reason, message: messageFor(res.reason) },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({
      ok: true,
      messages: res.messages ?? [],
      canClose: Boolean(res.canClose),
      closed: Boolean(res.closed),
    });
  } catch (error) {
    console.error("[thread:read]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load the conversation." },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const limit = rateLimit(`thread:write:ip:${clientIp(req)}`, 120, 10 * 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited", message: messageFor("rate_limited") },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const action = body.action;
  const taskId = typeof body.taskId === "string" ? body.taskId : "";
  const messageId = typeof body.messageId === "string" ? body.messageId : "";

  try {
    if (action === "send") {
      if (!taskId) {
        return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
      }
      const messageBody = typeof body.body === "string" ? body.body.trim() : "";
      const res = await callRpc<ThreadPayload>("post_task_message", {
        p_session_token: token,
        p_task_id: taskId,
        p_body: messageBody,
        p_unit_id: typeof body.unitId === "string" && body.unitId ? body.unitId : null,
        p_reply_to: typeof body.replyTo === "string" && body.replyTo ? body.replyTo : null,
      });
      if (!res.ok) {
        return NextResponse.json(
          { ok: false, reason: res.reason, message: messageFor(res.reason) },
          { status: statusForReason(res.reason) },
        );
      }

      const actorId = await loadCurrentAccountId(token);
      let recipientIds: string[];
      if (res.side === "usg") {
        const detail = await callRpc<RpcResult & { assignments?: Array<{ unitId?: string }> }>(
          "task_detail",
          { p_session_token: token, p_task_id: taskId },
        );
        const unitIds = (detail.assignments ?? [])
          .map((assignment) => assignment.unitId)
          .filter((id): id is string => typeof id === "string");
        recipientIds = await loadUnitRecipientIds(token, unitIds);
      } else {
        recipientIds = await loadUsgRecipientIds(token);
      }

      const preview = messageBody.length > 160 ? `${messageBody.slice(0, 157)}...` : messageBody;
      await notifyAccounts(
        token,
        recipientIds.map((id) => ({ id })),
        {
          kind: "task_thread_message",
          title: "New task message",
          body: preview,
          link: `/${res.side === "usg" ? "lsg" : "usg"}/request?tab=tasks&task=${taskId}&thread=1`,
          excludeAccountId: actorId,
        },
      );

      return NextResponse.json({ ok: true, messageId: res.messageId, side: res.side });
    }

    if (action === "unsend") {
      if (!messageId) {
        return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
      }
      const res = await callRpc<ThreadPayload>("delete_task_message", {
        p_session_token: token,
        p_message_id: messageId,
      });
      if (!res.ok) {
        return NextResponse.json(
          { ok: false, reason: res.reason, message: messageFor(res.reason) },
          { status: statusForReason(res.reason) },
        );
      }
      // `hiddenFrom` is returned so the screen can say what actually happened:
      // the office unsends for itself, a unit deletes for both. Telling the
      // person which one occurred is the difference between a mystery and a
      // known rule, so it is surfaced rather than swallowed.
      return NextResponse.json({ ok: true, hiddenFrom: res.hiddenFrom });
    }

    if (action === "react") {
      if (!messageId) {
        return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
      }
      const res = await callRpc<ThreadPayload>("react_to_message", {
        p_session_token: token,
        p_message_id: messageId,
        p_reaction: typeof body.reaction === "string" ? body.reaction : "",
      });
      if (!res.ok) {
        return NextResponse.json(
          { ok: false, reason: res.reason, message: messageFor(res.reason) },
          { status: statusForReason(res.reason) },
        );
      }
      return NextResponse.json({ ok: true, on: Boolean(res.on) });
    }

    return NextResponse.json({ ok: false, message: "Unknown action." }, { status: 400 });
  } catch (error) {
    console.error("[thread:write]", error);
    return NextResponse.json(
      { ok: false, message: "We could not save that. Please try again." },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

const PatchSchema = z.object({
  title: z.string().trim().min(3).max(160).optional(),
  description: z.string().trim().max(4000).optional().nullable(),
  eventDate: z.string().regex(DATE_RE).optional(),
  eventTime: z.string().regex(TIME_RE).optional().nullable(),
  timezone: z
    .string()
    .trim()
    .refine((value) => value === "" || isValidTimeZone(value), "Pick a valid IANA timezone.")
    .optional()
    .nullable(),
  venue: z.string().trim().max(200).optional().nullable(),
});

const CancelSchema = z.object({
  reason: z.string().trim().max(2000).optional().nullable(),
});

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

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }
  const { id } = await ctx.params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Check the event details." },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<RpcResult>("update_event", {
      p_session_token: token,
      p_event_id: id,
      p_title: parsed.data.title ?? null,
      p_description: parsed.data.description ?? null,
      p_event_date: parsed.data.eventDate ?? null,
      p_event_time: parsed.data.eventTime || null,
      p_timezone: parsed.data.timezone || null,
      p_venue: parsed.data.venue ?? null,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[events:update]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }
  const { id } = await ctx.params;

  let raw: unknown = {};
  try {
    raw = await request.json();
  } catch {
    // A cancel with no body is allowed; the reason is optional for the caller
    // who owns the event.
  }
  const parsed = CancelSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Check the reason." }, { status: 400 });
  }

  try {
    const res = await callRpc<RpcResult>("cancel_event", {
      p_session_token: token,
      p_event_id: id,
      p_reason: parsed.data.reason ?? null,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[events:cancel]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}

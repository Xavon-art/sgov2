import { NextResponse } from "next/server";
import { z } from "zod";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

type EventRow = {
  id: string;
  title: string;
  description: string | null;
  eventDate: string;
  eventTime: string | null;
  timezone: string | null;
  venue: string | null;
  scope: string;
  unitId: string | null;
  status: string;
  honorStatus: string;
  honorReason: string | null;
  source: string;
  supportFiles: unknown;
  files: Array<{ id: string; name: string; url: string | null; mimeType: string | null; sizeBytes: number | null }>;
  scopes: Array<{ unitType: string | null; unitId: string | null }>;
  claimNote: string | null;
  decisionNote: string | null;
  linkedRequest: string | null;
  cancelledAt: string | null;
  updatedAt: string;
  createdAt: string;
  createdBy: string;
  canDecide: boolean;
  canEdit: boolean;
  canClaim: boolean;
};

type ListPayload = RpcResult & { events?: EventRow[] };
type CreatePayload = RpcResult & { eventId?: string };

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

const CreateSchema = z.object({
  title: z.string().trim().min(3, "Give the event a title of at least 3 characters.").max(160),
  description: z.string().trim().max(4000).optional().nullable(),
  eventDate: z.string().regex(DATE_RE, "Pick a valid event date."),
  eventTime: z
    .string()
    .regex(TIME_RE, "Use a 24-hour time such as 09:30.")
    .optional()
    .nullable(),
  timezone: z
    .string()
    .trim()
    .refine((value) => value === "" || isValidTimeZone(value), "Pick a valid IANA timezone.")
    .optional()
    .nullable(),
  venue: z.string().trim().max(200).optional().nullable(),
  scope: z.enum(["university", "unit_type", "units", "unit", "org"]),
  unitIds: z.array(z.string().uuid()).max(200).optional(),
  unitTypes: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  files: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        url: z.string().trim().url("Attach a valid link."),
      }),
    )
    .max(20)
    .optional(),
  linkedRequest: z.string().uuid().optional().nullable(),
  claimNote: z.string().trim().max(2000).optional().nullable(),
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

export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }
  try {
    const res = await callRpc<ListPayload>("list_events", { p_session_token: token });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, events: res.events ?? [] });
  } catch (error) {
    console.error("[events:list]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Check the event details." },
      { status: 400 },
    );
  }

  const body = parsed.data;
  const scope = body.scope === "org" ? "university" : body.scope;

  try {
    const res = await callRpc<CreatePayload>("create_event_v2", {
      p_session_token: token,
      p_title: body.title,
      p_description: body.description ?? null,
      p_event_date: body.eventDate,
      p_event_time: body.eventTime || null,
      p_timezone: body.timezone || null,
      p_venue: body.venue || null,
      p_scope: scope,
      p_unit_ids: body.unitIds ?? [],
      p_unit_types: body.unitTypes ?? [],
      p_files: body.files ?? [],
      p_link_request: body.linkedRequest ?? null,
      p_claim_note: body.claimNote ?? null,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, eventId: res.eventId });
  } catch (error) {
    console.error("[events:create]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}

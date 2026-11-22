import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Profile and dashboard customisation for the federated workspace.
 *
 * One endpoint, four actions, because they are one screen: `GET` reads the
 * caller's profile, and `POST` applies a single change named by `action`. The
 * split mirrors the RPCs one-for-one rather than inventing a fatter contract --
 * each action maps to exactly one `SECURITY DEFINER` call, so the authority
 * check is always the function's, never this file's.
 *
 * The organisation's look (accent, theme, logo) is owner-only. The screen hides
 * it from everyone else, and `update_customisation` refuses it too, so the gate
 * is not merely a hidden button.
 */
const IP_LIMIT = 40;
const IP_WINDOW_MS = 10 * 60_000;

type ApiResponse = RpcResult & {
  account?: Record<string, unknown>;
  organization?: Record<string, unknown> | null;
  canCustomise?: boolean;
  displayName?: string;
  email?: string;
  universityName?: string;
  campusName?: string;
};

export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  try {
    const res = await callRpc<ApiResponse>("my_profile", { p_session_token: token });

    if (!res.ok) {
      return NextResponse.json({ ok: false, message: messageFor(res.reason) }, { status: 403 });
    }

    return NextResponse.json({
      ok: true,
      account: res.account ?? null,
      organization: res.organization ?? null,
      canCustomise: Boolean(res.canCustomise),
    });
  } catch (error) {
    console.error("[profile:read]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load your profile." },
      { status: 500 },
    );
  }
}

type Body = {
  action?: "profile" | "email" | "password" | "customisation" | "identity";
  displayName?: string;
  email?: string;
  password?: string;
  currentPassword?: string;
  newPassword?: string;
  accent?: string;
  themeMode?: string;
  logoData?: string | null;
  universityName?: string;
  campusName?: string;
};

export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: Body;
  try {
    body = ((await req.json()) ?? {}) as Body;
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const limit = rateLimit(`profile:write:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited", message: messageFor("rate_limited") },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    if (body.action === "profile") {
      const res = await callRpc<ApiResponse>("update_my_profile", {
        p_session_token: token,
        p_display_name: body.displayName ?? "",
      });
      if (!res.ok) {
        return NextResponse.json(
          { ok: false, reason: res.reason, message: messageFor(res.reason) },
          { status: res.reason === "unauthenticated" ? 401 : 400 },
        );
      }
      return NextResponse.json({ ok: true, displayName: res.displayName });
    }

    if (body.action === "identity") {
      const res = await callRpc<ApiResponse>("update_my_identity", {
        p_session_token: token,
        p_university_name: body.universityName ?? "",
        p_campus_name: body.campusName ?? "",
      });
      if (!res.ok) {
        return NextResponse.json(
          { ok: false, reason: res.reason, message: messageFor(res.reason) },
          { status: res.reason === "unauthenticated" ? 401 : 400 },
        );
      }
      return NextResponse.json({
        ok: true,
        universityName: res.universityName,
        campusName: res.campusName,
      });
    }

    if (body.action === "email") {
      const res = await callRpc<ApiResponse>("change_my_email", {
        p_session_token: token,
        p_new_email: body.email ?? "",
        p_password: body.password ?? "",
      });
      if (!res.ok) {
        return NextResponse.json(
          { ok: false, reason: res.reason, message: messageFor(res.reason) },
          { status: res.reason === "unauthenticated" ? 401 : 400 },
        );
      }
      return NextResponse.json({ ok: true, email: res.email });
    }

    if (body.action === "password") {
      const res = await callRpc<RpcResult>("change_my_password", {
        p_session_token: token,
        p_current_password: body.currentPassword ?? "",
        p_new_password: body.newPassword ?? "",
      });
      if (!res.ok) {
        return NextResponse.json(
          { ok: false, reason: res.reason, message: messageFor(res.reason) },
          { status: res.reason === "unauthenticated" ? 401 : 400 },
        );
      }
      return NextResponse.json({ ok: true });
    }

    if (body.action === "customisation") {
      const res = await callRpc<RpcResult>("update_customisation", {
        p_session_token: token,
        p_accent: body.accent ?? null,
        p_theme_mode: body.themeMode ?? null,
        // Omitted means leave the logo alone; an explicit empty string clears it.
        p_logo_data: "logoData" in body ? body.logoData ?? "" : undefined,
      });
      if (!res.ok) {
        return NextResponse.json(
          { ok: false, reason: res.reason, message: messageFor(res.reason) },
          { status: res.reason === "forbidden" ? 403 : 400 },
        );
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, message: "Unknown action." }, { status: 400 });
  } catch (error) {
    console.error("[profile:write]", error);
    return NextResponse.json(
      { ok: false, message: "We could not save that change." },
      { status: 500 },
    );
  }
}

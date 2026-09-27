import { NextResponse } from "next/server";
import { callRpc } from "@/lib/auth/rpc";
import { clearSessionCookie, readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

/** Drops the database session, then the cookie. */
export async function POST() {
  const token = await readSessionToken();

  if (token) {
    try {
      await callRpc("delete_session", { p_token: token });
    } catch (error) {
      // The cookie is cleared regardless, so a stale row cannot keep a
      // signed-in session alive on its own.
      console.error("[logout]", error);
    }
  }

  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}

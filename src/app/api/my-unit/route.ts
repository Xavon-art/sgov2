import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

type MyUnitResult = RpcResult & {
  unitId?: string | null;
};

/**
 * The caller's drafting unit. For an invited officer this is the LSG unit their
 * membership binds them to -- the `unitId` `create_proposal` refuses to
 * fabricate. Owners answer null; they publish unit-less USG activities.
 */
export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  try {
    const res = await callRpc<MyUnitResult>("my_unit", { p_session_token: token });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason) },
        { status: res.reason === "unauthenticated" ? 401 : 400 },
      );
    }
    return NextResponse.json({ ok: true, unitId: res.unitId ?? null });
  } catch (error) {
    console.error("[my-unit:read]", error);
    return NextResponse.json(
      { ok: false, message: "We could not find your unit." },
      { status: 500 },
    );
  }
}
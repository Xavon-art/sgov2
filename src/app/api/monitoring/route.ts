import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { parseMonitoringPayload, type MonitoringPayload } from "@/lib/monitoring";

export const runtime = "nodejs";

type MonitoringResult = RpcResult & Partial<MonitoringPayload>;

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "forbidden") return 403;
  return 400;
}

export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  try {
    const res = await callRpc<MonitoringResult>("monitoring_by_campus", {
      p_session_token: token,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }

    const payload = parseMonitoringPayload(res);
    if (!payload) {
      return NextResponse.json(
        { ok: false, message: "We could not load the monitoring data." },
        { status: 500 },
      );
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[monitoring:list]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load the monitoring data." },
      { status: 500 },
    );
  }
}

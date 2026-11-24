import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Philippine location picker data.
 *
 * The browser talks to this route, not to PSGC directly: the upstream is a
 * public dataset but it has no CORS contract worth depending on, and the four
 * cascading selects issue a lot of small reads while somebody types a campus
 * name. A day-long fetch cache here keeps one owner's browsing from hammering
 * the upstream and keeps the UI responsive when the network is slow.
 *
 * PSGC codes are nine digits. Validating them before they reach the URL keeps
 * this endpoint a closed proxy rather than a general-purpose fetcher.
 */
const IP_LIMIT = 120;
const IP_WINDOW_MS = 10 * 60_000;
const CODE_RE = /^[0-9]{9}$/;
const UPSTREAM = "https://psgc.gitlab.io/api";

type Level = "regions" | "provinces" | "cities" | "barangays";
export type PlaceOption = { code: string; name: string };

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isCode(value: string): boolean {
  return CODE_RE.test(value);
}

export async function GET(req: Request) {
  const limit = rateLimit(`locations:read:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, message: "Too many location lookups. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const url = new URL(req.url);
  const level = clean(url.searchParams.get("level")) as Level;
  const region = clean(url.searchParams.get("region"));
  const province = clean(url.searchParams.get("province"));
  const city = clean(url.searchParams.get("city"));

  if (!["regions", "provinces", "cities", "barangays"].includes(level)) {
    return NextResponse.json({ ok: false, message: "Unknown location level." }, { status: 400 });
  }

  let path: string;
  switch (level) {
    case "regions":
      path = "regions/";
      break;
    case "provinces":
      if (!isCode(region)) {
        return NextResponse.json({ ok: false, message: "Choose a region first." }, { status: 400 });
      }
      path = `regions/${region}/provinces/`;
      break;
    case "cities":
      if (province) {
        if (!isCode(province)) {
          return NextResponse.json({ ok: false, message: "Malformed province code." }, { status: 400 });
        }
        path = `provinces/${province}/cities-municipalities/`;
      } else {
        if (!isCode(region)) {
          return NextResponse.json({ ok: false, message: "Choose a region first." }, { status: 400 });
        }
        path = `regions/${region}/cities-municipalities/`;
      }
      break;
    case "barangays":
      if (!isCode(city)) {
        return NextResponse.json(
          { ok: false, message: "Choose a city or municipality first." },
          { status: 400 },
        );
      }
      path = `cities-municipalities/${city}/barangays/`;
      break;
  }

  try {
    const upstream = await fetch(`${UPSTREAM}/${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
      next: { revalidate: 86_400 },
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { ok: false, message: "The location service is unavailable right now." },
        { status: 502 },
      );
    }

    const rows: unknown = await upstream.json();
    if (!Array.isArray(rows)) {
      return NextResponse.json(
        { ok: false, message: "The location service returned an unexpected response." },
        { status: 502 },
      );
    }

    const places: PlaceOption[] = rows.flatMap((row) => {
      const item = row as Record<string, unknown>;
      const code = clean(item.code);
      const name = clean(item.name);
      return code && name ? [{ code, name }] : [];
    });

    return NextResponse.json({ ok: true, places });
  } catch (error) {
    console.error("[locations:read]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load locations. Try again." },
      { status: 502 },
    );
  }
}

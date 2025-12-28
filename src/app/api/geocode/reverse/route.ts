import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pickFirst<T>(...values: Array<T | null | undefined>) {
  for (const v of values) {
    if (v == null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    return v;
  }
  return null;
}

function normalizeRegion(raw: string | null) {
  if (!raw) return null;
  const v = raw.trim();
  if (!v) return null;
  return v.replace(/^regi[oó]n\s+/i, "").replace(/\s+de\s+santiago$/i, " Metropolitana").trim();
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const latRaw = url.searchParams.get("lat");
  const lngRaw = url.searchParams.get("lng");

  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat_lng_required" }, { status: 400 });
  }

  const nominatimUrl = new URL("https://nominatim.openstreetmap.org/reverse");
  nominatimUrl.searchParams.set("format", "jsonv2");
  nominatimUrl.searchParams.set("lat", String(lat));
  nominatimUrl.searchParams.set("lon", String(lng));
  nominatimUrl.searchParams.set("zoom", "18");
  nominatimUrl.searchParams.set("addressdetails", "1");
  nominatimUrl.searchParams.set("accept-language", "es");

  try {
    const res = await fetch(nominatimUrl.toString(), {
      headers: {
        "User-Agent": "geimser-itsm/1.0",
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ error: "geocode_failed", status: res.status }, { status: 502 });
    }
    const data = (await res.json()) as {
      display_name?: string;
      address?: Record<string, string | undefined>;
    };
    const a = data.address ?? {};

    const regionRaw = pickFirst(a.state, a.region, a.state_district) ?? null;
    const comuna =
      pickFirst(a.municipality, a.city, a.town, a.village, a.city_district, a.suburb, a.county) ?? null;

    const road = pickFirst(a.road, a.pedestrian) ?? null;
    const houseNumber = pickFirst(a.house_number) ?? null;
    const addrLine = [road, houseNumber].filter(Boolean).join(" ").trim();
    const address = pickFirst(addrLine, data.display_name) ?? null;

    return NextResponse.json({
      ok: true,
      region: normalizeRegion(regionRaw),
      region_raw: regionRaw,
      comuna,
      address,
      raw: data,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: "geocode_failed", detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}


import { NextRequest, NextResponse } from "next/server";
import { parseLatLng, parseNumber } from "@/lib/geo";
import { buildHazardsSummary } from "@/lib/hazards";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const latlng = parseLatLng(searchParams.get("lat") ?? undefined, searchParams.get("lng") ?? undefined);
    const radiusKm = parseNumber(searchParams.get("radiusKm") ?? undefined, 100);
    const years = parseNumber(searchParams.get("years") ?? undefined, 5);
    if (!latlng) {
      return NextResponse.json({ error: "Invalid lat/lng" }, { status: 400 });
    }
    const summary = await buildHazardsSummary(latlng, radiusKm, years);
    return NextResponse.json(summary, { status: 200 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

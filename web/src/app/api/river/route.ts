import { NextRequest, NextResponse } from "next/server";
import { parseLatLng } from "@/lib/geo";
import { analyzeRiverTrend, fetchGageLevels, findNearestUsgsGage } from "@/lib/river";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const latlng = parseLatLng(searchParams.get("lat") ?? undefined, searchParams.get("lng") ?? undefined);
    if (!latlng) return NextResponse.json({ error: "Invalid lat/lng" }, { status: 400 });

    const gage = await findNearestUsgsGage(latlng);
    if (!gage) return NextResponse.json({ error: "No gage found nearby" }, { status: 404 });

    const readings = await fetchGageLevels(gage.siteCode);
    const trend = analyzeRiverTrend(gage, readings);
    return NextResponse.json(trend, { status: 200 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

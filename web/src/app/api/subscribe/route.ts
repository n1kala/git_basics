import { NextRequest, NextResponse } from "next/server";

// In-memory store for hackathon demo only
const subscribers = new Map<string, { lat: number; lng: number; radiusKm: number; createdAt: number }>();

type SubscribeBody = { email: string; lat: number; lng: number; radiusKm?: number };

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<SubscribeBody>;
    const { email, lat, lng, radiusKm } = body;
    if (!email || typeof email !== "string") return NextResponse.json({ error: "Email required" }, { status: 400 });
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
    const finalRadius = Number.isFinite(radiusKm as number) ? (radiusKm as number) : 50;
    subscribers.set(email, { lat: lat as number, lng: lng as number, radiusKm: finalRadius, createdAt: Date.now() });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ subscribers: Array.from(subscribers.entries()).map(([email, v]) => ({ email, ...v })) });
}

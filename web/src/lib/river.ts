import { LatLng, haversineDistanceKm } from "@/lib/geo";

export type GageSite = {
  siteCode: string;
  siteName: string;
  coordinates: { lat: number; lng: number };
};

export type GageReading = {
  timestamp: string;
  value: number;
};

export type RiverTrend = {
  site: GageSite;
  readings: GageReading[];
  rising: boolean;
  riseRatePerHour: number;
  message: string;
};

export async function findNearestUsgsGage(center: LatLng): Promise<GageSite | null> {
  // Query recent instantaneous values within a small bounding box to discover nearby gages
  const deltaDeg = 0.5; // ~55 km
  const west = center.lng - deltaDeg;
  const east = center.lng + deltaDeg;
  const south = center.lat - deltaDeg;
  const north = center.lat + deltaDeg;
  const params = new URLSearchParams({
    format: "json",
    bBox: `${west},${south},${east},${north}`,
    parameterCd: "00065", // Gage height
    siteStatus: "active",
    siteType: "ST",
    period: "P1D",
  });
  const url = `https://waterservices.usgs.gov/nwis/iv/?${params}`;
  const res = await fetch(url, { next: { revalidate: 900 } });
  if (!res.ok) throw new Error(`USGS IV discovery failed: ${res.status}`);
  const data = await res.json();
  const series: unknown[] = data?.value?.timeSeries ?? [];
  type SourceInfo = {
    siteCode?: Array<{ value?: string }>;
    siteName?: string;
    geoLocation?: { geogLocation?: { latitude?: number; longitude?: number } };
  };
  const candidates: GageSite[] = (series as Array<{ sourceInfo?: SourceInfo }>)
    .map((ts) => ts?.sourceInfo)
    .filter(Boolean)
    .map((si) => ({
      siteCode: String(si?.siteCode?.[0]?.value ?? ""),
      siteName: String(si?.siteName ?? ""),
      coordinates: {
        lat: Number(si?.geoLocation?.geogLocation?.latitude),
        lng: Number(si?.geoLocation?.geogLocation?.longitude),
      },
    }))
    .filter((s: GageSite) => Number.isFinite(s.coordinates.lat) && Number.isFinite(s.coordinates.lng));
  if (!candidates.length) return null;
  let best: GageSite | null = null;
  let bestD = Infinity;
  for (const s of candidates) {
    const d = haversineDistanceKm(center, s.coordinates);
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

export async function fetchGageLevels(siteCode: string): Promise<GageReading[]> {
  const params = new URLSearchParams({ format: "json", sites: siteCode, parameterCd: "00065", period: "P3D" });
  const url = `https://waterservices.usgs.gov/nwis/iv/?${params}`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`USGS IV failed: ${res.status}`);
  const data = await res.json();
  const points: unknown[] = data?.value?.timeSeries?.[0]?.values?.[0]?.value ?? [];
  return (points as Array<{ dateTime?: string; value?: string | number }>)
    .map((p) => ({ timestamp: String(p?.dateTime ?? ""), value: Number(p?.value) }))
    .filter((r: GageReading) => Number.isFinite(r.value));
}

export function analyzeRiverTrend(site: GageSite, readings: GageReading[]): RiverTrend {
  if (readings.length < 2) {
    return { site, readings, rising: false, riseRatePerHour: 0, message: "Insufficient data" };
  }
  const recent = readings.slice(-12); // last ~12 samples
  const first = new Date(recent[0].timestamp).getTime();
  const last = new Date(recent[recent.length - 1].timestamp).getTime();
  const hours = Math.max(0.1, (last - first) / 3600000);
  const delta = recent[recent.length - 1].value - recent[0].value;
  const rate = delta / hours;
  const rising = rate > 0.01; // 1 cm/hour threshold if units are feet, still relative

  const message = rising
    ? `River level rising at ~${rate.toFixed(2)} per hour`
    : `River level stable/falling (~${rate.toFixed(2)} per hour)`;

  return { site, readings: recent, rising, riseRatePerHour: rate, message };
}

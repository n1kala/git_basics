import { LatLng, haversineDistanceKm, isoDateNYearsAgo } from "@/lib/geo";

export type EonetEvent = {
  id: string;
  title: string;
  categories: { id: number; title: string }[];
  geometry: { date: string; magnitudeValue?: number; magnitudeUnit?: string; type: string; coordinates: number[] }[];
  link?: string;
};

export type EarthquakeFeature = {
  id: string;
  properties: {
    mag: number | null;
    place: string;
    time: number;
    url: string;
  };
  geometry: { type: string; coordinates: [number, number, number?] };
};

export type HazardsSummary = {
  center: LatLng;
  radiusKm: number;
  lookbackYears: number;
  counts: {
    earthquakes: number;
    eonetByCategory: Record<string, number>;
  };
  earthquakes: Array<{
    id: string;
    mag: number | null;
    place: string;
    time: number;
    url: string;
    coordinates: { lat: number; lng: number };
  }>;
  eonetEvents: Array<{
    id: string;
    title: string;
    categories: string[];
    time: string;
    coordinates: { lat: number; lng: number };
    link?: string;
  }>;
};

const EONET_BASE = "https://eonet.gsfc.nasa.gov/api/v3";

export async function fetchEonetEvents(center: LatLng, radiusKm: number, lookbackYears: number): Promise<EonetEvent[]> {
  const days = Math.max(30, Math.min(365 * lookbackYears, 3650));
  const url = `${EONET_BASE}/events?status=all&days=${encodeURIComponent(days)}&limit=500`;
  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`EONET request failed: ${res.status}`);
  const data = await res.json();
  const events: EonetEvent[] = data.events ?? [];
  // Filter by distance to any geometry point
  const filtered = events.filter((ev) => {
    return ev.geometry?.some((g) => {
      const coords = g.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) return false;
      const [lng, lat] = coords;
      const d = haversineDistanceKm(center, { lat, lng });
      return d <= radiusKm;
    });
  });
  return filtered;
}

export async function fetchEarthquakes(center: LatLng, radiusKm: number, lookbackYears: number, minMagnitude = 3): Promise<EarthquakeFeature[]> {
  const start = isoDateNYearsAgo(lookbackYears);
  const params = new URLSearchParams({
    format: "geojson",
    starttime: start,
    endtime: new Date().toISOString().slice(0, 10),
    latitude: String(center.lat),
    longitude: String(center.lng),
    maxradiuskm: String(radiusKm),
    minmagnitude: String(minMagnitude),
    orderby: "time-asc",
    limit: "20000",
  });
  const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?${params.toString()}`;
  const res = await fetch(url, { next: { revalidate: 600 } });
  if (!res.ok) throw new Error(`USGS earthquake request failed: ${res.status}`);
  const data = await res.json();
  const features: EarthquakeFeature[] = data.features ?? [];
  return features;
}

export async function buildHazardsSummary(center: LatLng, radiusKm: number, lookbackYears: number): Promise<HazardsSummary> {
  const [eonet, eqs] = await Promise.all([
    fetchEonetEvents(center, radiusKm, lookbackYears),
    fetchEarthquakes(center, radiusKm, lookbackYears, 3),
  ]);

  const eonetByCategory: Record<string, number> = {};
  for (const ev of eonet) {
    for (const c of ev.categories ?? []) {
      eonetByCategory[c.title] = (eonetByCategory[c.title] ?? 0) + 1;
    }
  }

  const earthquakes = eqs.map((f) => ({
    id: f.id,
    mag: f.properties.mag,
    place: f.properties.place,
    time: f.properties.time,
    url: f.properties.url,
    coordinates: { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] },
  }));

  const eonetEvents = eonet.map((ev) => {
    const g = ev.geometry?.[ev.geometry.length - 1];
    const [lng, lat] = Array.isArray(g?.coordinates) ? g!.coordinates : [0, 0];
    return {
      id: ev.id,
      title: ev.title,
      categories: (ev.categories ?? []).map((c) => c.title),
      time: g?.date ?? "",
      coordinates: { lat, lng },
      link: ev.link,
    };
  });

  return {
    center,
    radiusKm,
    lookbackYears,
    counts: {
      earthquakes: earthquakes.length,
      eonetByCategory,
    },
    earthquakes,
    eonetEvents,
  };
}

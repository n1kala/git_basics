"use client";

import { useEffect, useMemo, useState } from "react";

type Coordinates = { lat: number; lng: number };

function useGeolocation(): Coordinates | null {
  const [coords, setCoords] = useState<Coordinates | null>(null);
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setCoords(null)
    );
  }, []);
  return coords;
}

export default function Home() {
  const browserCoords = useGeolocation();
  const [manual, setManual] = useState<Coordinates | null>(null);
  const coords = useMemo<Coordinates>(() => {
    return manual ?? browserCoords ?? { lat: 37.7749, lng: -122.4194 };
  }, [manual, browserCoords]);

  const [years, setYears] = useState(5);
  const [radiusKm, setRadiusKm] = useState(150);

  type Hazards = {
    earthquakes: Array<{ id: string; mag: number | null; place: string; time: number; url: string; coordinates: Coordinates }>;
    eonetEvents: Array<{ id: string; title: string; categories: string[]; time: string; coordinates: Coordinates; link?: string }>;
  } | null;
  type Advice = { risk: { overall: number }; advice: { level: string; business: string; home: string } } | null;
  type River = { message: string; site: { siteName: string; siteCode: string } } | null;
  const [hazards, setHazards] = useState<Hazards>(null);
  const [advice, setAdvice] = useState<Advice>(null);
  const [river, setRiver] = useState<River>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");

  const query = useMemo(() => ({ coords, years, radiusKm }), [coords, years, radiusKm]);

  async function runQueries() {
    setLoading(true);
    setError(null);
    try {
      const [haz, adv, riv]: [unknown, unknown, unknown] = await Promise.all([
        fetch(`/api/hazards?lat=${coords.lat}&lng=${coords.lng}&years=${years}&radiusKm=${radiusKm}`).then((r) => r.json()),
        fetch(`/api/advice?lat=${coords.lat}&lng=${coords.lng}&years=${years}&radiusKm=${radiusKm}`).then((r) => r.json()),
        fetch(`/api/river?lat=${coords.lat}&lng=${coords.lng}`).then((r) => r.json()),
      ]);
      const hasError = (v: unknown): v is { error: string } =>
        typeof v === "object" && v !== null && "error" in v;
      if (hasError(haz) || hasError(adv) || hasError(riv)) {
        const err = (hasError(haz) && haz.error) || (hasError(adv) && adv.error) || (hasError(riv) && riv.error) || "Error";
        throw new Error(err);
      }
      setHazards(haz as Hazards);
      setAdvice(adv as Advice);
      setRiver(riv as River);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to load data";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    runQueries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.coords?.lat, query.coords?.lng, query.years, query.radiusKm]);

  return (
    <div className="min-h-screen p-6 sm:p-10">
      <div className="max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl sm:text-3xl font-bold">Natural Disaster Risk & Advisory</h1>
        <p className="text-sm text-gray-600">Enter a location or use your current position to estimate hazard probabilities, business/home advice, and river rise alerts.</p>

        <div className="grid sm:grid-cols-3 gap-3">
          <input
            type="text"
            placeholder="lat,lng (e.g. 34.05,-118.24)"
            className="border rounded px-3 py-2 w-full"
            onBlur={(e) => {
              const v = e.target.value.trim();
              const m = v.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
              if (m) setManual({ lat: Number(m[1]), lng: Number(m[2]) });
            }}
          />
          <label className="flex items-center gap-2">
            <span className="text-sm w-28">Years</span>
            <input
              type="number"
              className="border rounded px-2 py-1 w-full"
              min={1}
              max={20}
              value={years}
              onChange={(e) => setYears(Number(e.target.value))}
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-sm w-28">Radius (km)</span>
            <input
              type="number"
              className="border rounded px-2 py-1 w-full"
              min={10}
              max={500}
              value={radiusKm}
              onChange={(e) => setRadiusKm(Number(e.target.value))}
            />
          </label>
        </div>

        <div className="flex gap-2">
          <button className="px-4 py-2 rounded bg-black text-white" onClick={runQueries} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
          <span className="text-sm text-gray-500">Using: {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}</span>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-end">
          <label className="flex-1 w-full">
            <span className="block text-sm mb-1">Email for alerts</span>
            <input
              type="email"
              placeholder="you@example.com"
              className="border rounded px-3 py-2 w-full"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <button
            className="px-4 py-2 rounded border"
            onClick={async () => {
              if (!email) return;
              await fetch("/api/subscribe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, lat: coords.lat, lng: coords.lng, radiusKm }),
              });
              setEmail("");
              alert("Subscribed for demo notifications.");
            }}
          >
            Subscribe
          </button>
        </div>

        {error && <div className="p-3 rounded bg-red-50 text-red-700">{error}</div>}

        {advice && (
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="p-4 rounded border">
              <h2 className="font-semibold mb-2">Overall Risk</h2>
              <div className="text-3xl font-bold">{Math.round(advice.risk.overall * 100)}%</div>
              <div className="text-xs text-gray-500 capitalize">{advice.advice.level} risk</div>
            </div>
            <div className="p-4 rounded border">
              <h2 className="font-semibold mb-2">Business Advice</h2>
              <p className="text-sm text-gray-700">{advice.advice.business}</p>
            </div>
            <div className="p-4 rounded border">
              <h2 className="font-semibold mb-2">Home Advice</h2>
              <p className="text-sm text-gray-700">{advice.advice.home}</p>
            </div>
          </div>
        )}

        {hazards && (
          <div className="p-4 rounded border">
            <h2 className="font-semibold mb-2">Recent Hazards</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <h3 className="font-medium">Earthquakes: {hazards.earthquakes.length}</h3>
                <ul className="text-sm mt-2 space-y-1 max-h-56 overflow-auto">
                  {hazards.earthquakes.slice(-10).reverse().map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">M{e.mag ?? "?"} – {e.place}</span>
                      <a className="text-blue-600 hover:underline text-xs" href={e.url} target="_blank" rel="noreferrer">USGS</a>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="font-medium">EONET Events: {hazards.eonetEvents.length}</h3>
                <ul className="text-sm mt-2 space-y-1 max-h-56 overflow-auto">
                  {hazards.eonetEvents.slice(-10).reverse().map((ev) => (
                    <li key={ev.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">{ev.title}</span>
                      {ev.link && (
                        <a className="text-blue-600 hover:underline text-xs" href={ev.link} target="_blank" rel="noreferrer">Link</a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {river && (
          <div className="p-4 rounded border">
            <h2 className="font-semibold mb-2">River Rise</h2>
            <div className="text-sm">{river.message}</div>
            <div className="text-xs text-gray-500">Site: {river.site.siteName} ({river.site.siteCode})</div>
          </div>
        )}
      </div>
    </div>
  );
}

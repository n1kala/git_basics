import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import MapView from '../components/MapView'
import StabilityCard from '../components/StabilityCard'

// legacy series interface (unused currently)
// interface ClimateRow {
//   date: string
//   temperature_c: number | null
//   precip_mm: number | null
//   humidity_percent: number | null
// }

interface ClimateYearlyResponse {
  location: { lat: number; lon: number }
  years: { year: number; average_temperature_c: number | null; average_precip_mm: number | null; average_humidity_percent: number | null }[]
  projections?: {
    temperature_c?: { year: number; value: number }[]
    precip_mm?: { year: number; value: number }[]
  }
}

interface FiresResponse {
  bbox: { lat_min: number; lon_min: number; lat_max: number; lon_max: number }
  days: number
  total: number
  by_source: Record<string, number>
}

const API_BASE: string = (import.meta as any).env?.VITE_API_BASE ?? ''

export default function Dashboard() {
  const [params] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [yearly, setYearly] = useState<ClimateYearlyResponse | null>(null)
  const [stability, setStability] = useState<number | null>(null)
  const [fires, setFires] = useState<FiresResponse | null>(null)
  const [projectionText, setProjectionText] = useState<string | null>(null)
  const q = params.get('q')
  const lat = params.get('lat')
  const lon = params.get('lon')

  useEffect(() => {
    async function run() {
      setLoading(true)
      setError(null)
      try {
        let latitude: number
        let longitude: number

        if (q) {
          const geores = await fetch(`${API_BASE}/api/geocode?q=${encodeURIComponent(q)}`)
          if (!geores.ok) throw new Error('Failed to geocode location')
          const gj = await geores.json()
          latitude = gj.lat
          longitude = gj.lon
        } else if (lat && lon) {
          latitude = parseFloat(lat)
          longitude = parseFloat(lon)
        } else {
          throw new Error('Please provide a city or coordinates')
        }

        const currentYear = new Date().getFullYear()
        const startYear = currentYear - 19
        const clim = await fetch(`${API_BASE}/api/climate?lat=${latitude}&lon=${longitude}&start_year=${startYear}&end_year=${currentYear}`)
        if (!clim.ok) throw new Error('Failed to fetch climate data')
        const yr: ClimateYearlyResponse = await clim.json()
        setYearly(yr)

        // Stability score derived from recent trends
        const payload = { years: yr.years }
        const stabilityScore = computeStabilityScore(payload)
        setStability(stabilityScore)

        // Projection text for rainfall percentage change by 2035
        try {
          const lastActual = yr.years[yr.years.length - 1]?.year
          const proj = yr.projections?.precip_mm ?? []
          const pTarget = proj.find(p => p.year === 2035)
          const base = yr.years.find(y => y.year === lastActual)?.average_precip_mm ?? null
          if (pTarget && typeof base === 'number' && base > 0) {
            const deltaPct = Math.round(((pTarget.value - base) / base) * 100)
            const dir = deltaPct < 0 ? 'drop' : 'increase'
            const risk = deltaPct < 0 ? '— drought risk increasing.' : '— flood risk possible.'
            setProjectionText(`Predicted rainfall ${dir} of ${Math.abs(deltaPct)}% by 2035 ${risk}`)
          } else {
            setProjectionText(null)
          }
        } catch { setProjectionText(null) }

        // Fires in 2-degree bbox around location for last 30 days
        const latMin = latitude - 1
        const latMax = latitude + 1
        const lonMin = longitude - 1
        const lonMax = longitude + 1
        try {
          const fr = await fetch(`${API_BASE}/api/fires?lat_min=${latMin}&lon_min=${lonMin}&lat_max=${latMax}&lon_max=${lonMax}&days=30`)
          if (fr.ok) {
            const fj: FiresResponse = await fr.json()
            setFires(fj)
          }
        } catch {}
      } catch (e: any) {
        setError(e.message || 'Something went wrong')
        setYearly(null)
      } finally {
        setLoading(false)
      }
    }
    run()
  }, [q, lat, lon])

  const center: [number, number] | null = useMemo(() => {
    if (!yearly) return null
    return [yearly.location.lat, yearly.location.lon]
  }, [yearly])

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Dashboard</h2>
      {loading && (
        <div className="flex items-center gap-3 text-gray-500">
          <svg className="animate-spin h-5 w-5 text-brand" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
          </svg>
          <span>Loading…</span>
        </div>
      )}
      {error && <div className="text-red-600">{error}</div>}

      {yearly && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
            <div className="lg:col-span-2 p-0 overflow-hidden rounded-md border border-gray-200 dark:border-gray-800 h-[360px]">
              {center && (
                <MapView
                  lat={center[0]}
                  lon={center[1]}
                  onSelect={(la, lo) => {
                    window.location.href = `/dashboard?lat=${la}&lon=${lo}`
                  }}
                />
              )}
            </div>
            <StabilityCard score={stability} />
          </div>

          {projectionText && (
            <div className="p-4 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              <div className="text-sm text-gray-500 mb-1">Projection</div>
              <div className="text-sm">{projectionText}</div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <ChartCard title="Temperature (°C)">
              <YearlyChart
                data={yearly.years.map(y => ({ date: String(y.year), value: y.average_temperature_c }))}
                proj={yearly.projections?.temperature_c?.map(p => ({ date: String(p.year), value: p.value })) ?? []}
                color="#ef4444"
              />
            </ChartCard>
            <ChartCard title="Precipitation (mm)">
              <YearlyChart
                data={yearly.years.map(y => ({ date: String(y.year), value: y.average_precip_mm }))}
                proj={yearly.projections?.precip_mm?.map(p => ({ date: String(p.year), value: p.value })) ?? []}
                color="#0ea5e9"
              />
            </ChartCard>
            <div className="p-4 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              <div className="text-sm text-gray-500 mb-2">Recent Wildfire Activity</div>
              {fires ? (
                <div className="space-y-1 text-sm">
                  <div><span className="text-gray-500">Last {fires.days} days:</span> <span className="font-medium">{fires.total}</span> events</div>
                  <div className="text-gray-500">By source:</div>
                  <ul className="list-disc pl-6">
                    {Object.entries(fires.by_source).map(([k, v]) => (
                      <li key={k}>{k}: {v}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="text-gray-500 text-sm">No data</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-4 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="text-sm text-gray-500 mb-2">{title}</div>
      {children}
    </div>
  )
}

function YearlyChart({ data, proj = [], color }: { data: { date: string; value: number | null }[]; proj?: { date: string; value: number }[]; color: string }) {
  const filtered = useMemo(() => data.filter((d) => typeof d.value === 'number'), [data])
  const projFiltered = useMemo(() => proj.filter((d) => typeof d.value === 'number'), [proj])
  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={filtered} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} interval={Math.max(0, Math.floor(filtered.length / 8))} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="value" stroke={color} dot={false} strokeWidth={2} />
          {projFiltered.length > 0 && (
            <Line type="monotone" data={projFiltered} dataKey="value" stroke={color} strokeDasharray="5 5" dot={false} strokeWidth={2} />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function computeStabilityScore(data: { years: { year: number; average_temperature_c: number | null; average_precip_mm: number | null }[] }): number {
  // Lightweight client-side estimation aligned with backend thresholds
  const years = data.years.slice(-20)
  if (!years.length) return 0
  const xs = years.map((_, i) => i)
  const slope = (ys: (number | null)[]) => {
    const pts = xs.map((x, i) => [x, ys[i]] as const).filter(([, y]) => typeof y === 'number') as [number, number][]
    if (pts.length < 2) return 0
    const n = pts.length
    const meanX = pts.reduce((a, [x]) => a + x, 0) / n
    const meanY = pts.reduce((a, [, y]) => a + y, 0) / n
    let sxx = 0, sxy = 0
    for (const [x, y] of pts) {
      sxx += (x - meanX) * (x - meanX)
      sxy += (x - meanX) * (y - meanY)
    }
    return sxx === 0 ? 0 : sxy / sxx
  }
  const tSlope = slope(years.map(y => y.average_temperature_c))
  const pSeries = years.map(y => y.average_precip_mm)
  const pSlope = slope(pSeries)
  const pMean = (() => {
    const vals = pSeries.filter((v): v is number => typeof v === 'number')
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
  })()
  const relPSlope = pMean > 0 ? pSlope / pMean : 0

  const piece = (x: number, lo: number, hi: number) => {
    const ax = Math.abs(x)
    if (ax <= lo) return 0
    if (ax >= hi) return 1
    return (ax - lo) / (hi - lo)
  }
  const tempPenalty = piece(tSlope, 0.02, 0.05)
  const dryingPen = piece(Math.min(0, relPSlope), 0.01, 0.03)
  const wettingPen = 0.5 * piece(Math.max(0, relPSlope), 0.01, 0.03)
  const precipPenalty = Math.max(dryingPen, wettingPen)
  const overall = 0.6 * tempPenalty + 0.4 * precipPenalty
  const score = Math.max(0, Math.min(100, Math.round(100 * (1 - overall))))
  return score
}

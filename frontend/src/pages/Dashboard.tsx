import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

interface ClimateRow {
  date: string
  temperature_c: number | null
  precip_mm: number | null
  humidity_percent: number | null
}

interface ClimateResponse {
  location: { lat: number; lon: number }
  period: { start: string | null; end: string | null }
  series: ClimateRow[]
  suitability_score: number
}

const API_BASE: string = (import.meta as any).env?.VITE_API_BASE ?? ''

export default function Dashboard() {
  const [params] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ClimateResponse | null>(null)
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

        const clim = await fetch(`${API_BASE}/api/climate/history?lat=${latitude}&lon=${longitude}`)
        if (!clim.ok) throw new Error('Failed to fetch climate data')
        const cj: ClimateResponse = await clim.json()
        setData(cj)
      } catch (e: any) {
        setError(e.message || 'Something went wrong')
        setData(null)
      } finally {
        setLoading(false)
      }
    }
    run()
  }, [q, lat, lon])

  const center: [number, number] | null = useMemo(() => {
    if (!data) return null
    return [data.location.lat, data.location.lon]
  }, [data])

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Dashboard</h2>
      {loading && <div className="text-gray-500">Loading…</div>}
      {error && <div className="text-red-600">{error}</div>}

      {data && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
            <div className="lg:col-span-2 p-0 overflow-hidden rounded-md border border-gray-200 dark:border-gray-800 h-[360px]">
              {center && (
                <MapContainer center={center} zoom={8} style={{ height: '100%', width: '100%' }}>
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <Marker position={center}>
                    <Popup>Selected location</Popup>
                  </Marker>
                </MapContainer>
              )}
            </div>
            <div className="p-6 rounded-md border border-gray-200 dark:border-gray-800 flex flex-col justify-center items-start bg-white dark:bg-gray-900">
              <div className="text-sm text-gray-500">Business Suitability</div>
              <div className="text-5xl font-bold mt-2">{data.suitability_score}</div>
              <div className="mt-3 h-2 w-full bg-gray-200 dark:bg-gray-800 rounded">
                <div
                  className="h-2 rounded bg-emerald-500"
                  style={{ width: `${data.suitability_score}%` }}
                />
              </div>
              <div className="text-xs text-gray-500 mt-2">0 = poor conditions · 100 = ideal</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <ChartCard title="Temperature (°C)">
              <SeriesChart data={data.series} dataKey="temperature_c" color="#ef4444" />
            </ChartCard>
            <ChartCard title="Precipitation (mm)">
              <SeriesChart data={data.series} dataKey="precip_mm" color="#0ea5e9" />
            </ChartCard>
            <ChartCard title="Humidity (%)">
              <SeriesChart data={data.series} dataKey="humidity_percent" color="#22c55e" />
            </ChartCard>
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

function SeriesChart({ data, dataKey, color }: { data: ClimateRow[]; dataKey: keyof ClimateRow; color: string }) {
  const filtered = useMemo(() => data.filter((d) => typeof d[dataKey] === 'number'), [data, dataKey])
  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={filtered} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} interval={Math.max(0, Math.floor(filtered.length / 8))} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey={dataKey as string} stroke={color} dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

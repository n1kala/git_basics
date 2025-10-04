import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function Home() {
  const [query, setQuery] = useState('')
  const navigate = useNavigate()

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return

    // If input looks like lat,lon navigate directly; else pass as q
    const coordMatch = trimmed.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/)
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1])
      const lon = parseFloat(coordMatch[2])
      navigate(`/dashboard?lat=${lat}&lon=${lon}`)
    } else {
      navigate(`/dashboard?q=${encodeURIComponent(trimmed)}`)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-semibold mb-6">EcoShield</h1>
      <p className="text-gray-600 dark:text-gray-300 mb-4">Enter a city name or coordinates to explore climate history and business suitability.</p>
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. Nairobi or 40.7128,-74.0060"
          className="flex-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-brand"
        />
        <button type="submit" className="rounded-md bg-brand text-white px-5 py-3 hover:bg-brand-dark transition">Search</button>
      </form>
      <div className="mt-6">
        <div className="text-sm text-gray-500 mb-2">Try demo cities:</div>
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'Houston (USA)', q: 'Houston, Texas' },
            { label: 'Tbilisi (Georgia)', q: 'Tbilisi, Georgia' },
            { label: 'Sydney (Australia)', q: 'Sydney, Australia' },
          ].map((c) => (
            <button
              key={c.label}
              onClick={() => navigate(`/dashboard?q=${encodeURIComponent(c.q)}`)}
              className="px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

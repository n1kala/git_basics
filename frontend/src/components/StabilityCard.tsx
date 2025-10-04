interface StabilityCardProps {
  score: number | null
}

function interpretation(score: number | null): string {
  if (score === null || Number.isNaN(score)) return 'Insufficient data'
  if (score >= 80) return 'Stable climate conditions'
  if (score >= 40) return 'Noticeable warming/drying trend'
  return 'Highly unstable conditions'
}

export default function StabilityCard({ score }: StabilityCardProps) {
  const safe = typeof score === 'number' ? Math.max(0, Math.min(100, score)) : 0
  const gradient = 'linear-gradient(90deg, #ef4444 0%, #f59e0b 50%, #22c55e 100%)'
  return (
    <div className="p-6 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="text-sm text-gray-500">Stability Score</div>
      <div className="flex items-end gap-3 mt-2">
        <div className="text-5xl font-bold">{score ?? '—'}</div>
        <div className="text-sm text-gray-500">/ 100</div>
      </div>
      <div className="mt-3 h-2 w-full bg-gray-200 dark:bg-gray-800 rounded overflow-hidden">
        <div
          className="h-2 rounded"
          style={{ width: `${safe}%`, background: gradient }}
        />
      </div>
      <div className="text-sm text-gray-600 dark:text-gray-300 mt-3">{interpretation(score)}</div>
    </div>
  )
}

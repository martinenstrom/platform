import { ArrowLeft, Clock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatRelativeTime, formatTime } from '~/lib/format'
import type { CountryMacroData } from '~/types/countryExplorer'

const CLASSIFICATION_LABEL: Record<CountryMacroData['marketClassification'], string> = {
  developed: 'Developed Market',
  emerging: 'Emerging Market',
  frontier: 'Frontier Market',
}

/**
 * How many of the analysis's 8 non-overview sections actually have content —
 * an honest completeness readout, not a fabricated confidence score.
 */
function countCoveredSections(data: CountryMacroData): {
  available: number
  total: number
} {
  const checks = [
    data.macro.length > 0,
    data.news.length > 0,
    data.markets !== null,
    data.sectors.length > 0,
    data.topCompanies.length > 0,
    data.investmentStrengths.length > 0 && data.investmentRisks.length > 0,
    data.scores !== null,
    data.triggers.length > 0,
  ]
  return { available: checks.filter(Boolean).length, total: checks.length }
}

export function CountryHeader({
  data,
  flagEmoji,
  onBack,
}: {
  data: CountryMacroData
  flagEmoji: string
  onBack: () => void
}) {
  // Client-only ticking clock — starts null so server/client markup match on hydration.
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const { available, total } = countCoveredSections(data)
  const coveragePercent = Math.round((available / total) * 100)

  return (
    <div className="flex flex-col gap-4 border-b border-line pb-4">
      <button
        type="button"
        onClick={onBack}
        className="hud-label inline-flex w-fit items-center gap-1.5 text-[10px] text-content-muted transition-colors duration-150 hover:text-accent"
      >
        <ArrowLeft className="h-3 w-3" aria-hidden="true" />
        Tillbaka till världskartan
      </button>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-3xl" aria-hidden="true">
          {flagEmoji}
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight text-content">
            {data.countryName}
          </h2>
          <p className="hud-label text-[10px] text-content-subtle">
            {data.countryCode} · {data.region.toUpperCase()}
          </p>
        </div>
        <span className="hud-frame ml-auto hidden shrink-0 rounded-md bg-accent-soft px-2.5 py-1 sm:block">
          <span className="hud-label text-[10px] text-accent">
            {CLASSIFICATION_LABEL[data.marketClassification]}
          </span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="hud-label inline-flex items-center gap-1.5 text-[10px] text-content-subtle">
          <Clock className="h-3 w-3" aria-hidden="true" />
          {now ? formatTime(now) : '--:--'}
        </span>
        <span className="hud-label text-[10px] text-content-subtle">
          Uppdaterad {now ? formatRelativeTime(data.lastUpdated, now) : '—'}
        </span>
        <span className="hud-label text-[10px] text-content-subtle">
          Datatäckning {available}/{total} sektioner ({coveragePercent} %)
        </span>
      </div>
    </div>
  )
}

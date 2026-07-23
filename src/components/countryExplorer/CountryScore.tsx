import { cn } from '~/lib/cn'
import { DataNotAvailable } from './DataSourceBadge'
import type { CountryScores } from '~/types/countryExplorer'

const DIMENSION_LABELS: Record<
  keyof Omit<CountryScores, 'overall' | 'classification' | 'cioConclusion'>,
  string
> = {
  macro: 'Makroekonomi',
  valuation: 'Värdering',
  earningsMomentum: 'Vinstmomentum',
  politicalStability: 'Politisk stabilitet',
  currencyRisk: 'Valutarisk',
  marketLiquidity: 'Marknadslikviditet',
  structuralGrowth: 'Strukturell tillväxt',
  cycleSensitivity: 'Konjunkturkänslighet',
  newsFlow: 'Nyhetsflöde',
}

const CLASSIFICATION_META: Record<
  CountryScores['classification'],
  { label: string; className: string }
> = {
  attractive: { label: 'Attractive', className: 'text-positive' },
  neutral: { label: 'Neutral', className: 'text-content' },
  cautious: { label: 'Cautious', className: 'text-warning' },
  'high-risk': { label: 'High Risk', className: 'text-negative' },
}

export function CountryScore({ scores }: { scores: CountryScores | null }) {
  if (!scores) {
    return (
      <section aria-labelledby="country-score-heading">
        <h3 id="country-score-heading" className="hud-label text-xs text-content-muted">
          Sammantagen investeringsbedömning
        </h3>
        <div className="hud-frame mt-3 flex items-center justify-center rounded-xl bg-surface p-8">
          <DataNotAvailable />
        </div>
      </section>
    )
  }

  const classification = CLASSIFICATION_META[scores.classification]
  const dimensions = Object.keys(DIMENSION_LABELS) as Array<keyof typeof DIMENSION_LABELS>

  return (
    <section aria-labelledby="country-score-heading" className="flex flex-col gap-4">
      <h3 id="country-score-heading" className="hud-label text-xs text-content-muted">
        Sammantagen investeringsbedömning
      </h3>

      <div className="hud-frame flex flex-col gap-4 rounded-lg bg-surface p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {dimensions.map((key) => (
            <div key={key} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-content-subtle">{DIMENSION_LABELS[key]}</span>
                <span className="font-mono text-content">{scores[key]}/10</span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${(scores[key] / 10) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="hud-glow flex flex-col items-center gap-1 rounded-lg bg-accent-soft py-5 text-center">
          <span className="hud-label text-[10px] text-content-subtle">
            Country Investment Score
          </span>
          <span className="font-mono text-3xl text-content">
            {scores.overall.toFixed(1)} / 10
          </span>
          <span className={cn('hud-label text-xs', classification.className)}>
            {classification.label}
          </span>
        </div>

        <p className="text-sm leading-relaxed text-content-muted">
          {scores.cioConclusion}
        </p>
      </div>
    </section>
  )
}

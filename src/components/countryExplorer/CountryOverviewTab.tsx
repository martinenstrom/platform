import type { ReactNode } from 'react'
import { cn } from '~/lib/cn'
import { StatusBadge } from '~/components/ui/StatusBadge'
import { DataNotAvailable } from './DataSourceBadge'
import type { CountryMacroData } from '~/types/countryExplorer'
import type { Tone } from '~/types'

const CLASSIFICATION_TONE: Record<
  NonNullable<CountryMacroData['scores']>['classification'],
  Tone
> = {
  attractive: 'positive',
  neutral: 'neutral',
  cautious: 'warning',
  'high-risk': 'negative',
}

const CONSENSUS_TONE: Record<string, Tone> = {
  Köp: 'positive',
  Behåll: 'neutral',
  Sälj: 'negative',
}

/**
 * The default "Overview" tab — a condensed cross-section of every other tab,
 * each snippet linking (via `onGoToTab`) to its full section rather than
 * repeating it in full.
 */
export function CountryOverviewTab({
  data,
  onGoToTab,
}: {
  data: CountryMacroData
  onGoToTab: (tabId: string) => void
}) {
  const positiveTriggers = data.triggers
    .filter((t) => t.direction === 'positive')
    .slice(0, 2)
  const negativeTriggers = data.triggers
    .filter((t) => t.direction === 'negative')
    .slice(0, 2)
  const topSectors = [...data.sectors]
    .sort((a, b) => b.domesticWeightPercent - a.domesticWeightPercent)
    .slice(0, 3)

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SnippetCard title="Investeringsbetyg" onViewAll={() => onGoToTab('scores')}>
          {data.scores ? (
            <div className="flex flex-col items-center gap-1 py-2 text-center">
              <span className="font-mono text-3xl text-content">
                {data.scores.overall.toFixed(1)} / 10
              </span>
              <StatusBadge tone={CLASSIFICATION_TONE[data.scores.classification]}>
                {data.scores.classification}
              </StatusBadge>
            </div>
          ) : (
            <DataNotAvailable />
          )}
        </SnippetCard>

        <SnippetCard title="Marknad" onViewAll={() => onGoToTab('markets')}>
          {data.markets ? (
            <div className="flex flex-col gap-1 py-1">
              <span className="hud-label text-[9px] text-content-subtle">
                {data.markets.primaryIndexName}
              </span>
              <span className="font-mono text-xl text-content">
                {data.markets.primaryIndexValue}
              </span>
              <span className="font-mono text-xs text-content-muted">
                {data.markets.indexChangeYtd} YTD
              </span>
            </div>
          ) : (
            <DataNotAvailable />
          )}
        </SnippetCard>

        <SnippetCard title="Key Triggers" onViewAll={() => onGoToTab('triggers')}>
          {data.triggers.length === 0 ? (
            <DataNotAvailable />
          ) : (
            <ul className="flex flex-col gap-1 text-xs text-content-muted">
              {positiveTriggers.map((trigger) => (
                <li key={trigger.label} className="truncate text-positive">
                  + {trigger.label}
                </li>
              ))}
              {negativeTriggers.map((trigger) => (
                <li key={trigger.label} className="truncate text-negative">
                  − {trigger.label}
                </li>
              ))}
            </ul>
          )}
        </SnippetCard>
      </div>

      <div>
        <SectionHeader title="Makro i korthet" onViewAll={() => onGoToTab('macro')} />
        {data.macro.length === 0 ? (
          <div className="hud-frame mt-3 flex items-center justify-center rounded-xl bg-surface p-8">
            <DataNotAvailable />
          </div>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {data.macro.slice(0, 4).map((indicator) => (
              <div key={indicator.id} className="hud-frame rounded-lg bg-surface p-3">
                <p className="hud-label truncate text-[9px] text-content-subtle">
                  {indicator.label}
                </p>
                <p className="mt-1 font-mono text-lg text-content">{indicator.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <SectionHeader title="Sektorprofil" onViewAll={() => onGoToTab('sectors')} />
        {topSectors.length === 0 ? (
          <div className="hud-frame mt-3 flex items-center justify-center rounded-xl bg-surface p-8">
            <DataNotAvailable />
          </div>
        ) : (
          <div className="hud-frame mt-2 flex flex-col gap-2 rounded-lg bg-surface p-4">
            {topSectors.map((sector) => (
              <div
                key={sector.sector}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-content">{sector.sector}</span>
                <span className="font-mono text-content-subtle">
                  {sector.domesticWeightPercent}%
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <SectionHeader title="Största bolag" onViewAll={() => onGoToTab('companies')} />
        {data.topCompanies.length === 0 ? (
          <div className="hud-frame mt-3 flex items-center justify-center rounded-xl bg-surface p-8">
            <DataNotAvailable />
          </div>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {data.topCompanies.slice(0, 5).map((company) => (
              <li
                key={company.ticker}
                className="hud-frame flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2 text-xs"
              >
                <span className="min-w-0 truncate text-content">
                  {company.name}
                  <span className="ml-2 text-content-subtle">{company.ticker}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-content-muted">
                    {company.ytdPerformance}
                  </span>
                  <StatusBadge
                    tone={CONSENSUS_TONE[company.analystConsensus] ?? 'neutral'}
                  >
                    {company.analystConsensus}
                  </StatusBadge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <SectionHeader title="Viktiga nyheter" onViewAll={() => onGoToTab('news')} />
        {data.news.length === 0 ? (
          <div className="hud-frame mt-3 flex items-center justify-center rounded-xl bg-surface p-8">
            <DataNotAvailable />
          </div>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {data.news.slice(0, 3).map((item) => (
              <li key={item.id} className="hud-frame rounded-lg bg-surface p-3">
                <p className="text-sm text-content">{item.headline}</p>
                <p className="mt-1 text-xs text-content-subtle">{item.source}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function SectionHeader({ title, onViewAll }: { title: string; onViewAll: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="hud-label text-xs text-content-muted">{title}</h3>
      <button
        type="button"
        onClick={onViewAll}
        className="hud-label text-[10px] text-accent transition-colors duration-150 hover:text-accent/80"
      >
        Visa alla →
      </button>
    </div>
  )
}

function SnippetCard({
  title,
  onViewAll,
  children,
  className,
}: {
  title: string
  onViewAll: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn('hud-frame flex flex-col gap-2 rounded-lg bg-surface p-4', className)}
    >
      <SectionHeader title={title} onViewAll={onViewAll} />
      {children}
    </div>
  )
}

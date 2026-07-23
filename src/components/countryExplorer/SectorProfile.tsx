import { DataNotAvailable } from './DataSourceBadge'
import type { SectorWeight } from '~/types/countryExplorer'

export function SectorProfile({
  sectors,
  analysis,
}: {
  sectors: SectorWeight[]
  analysis: string | null
}) {
  if (sectors.length === 0) {
    return (
      <section aria-labelledby="sector-profile-heading">
        <h3 id="sector-profile-heading" className="hud-label text-xs text-content-muted">
          Sektorprofil
        </h3>
        <div className="hud-frame mt-3 flex items-center justify-center rounded-xl bg-surface p-8">
          <DataNotAvailable />
        </div>
      </section>
    )
  }

  const maxWeight = Math.max(...sectors.map((s) => s.domesticWeightPercent))

  return (
    <section aria-labelledby="sector-profile-heading" className="flex flex-col gap-4">
      <h3 id="sector-profile-heading" className="hud-label text-xs text-content-muted">
        Sektorprofil
      </h3>

      <div className="hud-frame flex flex-col gap-3 rounded-lg bg-surface p-4">
        {sectors.map((sector) => {
          const isOverweight =
            sector.domesticWeightPercent > sector.globalIndexWeightPercent
          return (
            <div key={sector.sector} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-content">{sector.sector}</span>
                <span className="font-mono text-content-subtle">
                  {sector.domesticWeightPercent}%{' '}
                  <span className={isOverweight ? 'text-positive' : 'text-negative'}>
                    ({isOverweight ? '+' : ''}
                    {(
                      sector.domesticWeightPercent - sector.globalIndexWeightPercent
                    ).toFixed(0)}{' '}
                    pp vs. globalt index)
                  </span>
                </span>
              </div>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
                role="progressbar"
                aria-valuenow={sector.domesticWeightPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${sector.sector}: ${sector.domesticWeightPercent}% av marknaden`}
              >
                <div
                  className="h-full rounded-full bg-accent"
                  style={{
                    width: `${(sector.domesticWeightPercent / maxWeight) * 100}%`,
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>

      {analysis && (
        <p className="text-sm leading-relaxed text-content-muted">{analysis}</p>
      )}
    </section>
  )
}

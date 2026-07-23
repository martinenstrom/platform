import { DataNotAvailable } from './DataSourceBadge'
import type { InvestmentRisk } from '~/types/countryExplorer'

export function InvestmentRisks({ risks }: { risks: InvestmentRisk[] }) {
  return (
    <section aria-labelledby="investment-risks-heading" className="flex flex-col gap-3">
      <h3 id="investment-risks-heading" className="hud-label text-xs text-content-muted">
        Investment Risks // Weaknesses
      </h3>

      {risks.length === 0 ? (
        <div className="hud-frame flex items-center justify-center rounded-xl bg-surface p-8">
          <DataNotAvailable />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {risks.map((risk) => (
            <div key={risk.heading} className="hud-frame rounded-lg bg-negative-soft p-4">
              <h4 className="hud-label text-[10px] text-negative">{risk.heading}</h4>
              <p className="mt-2 text-sm leading-relaxed text-content-muted">
                {risk.analysis}
              </p>
              <p className="mt-2 text-xs text-content-subtle">
                <span className="hud-label text-[9px]">Sannolik marknadspåverkan </span>
                {risk.probableMarketImpact}
              </p>
              {risk.monitor.length > 0 && (
                <p className="mt-1 text-xs text-content-subtle">
                  <span className="hud-label text-[9px]">Bevaka </span>
                  {risk.monitor.join(', ')}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

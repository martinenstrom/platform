import { DataNotAvailable } from './DataSourceBadge'
import type { InvestmentStrength } from '~/types/countryExplorer'

export function InvestmentStrengths({ strengths }: { strengths: InvestmentStrength[] }) {
  return (
    <section
      aria-labelledby="investment-strengths-heading"
      className="flex flex-col gap-3"
    >
      <h3
        id="investment-strengths-heading"
        className="hud-label text-xs text-content-muted"
      >
        Investment Case // Strengths
      </h3>

      {strengths.length === 0 ? (
        <div className="hud-frame flex items-center justify-center rounded-xl bg-surface p-8">
          <DataNotAvailable />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {strengths.map((strength) => (
            <div
              key={strength.heading}
              className="hud-frame rounded-lg bg-positive-soft p-4"
            >
              <h4 className="hud-label text-[10px] text-positive">{strength.heading}</h4>
              <p className="mt-2 text-sm leading-relaxed text-content-muted">
                {strength.analysis}
              </p>
              <p className="mt-2 text-xs text-content-subtle">
                <span className="hud-label text-[9px]">Passar </span>
                {strength.suitableFor}
              </p>
              {strength.relevantSectors.length > 0 && (
                <p className="mt-1 text-xs text-content-subtle">
                  <span className="hud-label text-[9px]">Sektorer </span>
                  {strength.relevantSectors.join(', ')}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

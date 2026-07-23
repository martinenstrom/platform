import { DataNotAvailable } from './DataSourceBadge'
import type { CountryNewsSynthesis as Synthesis } from '~/types/countryExplorer'

export function CountryNewsSynthesis({ synthesis }: { synthesis: Synthesis | null }) {
  if (!synthesis) {
    return (
      <div className="hud-frame rounded-lg bg-surface p-4">
        <h4 className="hud-label text-[10px] text-content-muted">
          Vad betyder detta för investerare
        </h4>
        <div className="mt-3">
          <DataNotAvailable />
        </div>
      </div>
    )
  }

  return (
    <div className="hud-frame rounded-lg bg-accent-soft p-4">
      <h4 className="hud-label text-[10px] text-accent">
        Vad betyder detta för investerare
      </h4>
      <p className="mt-2 text-sm leading-relaxed text-content">
        {synthesis.investorImplications}
      </p>
      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="hud-label text-[9px] text-content-subtle">Gynnas</dt>
          <dd className="text-content-muted">
            {synthesis.sectorsLikelyToBenefit.join(', ')}
          </dd>
        </div>
        <div>
          <dt className="hud-label text-[9px] text-content-subtle">Riskexponerade</dt>
          <dd className="text-content-muted">
            {synthesis.sectorsFacingRisks.join(', ')}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="hud-label text-[9px] text-content-subtle">Bevaka</dt>
          <dd className="text-content-muted">
            {synthesis.indicatorsToMonitor.join(', ')}
          </dd>
        </div>
      </dl>
    </div>
  )
}

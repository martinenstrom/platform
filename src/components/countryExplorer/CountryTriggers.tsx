import { Minus, Plus } from 'lucide-react'
import { DataNotAvailable } from './DataSourceBadge'
import type { CountryTrigger } from '~/types/countryExplorer'

export function CountryTriggers({ triggers }: { triggers: CountryTrigger[] }) {
  const positive = triggers.filter((t) => t.direction === 'positive')
  const negative = triggers.filter((t) => t.direction === 'negative')

  return (
    <section aria-labelledby="country-triggers-heading" className="flex flex-col gap-3">
      <h3 id="country-triggers-heading" className="hud-label text-xs text-content-muted">
        Key Triggers
      </h3>

      {triggers.length === 0 ? (
        <div className="hud-frame flex items-center justify-center rounded-xl bg-surface p-8">
          <DataNotAvailable />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ul className="flex flex-col gap-2">
            {positive.map((trigger) => (
              <li
                key={trigger.label}
                className="flex items-start gap-2 text-sm text-content-muted"
              >
                <Plus
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-positive"
                  aria-hidden="true"
                />
                {trigger.label}
              </li>
            ))}
          </ul>
          <ul className="flex flex-col gap-2">
            {negative.map((trigger) => (
              <li
                key={trigger.label}
                className="flex items-start gap-2 text-sm text-content-muted"
              >
                <Minus
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-negative"
                  aria-hidden="true"
                />
                {trigger.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

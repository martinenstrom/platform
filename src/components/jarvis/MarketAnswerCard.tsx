import { cn } from '~/lib/cn'
import type { MarketCard, MarketCardItem } from '~/presentation/jarvis/marketCard'

/**
 * A period answer on screen: per instrument the change over the period,
 * the start and the latest observation with their dates, the source and
 * the data's own time, and a small sparkline of the measured series. A
 * compact analytical block, not a charting workstation; every string comes
 * ready from the presentation layer.
 */
export function MarketAnswerCard({ card }: { card: MarketCard }) {
  return (
    <div className="mt-2 flex flex-col gap-2" data-market-card>
      {card.items.map((item) => (
        <MarketCardBlock key={item.symbol} item={item} />
      ))}
      {card.difference && <p className="type-metadata px-0.5">{card.difference}.</p>}
      {card.missing.length > 0 && (
        <p className="type-metadata px-0.5">
          Ej verifierat för perioden: {card.missing.join(', ')}.
        </p>
      )}
    </div>
  )
}

function MarketCardBlock({ item }: { item: MarketCardItem }) {
  return (
    <section
      aria-label={`${item.name} ${item.periodLabel.toLowerCase()}`}
      className="rounded-md border border-line bg-surface-2/60 px-3 py-2.5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-display text-[15px] leading-tight text-content">{item.name}</p>
        <p
          className={cn(
            'type-display-figure-sm text-[20px] leading-none',
            item.tone === 'up' && 'text-positive',
            item.tone === 'down' && 'text-negative',
            item.tone === 'flat' && 'text-content-muted',
          )}
        >
          {item.change}
        </p>
      </div>
      <p className="type-section mt-0.5 text-[9px] tracking-[0.12em]">
        {item.periodLabel}
      </p>
      {item.spark.length > 1 && <Sparkline values={item.spark} tone={item.tone} />}
      <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5">
        <Figure label="Start" value={item.start.value} note={item.start.date} />
        <Figure label="Senast" value={item.latest.value} note={item.latest.date} />
        <Figure label="Period" value={item.span} />
      </dl>
      <p className="type-metadata mt-2">
        Underlag: {item.source}
        {item.asOf ? ` · ${item.asOf}` : ''}
      </p>
      {item.stale && <p className="type-metadata mt-0.5 text-warning">{item.stale}</p>}
    </section>
  )
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0">
      <dt className="type-section text-[8.5px] tracking-[0.1em]">{label}</dt>
      <dd className="tabular mt-0.5 truncate text-[12.5px] font-semibold text-content">
        {value}
      </dd>
      {note && <dd className="type-machine normal-case text-content-subtle">{note}</dd>}
    </div>
  )
}

/** The measured series as one thin line; the first and last values set its ends. */
function Sparkline({
  values,
  tone,
}: {
  values: readonly number[]
  tone: MarketCardItem['tone']
}) {
  const width = 240
  const height = 36
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width
      const y = height - 3 - ((value - min) / range) * (height - 6)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="mt-1.5 h-9 w-full"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <polyline
        points={points}
        fill="none"
        strokeWidth={1.4}
        className={cn(
          tone === 'up' && 'stroke-positive',
          tone === 'down' && 'stroke-negative',
          tone === 'flat' && 'stroke-content-muted',
        )}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

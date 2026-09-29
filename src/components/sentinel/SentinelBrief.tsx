import { Link } from '@tanstack/react-router'
import type {
  SentinelBrief as SentinelBriefModel,
  SentinelEntry,
} from '~/application/advisory/sentinel'
import { cn } from '~/lib/cn'
import {
  briefingLine,
  contextLine,
  preparation,
  priorityTitle,
  SEVERITY_LABEL,
  STRENGTHENED_BY_MARKET,
  whyNow,
} from '~/presentation/advisory/sentinelText'

/**
 * Sentinel on the dashboard: the few clients that need the advisor today,
 * beside the markets — the morning brief's client half.
 *
 * Rendered inside the dashboard's own section card, in the dashboard's own
 * tile language, so it reads as one more module of the same screen. The
 * numbers are the brief's; the words are the presentation layer's.
 */

/** The dashboard's inner tile, mirrored from the market cards so the two match. */
const TILE =
  'rounded-[10px] border border-[rgba(54,119,155,0.22)] bg-[rgba(6,18,29,0.55)] transition-colors duration-200 hover:border-[rgba(54,119,155,0.36)]'
const LABEL = 'text-[11px] font-medium tracking-[0.2em] uppercase text-[#6f88a0]'

const SEVERITY_TONE = {
  critical: 'text-negative',
  high: 'text-warning',
  normal: 'text-[#9aa7b7]',
  low: 'text-[#6f88a0]',
} as const

/** The compact intelligence mark: Sentinel belongs to the same layer as JARVIS. */
export function SentinelMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'type-section inline-flex items-center gap-1.5 text-accent',
        className,
      )}
    >
      <span aria-hidden="true" className="h-1 w-1 rounded-full bg-current" />
      Sentinel
    </span>
  )
}

/** Under the greeting: three counts and a door, nothing more. */
export function SentinelGreeting({ brief }: { brief: SentinelBriefModel }) {
  const lines = briefingLine(brief.metrics)
  return (
    <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12.5px] text-[#9aa7b7]">
      <SentinelMark />
      <span>{lines.join(' · ')}</span>
      <Link
        to="/sentinel"
        className="text-[11px] font-medium tracking-[0.12em] text-[#7f97ad] uppercase hover:text-[#f4f7fb]"
      >
        Öppna prioriteringarna →
      </Link>
    </p>
  )
}

/** The module body: the highest-ranked active priorities, at most `limit`. */
export function SentinelBriefList({
  brief,
  limit = 4,
}: {
  brief: SentinelBriefModel
  limit?: number
}) {
  const active = brief.entries.filter(
    (e) => e.status === 'active' || e.status === 'reviewed',
  )
  const shown = active.slice(0, limit)
  const count = brief.metrics.clientsNeedingAttention

  if (active.length === 0) {
    return (
      <p className="text-[13px] text-[#9aa7b7]">
        Ingen klient behöver din uppmärksamhet i dag. {brief.metrics.quietClients}{' '}
        relationer är i ordning.
      </p>
    )
  }

  return (
    <div>
      <p className="text-[13px] text-[#9aa7b7]">
        {count === 1
          ? '1 klient behöver din uppmärksamhet'
          : `${count} klienter behöver din uppmärksamhet`}
        {brief.metrics.quietClients > 0 && (
          <span className="text-[#6f88a0]">
            {' '}
            · {brief.metrics.quietClients} utan prioritet
          </span>
        )}
      </p>
      <ol className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {shown.map((entry, index) => (
          <BriefTile key={entry.priority.id} entry={entry} index={index + 1} />
        ))}
      </ol>
    </div>
  )
}

function BriefTile({ entry, index }: { entry: SentinelEntry; index: number }) {
  const { priority, client } = entry
  return (
    <li className={cn(TILE, 'flex flex-col p-3.5')}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="tabular text-[11px] font-medium tracking-[0.2em] text-[#6f88a0]">
          {String(index).padStart(2, '0')}
        </span>
        <span
          className={cn(
            'text-[10px] font-medium tracking-[0.14em] uppercase',
            SEVERITY_TONE[priority.severity],
          )}
        >
          {SEVERITY_LABEL[priority.severity]}
        </span>
      </div>
      <p className="mt-1.5 truncate text-[13px] font-semibold tracking-[0.06em] text-[#f4f7fb] uppercase">
        {client.displayName}
      </p>
      <p className="mt-2 text-[13px] font-medium leading-snug text-[#e8edf7]">
        {priorityTitle(entry)}
      </p>
      <p className="mt-1 text-[12px] leading-snug text-[#9aa7b7]">{whyNow(priority)}</p>
      {priority.strengthenedByMarket && (
        <p className="mt-1 text-[10px] font-medium tracking-[0.1em] text-[#73c8ff] uppercase">
          {STRENGTHENED_BY_MARKET}
        </p>
      )}
      <p className="mt-2 text-[11px] text-[#6f88a0]">{contextLine(entry)}</p>
      <p className="mt-2 flex-1 text-[12px] leading-snug text-[#c7d0dc]">
        <span className={cn(LABEL, 'mr-1.5 text-[10px]')}>Förberedelse</span>
        {preparation(priority)}
      </p>
      <Link
        to="/clients/$clientId"
        params={{ clientId: client.id }}
        className="mt-3 inline-block self-start text-[11px] font-medium tracking-[0.12em] text-[#7f97ad] uppercase hover:text-[#f4f7fb]"
      >
        Öppna klient →
      </Link>
    </li>
  )
}

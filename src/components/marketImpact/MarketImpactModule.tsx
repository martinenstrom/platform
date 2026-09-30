import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Users } from 'lucide-react'
import type { MarketEpisode } from '~/application/advisory/marketEpisodes'
import type {
  MarketEventEntry,
  MarketImpactBrief,
} from '~/application/advisory/marketImpact'
import { cn } from '~/lib/cn'
import {
  dashboardEpisodes,
  episodeCountsText,
  episodeHeadline,
  marketMoveText,
  observedAtText,
  QUALITY_LABEL,
  RELEVANCE_LABEL,
  SEVERITY_LABEL,
} from '~/presentation/advisory/marketImpactText'

/**
 * Market-to-Client on the dashboard: the restrained answer to *which of my
 * clients does this move touch?* — a count beside the market row, and one
 * module listing the episodes that touch somebody. Rendered in the
 * dashboard's own tile language, so it reads as one more module of the
 * same screen.
 *
 * An episode, not an event: seven touching moves in one broad selloff are
 * one tile with its moves listed beneath and the events on request. A move
 * nobody is exposed to earns no mark and no tile here; it is still listed,
 * with its zero, on `/market-impact`.
 */

const TILE =
  'rounded-[10px] border border-[rgba(54,119,155,0.22)] bg-[rgba(6,18,29,0.55)] transition-colors duration-200 hover:border-[rgba(54,119,155,0.36)]'
const LABEL = 'text-[11px] font-medium tracking-[0.2em] uppercase text-[#6f88a0]'

const RELEVANCE_TONE = {
  high: 'text-warning',
  medium: 'text-[#c9d6e2]',
  low: 'text-[#6f88a0]',
} as const

/** The events at least one client is meaningfully (medium or high) exposed to — the row marks. */
export function meaningfulEvents(brief: MarketImpactBrief): MarketEventEntry[] {
  return brief.events.filter((entry) => entry.meaningful > 0)
}

/**
 * "3 klienter" beside a market row — only when someone is meaningfully
 * exposed, and as quiet as a mark can be: muted blue-grey text with no
 * border and no fill, lit only under the pointer. It is the market command
 * centre's one pointer into the JARVIS workspace, not a module of it. Three
 * shapes for three widths: `text` where a card has room, `compact` (a glyph
 * and the number) where a disclosure badge already competes for the row,
 * and `badge` — a count pinned to the corner of the row's own glyph, taking
 * no width at all — for the narrowest rows. The full text is the link's
 * accessible name in every shape.
 */
export function AffectedClientsMark({
  entry,
  variant = 'text',
}: {
  entry: MarketEventEntry | undefined
  variant?: 'text' | 'compact' | 'badge'
}) {
  if (!entry || entry.meaningful === 0) return null
  const text = entry.meaningful === 1 ? '1 klient' : `${entry.meaningful} klienter`
  const shared = {
    to: '/market-impact' as const,
    hash: entry.event.id,
    title: `Vilka klienter berörs? ${text}`,
    'aria-label': `${text} berörs av ${marketMoveText(entry.event)}`,
  }
  if (variant === 'badge') {
    return (
      <Link
        {...shared}
        className="absolute -top-1.5 -right-2 flex h-3.5 min-w-[14px] items-center justify-center rounded-full border border-[rgba(70,130,163,0.3)] bg-[rgba(6,14,23,0.95)] px-0.5 text-[9px] leading-none font-medium text-[#8fa6bb] transition-colors duration-200 hover:border-[rgba(70,130,163,0.55)] hover:text-[#e8edf7]"
      >
        {entry.meaningful}
      </Link>
    )
  }
  return (
    <Link
      {...shared}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 text-[10px] font-medium tracking-[0.1em] whitespace-nowrap text-[#6f88a0] uppercase transition-colors duration-200 hover:text-[#e8edf7]',
        variant === 'compact' ? 'ml-1.5' : 'ml-2',
      )}
    >
      {variant === 'compact' ? (
        <>
          <Users className="h-2.5 w-2.5" aria-hidden="true" />
          {entry.meaningful}
        </>
      ) : (
        text
      )}
    </Link>
  )
}

/**
 * A row's own glyph with the count pinned to its corner when someone is
 * exposed — and the glyph alone, untouched, otherwise, so a screen without
 * impacts is the screen it was before Market-to-Client existed.
 */
export function GlyphWithAffectedClients({
  entry,
  children,
}: {
  entry: MarketEventEntry | undefined
  children: ReactNode
}) {
  if (!entry || entry.meaningful === 0) return <>{children}</>
  return (
    <span className="relative flex shrink-0">
      {children}
      <AffectedClientsMark entry={entry} variant="badge" />
    </span>
  )
}

/** The module body: at most three episodes that touch somebody, with the names. */
export function MarketImpactList({ brief }: { brief: MarketImpactBrief }) {
  const shown = dashboardEpisodes(brief.episodes)
  const touching = brief.episodes.filter((e) => e.meaningful > 0).length
  return (
    <div>
      <p className="text-[13px] text-[#9aa7b7]">
        {brief.affectedClients === 1
          ? '1 klient berörs'
          : `${brief.affectedClients} klienter berörs`}{' '}
        av {touching === 1 ? '1 marknadsepisod' : `${touching} marknadsepisoder`}
        {touching > shown.length && (
          <span className="text-[#6f88a0]"> · {shown.length} visas här</span>
        )}
        {brief.scenario && (
          <span className="text-[#6f88a0]"> · exempelscenario {brief.scenario}</span>
        )}
      </p>
      <ol
        className={cn(
          'mt-3 grid gap-3',
          shown.length >= 3 ? 'md:grid-cols-2 xl:grid-cols-3' : 'md:grid-cols-2',
        )}
      >
        {shown.map((episode) => (
          <EpisodeTile key={episode.id} episode={episode} />
        ))}
      </ol>
    </div>
  )
}

function EpisodeTile({ episode }: { episode: MarketEpisode }) {
  const meaningful = episode.affected.filter((a) => a.relevance !== 'low').slice(0, 5)
  const freshest = episode.events[0]!.event
  return (
    <li className={cn(TILE, 'flex flex-col p-3.5')}>
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={cn(
            'text-[10px] font-medium tracking-[0.14em] uppercase',
            episode.severity === 'major' ? 'text-warning' : 'text-[#9aa7b7]',
          )}
        >
          {SEVERITY_LABEL[episode.severity]}
        </span>
        <span className="text-[10px] tracking-[0.08em] text-[#6f88a0] uppercase">
          {QUALITY_LABEL[freshest.quality]}
        </span>
      </div>
      <p className="mt-1.5 text-[13px] font-semibold text-[#f4f7fb]">
        {episodeHeadline(episode)}
      </p>
      {episode.kind !== 'single' && (
        <ul className="mt-1 space-y-0.5 text-[12px] text-[#c9d6e2]">
          {episode.events.slice(0, 4).map((e) => (
            <li key={e.event.id}>{marketMoveText(e.event)}</li>
          ))}
          {episode.events.length > 4 && (
            <li className="text-[#6f88a0]">+{episode.events.length - 4} till</li>
          )}
        </ul>
      )}
      <p className="mt-1 text-[11px] leading-snug text-[#6f88a0]">
        Observerad {observedAtText(episode.observedAt)}
      </p>
      <p className={cn(LABEL, 'mt-2.5 text-[10px]')}>{episodeCountsText(episode)}</p>
      <ul className="mt-1 flex-1 space-y-0.5">
        {meaningful.map((a) => (
          <li
            key={a.client.id}
            className="flex items-baseline justify-between gap-2 text-[12px]"
          >
            <Link
              to="/clients/$clientId"
              params={{ clientId: a.client.id }}
              className="truncate text-[#e8edf7] hover:text-white"
            >
              {a.client.displayName}
            </Link>
            <span
              className={cn(
                'shrink-0 text-[10px] font-medium tracking-[0.1em] uppercase',
                RELEVANCE_TONE[a.relevance],
              )}
            >
              {RELEVANCE_LABEL[a.relevance]}
              {a.sentinel?.strengthenedByMarket || a.sentinel?.anchoredByMarket
                ? ' · Sentinel'
                : ''}
            </span>
          </li>
        ))}
        {episode.affected.filter((a) => a.relevance !== 'low').length >
          meaningful.length && (
          <li className="text-[11px] text-[#6f88a0]">
            +
            {episode.affected.filter((a) => a.relevance !== 'low').length -
              meaningful.length}{' '}
            till
          </li>
        )}
      </ul>
      {episode.kind !== 'single' && (
        <details className="mt-2">
          <summary className="cursor-pointer list-none text-[11px] tracking-[0.08em] text-[#7f97ad] uppercase hover:text-[#f4f7fb]">
            {episode.events.length} underliggande händelser
          </summary>
          <ul className="mt-1 space-y-0.5 border-l border-[rgba(70,130,163,0.25)] pl-2 text-[11px] text-[#9aa7b7]">
            {episode.events.map((e) => (
              <li key={e.event.id} className="flex justify-between gap-2">
                <Link
                  to="/market-impact"
                  hash={e.event.id}
                  className="hover:text-[#f4f7fb]"
                >
                  {marketMoveText(e.event)}
                </Link>
                <span className="shrink-0 tabular-nums">
                  {e.meaningful === 1 ? '1 klient' : `${e.meaningful} klienter`}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <Link
        to="/market-impact"
        hash={episode.events[0]!.event.id}
        className="mt-3 inline-block self-start text-[11px] font-medium tracking-[0.12em] text-[#7f97ad] uppercase hover:text-[#f4f7fb]"
      >
        Varför det är relevant →
      </Link>
    </li>
  )
}

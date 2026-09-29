import { Link } from '@tanstack/react-router'
import type { MarketEpisode } from '~/application/advisory/marketEpisodes'
import type {
  AffectedClient,
  MarketEventEntry,
  MarketImpactBrief,
} from '~/application/advisory/marketImpact'
import type { Relevance } from '~/domain/advisory'
import { MATERIALITY } from '~/domain/advisory'
import { Panel } from '~/components/ui/Panel'
import { cn } from '~/lib/cn'
import { formatLongDate } from '~/presentation/advisory/format'
import {
  CATEGORY_LABEL,
  concernMatches,
  DIRECTNESS_LABEL,
  episodeCountsText,
  episodeHeadline,
  freshnessText,
  marketFactText,
  marketMoveText,
  observedAtText,
  QUALITY_LABEL,
  RELEVANCE_LABEL,
  RELEVANCE_OR_NONE_LABEL,
  relevanceSplitText,
  relevanceText,
  SEVERITY_LABEL,
} from '~/presentation/advisory/marketImpactText'
import {
  SEVERITY_LABEL as SENTINEL_SEVERITY_LABEL,
  STRENGTHENED_BY_MARKET,
  THEME_LABEL,
} from '~/presentation/advisory/sentinelText'
import { SEGMENT_SHORT } from '~/presentation/advisory/text'
import { ImpactExplanation } from './ImpactExplanation'

/**
 * The affected-clients view: every open market event against every client
 * it touches, as a matrix and then as explanations — one per event and
 * client, in the five sections. An event nobody is exposed to is listed
 * with its zero: the product is comfortable saying a move is not a client
 * matter.
 */

const RELEVANCE_TONE: Record<Relevance, string> = {
  high: 'text-warning',
  medium: 'text-content',
  low: 'text-content-muted',
}

export function MarketToClientMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'type-section inline-flex items-center gap-1.5 text-accent',
        className,
      )}
    >
      <span aria-hidden="true" className="h-1 w-1 rounded-full bg-current" />
      Market-to-Client
    </span>
  )
}

export function MarketImpactMatrix({ brief }: { brief: MarketImpactBrief }) {
  const clients = clientColumns(brief)
  const highCount = brief.events.reduce((sum, e) => sum + e.counts.high, 0)
  const tiles: { label: string; value: number; tone?: 'warning' | 'accent' }[] = [
    { label: 'Materiella rörelser', value: brief.events.length },
    {
      label: 'Berörda klienter',
      value: brief.affectedClients,
      tone: brief.affectedClients > 0 ? 'warning' : undefined,
    },
    {
      label: 'Hög relevans',
      value: highCount,
      tone: highCount > 0 ? 'warning' : undefined,
    },
    { label: 'Bedömda klienter', value: brief.clientsAssessed },
  ]

  return (
    <div className="flex flex-col gap-2">
      <header className="ref-panel px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <MarketToClientMark />
            <h1 className="mt-1 text-[22px] font-semibold leading-tight tracking-[-0.01em] text-content">
              Marknadspåverkan
            </h1>
            <p className="type-inst-sub mt-1">
              {brief.affectedClients === 1
                ? '1 klient berörs'
                : `${brief.affectedClients} klienter berörs`}{' '}
              av{' '}
              {brief.events.length === 1
                ? '1 materiell rörelse'
                : `${brief.events.length} materiella rörelser`}
              {' · '}en bedömning per klient och rörelse, aldrig en rekommendation
            </p>
          </div>
          <p className="type-machine text-right">
            derivat per {formatLongDate(brief.today)} · {brief.method} · syntetiska
            klienter
            {brief.observedAt && (
              <> · marknadsdata observerad {observedAtText(brief.observedAt)}</>
            )}
            {brief.scenario && <> · exempelscenario {brief.scenario}</>}
          </p>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-y-2 border-t border-line pt-3 md:grid-cols-4">
          {tiles.map((tile) => (
            <div key={tile.label} className="min-w-0 pr-3">
              <dt className="type-section truncate">{tile.label}</dt>
              <dd
                className={cn(
                  'type-figure mt-0.5',
                  tile.tone === 'warning' && 'text-warning',
                  tile.tone === 'accent' && 'text-accent',
                )}
              >
                {tile.value}
              </dd>
            </div>
          ))}
        </dl>
      </header>

      <Panel
        title="Marknadsepisoder"
        meta={
          brief.episodes.length === 0
            ? 'inga öppna episoder'
            : `${brief.episodes.length} ${brief.episodes.length === 1 ? 'episod' : 'episoder'} över ${brief.events.length} ${brief.events.length === 1 ? 'händelse' : 'händelser'}`
        }
        bodyClassName="p-0"
      >
        {brief.episodes.length === 0 ? (
          <p className="type-inst-sub px-3 py-3">
            Inga relaterade rörelser att gruppera. Episoder är en läsning för rådgivaren
            över samma händelser – händelserna nedan är underlaget, oförändrade.
          </p>
        ) : (
          <ol className="divide-y divide-line">
            {brief.episodes.map((episode) => (
              <EpisodeRow key={episode.id} episode={episode} />
            ))}
          </ol>
        )}
      </Panel>

      <Panel
        title="Vilka klienter berörs?"
        meta={`${clients.length} klienter med minst en bedömning`}
        bodyClassName="p-0"
      >
        {brief.events.length === 0 ? (
          <div className="px-3 py-3">
            <p className="type-inst-sub">
              Inga materiella marknadsrörelser just nu. Ingen klient behöver kontaktas på
              grund av marknaden.
            </p>
            <p className="type-machine mt-1">{thresholdSummary()}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[12px]">
              <thead>
                <tr className="border-b border-line">
                  <th className="type-section px-3 py-2 text-left font-medium">
                    Rörelse
                  </th>
                  {clients.map((c) => (
                    <th key={c.id} className="px-2 py-2 text-left">
                      <Link
                        to="/clients/$clientId"
                        params={{ clientId: c.id }}
                        className="type-section font-medium text-content hover:text-institution"
                      >
                        {c.displayName}
                      </Link>
                    </th>
                  ))}
                  {clients.length === 0 && (
                    <th className="type-section px-2 py-2 text-left font-medium">
                      Berörda klienter
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {brief.events.map((entry) => (
                  <tr
                    key={entry.event.id}
                    className="border-b border-line last:border-b-0"
                  >
                    <td className="px-3 py-2 align-top">
                      <a
                        href={`#${entry.event.id}`}
                        className="font-medium text-content hover:text-institution"
                      >
                        {marketMoveText(entry.event)}
                      </a>
                      <p className="type-machine mt-0.5">
                        {CATEGORY_LABEL[entry.event.category]} ·{' '}
                        {SEVERITY_LABEL[entry.event.severity].toLowerCase()} ·{' '}
                        {QUALITY_LABEL[entry.event.quality].toLowerCase()}
                      </p>
                    </td>
                    {clients.map((c) => {
                      const cell = entry.affected.find((a) => a.client.id === c.id)
                      return (
                        <td key={c.id} className="px-2 py-2 align-top">
                          {cell ? (
                            <span
                              className={cn(
                                'type-section',
                                RELEVANCE_TONE[cell.impact.relevance],
                              )}
                            >
                              {RELEVANCE_LABEL[cell.impact.relevance]}
                              {cell.impact.directness === 'contextual'
                                ? ' · kontext'
                                : ''}
                            </span>
                          ) : (
                            <span className="text-content-subtle">–</span>
                          )}
                        </td>
                      )
                    })}
                    {clients.length === 0 && (
                      <td className="px-2 py-2 align-top text-content-subtle">ingen</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {brief.events.map((entry) => (
        <EventPanel key={entry.event.id} entry={entry} />
      ))}
    </div>
  )
}

/**
 * One episode: the advisor's reading over related events, with the events
 * listed beneath and every touched client at the strongest verdict any of
 * them gave. The events keep their own panels below; nothing is replaced.
 */
function EpisodeRow({ episode }: { episode: MarketEpisode }) {
  const meaningful = episode.affected.filter((a) => a.relevance !== 'low')
  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[14px] font-medium text-content">
          <span
            className={cn(
              'type-section mr-2',
              episode.severity === 'major' ? 'text-warning' : 'text-content-muted',
            )}
          >
            {SEVERITY_LABEL[episode.severity]}
          </span>
          {episodeHeadline(episode)}
        </p>
        <p className="type-machine">
          {episodeCountsText(episode)} · {episode.events.length}{' '}
          {episode.events.length === 1 ? 'händelse' : 'händelser'} · observerad{' '}
          {observedAtText(episode.observedAt)}
        </p>
      </div>
      {episode.kind !== 'single' && (
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-content-muted">
          {episode.events.map((e) => (
            <li key={e.event.id}>
              <a href={`#${e.event.id}`} className="hover:text-institution">
                {marketMoveText(e.event)}
              </a>
              <span className="type-machine ml-1">
                {e.meaningful === 1 ? '1 klient' : `${e.meaningful} klienter`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {meaningful.length > 0 ? (
        <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px]">
          {meaningful.map((a) => (
            <li key={a.client.id} className="flex items-baseline gap-1.5">
              <Link
                to="/clients/$clientId"
                params={{ clientId: a.client.id }}
                className="text-content hover:text-institution"
              >
                {a.client.displayName}
              </Link>
              <span className={cn('type-section', RELEVANCE_TONE[a.relevance])}>
                {RELEVANCE_LABEL[a.relevance]}
              </span>
              <span className="type-machine">
                fin. {RELEVANCE_OR_NONE_LABEL[a.financialRelevance].toLowerCase()} ·
                samtal {RELEVANCE_OR_NONE_LABEL[a.conversationRelevance].toLowerCase()}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="type-inst-sub mt-1">Ingen klient berörs meningsfullt.</p>
      )}
    </li>
  )
}

function clientColumns(brief: MarketImpactBrief): { id: string; displayName: string }[] {
  const seen = new Map<string, string>()
  for (const entry of brief.events)
    for (const a of entry.affected) seen.set(a.client.id, a.client.displayName)
  return [...seen.entries()]
    .map(([id, displayName]) => ({ id, displayName }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'sv'))
}

function thresholdSummary(): string {
  const m = MATERIALITY
  return `Trösklar: räntor ${m.rates.enter} bp · aktieindex ${m.equities.enter} % · sektorer ${m.sectors.enter} % mot index · valuta ${m.fx.enter} % · råvaror ${m.commodities.enter} % · riskaptit ${m['risk-appetite'].enter} p under neutralt`
}

function EventPanel({ entry }: { entry: MarketEventEntry }) {
  const { event } = entry
  return (
    <section id={event.id} className="ref-panel flex min-w-0 scroll-mt-16 flex-col">
      <header className="ref-head">
        <h2 className="type-section truncate">
          <span
            className={cn(event.severity === 'major' ? 'text-warning' : 'text-content')}
          >
            {SEVERITY_LABEL[event.severity]}
          </span>
          {' · '}
          {marketMoveText(event)}
        </h2>
        <span className="type-machine shrink-0">
          {entry.affected.length === 0
            ? 'ingen klient berörs'
            : `${entry.affected.length} ${entry.affected.length === 1 ? 'klient' : 'klienter'} · ${entry.counts.high} hög · ${entry.counts.medium} medel · ${entry.counts.low} låg`}
        </span>
      </header>
      <div className="p-3">
        <p className="text-[13px] text-content">{marketFactText(event)}</p>
        <p className="type-machine mt-0.5">
          {freshnessText(event)} · {event.id}
        </p>
        {entry.affected.length === 0 ? (
          <p className="type-inst-sub mt-3 border-t border-line pt-3">
            Ingen klient berörs. Ingen registrerad exponering eller klientkontext talar
            till rörelsen, så ingen prioritet skapas och ingen kontakt föreslås.
          </p>
        ) : (
          <ol className="mt-3 divide-y divide-line border-t border-line">
            {entry.affected.map((a) => (
              <AffectedRow key={a.client.id} affected={a} />
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}

function AffectedRow({ affected }: { affected: AffectedClient }) {
  const { client, impact, sentinel } = affected
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <Link
            to="/clients/$clientId"
            params={{ clientId: client.id }}
            className="type-inst-lg hover:text-institution"
          >
            {client.displayName}
          </Link>
          <span className="type-inst-sub ml-2">
            {SEGMENT_SHORT[client.segment]} · {client.advisorName}
          </span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className={cn('type-section', RELEVANCE_TONE[impact.relevance])}>
            {RELEVANCE_LABEL[impact.relevance]} relevans
          </span>
          <span className="type-machine">{DIRECTNESS_LABEL[impact.directness]}</span>
          {concernMatches(impact) && (
            <span className="type-machine text-warning">
              klienten har själv tagit upp ämnet
            </span>
          )}
        </div>
      </div>
      <p className="mt-1 text-[12.5px] text-content">
        <span className="type-section mr-1.5">Varför det är relevant</span>
        {relevanceText(impact)}
      </p>
      <p className="type-machine mt-0.5">{relevanceSplitText(impact)}</p>
      <p className="type-machine mt-0.5">
        Sentinel:{' '}
        {sentinel
          ? `${SENTINEL_SEVERITY_LABEL[sentinel.severity]} · ${THEME_LABEL[sentinel.theme]}${
              sentinel.anchoredByMarket
                ? ' · skapad av marknadsrörelsen'
                : sentinel.strengthenedByMarket
                  ? ` · ${STRENGTHENED_BY_MARKET}`
                  : sentinel.carriesEvent
                    ? ' · rörelsen ligger som underlag'
                    : ' · rörelsen når inte prioriteringen (låg relevans)'
            }${sentinel.status !== 'active' ? ` · ${sentinel.status}` : ''}`
          : 'ingen prioritet – rörelsen räcker inte för en'}
      </p>
      <details className="mt-1.5">
        <summary className="type-machine cursor-pointer list-none underline decoration-dotted underline-offset-2 hover:text-content">
          Marknadsfakta · klientexponering · klientkontext · tolkning · förberedelse
        </summary>
        <ImpactExplanation impact={impact} className="mt-2 border-l border-line pl-3" />
      </details>
    </li>
  )
}

/**
 * Market-to-Client, as the advisor reads it: the market fact, the client's
 * exposure, the client's context, an interpretation typed as one, and what
 * to prepare — in Swedish, once, from the typed impact.
 *
 * Every sentence quotes the numbers its reason carries. The interpretation
 * says what a move means for this record and never what to do about it;
 * the preparation supports the advisor's judgement and never makes the
 * financial decision ("ta fram…", "förbered…", never "sälj", "köp" or
 * "lås räntan").
 */

import type {
  ClientMarketImpact,
  Directness,
  ImpactReason,
  MarketCategory,
  MarketEvent,
  MarketQuality,
  MarketSeverity,
  Region,
  Relevance,
  RelevanceOrNone,
  Sector,
} from '~/domain/advisory'
import type {
  MarketEpisode,
  MarketEpisodeKind,
} from '~/application/advisory/marketEpisodes'
import type { MarketChangeSince } from '~/application/advisory/marketImpact'
import { formatDayMonth, formatLongDate, formatMsek, formatPoints } from './format'

const LOCALE = 'sv-SE'
const oneDecimal = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const twoDecimals = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const noDecimal = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 })
const timeOfDay = new Intl.DateTimeFormat(LOCALE, {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Stockholm',
})

/* ------------------------------------------------------------------ labels */

export const CATEGORY_LABEL: Record<MarketCategory, string> = {
  rates: 'Räntor',
  equities: 'Aktier',
  sectors: 'Sektorer',
  fx: 'Valuta',
  commodities: 'Råvaror',
  'risk-appetite': 'Riskaptit',
}

export const RELEVANCE_LABEL: Record<Relevance, string> = {
  high: 'Hög',
  medium: 'Medel',
  low: 'Låg',
}

export const RELEVANCE_OR_NONE_LABEL: Record<RelevanceOrNone, string> = {
  high: 'Hög',
  medium: 'Medel',
  low: 'Låg',
  none: 'Ingen',
}

export const DIRECTNESS_LABEL: Record<Directness, string> = {
  direct: 'Direkt exponering',
  contextual: 'Kontextuell relevans',
}

/** The advisor-facing name of an episode; a single-event episode is named by its event. */
export const EPISODE_LABEL: Record<MarketEpisodeKind, string> = {
  'global-risk-off': 'Globalt risk-off',
  'equity-selloff': 'Bred aktienedgång',
  'equity-rally': 'Bred aktieuppgång',
  'rates-up': 'Ränteuppgång på bred front',
  'rates-down': 'Räntenedgång på bred front',
  'energy-selloff': 'Energinedgång',
  'energy-rally': 'Energiuppgång',
  'sek-weaker': 'Kronan försvagas',
  'sek-stronger': 'Kronan stärks',
  single: '',
}

export const SEVERITY_LABEL: Record<MarketSeverity, string> = {
  notable: 'Notabel rörelse',
  major: 'Stor rörelse',
}

/** The freshness the advisor must see beside every market figure. */
export const QUALITY_LABEL: Record<MarketQuality, string> = {
  live: 'Aktuell',
  delayed: 'Fördröjd',
  'official-daily': 'Officiell dagsnotering',
  stale: 'Föråldrad',
  fixture: 'Exempeldata',
}

const MARKET_LABEL: Record<string, string> = {
  'rate:us10y': 'US 10-årsränta',
  'rate:us2y': 'US 2-årsränta',
  'rate:de10y': 'Tysk 10-årsränta',
  'rate:se10y': 'Svensk 10-årsränta',
  'idx:omxs30': 'OMXS30',
  'idx:sp500': 'S&P 500',
  'idx:nasdaq100': 'Nasdaq 100',
  'idx:dax': 'DAX',
  'idx:ftse100': 'FTSE 100',
  'idx:nikkei225': 'Nikkei 225',
  'idx:djia': 'Dow Jones',
  'idx:russell2000': 'Russell 2000',
  'fx:usdsek': 'USD/SEK',
  'fx:eurusd': 'EUR/USD',
  'fx:eursek': 'EUR/SEK',
  'cmd:brent': 'Brent',
  'cmd:gold': 'Guld',
  'sector:technology': 'Teknologisektorn',
  'sector:communication': 'Kommunikationssektorn',
  'sector:industrials': 'Industrisektorn',
  'sector:financials': 'Finanssektorn',
  'sector:discretionary': 'Sällanköpssektorn',
  'sector:healthcare': 'Hälsovårdssektorn',
  'sector:realestate': 'Fastighetssektorn',
  'sector:energy': 'Energisektorn',
  'sector:staples': 'Dagligvarusektorn',
  'sentiment:cross-asset': 'Riskaptit',
}

const SECTOR_NAME: Record<Sector, string> = {
  energy: 'energi',
  technology: 'teknologi',
  financials: 'finans',
  industrials: 'industri',
  healthcare: 'hälsovård',
  'real-estate': 'fastigheter',
  consumer: 'konsument',
  government: 'statsobligationer',
  credit: 'krediter',
  multi: 'blandade fonder',
}

const REGION_NAME: Record<Region, string> = {
  sweden: 'Sverige',
  nordics: 'Norden',
  europe: 'Europa',
  us: 'USA',
  emerging: 'tillväxtmarknader',
  global: 'globala fonder',
}

/* ------------------------------------------------------------------- move */

/** The minimum a move needs to be named: what the Sentinel driver carries. */
export interface MarketMove {
  symbol: string
  label: string
  category: MarketCategory
  change: number
  changeUnit: 'bp' | 'percent' | 'points'
}

export function marketLabel(move: Pick<MarketMove, 'symbol' | 'label'>): string {
  return MARKET_LABEL[move.symbol] ?? move.label
}

/** "+18 bp", "−2,4 %", "−24 p mot neutral". */
export function formatMove(change: number, unit: MarketMove['changeUnit']): string {
  const sign = change > 0 ? '+' : change < 0 ? '−' : ''
  const abs = Math.abs(change)
  switch (unit) {
    case 'bp':
      return `${sign}${noDecimal.format(Math.round(abs))} bp`
    case 'percent':
      return `${sign}${oneDecimal.format(abs)} %`
    case 'points':
      return `${sign}${noDecimal.format(Math.round(abs))} p mot neutral`
  }
}

/** "Svensk 10-årsränta +18 bp", "Energisektorn −4,9 % mot index". */
export function marketMoveText(move: MarketMove): string {
  const suffix = move.category === 'sectors' ? ' mot index' : ''
  return `${marketLabel(move)} ${formatMove(move.change, move.changeUnit)}${suffix}`
}

/** "24 sep 2026 09:00". */
export function observedAtText(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${formatLongDate(iso.slice(0, 10))} ${timeOfDay.format(date)}`
}

/** "Observerad 24 sep 2026 09:00 · Riksbanken · Officiell dagsnotering". */
export function freshnessText(event: MarketEvent): string {
  return `Observerad ${observedAtText(event.observedAt)} · ${event.source} · ${QUALITY_LABEL[event.quality]}`
}

/** The threshold the move crossed — the policy that applied to this event, not today's constants — quoted so the reader can check it. */
export function thresholdText(event: MarketEvent): string {
  const unit =
    event.changeUnit === 'bp' ? 'bp' : event.changeUnit === 'percent' ? '%' : 'p'
  const level =
    event.severity === 'major' ? event.thresholds.major : event.thresholds.enter
  return `${SEVERITY_LABEL[event.severity].toLowerCase()}, tröskel ${level} ${unit}${
    event.category === 'sectors' ? ' mot index' : ''
  }`
}

/** The move at its peak — what history quotes once the current value has faded. */
export function peakMoveText(event: MarketEvent): string {
  return marketMoveText({ ...event, change: event.peakChange })
}

/** "pågår · räknas i prioriteringen" or "avslutad 25 sep · avklingad · räknas inte i prioriteringen". */
export function changeStatusText(change: MarketChangeSince): string {
  if (change.status === 'active' || change.closedAt === null) {
    return 'pågår · räknas i prioriteringen'
  }
  const why = change.closeReason === 'expired' ? 'utgången' : 'avklingad'
  return `avslutad ${formatDayMonth(change.closedAt.slice(0, 10))} · ${why} · räknas inte i prioriteringen`
}

/* ---------------------------------------------------------------- episodes */

/** "Globalt risk-off", or the single event's own move. */
export function episodeHeadline(episode: MarketEpisode): string {
  return episode.kind === 'single'
    ? marketMoveText(episode.events[0]!.event)
    : EPISODE_LABEL[episode.kind]
}

/** The lines beneath an episode's headline: each underlying move, most material first. */
export function episodeLines(episode: MarketEpisode): string[] {
  return episode.events.map((e) => marketMoveText(e.event))
}

/** "5 berörda klienter · 2 hög relevans". */
export function episodeCountsText(episode: MarketEpisode): string {
  const clients =
    episode.meaningful === 1
      ? '1 berörd klient'
      : `${episode.meaningful} berörda klienter`
  return episode.high > 0 ? `${clients} · ${episode.high} hög relevans` : clients
}

/**
 * What the dashboard shows: the episodes that touch somebody, at most
 * `limit`, most consequential first. A calm day, or a day whose moves reach
 * nobody, gives an empty list — and no module.
 */
export function dashboardEpisodes(
  episodes: readonly MarketEpisode[],
  limit = 3,
): MarketEpisode[] {
  return episodes.filter((e) => e.meaningful > 0).slice(0, limit)
}

/* ------------------------------------------------------------- MARKNADSFAKTA */

function levelText(event: MarketEvent): string {
  switch (event.category) {
    case 'rates':
      return `till ${twoDecimals.format(event.currentValue)} %`
    case 'risk-appetite':
      return `till ${noDecimal.format(event.currentValue)}/100`
    case 'fx':
      return `till ${twoDecimals.format(event.currentValue)}`
    default:
      return event.previousValue === null
        ? ''
        : `till ${oneDecimal.format(event.currentValue)}`
  }
}

/** One sentence of fact: what moved, how much, to where, against which line. */
export function marketFactText(event: MarketEvent): string {
  const verb =
    event.category === 'risk-appetite'
      ? 'ligger'
      : event.direction === 'up'
        ? 'steg'
        : 'föll'
  const amount =
    event.category === 'risk-appetite'
      ? `${noDecimal.format(Math.abs(event.change))} punkter under neutralt`
      : event.changeUnit === 'bp'
        ? `${noDecimal.format(Math.abs(event.change))} punkter`
        : `${oneDecimal.format(Math.abs(event.change))} %${event.category === 'sectors' ? ' relativt S&P 500' : ''}`
  const level = levelText(event)
  return `${marketLabel(event)} ${verb} ${amount}${level ? ` ${level}` : ''} (${thresholdText(event)}).`
}

/* ------------------------------------------------------ reasons as sentences */

export function reasonText(reason: ImpactReason): string {
  switch (reason.kind) {
    case 'fixed-income-duration':
      return `Räntebärande innehav utgör ${reason.sharePercent} % av portföljen.`
    case 'equity-allocation':
      return reason.region && reason.regionSharePercent !== null
        ? `Aktier utgör ${reason.sharePercent} % av portföljen, varav ${reason.regionSharePercent} % i ${REGION_NAME[reason.region]}.`
        : `Aktier utgör ${reason.sharePercent} % av portföljen.`
    case 'sector-holding':
      return `Innehav inom ${SECTOR_NAME[reason.sector]} utgör ${reason.sharePercent} % av portföljen.`
    case 'currency-holding':
      return `Innehav i ${reason.currency} utgör ${reason.sharePercent} % av portföljen.`
    case 'commodity-theme':
      return `Innehav inom ${SECTOR_NAME[reason.sector]} utgör ${reason.sharePercent} % av portföljen.`
    case 'strategy-deviation':
      return `Aktieandelen ligger ${formatPoints(reason.deviationPoints)} mot strategisk allokering (${reason.currentPercent} % mot ${reason.strategicPercent} %).`
    case 'refinancing-approaching':
      return `Refinansiering av ${formatMsek(reason.balance)} om ${reason.daysToMaturity} dagar.`
    case 'variable-rate-debt':
      return `Rörlig skuld på ${formatMsek(reason.balance)}.`
    case 'related-concern':
      return `Klienten har tidigare uttryckt oro: ”${reason.statement}”.`
    case 'drawdown-sensitivity':
      return `Registrerat beteende: ”${reason.statement}”.`
    case 'meeting-approaching':
      return reason.daysAhead === 0
        ? 'Möte i dag.'
        : reason.daysAhead === 1
          ? 'Möte i morgon.'
          : `Möte om ${reason.daysAhead} dagar.`
    case 'concentration':
      return `Största enskilda innehav är ${reason.largestHoldingPercent} % av portföljen.`
  }
}

const has = <K extends ImpactReason['kind']>(impact: ClientMarketImpact, kind: K) =>
  impact.reasons.find((r): r is Extract<ImpactReason, { kind: K }> => r.kind === kind)

/** KLIENTEXPONERING — the direct reasons, or the honest absence of one. */
export function exposureTexts(impact: ClientMarketImpact): string[] {
  const direct = impact.reasons.filter((r) => r.directness === 'direct').map(reasonText)
  return direct.length > 0
    ? direct
    : ['Ingen direkt exponering registrerad – relevansen kommer från klientkontexten.']
}

/** KLIENTKONTEXT — the contextual reasons, or none. */
export function contextTexts(impact: ClientMarketImpact): string[] {
  const contextual = impact.reasons
    .filter((r) => r.directness === 'contextual')
    .map(reasonText)
  return contextual.length > 0
    ? contextual
    : ['Ingen särskild klientkontext talar till rörelsen.']
}

/* ---------------------------------------------------- VARFÖR DET ÄR RELEVANT */

function shortReason(reason: ImpactReason): string {
  switch (reason.kind) {
    case 'fixed-income-duration':
      return `räntebärande ${reason.sharePercent} %`
    case 'equity-allocation':
      return `aktier ${reason.sharePercent} %`
    case 'sector-holding':
    case 'commodity-theme':
      return `${SECTOR_NAME[reason.sector]} ${reason.sharePercent} %`
    case 'currency-holding':
      return `${reason.currency} ${reason.sharePercent} %`
    case 'strategy-deviation':
      return `${formatPoints(reason.deviationPoints)} mot strategi`
    case 'refinancing-approaching':
      return `refinansiering om ${reason.daysToMaturity} dagar`
    case 'variable-rate-debt':
      return 'rörlig skuld'
    case 'related-concern':
      return 'tidigare uttryckt oro'
    case 'drawdown-sensitivity':
      return 'känslig för nedgångar'
    case 'meeting-approaching':
      return `möte om ${reason.daysAhead} dagar`
    case 'concentration':
      return 'koncentrerat innehav'
  }
}

/** "Hög relevans: direkt exponering (energi 12 %), förstärkt av tidigare uttryckt oro och möte om 10 dagar." */
export function relevanceText(impact: ClientMarketImpact): string {
  const direct = impact.reasons.filter((r) => r.directness === 'direct').map(shortReason)
  const context = impact.reasons
    .filter((r) => r.directness === 'contextual')
    .map(shortReason)
  const head = `${RELEVANCE_LABEL[impact.relevance]} relevans`
  if (direct.length > 0 && context.length > 0) {
    return `${head}: direkt exponering (${direct.join(', ')}), förstärkt av ${context.join(', ')}.`
  }
  if (direct.length > 0) return `${head}: direkt exponering (${direct.join(', ')}).`
  return `${head}: ingen direkt exponering, men ${context.join(', ')}.`
}

/** "Finansiell relevans medel · samtalsrelevans hög" — the two verdicts side by side, never merged. */
export function relevanceSplitText(impact: ClientMarketImpact): string {
  return `Finansiell relevans ${RELEVANCE_OR_NONE_LABEL[impact.financialRelevance].toLowerCase()} · samtalsrelevans ${RELEVANCE_OR_NONE_LABEL[impact.conversationRelevance].toLowerCase()}`
}

/** True when the record itself raised the theme the move is about. */
export function concernMatches(impact: ClientMarketImpact): boolean {
  return impact.reasons.some((r) => r.kind === 'related-concern')
}

/* ---------------------------------------------------------------- TOLKNING */

/**
 * What the move means for this record — typed as an interpretation, never
 * as a fact, and never as advice. Each sentence rests on a reason the
 * impact carries.
 */
export function interpretationTexts(impact: ClientMarketImpact): string[] {
  const { event } = impact
  const up = event.direction === 'up'
  const out: string[] = []
  const fixedIncome = has(impact, 'fixed-income-duration')
  const equity = has(impact, 'equity-allocation')
  const sector = has(impact, 'sector-holding') ?? has(impact, 'commodity-theme')
  const currency = has(impact, 'currency-holding')
  const refinancing = has(impact, 'refinancing-approaching')
  const variable = has(impact, 'variable-rate-debt')
  const deviation = has(impact, 'strategy-deviation')
  const drawdown = has(impact, 'drawdown-sensitivity')
  const concern = has(impact, 'related-concern')
  const concentration = has(impact, 'concentration')

  switch (event.category) {
    case 'rates':
      if (fixedIncome) {
        out.push(
          up
            ? `Stigande långräntor pressar värdet på räntedelen (${fixedIncome.sharePercent} %) på kort sikt, samtidigt som löpande avkastning framåt blir högre.`
            : `Fallande långräntor stöder värdet på räntedelen (${fixedIncome.sharePercent} %) men sänker löpande avkastning framåt.`,
        )
      }
      if (refinancing) {
        out.push(
          `Refinansieringen om ${refinancing.daysToMaturity} dagar sker i ett ${up ? 'högre' : 'lägre'} ränteläge än när den senast diskuterades.`,
        )
      }
      if (variable) {
        out.push(
          `Den rörliga skulden (${formatMsek(variable.balance)}) följer ränteläget direkt.`,
        )
      }
      if (deviation && up) {
        out.push(
          'Portföljen ligger redan över strategisk aktieandel, och stigande räntor brukar pressa aktievärderingar.',
        )
      }
      break
    case 'equities':
      if (equity) {
        out.push(
          up
            ? `Uppgången lyfter aktiedelen (${equity.sharePercent} % av portföljen).`
            : `Nedgången slår igenom i aktiedelen (${equity.sharePercent} % av portföljen).`,
        )
      }
      if (deviation) {
        out.push(
          deviation.deviationPoints > 0
            ? up
              ? `Aktieandelen ligger ${formatPoints(deviation.deviationPoints)} över strategin, och avvikelsen växer med uppgången.`
              : `Aktieandelen ligger ${formatPoints(deviation.deviationPoints)} över strategin – nedgången träffar en större del av portföljen än mandatet avser.`
            : `Aktieandelen ligger ${formatPoints(deviation.deviationPoints)} under strategin, så portföljen ${up ? 'tar del av uppgången i mindre grad' : 'känner av nedgången i mindre grad'} än mandatet avser.`,
        )
      }
      if (concentration) {
        out.push(
          `Största innehavet är ${concentration.largestHoldingPercent} % av portföljen; en bred rörelse kan slå ojämnt.`,
        )
      }
      break
    case 'sectors':
      if (sector) {
        out.push(
          `Sektorn rör sig ${formatMove(event.change, 'percent')} mot index; klientens innehav i ${SECTOR_NAME[sector.sector]} (${sector.sharePercent} %) följer alltså inte marknaden i stort.`,
        )
      }
      break
    case 'fx':
      if (currency) {
        out.push(
          up
            ? `Starkare ${currency.currency} lyfter SEK-värdet på innehaven i ${currency.currency} (${currency.sharePercent} % av portföljen); valutan väger samtidigt tyngre i portföljens risk.`
            : `Svagare ${currency.currency} sänker SEK-värdet på innehaven i ${currency.currency} (${currency.sharePercent} % av portföljen).`,
        )
      }
      break
    case 'commodities':
      if (sector) {
        out.push(
          up
            ? `Ett högre oljepris stöder energisektorn, där klienten har ${sector.sharePercent} % av portföljen.`
            : `Ett lägre oljepris pressar energisektorn, där klienten har ${sector.sharePercent} % av portföljen.`,
        )
      }
      break
    case 'risk-appetite':
      out.push(
        equity
          ? `Marknaden prissätter risk-off; en portfölj med ${equity.sharePercent} % aktier känner av det först.`
          : 'Marknaden prissätter risk-off; klientkontexten gör läget relevant även utan stor aktieandel.',
      )
      if (deviation && deviation.deviationPoints > 0) {
        out.push(
          `Aktieandelen ligger ${formatPoints(deviation.deviationPoints)} över strategin i ett läge där marknaden tar mindre risk.`,
        )
      }
      break
  }

  if (drawdown) {
    out.push(
      'Klienten har tidigare reagerat på större nedgångar; rörelsen kan väcka frågor.',
    )
  }
  if (concern) {
    out.push(
      'Särskilt relevant eftersom klienten själv tagit upp ämnet – rörelsen bekräftar en oro som redan finns i relationen.',
    )
  }
  if (out.length === 0) out.push('Rörelsen berör klientens registrerade exponering.')
  return out
}

/* ------------------------------------------------ FÖRBERED INFÖR KONTAKT */

/** What to prepare, never what to decide. */
export function preparationTexts(impact: ClientMarketImpact): string[] {
  const { event } = impact
  const out: string[] = []
  const refinancing = has(impact, 'refinancing-approaching')
  const meeting = has(impact, 'meeting-approaching')
  const concern = has(impact, 'related-concern')
  const drawdown = has(impact, 'drawdown-sensitivity')
  const sector = has(impact, 'sector-holding') ?? has(impact, 'commodity-theme')

  switch (event.category) {
    case 'rates':
      if (has(impact, 'fixed-income-duration')) {
        out.push(
          'Ta fram hur räntedelen påverkats och vad löpande avkastning blir framåt.',
        )
      }
      if (refinancing) {
        out.push(
          `Förbered de aktuella villkoren och alternativen inför refinansieringen om ${refinancing.daysToMaturity} dagar.`,
        )
      }
      if (has(impact, 'variable-rate-debt')) {
        out.push('Ta fram vad ränteläget betyder för den rörliga skuldens kostnad.')
      }
      break
    case 'equities':
    case 'risk-appetite':
      out.push(
        'Ta fram portföljens utveckling i rörelsen och avståndet till strategisk allokering.',
      )
      break
    case 'sectors':
    case 'commodities':
      if (sector) {
        out.push(
          `Ta fram innehaven inom ${SECTOR_NAME[sector.sector]} och hur de rört sig.`,
        )
      }
      break
    case 'fx':
      out.push('Ta fram valutaexponeringen i SEK-termer och hur den förändrats.')
      break
  }

  if (drawdown) {
    out.push(
      'Förbered ett proaktivt samtal – klienten har tidigare blivit obekväm vid nedgångar.',
    )
  }
  if (concern) {
    out.push(`Förbered ett svar på den oro klienten uttryckt: ”${concern.statement}”.`)
  }
  if (meeting) {
    out.push(
      meeting.daysAhead <= 1
        ? 'Ta med rörelsen som en punkt till mötet.'
        : `Ta med rörelsen som en punkt till mötet om ${meeting.daysAhead} dagar.`,
    )
  }
  out.push('Bedöm om klienten bör kontaktas proaktivt – beslutet är rådgivarens.')
  return out
}

/** The id line beneath an explanation. */
export function sourceLine(impact: ClientMarketImpact): string {
  const ids = impact.sourceIds.length > 0 ? impact.sourceIds.join(', ') : 'härledda'
  return `källor ${ids} · ${impact.event.id} · ${impact.method}`
}

/* ------------------------------------------------------- the explanation */

/**
 * The whole explanation of one impact as a typed object: every section the
 * surfaces render, the relevance verdicts side by side, and the ids behind
 * them. Built from the impact's own reasons — nothing is recomputed — so a
 * later "why is this move relevant to Henrik?" can be answered from it
 * directly (TD-105).
 */
export interface ImpactExplanationModel {
  impactId: string
  clientId: string
  eventId: string
  headline: string
  relevance: {
    combined: Relevance
    financial: RelevanceOrNone
    conversation: RelevanceOrNone
    directness: Directness
    /** One sentence: what the relevance rests on. */
    why: string
    /** The two verdicts side by side. */
    split: string
    /** The client raised the theme themselves. */
    concernRaised: boolean
  }
  marketFact: string
  freshness: string
  exposure: readonly string[]
  context: readonly string[]
  /** Typed as interpretation, never as fact. */
  interpretation: readonly string[]
  /** What to prepare, never what to decide. */
  preparation: readonly string[]
  sourceIds: readonly string[]
  sourceLine: string
  method: ClientMarketImpact['method']
}

export function explanationOf(impact: ClientMarketImpact): ImpactExplanationModel {
  return {
    impactId: impact.id,
    clientId: impact.clientId,
    eventId: impact.eventId,
    headline: marketMoveText(impact.event),
    relevance: {
      combined: impact.relevance,
      financial: impact.financialRelevance,
      conversation: impact.conversationRelevance,
      directness: impact.directness,
      why: relevanceText(impact),
      split: relevanceSplitText(impact),
      concernRaised: concernMatches(impact),
    },
    marketFact: marketFactText(impact.event),
    freshness: freshnessText(impact.event),
    exposure: exposureTexts(impact),
    context: contextTexts(impact),
    interpretation: interpretationTexts(impact),
    preparation: preparationTexts(impact),
    sourceIds: impact.sourceIds,
    sourceLine: sourceLine(impact),
    method: impact.method,
  }
}

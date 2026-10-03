/**
 * Which evidence a question needs, in what order: the tool-selection rules
 * of the brief, written once.
 *
 *   current level ................ market data (the market tier, not here)
 *   period performance ........... the history service (the market tier)
 *   central-bank decision ........ the bank's own feed, then news for context
 *   macro release ................ the statistics agency, then news
 *   company earnings ............. the filing or release, then news
 *   why the market moved ......... market data, then trusted reporting
 *   week ahead ................... official calendars, then reporting
 *   expectations ................. reporting, then the scheduled source
 *   analyst view ................. reporting
 *   general financial ............ search
 *
 * A generic search never stands where a structured source exists. QUICK
 * takes one official source and a few reports; DEEP opens the official
 * release and reads more widely.
 */

import {
  SYM_DAX,
  SYM_DE10Y,
  SYM_FTSE100,
  SYM_NASDAQ100,
  SYM_NIKKEI225,
  SYM_OMXS30,
  SYM_SE10Y,
  SYM_SP500,
  SYM_US10Y,
  type CanonicalSymbol,
} from '~/domain/market'
import type { MarketScope } from '../marketBrief'
import type { MarketPeriod } from '../marketQuery'
import type { SearchFreshness } from './publicSearch'
import {
  INSTITUTION_NAMES,
  type Country,
  type Institution,
  type MacroRelease,
  type ResearchDepth,
  type ResearchKind,
  type ResearchQuery,
} from './researchQuery'
import { NEWS_DOMAINS } from './sourceAuthority'

export type PlanSource = 'official' | 'issuer' | 'news' | 'search' | 'calendar'

/** A structured feed an adapter can read directly, when the question names its institution or release. */
export type OfficialFeed =
  'fed-monetary' | 'ecb-press' | 'riksbank-press' | 'bls-cpi' | 'edgar-filings'

export interface PlanStep {
  source: PlanSource
  purpose: 'fact' | 'context' | 'calendar'
  domains: readonly string[]
  freshness: SearchFreshness
  /** Open the source and read the fact itself, not the snippet. */
  retrieve: boolean
  limit: number
  feed: OfficialFeed | null
  /** The key figures and conflicts are grouped under: `us:cpi`, `fed:policy-rate`. */
  topicKey: string | null
  /** The query the step sends when the advisor's own line may not travel. */
  query: string
}

export interface ResearchPlan {
  kind: ResearchKind
  depth: ResearchDepth
  steps: PlanStep[]
  /** The platform's own numbers the answer opens with, when the question is about a move. */
  marketFacts: {
    symbols: readonly CanonicalSymbol[]
    region: MarketScope | null
    period: MarketPeriod
  } | null
}

const INSTITUTION_DOMAINS: Record<Institution, readonly string[]> = {
  fed: ['federalreserve.gov'],
  riksbank: ['riksbank.se'],
  ecb: ['ecb.europa.eu'],
  boe: ['bankofengland.co.uk'],
  boj: ['boj.or.jp'],
}

const INSTITUTION_FEED: Partial<Record<Institution, OfficialFeed>> = {
  fed: 'fed-monetary',
  riksbank: 'riksbank-press',
  ecb: 'ecb-press',
}

function releaseDomains(
  release: MacroRelease,
  country: Country | null,
): readonly string[] {
  if (country === 'se') return ['scb.se', 'riksbank.se', 'konj.se']
  if (country === 'eu') return ['ec.europa.eu', 'ecb.europa.eu', 'destatis.de']
  if (country === 'uk') return ['ons.gov.uk', 'bankofengland.co.uk']
  if (country === 'jp') return ['boj.or.jp']
  switch (release) {
    case 'gdp':
    case 'pce':
      return ['bea.gov']
    case 'retail':
      return ['census.gov']
    case 'ism':
      return ['ismworld.org']
    case 'pmi':
      return ['pmi.spglobal.com', 'ismworld.org']
    default:
      return ['bls.gov']
  }
}

const CALENDAR_DOMAINS: readonly string[] = [
  'federalreserve.gov',
  'bls.gov',
  'bea.gov',
  'ecb.europa.eu',
  'riksbank.se',
  'scb.se',
  'nasdaq.com',
]

const RELEASE_ENGLISH: Record<MacroRelease, string> = {
  cpi: 'CPI inflation',
  jobs: 'jobs report nonfarm payrolls',
  unemployment: 'unemployment rate',
  pmi: 'PMI',
  ism: 'ISM',
  gdp: 'GDP',
  retail: 'retail sales',
  pce: 'PCE inflation',
}

const COUNTRY_ENGLISH: Record<Country, string> = {
  us: 'US',
  se: 'Sweden',
  eu: 'euro area',
  uk: 'UK',
  jp: 'Japan',
}

const INDEX_ENGLISH: Partial<Record<string, string>> = {
  'idx:sp500': 'S&P 500',
  'idx:nasdaq100': 'Nasdaq 100',
  'idx:djia': 'Dow Jones',
  'idx:russell2000': 'Russell 2000',
  'idx:omxs30': 'OMXS30',
  'idx:dax': 'DAX',
  'idx:ftse100': 'FTSE 100',
  'idx:nikkei225': 'Nikkei 225',
  'rate:us10y': 'US 10-year Treasury yield',
  'rate:us2y': 'US 2-year Treasury yield',
  'rate:de10y': 'German 10-year Bund yield',
  'rate:se10y': 'Swedish 10-year government bond yield',
  'fx:usdsek': 'USD/SEK',
  'fx:eurusd': 'EUR/USD',
  'cmd:gold': 'gold price',
  'cmd:brent': 'Brent crude',
}

const REGION_ENGLISH: Record<MarketScope, string> = {
  us: 'US stock market',
  europe: 'European stock markets',
  sweden: 'Swedish stock market',
  global: 'global stock markets',
}

function periodEnglish(period: MarketPeriod | null): string {
  if (!period) return ''
  if (period.kind === 'today') return 'today'
  if (period.kind === 'month')
    return `in ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][period.month - 1]} ${period.year}`
  if (period.kind === 'unsupported') return period.label
  switch (period.range) {
    case 'this-week':
      return 'this week'
    case '1w':
    case '5d':
      return 'last week'
    case 'mtd':
      return 'this month'
    case '1m':
      return 'last month'
    case '3m':
      return 'last quarter'
    case '1y':
      return 'last year'
    case 'ytd':
      return 'year to date'
  }
}

/** The subject in the words a public source uses. */
export function subjectEnglish(query: ResearchQuery): string {
  if (query.companies[0]) return query.companies[0].name
  if (query.institution) return INSTITUTION_NAMES[query.institution]
  if (query.release)
    return `${query.country ? COUNTRY_ENGLISH[query.country] : 'US'} ${RELEASE_ENGLISH[query.release]}`
  const named = query.instruments
    .map((symbol) => INDEX_ENGLISH[symbol])
    .filter((name): name is string => Boolean(name))
  if (named.length > 0) return named.slice(0, 2).join(' and ')
  if (query.region) return REGION_ENGLISH[query.region]
  return 'financial markets'
}

const monthYear = (now: Date) =>
  now.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** What the question is about, in a region's indices plus the rate that moves them. */
function factsFor(query: ResearchQuery): ResearchPlan['marketFacts'] {
  const period: MarketPeriod = query.period ?? { kind: 'today' }
  if (query.instruments.length > 0)
    return { symbols: query.instruments, region: query.region, period }
  const region =
    query.region ??
    (query.country === 'se' ? 'sweden' : query.country === 'eu' ? 'europe' : 'us')
  const symbols: readonly CanonicalSymbol[] =
    region === 'us'
      ? [SYM_SP500, SYM_NASDAQ100, SYM_US10Y]
      : region === 'europe'
        ? [SYM_DAX, SYM_FTSE100, SYM_OMXS30, SYM_DE10Y]
        : region === 'sweden'
          ? [SYM_OMXS30, SYM_SE10Y]
          : [SYM_SP500, SYM_NASDAQ100, SYM_OMXS30, SYM_DAX, SYM_FTSE100, SYM_NIKKEI225]
  return { symbols, region, period }
}

/** The plan for a question: the steps in authority order, sized by depth. */
export function planFor(query: ResearchQuery, now: Date = new Date()): ResearchPlan {
  const deep = query.depth === 'deep'
  const steps: PlanStep[] = []
  const subject = subjectEnglish(query)
  const when = periodEnglish(query.period)
  const news = (
    purpose: 'context' | 'fact',
    queryText: string,
    freshness: SearchFreshness,
    limit: number,
    topicKey: string | null = null,
  ): PlanStep => ({
    source: 'news',
    purpose,
    domains: NEWS_DOMAINS,
    freshness,
    retrieve: false,
    limit,
    feed: null,
    /* The same key as the official step, so a figure the reporting states is reconciled against the official one. */
    topicKey,
    query: queryText,
  })

  switch (query.kind) {
    case 'CENTRAL_BANK': {
      const institution = query.institution ?? 'fed'
      steps.push({
        source: 'official',
        purpose: 'fact',
        domains: INSTITUTION_DOMAINS[institution],
        freshness: 'month',
        retrieve: true,
        limit: deep ? 4 : 2,
        feed: INSTITUTION_FEED[institution] ?? null,
        topicKey: `${institution}:policy-rate`,
        query: `${INSTITUTION_NAMES[institution]} latest policy decision statement ${monthYear(now)}`,
      })
      steps.push(
        news(
          'context',
          `${INSTITUTION_NAMES[institution]} decision market reaction`,
          'week',
          deep ? 4 : 2,
          `${institution}:policy-rate`,
        ),
      )
      break
    }
    case 'MACRO_RELEASE': {
      const release = query.release ?? 'cpi'
      const country = query.country ?? 'us'
      steps.push({
        source: 'official',
        purpose: 'fact',
        domains: releaseDomains(release, country),
        freshness: 'month',
        retrieve: true,
        limit: deep ? 3 : 2,
        feed: release === 'cpi' && country === 'us' ? 'bls-cpi' : null,
        topicKey: `${country}:${release}`,
        query: `${COUNTRY_ENGLISH[country]} ${RELEASE_ENGLISH[release]} latest release`,
      })
      steps.push(
        news(
          'context',
          `${COUNTRY_ENGLISH[country]} ${RELEASE_ENGLISH[release]} market reaction`,
          'week',
          deep ? 4 : 2,
          `${country}:${release}`,
        ),
      )
      break
    }
    case 'COMPANY': {
      const company = query.companies[0]
      const name = company?.name ?? subject
      steps.push({
        source: 'issuer',
        purpose: 'fact',
        domains: ['sec.gov'],
        freshness: 'month',
        retrieve: deep,
        limit: deep ? 3 : 2,
        feed: company?.ticker ? 'edgar-filings' : null,
        topicKey: `company:${name.toLowerCase()}`,
        /* The EDGAR feed reads the ticker as its first word; without a ticker the step is a domain-restricted search. */
        query: company?.ticker
          ? `${company.ticker} 8-K earnings release`
          : `${name} earnings press release results guidance`,
      })
      steps.push(news('context', `${name} results guidance shares`, 'week', deep ? 5 : 3))
      break
    }
    case 'MARKET_WHY':
      steps.push(
        news(
          'fact',
          `why ${subject} moved ${when}`.trim(),
          query.freshness,
          deep ? 6 : 3,
        ),
      )
      if (deep)
        steps.push({
          source: 'search',
          purpose: 'context',
          domains: [],
          freshness: query.freshness,
          retrieve: false,
          limit: 4,
          feed: null,
          topicKey: null,
          query: `${subject} market move explanation ${when}`.trim(),
        })
      break
    case 'MARKET_DRIVERS':
      steps.push(news('fact', `what is driving ${subject} today`, 'day', deep ? 6 : 3))
      break
    case 'PRE_MARKET':
      steps.push(
        news('fact', `${subject} pre-market futures this morning`, 'day', deep ? 5 : 3),
      )
      steps.push({
        source: 'search',
        purpose: 'context',
        domains: [],
        freshness: 'day',
        retrieve: false,
        limit: 3,
        feed: null,
        topicKey: null,
        query: `stock futures pre-market today ${subject}`,
      })
      break
    case 'WEEK_AHEAD':
      steps.push({
        source: 'calendar',
        purpose: 'calendar',
        domains: CALENDAR_DOMAINS,
        freshness: 'week',
        retrieve: false,
        limit: deep ? 6 : 4,
        feed: null,
        topicKey: 'calendar',
        query: `economic calendar next week central bank meetings data releases earnings ${monthYear(now)}`,
      })
      steps.push(news('context', `week ahead markets ${subject}`, 'week', deep ? 5 : 3))
      break
    case 'MARKET_EXPECTATIONS':
      steps.push(
        news(
          'fact',
          `what markets expect from ${subject} ${when}`.trim(),
          'week',
          deep ? 5 : 3,
        ),
      )
      if (query.institution || query.release)
        steps.push({
          source: 'official',
          purpose: 'context',
          domains: query.institution
            ? INSTITUTION_DOMAINS[query.institution]
            : releaseDomains(query.release ?? 'cpi', query.country ?? 'us'),
          freshness: 'month',
          retrieve: false,
          limit: 2,
          feed: query.institution ? (INSTITUTION_FEED[query.institution] ?? null) : null,
          topicKey: query.institution
            ? `${query.institution}:policy-rate`
            : `${query.country ?? 'us'}:${query.release ?? 'cpi'}`,
          query: `${subject} schedule next release`,
        })
      break
    case 'ANALYST_VIEW':
      steps.push(
        news(
          'fact',
          `analysts strategists outlook ${subject} ${when}`.trim(),
          'week',
          deep ? 6 : 3,
        ),
      )
      break
    case 'GENERAL_FINANCIAL':
      steps.push({
        source: 'search',
        purpose: 'fact',
        domains: [],
        freshness: query.freshness,
        retrieve: false,
        limit: deep ? 6 : 3,
        feed: null,
        topicKey: null,
        query: `${subject} latest news ${when}`.trim(),
      })
      break
  }

  const wantsFacts =
    query.kind === 'MARKET_WHY' ||
    query.kind === 'MARKET_DRIVERS' ||
    query.kind === 'PRE_MARKET' ||
    (query.kind === 'GENERAL_FINANCIAL' && query.instruments.length > 0)
  return {
    kind: query.kind,
    depth: query.depth,
    steps,
    marketFacts: wantsFacts ? factsFor(query) : null,
  }
}

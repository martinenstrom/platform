/**
 * The market family of questions, recognised without a model — the one
 * path a typed line and a spoken line share.
 *
 * "Hur gick S&P 500?", "Hur gick amerikanska börsen i veckan?", "Och
 * Nasdaq?", "Och i veckan?", "Jämför med S&P.", "Vilken gick bäst?", "Vad
 * hände med räntorna?", "Vad händer idag?" on the market dashboard: every
 * one is an observation of the market, and every one resolves here to an
 * intent, the instruments it is about, and the period it asks for — in the
 * words an advisor uses, never in the platform's symbols.
 *
 * ## What is recognised, and what is refused
 *
 * A line is a market query when it names an instrument, a region or the
 * rates and asks for their state; when it is a bare follow-up — a period, a
 * comparison, a "which did best" — of a market conversation already under
 * way; or when it is a generic "what is happening" asked where the market
 * is the scope. Any cue of judgement, reasoning or meaning refuses the match
 * and the line goes to the one router (`NOT_RETRIEVAL`). A region word in a
 * sentence with no state cue — "kunden har bolag i USA" — is not a question
 * about the market.
 *
 * ## Context, and what overrides it
 *
 * The conversation carries the instruments, the region and the period of
 * the last market answer. A follow-up inherits what it does not say and
 * never more: "Och Nasdaq?" keeps the period, "Och i veckan?" keeps the
 * subject, "Jämför med S&P." adds S&P to the subject over the same period.
 * A full question with a subject and no period means today. "I veckan" is
 * never read as today.
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
  SYM_US2Y,
  type CanonicalSymbol,
} from '~/domain/market'
import type { JarvisScope } from './context'
import type { MarketScope } from './marketBrief'
import {
  L,
  namedTargets,
  NOT_RETRIEVAL,
  scopeForTargets,
  STATE_CUE,
  WORD,
  words,
  type RetrievalTarget,
} from './marketIntent'

/* ----------------------------------------------------------------- types */

export type MarketIntentKind =
  /** Named instruments over a period: "Hur gick S&P 500?", "Vad gjorde Nasdaq i veckan?". */
  | 'MARKET_INDEX_PERFORMANCE'
  /** A region's major indices over a period: "Hur gick amerikanska börsen idag?". */
  | 'MARKET_REGION_PERFORMANCE'
  /** Two or more instruments against each other over one period: "Jämför med S&P.". */
  | 'MARKET_COMPARE'
  /** Which of the set did best or worst over the period: "Vilken gick bäst?". */
  | 'MARKET_BEST'
  /** The rates of a region, today: "Vad hände med räntorna?". */
  | 'MARKET_RATES'
  /** The market as a whole, where the market is the scope: "Vad händer idag?", "Vad sticker ut?". */
  | 'MARKET_OVERVIEW'
  /** The US sectors, best to worst. */
  | 'MARKET_SECTORS'
  /** The platform's risk-appetite score. */
  | 'MARKET_RISK'
  /** A VIX level, which is not served. */
  | 'MARKET_VIX'
  /** An instrument the platform has no source for. */
  | 'MARKET_NOT_SERVED'

export type MarketRange = '1w' | '1m' | '3m' | '1y' | 'ytd'

export type MarketPeriod =
  | { kind: 'today' }
  | { kind: 'range'; range: MarketRange }
  /** A calendar month, 1–12, in a year. */
  | { kind: 'month'; year: number; month: number }
  /** A period the platform has no series for at all — "igår", "förra året" — named so the answer can say so. */
  | { kind: 'unsupported'; label: string }

/** What a market conversation remembers between lines: the subject and the period of the last answer. */
export interface MarketConversation {
  symbols: readonly CanonicalSymbol[]
  region: MarketScope | null
  period: MarketPeriod
}

export interface MarketQuery {
  kind: MarketIntentKind
  /** The instruments the answer is about, in order; a region's indices for a region question. */
  symbols: readonly CanonicalSymbol[]
  /** The region named, or inherited, when the question is about one. */
  region: MarketScope | null
  period: MarketPeriod
  /** The targets as Tier 0 names them, for the today renderer: quotes, rates, sectors, risk, VIX, not served. */
  targets: readonly RetrievalTarget[]
  superlative?: 'best' | 'worst'
  /** What the line said itself, as opposed to what it inherited from the conversation. */
  explicit: { subject: boolean; period: boolean }
  /** Instruments the line named that the platform does not serve. */
  notServed: readonly string[]
  method: 'market-query-v1'
}

export interface MarketQueryOptions {
  /** Where the advisor is; generic questions are the market's only where the market is the scope. */
  scope: JarvisScope
  conversation: MarketConversation | null
  /** For resolving "i september" to a year. */
  now?: Date
}

/* ---------------------------------------------------------------- lexicon */

/** "Amerikanska börsen" is S&P 500 and Nasdaq 100 unless an index is named; the regions as the brief defines them. */
export const REGION_INDICES: Record<MarketScope, readonly CanonicalSymbol[]> = {
  us: [SYM_SP500, SYM_NASDAQ100],
  europe: [SYM_DAX, SYM_FTSE100, SYM_OMXS30],
  sweden: [SYM_OMXS30],
  global: [SYM_SP500, SYM_NASDAQ100, SYM_OMXS30, SYM_DAX, SYM_FTSE100, SYM_NIKKEI225],
}

export const REGION_RATES: Record<MarketScope, readonly CanonicalSymbol[]> = {
  us: [SYM_US10Y, SYM_US2Y],
  europe: [SYM_DE10Y, SYM_SE10Y],
  sweden: [SYM_SE10Y],
  global: [SYM_US10Y, SYM_US2Y, SYM_DE10Y, SYM_SE10Y],
}

const REGION_LEXICON: readonly { pattern: RegExp; region: MarketScope }[] = [
  {
    pattern: words([
      `amerikanska (?:börs${L}|marknad${L}|aktiemarknad${L}|aktier(?:na)?|index(?:en)?|ränt${L}|statsränt${L})`,
      `usa:s (?:börs${L}|ränt${L})`,
      'usa[- ]?börsen',
      'us[- ]?börsen',
      'börsen i (?:usa|amerika|new york)',
      'börserna i usa',
      'usa',
      'amerika',
      'wall street',
      'new york',
    ]),
    region: 'us',
  },
  {
    pattern: words([
      'europa',
      `europeiska (?:börs${L}|marknad${L}|aktier(?:na)?|ränt${L})`,
      'europabörserna',
      'börserna i europa',
      'börsen i europa',
    ]),
    region: 'europe',
  },
  {
    pattern: words([
      'sverige',
      `svenska (?:marknad${L}|aktier(?:na)?|ränt${L})`,
      'börsen i (?:sverige|stockholm)',
    ]),
    region: 'sweden',
  },
  {
    pattern: words([
      'världen',
      'globalt',
      `globala (?:börs${L}|marknad${L})`,
      'världens börser',
      'börserna globalt',
      'världsindex',
    ]),
    region: 'global',
  },
]

const MONTHS = [
  'januari',
  'februari',
  'mars',
  'april',
  'maj',
  'juni',
  'juli',
  'augusti',
  'september',
  'oktober',
  'november',
  'december',
] as const

/** Swedish period expressions, most specific first; "i veckan" is a week, never today. */
const PERIOD_LEXICON: readonly { pattern: RegExp; period: MarketPeriod }[] = [
  {
    pattern: words([
      'i år',
      'ytd',
      'year to date',
      'sedan årsskiftet',
      'hittills i år',
      'sedan nyår',
      'under året',
      'det här året',
      'detta år',
      'i år hittills',
    ]),
    period: { kind: 'range', range: 'ytd' },
  },
  {
    pattern: words([
      '(?:det )?senaste året',
      'tolv månader',
      '12 månader',
      'på ett år',
      'ett år tillbaka',
      'senaste (?:tolv|12) månaderna',
      'rullande år',
    ]),
    period: { kind: 'range', range: '1y' },
  },
  {
    pattern: words([
      '(?:senaste|det här|detta|under|i|förra) kvartalet',
      'kvartalet',
      'tre månader',
      '3 månader',
      'senaste (?:tre|3) månaderna',
      'på ett kvartal',
    ]),
    period: { kind: 'range', range: '3m' },
  },
  {
    pattern: words([
      '(?:den här|denna|i|under|senaste|förra|den senaste|den gångna) månaden',
      'månaden',
      'senaste 30 dagarna',
      '30 dagar',
      'på en månad',
      'en månad tillbaka',
      'månadsvis',
    ]),
    period: { kind: 'range', range: '1m' },
  },
  {
    pattern: words([
      '(?:den här|denna|i|under|senaste|förra|den senaste|den gångna) veckan',
      'veckan',
      '(?:5|fem) dagar',
      'senaste (?:5|fem) (?:handels)?dagarna',
      'handelsdagarna',
      'på en vecka',
      'en vecka tillbaka',
      'veckovis',
      'sedan i måndags',
    ]),
    period: { kind: 'range', range: '1w' },
  },
  {
    pattern: words(['igår', 'i går', 'gårdagen']),
    period: { kind: 'unsupported', label: 'igår' },
  },
  {
    pattern: words(['förra året', 'fjolåret', 'i fjol']),
    period: { kind: 'unsupported', label: 'förra året' },
  },
  {
    pattern: words([
      'idag',
      'i dag',
      'just nu',
      'dagens',
      'i dagsläget',
      'för dagen',
      'under dagen',
      'senaste sessionen',
      'senaste handelsdagen',
    ]),
    period: { kind: 'today' },
  },
]

const MONTH_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:i |under |för )?(${MONTHS.join('|')})(?: månad)?(?![\\p{L}\\p{N}])`,
  'iu',
)

/** "Vad händer?", "Hur går det?", "Vad sticker ut?" — the market as a whole, where the market is the scope. */
const GENERIC = words([
  'vad händer',
  'vad har hänt',
  'vad hände',
  'hur går det',
  'hur gick det',
  'hur har det gått',
  'hur ser det ut',
  'hur ser läget ut',
  'läget',
  'vad sticker ut',
  'vad rör sig',
  'vad rörde sig',
  `hur (?:är|var|mår|går|gick) (?:marknaden|marknaderna|börsen|börserna|stämningen|läget)`,
  `marknad${L}`,
  'börsen',
  'börserna',
  'något att notera',
  'vad är nytt',
  'dagens rörelser',
])

const RATES = words([
  `ränt${L}`,
  'räntemarknaden',
  'yields?',
  `statsobligation${L}`,
  `långränt${L}`,
  `kortränt${L}`,
  'obligationsmarknaden',
  'räntorna',
])

const BEST = words([
  'vilken (?:gick|går|har gått|utvecklades|utvecklats|steg) (?:bäst|starkast|mest)',
  'vilket (?:gick|går) bäst',
  'vad gick bäst',
  'vem gick bäst',
  'bäst',
  'starkast',
  'vinnaren?',
])
const WORST = words([
  'vilken (?:gick|går|har gått|utvecklades|föll) (?:sämst|svagast|mest)',
  'vad gick sämst',
  'sämst',
  'svagast',
  'förloraren?',
])
const COMPARE = words([
  'jämför',
  'jämfört med',
  'i förhållande till',
  'relativt',
  'mot',
  'versus',
  'vs\\.?',
  'kontra',
  'jämförelse',
])
const FOLLOW_UP_START =
  /^(?:och|and|men|samt|hur var det med|vad sägs om|och hur var det med)(?![\p{L}])/iu

const MAX_LINE = 200
const MAX_SYMBOLS = 6

/* ------------------------------------------------------------- periods */

/** The period a line names, or null when it names none. */
export function resolvePeriod(text: string, now: Date = new Date()): MarketPeriod | null {
  const line = text.trim()
  const month = MONTH_PATTERN.exec(line)
  if (month) {
    const index = MONTHS.indexOf(month[1]!.toLowerCase() as (typeof MONTHS)[number])
    if (index >= 0) {
      /* A month already begun or passed this year is this year's; a month still to come is last year's. */
      const year =
        index + 1 > now.getUTCMonth() + 1
          ? now.getUTCFullYear() - 1
          : now.getUTCFullYear()
      return { kind: 'month', year, month: index + 1 }
    }
  }
  for (const entry of PERIOD_LEXICON) {
    if (entry.pattern.test(line)) return entry.period
  }
  return null
}

export function samePeriod(a: MarketPeriod, b: MarketPeriod): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'range' && b.kind === 'range') return a.range === b.range
  if (a.kind === 'month' && b.kind === 'month')
    return a.year === b.year && a.month === b.month
  if (a.kind === 'unsupported' && b.kind === 'unsupported') return a.label === b.label
  return true
}

/* ----------------------------------------------------------- recogniser */

const TODAY: MarketPeriod = { kind: 'today' }

const symbolsOf = (targets: readonly RetrievalTarget[]): CanonicalSymbol[] =>
  targets.flatMap((target) => ('symbol' in target ? [target.symbol] : []))

const unique = (symbols: readonly CanonicalSymbol[]): CanonicalSymbol[] => [
  ...new Set(symbols),
]

const quoteTargets = (symbols: readonly CanonicalSymbol[]): RetrievalTarget[] =>
  symbols.map((symbol) =>
    symbol.startsWith('rate:') ? { kind: 'rate', symbol } : { kind: 'quote', symbol },
  )

/** The brief scope that serves a query: its region, or the narrowest region covering its instruments. */
export function scopeForQuery(
  query: Pick<MarketQuery, 'region' | 'symbols' | 'targets'>,
): MarketScope {
  if (query.region) return query.region
  const targets = query.targets.length > 0 ? query.targets : quoteTargets(query.symbols)
  return targets.length > 0 ? scopeForTargets(targets) : 'global'
}

/** What the conversation remembers after an answer to this query. */
export function conversationAfter(query: MarketQuery): MarketConversation {
  return { symbols: query.symbols, region: query.region, period: query.period }
}

/**
 * The market query a line is, in its context, or null when the line is not
 * the market's to answer deterministically.
 */
export function recognizeMarketQuery(
  text: string,
  options: MarketQueryOptions,
): MarketQuery | null {
  const line = text.trim()
  if (!line || line.length > MAX_LINE) return null
  if (NOT_RETRIEVAL.test(line)) return null

  const now = options.now ?? new Date()
  const conversation = options.conversation
  /* The market dashboard is where a generic "vad händer?" is the market's; nowhere else is it taken from the router or the record. */
  const marketScope = options.scope === 'MARKET'

  const targets = namedTargets(line)
  const region = REGION_LEXICON.find((entry) => entry.pattern.test(line))?.region ?? null
  const period = resolvePeriod(line, now)
  const tokens = line.match(WORD) ?? []
  const generic = GENERIC.test(line)
  const asksState = STATE_CUE.test(line)
  /* "Och Nasdaq?", "Guldet?": a fragment that leans on the conversation. "Hur gick sp500?" is a whole question, and means today. */
  const followUp = FOLLOW_UP_START.test(line) || (tokens.length <= 3 && !asksState)
  const stateCue = asksState || period !== null || generic
  const compare = COMPARE.test(line)
  const worst = WORST.test(line)
  const best = !worst && BEST.test(line)
  const ratesAsked = RATES.test(line) && !targets.some((target) => target.kind === 'rate')

  const inherited = (): MarketPeriod =>
    conversation && followUp ? conversation.period : TODAY
  const query = (
    kind: MarketIntentKind,
    symbols: readonly CanonicalSymbol[],
    over: Partial<MarketQuery> & { explicit: MarketQuery['explicit'] },
  ): MarketQuery => ({
    kind,
    symbols: unique(symbols).slice(0, MAX_SYMBOLS),
    region: null,
    period: period ?? inherited(),
    targets: [],
    notServed: [],
    method: 'market-query-v1',
    ...over,
  })
  const conversationSymbols = (): readonly CanonicalSymbol[] =>
    conversation
      ? conversation.symbols.length > 0
        ? conversation.symbols
        : conversation.region
          ? REGION_INDICES[conversation.region]
          : []
      : []

  /* 1. Instruments named. */
  if (targets.length > 0) {
    if (!stateCue && !followUp && !compare && !best && !worst) return null
    const notServed = targets.flatMap((target) =>
      target.kind === 'not-served' ? [target.name] : [],
    )
    const quoted = symbolsOf(targets)
    const special = targets.find((target) => !('symbol' in target))

    if (compare) {
      /* A comparison needs two sides: the ones named, or the conversation's and the one named. */
      if (quoted.length < 2 && conversationSymbols().length === 0) return null
      const set = quoted.length >= 2 ? quoted : [...conversationSymbols(), ...quoted]
      return query('MARKET_COMPARE', set, {
        targets: quoteTargets(unique(set)),
        notServed,
        explicit: { subject: true, period: period !== null },
      })
    }
    if ((best || worst) && quoted.length + conversationSymbols().length >= 2) {
      const set = quoted.length >= 2 ? quoted : [...conversationSymbols(), ...quoted]
      return query('MARKET_BEST', set, {
        targets: quoteTargets(unique(set)),
        superlative: worst ? 'worst' : 'best',
        notServed,
        explicit: { subject: true, period: period !== null },
      })
    }
    if (quoted.length === 0 && special) {
      const kind: MarketIntentKind =
        special.kind === 'sectors'
          ? 'MARKET_SECTORS'
          : special.kind === 'risk'
            ? 'MARKET_RISK'
            : special.kind === 'vix'
              ? 'MARKET_VIX'
              : 'MARKET_NOT_SERVED'
      return query(kind, [], {
        targets,
        period: period ?? TODAY,
        notServed,
        explicit: { subject: true, period: period !== null },
      })
    }
    if (quoted.length > MAX_SYMBOLS) return null
    return query('MARKET_INDEX_PERFORMANCE', quoted, {
      targets,
      notServed,
      explicit: { subject: true, period: period !== null },
    })
  }

  /* 2. A region named. */
  if (region) {
    if (!stateCue && !followUp && !compare && !best && !worst) return null
    const indices = REGION_INDICES[region]
    if (compare && conversationSymbols().length > 0) {
      const set = [...conversationSymbols(), ...indices]
      return query('MARKET_COMPARE', set, {
        targets: quoteTargets(unique(set)),
        explicit: { subject: true, period: period !== null },
      })
    }
    if (ratesAsked) {
      return query('MARKET_RATES', REGION_RATES[region], {
        region,
        targets: quoteTargets(REGION_RATES[region]),
        period: TODAY,
        explicit: { subject: true, period: false },
      })
    }
    if (best || worst) {
      return query('MARKET_BEST', indices, {
        region,
        targets: quoteTargets(indices),
        superlative: worst ? 'worst' : 'best',
        explicit: { subject: true, period: period !== null },
      })
    }
    return query('MARKET_REGION_PERFORMANCE', indices, {
      region,
      targets: quoteTargets(indices),
      explicit: { subject: true, period: period !== null },
    })
  }

  /* 3. The rates, with no region: the conversation's, else every region's. */
  if (ratesAsked) {
    if (!stateCue && !followUp) return null
    const scope: MarketScope = conversation?.region ?? 'global'
    return query('MARKET_RATES', REGION_RATES[scope], {
      region: scope,
      targets: quoteTargets(REGION_RATES[scope]),
      period: TODAY,
      explicit: { subject: true, period: false },
    })
  }

  /* 4. "Vilken gick bäst?" over what the conversation is about. */
  if ((best || worst) && conversationSymbols().length >= 2) {
    const set = conversationSymbols()
    return query('MARKET_BEST', set, {
      region: conversation?.region ?? null,
      targets: quoteTargets(set),
      superlative: worst ? 'worst' : 'best',
      period: period ?? conversation!.period,
      explicit: { subject: false, period: period !== null },
    })
  }

  /* 5. A bare period on the conversation's subject: "Och i veckan?". */
  if (
    period &&
    conversation &&
    conversationSymbols().length > 0 &&
    (followUp || !generic)
  ) {
    const set = conversationSymbols()
    if (conversation.region && conversation.symbols.length === 0) {
      return query('MARKET_REGION_PERFORMANCE', set, {
        region: conversation.region,
        targets: quoteTargets(set),
        explicit: { subject: false, period: true },
      })
    }
    return query(
      conversation.region && set.length > 1
        ? 'MARKET_REGION_PERFORMANCE'
        : 'MARKET_INDEX_PERFORMANCE',
      set,
      {
        region: conversation.region,
        targets: quoteTargets(set),
        explicit: { subject: false, period: true },
      },
    )
  }

  /* 6. The market as a whole, where the market is the scope. */
  if (generic && (marketScope || (conversation && followUp))) {
    const scope: MarketScope = 'global'
    return query('MARKET_OVERVIEW', REGION_INDICES[scope], {
      region: scope,
      targets: quoteTargets(REGION_INDICES[scope]),
      period: period ?? TODAY,
      explicit: { subject: false, period: period !== null },
    })
  }

  return null
}

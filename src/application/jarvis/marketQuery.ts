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
  SYM_DJIA,
  SYM_FTSE100,
  SYM_NASDAQ100,
  SYM_NIKKEI225,
  SYM_OMXS30,
  SYM_RUSSELL2000,
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
  /**
   * One question back, never a refusal: "Vad gick bäst?" with nothing to
   * infer the universe from asks "Menar du bland de stora USA-indexen?".
   */
  | 'MARKET_CLARIFY'

/** The set a ranking runs over when the line names none: the region's majors. */
export type MarketUniverse = 'us-majors' | 'europe-majors'

/** A clarification the conversation waits on; the next line answers it or drops it. */
export interface PendingClarification {
  kind: 'best-universe'
  superlative: 'best' | 'worst'
  period: MarketPeriod
}

/**
 * The periods a series answers, as the history service measures them:
 * `this-week` from the last close before the week, `5d` the latest five
 * sessions, `1w` seven days back, `mtd` from the previous month's last
 * close, `1m`/`3m`/`1y` rolling, `ytd` from the previous year's last close.
 */
export type MarketRange = 'this-week' | '5d' | '1w' | 'mtd' | '1m' | '3m' | '1y' | 'ytd'

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
  /**
   * The instruments the thread has covered, when wider than the last
   * subject: "Hur gick S&P 500 i veckan?" then "Och Nasdaq?" is about
   * Nasdaq, over a thread of two — so "Vilken gick bäst?" has two to rank.
   */
  set?: readonly CanonicalSymbol[]
  /** The question the last answer asked back, so "ja" or "Europa" completes it. */
  pending?: PendingClarification
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
  /** The instruments the thread covers after this line: widened by a fragment that adds one, replaced by a whole question. */
  thread: readonly CanonicalSymbol[]
  /** The ranking's universe, when the line named none and the thread's region decided it. */
  universe?: MarketUniverse
  /** The one question back, for `MARKET_CLARIFY`. */
  clarification?: string
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

/**
 * The majors a ranking runs over when the advisor names none. The US set is
 * the four an advisor means by "de stora USA-indexen"; the Dow and the
 * Russell are served for history only, so a ranking over today uses the
 * region's live-quoted indices instead.
 */
export const UNIVERSES: Record<
  MarketUniverse,
  { region: MarketScope; symbols: readonly CanonicalSymbol[]; name: string }
> = {
  'us-majors': {
    region: 'us',
    symbols: [SYM_SP500, SYM_NASDAQ100, SYM_DJIA, SYM_RUSSELL2000],
    name: 'de stora USA-indexen',
  },
  'europe-majors': {
    region: 'europe',
    symbols: [SYM_DAX, SYM_FTSE100, SYM_OMXS30],
    name: 'de stora europeiska indexen',
  },
}

export const BEST_UNIVERSE_QUESTION = 'Menar du bland de stora USA-indexen?'

const universeOfRegion = (region: MarketScope): MarketUniverse | null =>
  region === 'us'
    ? 'us-majors'
    : region === 'europe' || region === 'sweden'
      ? 'europe-majors'
      : null

/** The region an index belongs to, for inferring a ranking's universe; null for anything but an index. */
const regionOfIndex = (symbol: CanonicalSymbol): MarketScope | null =>
  UNIVERSES['us-majors'].symbols.includes(symbol)
    ? 'us'
    : UNIVERSES['europe-majors'].symbols.includes(symbol)
      ? 'europe'
      : null

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
  /* "Den här månaden" is month-to-date; "senaste månaden" is a month back. Not the same period. */
  {
    pattern: words([
      '(?:den här|denna|i|under) månaden',
      'hittills i månaden',
      'månaden hittills',
      'sedan månadsskiftet',
    ]),
    period: { kind: 'range', range: 'mtd' },
  },
  {
    pattern: words([
      '(?:senaste|förra|den senaste|den gångna) månaden',
      'månaden',
      'senaste 30 dagarna',
      '30 dagar',
      'på en månad',
      'en månad tillbaka',
      'månadsvis',
    ]),
    period: { kind: 'range', range: '1m' },
  },
  /* Exactly five sessions, which is not a calendar week. */
  {
    pattern: words([
      '(?:5|fem) (?:handels)?dagar',
      'senaste (?:5|fem) (?:handels)?dagarna',
      'de senaste (?:5|fem) (?:handels)?dagarna',
      'handelsdagarna',
    ]),
    period: { kind: 'range', range: '5d' },
  },
  /* "Senaste veckan" is seven days back; "den här veckan" and "i veckan" are the week under way. The rolling one is read first, so a bare "veckan" means the week under way. */
  {
    pattern: words([
      '(?:senaste|förra|den senaste|den gångna) veckan',
      'senaste (?:7|sju) dagarna',
      'på en vecka',
      'en vecka tillbaka',
      'veckovis',
    ]),
    period: { kind: 'range', range: '1w' },
  },
  {
    pattern: words([
      '(?:den här|denna|i|under) veckan',
      'veckan',
      'sedan i måndags',
      'hittills i veckan',
    ]),
    period: { kind: 'range', range: 'this-week' },
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
  'vilka (?:gick|går|har gått) bäst',
  'vad (?:gick|går|har gått) (?:bäst|starkast)',
  'vem gick bäst',
  'bäst',
  'starkast',
  'vinnaren?',
])
const WORST = words([
  'vilken (?:gick|går|har gått|utvecklades|föll) (?:sämst|svagast|mest)',
  'vad (?:gick|går|har gått) (?:sämst|svagast)',
  'sämst',
  'svagast',
  'förloraren?',
])
/** "Ja", "japp", "precis": the answer to the one question back. A region word answers it too, through the lexicon. */
const YES = /^(?:ja|japp|jo|yes|ok|okej|precis|gärna|exakt)(?![\p{L}])/iu
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

/** The region a line names, by the same lexicon the market recogniser uses; null when it names none. */
export function regionNamed(text: string): MarketScope | null {
  return REGION_LEXICON.find((entry) => entry.pattern.test(text))?.region ?? null
}

/** What the conversation remembers after an answer to this query: the subject, the period, the thread when it is wider, and a question asked back. */
export function conversationAfter(query: MarketQuery): MarketConversation {
  const remembered: MarketConversation = {
    symbols: query.symbols,
    region: query.region,
    period: query.period,
  }
  if (query.kind === 'MARKET_CLARIFY')
    return {
      ...remembered,
      pending: {
        kind: 'best-universe',
        superlative: query.superlative ?? 'best',
        period: query.period,
      },
    }
  return query.thread.length > query.symbols.length
    ? { ...remembered, set: query.thread }
    : remembered
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
  /* A fragment leans on the conversation; a whole question stands alone. */
  const continues = followUp && conversation !== null
  const conversationSymbols = (): readonly CanonicalSymbol[] =>
    conversation
      ? conversation.symbols.length > 0
        ? conversation.symbols
        : conversation.region
          ? REGION_INDICES[conversation.region]
          : []
      : []
  /** The thread so far — "S&P 500 … och Nasdaq?" is two — when it is wider than the last subject. */
  const conversationSet = (): readonly CanonicalSymbol[] =>
    conversation?.set && conversation.set.length >= 2
      ? conversation.set
      : conversationSymbols()
  /*
   * What the thread covers after this line. A fragment that adds an
   * instrument widens it, so "Vilken gick bäst?" has every index the
   * advisor has brought up to rank; a fragment that only moves the period
   * keeps it; a whole question, a region, a comparison or a ranking
   * replaces it with its own instruments.
   */
  const threadAfter = (
    built: Omit<MarketQuery, 'thread'>,
  ): readonly CanonicalSymbol[] => {
    if (!continues) return built.symbols
    if (built.kind === 'MARKET_INDEX_PERFORMANCE' && built.explicit.subject)
      return unique([...conversationSet(), ...built.symbols]).slice(-MAX_SYMBOLS)
    if (
      !built.explicit.subject &&
      (built.kind === 'MARKET_INDEX_PERFORMANCE' ||
        built.kind === 'MARKET_REGION_PERFORMANCE') &&
      conversationSet().length > built.symbols.length
    )
      return conversationSet()
    return built.symbols
  }
  const query = (
    kind: MarketIntentKind,
    symbols: readonly CanonicalSymbol[],
    over: Partial<MarketQuery> & { explicit: MarketQuery['explicit'] },
  ): MarketQuery => {
    const built: Omit<MarketQuery, 'thread'> = {
      kind,
      symbols: unique(symbols).slice(0, MAX_SYMBOLS),
      region: null,
      period: period ?? inherited(),
      targets: [],
      notServed: [],
      method: 'market-query-v1',
      ...over,
    }
    return { ...built, thread: threadAfter(built) }
  }

  /** A ranking over a universe: the region's majors for a period, its live-quoted indices for today. */
  const universeQuery = (
    universe: MarketUniverse,
    superlative: 'best' | 'worst',
    over: MarketPeriod,
    explicitPeriod: boolean,
  ): MarketQuery => {
    const { region: universeRegion, symbols: majors } = UNIVERSES[universe]
    const members = over.kind === 'today' ? REGION_INDICES[universeRegion] : majors
    return query('MARKET_BEST', members, {
      region: universeRegion,
      targets: quoteTargets(members),
      superlative,
      universe,
      period: over,
      explicit: { subject: false, period: explicitPeriod },
    })
  }

  /* 0. The answer to the one question back: "ja" is the US majors, a region word is that region's. */
  if (
    conversation?.pending &&
    targets.length === 0 &&
    !best &&
    !worst &&
    !asksState &&
    !generic
  ) {
    const pending = conversation.pending
    const universe = region
      ? universeOfRegion(region)
      : YES.test(line)
        ? 'us-majors'
        : null
    if (universe)
      return universeQuery(
        universe,
        pending.superlative,
        period ?? pending.period,
        period !== null,
      )
  }

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
    if ((best || worst) && quoted.length + conversationSet().length >= 2) {
      const set = quoted.length >= 2 ? quoted : [...conversationSet(), ...quoted]
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
      /* "Vilket USA-index gick bäst i veckan?": the region's majors over a period, its live indices today. */
      const universe = universeOfRegion(region)
      if (universe)
        return universeQuery(
          universe,
          worst ? 'worst' : 'best',
          period ?? inherited(),
          period !== null,
        )
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

  /*
   * 4. "Vilken gick bäst?" over what the thread has covered. With one index
   * in the thread the ranking is over its region's majors — "vad gick bäst?"
   * after S&P 500 is the US majors; with nothing to infer from, one question
   * back and never a refusal.
   */
  if (best || worst) {
    const superlative = worst ? 'worst' : 'best'
    const set = conversationSet()
    /* A region thread that named no index — "amerikanska börsen" — ranks the region's majors, not its two default tiles. */
    const regionDefaults =
      conversation?.region !== null && conversation?.region !== undefined
        ? universeOfRegion(conversation.region)
        : null
    const unnamedRegion =
      regionDefaults !== null &&
      set.length === REGION_INDICES[conversation!.region!].length &&
      set.every((symbol) => REGION_INDICES[conversation!.region!].includes(symbol))
    if (unnamedRegion && regionDefaults)
      return universeQuery(
        regionDefaults,
        superlative,
        period ?? conversation!.period,
        period !== null,
      )
    if (set.length >= 2) {
      return query('MARKET_BEST', set, {
        region: conversation?.region ?? null,
        targets: quoteTargets(set),
        superlative,
        period: period ?? conversation!.period,
        explicit: { subject: false, period: period !== null },
      })
    }
    const over = period ?? conversation?.period ?? TODAY
    const inferredRegion =
      set.length === 1 ? regionOfIndex(set[0]!) : (conversation?.region ?? null)
    const universe = inferredRegion ? universeOfRegion(inferredRegion) : null
    if (universe) return universeQuery(universe, superlative, over, period !== null)
    if (marketScope || conversation) {
      return query('MARKET_CLARIFY', [], {
        clarification: BEST_UNIVERSE_QUESTION,
        superlative,
        period: over,
        explicit: { subject: false, period: period !== null },
      })
    }
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

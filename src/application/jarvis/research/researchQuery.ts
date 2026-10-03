/**
 * The research family of questions, recognised without a model: why the
 * market moved, what a central bank said, what a release showed, what a
 * company reported, what the market expects, what the week holds, how the
 * pre-market looks, what analysts say — the questions whose answer is
 * public and current rather than stored.
 *
 * ## Primary, not a fallback
 *
 * These are routed here before any model and beside the market tier, not
 * after an internal failure: "Varför går börsen ner just nu?" is
 * inherently a research question. A judgement question — "borde jag",
 * "köpa", "vikt", "exponering" — is refused here as everywhere, and goes
 * to the one router and the firm. A line that names a client is never
 * research on its own: the firewall decomposes it, and the public part is
 * the typed market event.
 *
 * ## Context
 *
 * The research context and the market conversation carry the subject on:
 * "Hur gick USA förra veckan?" then "Varför?" then "Vad säger analytiker
 * om nästa vecka?" never restate USA, last week, equities. Explicit words
 * win over context, and freshness words — idag, nu, i morse, nästa vecka
 * — make the question freshness-critical.
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
import type { JarvisScope } from '../context'
import type { MarketScope } from '../marketBrief'
import { L, mentionsMarket, namedTargets, WORD, words } from '../marketIntent'
import {
  REGION_RATES,
  regionNamed,
  resolvePeriod,
  type MarketConversation,
  type MarketPeriod,
} from '../marketQuery'
import type { SearchFreshness } from './publicSearch'

export type ResearchKind =
  /** "Varför går börsen ner?", "Vad drev Nasdaq igår?": market data plus trusted reporting. */
  | 'MARKET_WHY'
  /** "Vad sa Powell?", "Vad beslutade Riksbanken?": the official source first. */
  | 'CENTRAL_BANK'
  /** "Vad visade KPI?", "Hur var jobbrapporten?": the statistics agency first. */
  | 'MACRO_RELEASE'
  /** "Vad rapporterade Nvidia?", "Vad sa bolaget om guidance?": the filing first. */
  | 'COMPANY'
  /** "Vad händer nästa vecka?", "Vilka bolag rapporterar idag?": calendars, then reporting. */
  | 'WEEK_AHEAD'
  /** "Hur ser pre-market ut?", "Hur öppnar USA?": current reporting. */
  | 'PRE_MARKET'
  /** "Vad driver marknaden?": market data plus reporting. */
  | 'MARKET_DRIVERS'
  /** "Vad väntar sig marknaden av CPI?", "Vad tycker marknaden om nästa Fed-möte?". */
  | 'MARKET_EXPECTATIONS'
  /** "Vad säger analytiker om nästa vecka?". */
  | 'ANALYST_VIEW'
  /** "Vad händer med dollarn?" and other current public questions with a named subject. */
  | 'GENERAL_FINANCIAL'

export type ResearchDepth = 'quick' | 'deep'
export type Institution = 'fed' | 'riksbank' | 'ecb' | 'boe' | 'boj'
export type MacroRelease =
  'cpi' | 'jobs' | 'unemployment' | 'pmi' | 'ism' | 'gdp' | 'retail' | 'pce'
export type Country = 'us' | 'se' | 'eu' | 'uk' | 'jp'

export interface ResearchCompany {
  name: string
  /** The EDGAR ticker, where the company files with the SEC; null for a company that does not. */
  ticker: string | null
  country: Country | null
}

/** What a research conversation remembers between lines: the subject in typed slots, never a sentence. */
export interface ResearchContext {
  topic: string | null
  region: MarketScope | null
  period: MarketPeriod | null
  instruments: readonly CanonicalSymbol[]
  companies: readonly ResearchCompany[]
  institution: Institution | null
  release: MacroRelease | null
  evidenceIds: readonly string[]
  asOf: string | null
}

export interface ResearchQuery {
  kind: ResearchKind
  depth: ResearchDepth
  freshness: SearchFreshness
  /** The line says now: idag, just nu, i morse, nästa vecka. No cache older than minutes serves it. */
  freshnessCritical: boolean
  region: MarketScope | null
  period: MarketPeriod | null
  instruments: readonly CanonicalSymbol[]
  companies: readonly ResearchCompany[]
  institution: Institution | null
  release: MacroRelease | null
  country: Country | null
  explicit: { subject: boolean; period: boolean }
  /** The line leaned on the conversation for its subject or period. */
  continues: boolean
  /** The advisor's own words, for the firewall to judge; never sent in a record scope. */
  line: string
  method: 'research-query-v1'
}

export interface ResearchQueryOptions {
  scope: JarvisScope
  market: MarketConversation | null
  research: ResearchContext | null
  now?: Date
}

/* ---------------------------------------------------------------- lexicon */

const MAX_LINE = 300

/** Judgement, allocation and institutional work: refused here, the firm's or the router's. */
const NOT_RESEARCH = words([
  'borde',
  'bör',
  'ska (?:jag|vi)',
  'skall (?:jag|vi)',
  `köp${L}`,
  `sälj${L}`,
  `minska${L}`,
  `öka${L}`,
  `vikt${L}`,
  `position${L}`,
  `exponering${L}`,
  `attraktiv${L}`,
  `rekommend${L}`,
  `ärende${L}`,
  `kommitt${L}`,
  'tesen?',
  `scenario${L}`,
  'should (?:i|we)',
  'buy',
  'sell',
])

/** "Vad ska jag hålla koll på?" is a calendar question, whatever "ska jag" means elsewhere. */
const WATCHLIST = words([
  'vad (?:ska|bör|borde) (?:jag|vi|man) (?:hålla koll på|ha koll på|bevaka|följa|titta på)',
  'vad (?:är|finns) (?:det )?(?:att )?(?:hålla koll på|bevaka)',
  'what (?:should|do) (?:i|we) (?:watch|look for)',
])

const WHY = words([
  'varför',
  'vad drev',
  'vad driver',
  'vad drivit',
  'vad har drivit',
  `drivkraft${L}`,
  'vad ligger bakom',
  'vad låg bakom',
  'hur kommer det sig',
  `orsak${L}`,
  `katalysator${L}`,
  'vad betyder',
  'innebär',
  'förklara',
  'vad kan vända',
  'vad skulle vända',
  'why',
  'what drove',
  'what is driving',
  'what could reverse',
  'what would reverse',
])

const INSTITUTIONS: readonly { pattern: RegExp; institution: Institution }[] = [
  {
    pattern: words(['fed', 'federal reserve', 'fomc', 'powell', 'centralbanken i usa']),
    institution: 'fed',
  },
  { pattern: words([`riksbank${L}`, 'thedéen', 'thedeen']), institution: 'riksbank' },
  { pattern: words(['ecb', 'europeiska centralbanken', 'lagarde']), institution: 'ecb' },
  { pattern: words(['bank of england', 'boe', 'bailey']), institution: 'boe' },
  { pattern: words(['bank of japan', 'boj', 'ueda']), institution: 'boj' },
]

const STATEMENT = words([
  'sa',
  'sade',
  'säger',
  `beslut${L}`,
  `besked${L}`,
  'höjde',
  'sänkte',
  'lämnade',
  'höjer',
  'sänker',
  `styrränt${L}`,
  `räntebesked${L}`,
  `räntebeslut${L}`,
  `protokoll${L}`,
  'minutes',
  'talet',
  'tal',
  `presskonferens${L}`,
  `uttalande${L}`,
  'vad gjorde',
  'vad hände',
  'vad händer',
  'what did',
  'said',
  'decision',
])

const RELEASES: readonly { pattern: RegExp; release: MacroRelease }[] = [
  {
    pattern: words(['kpi', 'cpi', `inflation${L}`, `konsumentpris${L}`]),
    release: 'cpi',
  },
  {
    pattern: words([
      `jobbrapport${L}`,
      'nfp',
      'payrolls',
      `sysselsättning${L}`,
      'jobs report',
    ]),
    release: 'jobs',
  },
  { pattern: words([`arbetslöshet${L}`, 'unemployment']), release: 'unemployment' },
  { pattern: words(['ism']), release: 'ism' },
  { pattern: words(['pmi', `inköpschef${L}`]), release: 'pmi' },
  { pattern: words(['bnp', 'gdp', `tillväxtsiffr${L}`]), release: 'gdp' },
  { pattern: words([`detaljhandel${L}`, 'retail sales']), release: 'retail' },
  { pattern: words(['pce']), release: 'pce' },
]

const COMPANY_CUE = words([
  'rapporterade',
  'rapporterar',
  `rapport${L}`,
  `kvartalsrapport${L}`,
  `delårsrapport${L}`,
  'guidance',
  `prognos${L}`,
  `vinst${L}`,
  `omsättning${L}`,
  `resultat${L}`,
  `värdering${L}`,
  'p/e',
  `multipl${L}`,
  'bolaget',
  `aktien${L}`,
  'earnings',
  'reported',
  'results',
])

/** Companies an advisor names, with the filing ticker where the SEC has one. Reviewed; a name outside it is still a company when the line says so. */
const COMPANIES: readonly { pattern: RegExp; company: ResearchCompany }[] = [
  {
    pattern: words(['nvidia']),
    company: { name: 'Nvidia', ticker: 'NVDA', country: 'us' },
  },
  {
    pattern: words(['apple']),
    company: { name: 'Apple', ticker: 'AAPL', country: 'us' },
  },
  {
    pattern: words(['microsoft']),
    company: { name: 'Microsoft', ticker: 'MSFT', country: 'us' },
  },
  {
    pattern: words(['amazon']),
    company: { name: 'Amazon', ticker: 'AMZN', country: 'us' },
  },
  {
    pattern: words(['alphabet', 'google']),
    company: { name: 'Alphabet', ticker: 'GOOGL', country: 'us' },
  },
  {
    pattern: words(['meta', 'facebook']),
    company: { name: 'Meta', ticker: 'META', country: 'us' },
  },
  {
    pattern: words(['tesla']),
    company: { name: 'Tesla', ticker: 'TSLA', country: 'us' },
  },
  {
    pattern: words(['netflix']),
    company: { name: 'Netflix', ticker: 'NFLX', country: 'us' },
  },
  {
    pattern: words(['broadcom']),
    company: { name: 'Broadcom', ticker: 'AVGO', country: 'us' },
  },
  { pattern: words(['amd']), company: { name: 'AMD', ticker: 'AMD', country: 'us' } },
  {
    pattern: words(['intel']),
    company: { name: 'Intel', ticker: 'INTC', country: 'us' },
  },
  {
    pattern: words(['jpmorgan', 'jp morgan']),
    company: { name: 'JPMorgan', ticker: 'JPM', country: 'us' },
  },
  {
    pattern: words(['goldman(?: sachs)?']),
    company: { name: 'Goldman Sachs', ticker: 'GS', country: 'us' },
  },
  {
    pattern: words(['exxon(?:mobil)?']),
    company: { name: 'ExxonMobil', ticker: 'XOM', country: 'us' },
  },
  {
    pattern: words(['novo(?: nordisk)?']),
    company: { name: 'Novo Nordisk', ticker: 'NVO', country: 'eu' },
  },
  { pattern: words(['asml']), company: { name: 'ASML', ticker: 'ASML', country: 'eu' } },
  {
    pattern: words(['spotify']),
    company: { name: 'Spotify', ticker: 'SPOT', country: 'se' },
  },
  {
    pattern: words(['ericsson']),
    company: { name: 'Ericsson', ticker: 'ERIC', country: 'se' },
  },
  {
    pattern: words(['volvo(?: cars| group| ab)?']),
    company: { name: 'Volvo', ticker: null, country: 'se' },
  },
  {
    pattern: words(['investor(?: ab)?']),
    company: { name: 'Investor', ticker: null, country: 'se' },
  },
  {
    pattern: words(['atlas copco']),
    company: { name: 'Atlas Copco', ticker: null, country: 'se' },
  },
  {
    pattern: words(['h&m', 'hennes']),
    company: { name: 'H&M', ticker: null, country: 'se' },
  },
  {
    pattern: words(['sandvik']),
    company: { name: 'Sandvik', ticker: null, country: 'se' },
  },
  { pattern: words(['seb']), company: { name: 'SEB', ticker: null, country: 'se' } },
  {
    pattern: words(['swedbank']),
    company: { name: 'Swedbank', ticker: null, country: 'se' },
  },
  {
    pattern: words(['handelsbanken']),
    company: { name: 'Handelsbanken', ticker: null, country: 'se' },
  },
  {
    pattern: words(['nordea']),
    company: { name: 'Nordea', ticker: null, country: 'se' },
  },
  {
    pattern: words(['evolution']),
    company: { name: 'Evolution', ticker: null, country: 'se' },
  },
  {
    pattern: words(['hexagon']),
    company: { name: 'Hexagon', ticker: null, country: 'se' },
  },
  { pattern: words(['saab']), company: { name: 'Saab', ticker: null, country: 'se' } },
  {
    pattern: words(['assa abloy']),
    company: { name: 'Assa Abloy', ticker: null, country: 'se' },
  },
]

const WEEK_AHEAD = words([
  'nästa vecka',
  'veckan som kommer',
  'kommande vecka',
  'kommande veckan',
  'vad händer i veckan',
  'vad händer den här veckan',
  'vilka (?:stora )?bolag rapporterar',
  'vem rapporterar',
  'rapporterar (?:idag|i dag|i veckan|imorgon|i morgon)',
  `kalender${L}`,
  'viktiga datum',
  'viktiga händelser',
  'händelser i veckan',
  'next week',
  'week ahead',
  'this week',
])

const PRE_MARKET = words([
  'pre-?market',
  'premarket',
  `förhandel${L}`,
  'terminerna',
  `terminsmarknad${L}`,
  'futures',
  'före öppning',
  'innan öppning',
  'inför öppningen',
  'hur öppnar',
  'i morse',
])

const DRIVERS = words([
  'vad driver (?:marknaden|börsen|börserna|kurserna|marknaderna)',
  'vad rör marknaden',
  'vad styr marknaden',
  'vad är temat',
  'what is driving the market',
  'market drivers',
])

const EXPECTATIONS = words([
  'väntar (?:\\S+ )?sig',
  'förväntar (?:\\S+ )?sig',
  `förväntning${L}`,
  'prisar in',
  'prissätter',
  'konsensus',
  'vad tror marknaden',
  'vad tycker marknaden',
  'vad räknar marknaden',
  'expects?',
  'expectations',
  'priced in',
])

const ANALYST = words([
  `analytiker${L}`,
  `strateg${L}`,
  `bedömare${L}`,
  `expert${L}`,
  'vad säger marknaden',
  'vad säger (?:bankerna|husen)',
  'analysts?',
  'strategists?',
])

const DEEP = words([
  'ta reda på',
  'ordentlig analys',
  'ordentligt',
  'gör en analys',
  'gör en ordentlig',
  'djupare',
  'på djupet',
  'gräv',
  'undersök',
  'research (?:this|it|det)',
  'research',
  'dig into',
])

const FRESH = words([
  'idag',
  'i dag',
  'nu',
  'just nu',
  'precis',
  'senaste',
  'i morse',
  'pre-?market',
  'den här veckan',
  'i veckan',
  'nästa vecka',
  'igår',
  'i går',
  'live',
  'today',
  'now',
  'this morning',
])

const CURRENT_EVENT = words([
  'vad händer med',
  'vad hände med',
  'vad har hänt med',
  'senaste nytt om',
  'något nytt om',
  'what happened to',
  'what is happening with',
])

const FOLLOW_UP_START =
  /^(?:och|men|samt|hur var det med|vad sägs om|and|but)(?![\p{L}])/iu

/** "Ränteuppgången", "räntorna", "yields": the rates as the subject, when no single rate is named. */
const RATES_CUE =
  /(?<![\p{L}])(?:ränt\p{L}*|yields?|statsobligation\p{L}*|långränt\p{L}*|obligationsmarknad\p{L}*)(?![\p{L}])/iu

const WORDS_THAT_START_A_NAME = new Set([
  'Hur',
  'Vad',
  'Varför',
  'Vilken',
  'Vilket',
  'Vilka',
  'Och',
  'Men',
  'Är',
  'Har',
  'Kan',
  'Vem',
  'När',
  'Finns',
  'Ska',
  'Bör',
  'Hade',
  'Gick',
  'Går',
  'Visa',
  'Berätta',
  'Säg',
  'Ge',
  'Ta',
  'Gör',
  'Research',
  'What',
  'Why',
  'How',
  'Did',
  'Is',
  'Was',
])

/* ---------------------------------------------------------------- slots */

function institutionIn(line: string): Institution | null {
  return INSTITUTIONS.find((entry) => entry.pattern.test(line))?.institution ?? null
}

function releaseIn(line: string): MacroRelease | null {
  return RELEASES.find((entry) => entry.pattern.test(line))?.release ?? null
}

/** Companies the line names: the reviewed list first, then a capitalised word beside a company cue. */
export function companiesIn(line: string, hasCue: boolean): ResearchCompany[] {
  const found: ResearchCompany[] = []
  for (const entry of COMPANIES) {
    if (entry.pattern.test(line) && !found.some((c) => c.name === entry.company.name))
      found.push(entry.company)
  }
  if (found.length > 0 || !hasCue) return found
  const capitalised = line.match(/(?<![\p{L}])\p{Lu}[\p{L}&-]{2,}/gu) ?? []
  for (const word of capitalised) {
    if (WORDS_THAT_START_A_NAME.has(word)) continue
    if (
      /^(?:USA|Europa|Sverige|Fed|ECB|Riksbanken|KPI|CPI|BNP|Nasdaq|Dow|Russell|OMX)/i.test(
        word,
      )
    )
      continue
    found.push({ name: word, ticker: null, country: null })
    break
  }
  return found
}

const US_SYMBOLS: readonly CanonicalSymbol[] = [
  SYM_SP500,
  SYM_NASDAQ100,
  SYM_DJIA,
  SYM_RUSSELL2000,
  SYM_US10Y,
  SYM_US2Y,
]

/** Releases only the US publishes under these names. */
const US_ONLY_RELEASES: readonly MacroRelease[] = ['jobs', 'ism', 'pce', 'retail']

/* The Swedish words for a release — "KPI", "BNP", "inflationen" — against the English acronyms an advisor uses for the US ones. */
const SWEDISH_RELEASE_WORDING =
  /(?<![\p{L}])(?:kpi|bnp|inflation\p{L}*|arbetslöshet\p{L}*|detaljhandel\p{L}*|inköpschef\p{L}*)(?![\p{L}])/iu

function countryOf(
  institution: Institution | null,
  region: MarketScope | null,
  instruments: readonly CanonicalSymbol[],
  companies: readonly ResearchCompany[],
  release: MacroRelease | null,
  line: string,
): Country | null {
  if (institution === 'fed') return 'us'
  if (institution === 'riksbank') return 'se'
  if (institution === 'ecb') return 'eu'
  if (institution === 'boe') return 'uk'
  if (institution === 'boj') return 'jp'
  if (/(?<![\p{L}])(?:svensk\p{L}*|sverige|sveriges)(?![\p{L}])/iu.test(line)) return 'se'
  if (/(?<![\p{L}])(?:amerikansk\p{L}*|usa|us)(?![\p{L}])/iu.test(line)) return 'us'
  if (/(?<![\p{L}])(?:europ\p{L}*|euroområdet|eurozonen)(?![\p{L}])/iu.test(line))
    return 'eu'
  if (region === 'us') return 'us'
  if (region === 'sweden') return 'se'
  if (region === 'europe') return 'eu'
  const first = instruments[0]
  if (first) {
    if (US_SYMBOLS.includes(first)) return 'us'
    if (first === SYM_OMXS30 || first === SYM_SE10Y) return 'se'
    if (first === SYM_DAX || first === SYM_DE10Y) return 'eu'
    if (first === SYM_FTSE100) return 'uk'
    if (first === SYM_NIKKEI225) return 'jp'
  }
  if (companies[0]?.country) return companies[0].country
  /* A release named without a country: the US one by its English acronym, the Swedish one by its Swedish word. */
  if (release) {
    if (US_ONLY_RELEASES.includes(release)) return 'us'
    return SWEDISH_RELEASE_WORDING.test(line) ? 'se' : 'us'
  }
  return null
}

/* -------------------------------------------------------------- recogniser */

/**
 * The research query a line is, in its context, or null when the line is
 * not research: a judgement, a stored fact, or nothing public to find.
 */
export function recognizeResearchQuery(
  text: string,
  options: ResearchQueryOptions,
): ResearchQuery | null {
  const line = text.trim()
  if (!line || line.length > MAX_LINE) return null
  const now = options.now ?? new Date()
  const watchlist = WATCHLIST.test(line)
  if (!watchlist && NOT_RESEARCH.test(line)) return null

  const tokens = line.match(WORD) ?? []
  const targets = namedTargets(line)
  const namedRegion = regionNamed(line)
  const namedInstruments: readonly CanonicalSymbol[] = (() => {
    const named = targets.flatMap((target) => ('symbol' in target ? [target.symbol] : []))
    if (named.length > 0) return named
    /* "Dagens ränteuppgång": the rates of the region named or, failing one, the US rates. */
    if (RATES_CUE.test(line))
      return REGION_RATES[
        namedRegion ?? options.research?.region ?? options.market?.region ?? 'us'
      ]
    return []
  })()
  const namedPeriod = resolvePeriod(line, now)
  const institution = institutionIn(line)
  const release = releaseIn(line)
  const companyCue = COMPANY_CUE.test(line)
  const companies = companiesIn(line, companyCue)
  const why = WHY.test(line)
  const expectations = EXPECTATIONS.test(line)
  const analyst = ANALYST.test(line)
  const weekAhead = watchlist || WEEK_AHEAD.test(line)
  const preMarket = PRE_MARKET.test(line)
  const drivers = DRIVERS.test(line)
  const currentEvent = CURRENT_EVENT.test(line)
  const statement = STATEMENT.test(line)
  const marketWords = mentionsMarket(line)
  const followUp = FOLLOW_UP_START.test(line) || tokens.length <= 3

  const explicitSubject =
    namedInstruments.length > 0 ||
    namedRegion !== null ||
    institution !== null ||
    release !== null ||
    companies.length > 0
  const context = options.research
  const market = options.market
  /*
   * A line leans on the conversation when it names no subject of its own
   * and either is a fragment or asks something — why, what analysts say,
   * what the market expects, what the company said, a deeper look — that
   * only makes sense about the subject under discussion.
   */
  const leans = !explicitSubject && (context !== null || market !== null)
  const continues =
    leans && (followUp || why || expectations || analyst || companyCue || DEEP.test(line))

  /* The subject: what the line says, else what the conversation carried. */
  const instruments: readonly CanonicalSymbol[] =
    namedInstruments.length > 0
      ? namedInstruments
      : continues
        ? context?.instruments.length
          ? context.instruments
          : (market?.symbols ?? [])
        : []
  const region: MarketScope | null =
    namedRegion ?? (continues ? (context?.region ?? market?.region ?? null) : null)
  const period: MarketPeriod | null =
    namedPeriod ??
    (continues || (!explicitSubject && (why || expectations || analyst))
      ? (context?.period ?? market?.period ?? null)
      : null)
  const companiesResolved =
    companies.length > 0 ? companies : continues ? (context?.companies ?? []) : []
  const institutionResolved =
    institution ?? (continues && !explicitSubject ? (context?.institution ?? null) : null)
  const releaseResolved =
    release ?? (continues && !explicitSubject ? (context?.release ?? null) : null)
  const hasSubject =
    instruments.length > 0 ||
    region !== null ||
    companiesResolved.length > 0 ||
    institutionResolved !== null ||
    releaseResolved !== null

  let kind: ResearchKind | null = null
  if (
    expectations &&
    (institutionResolved || releaseResolved || hasSubject || marketWords)
  )
    kind = 'MARKET_EXPECTATIONS'
  else if (analyst) kind = 'ANALYST_VIEW'
  else if (
    institutionResolved &&
    (statement || why || currentEvent || followUp || tokens.length <= 6)
  )
    kind = 'CENTRAL_BANK'
  else if (releaseResolved && !why) kind = 'MACRO_RELEASE'
  else if (weekAhead) kind = 'WEEK_AHEAD'
  else if (preMarket) kind = 'PRE_MARKET'
  else if (
    companiesResolved.length > 0 &&
    (companyCue || why || currentEvent || followUp)
  )
    kind = 'COMPANY'
  else if (drivers) kind = 'MARKET_DRIVERS'
  else if (why && (hasSubject || marketWords || continues)) kind = 'MARKET_WHY'
  else if (currentEvent && hasSubject) kind = 'GENERAL_FINANCIAL'
  else if (releaseResolved && why) kind = 'MACRO_RELEASE'
  /* "Gör en ordentlig analys.", "Research this." on a subject under discussion: the deep form of why. */
  else if (DEEP.test(line) && (hasSubject || continues)) kind = 'MARKET_WHY'
  if (!kind) return null

  const freshnessCritical =
    FRESH.test(line) || period?.kind === 'today' || kind === 'PRE_MARKET'
  const freshness: SearchFreshness =
    kind === 'PRE_MARKET' || kind === 'MARKET_DRIVERS' || freshnessCritical
      ? 'day'
      : kind === 'MARKET_WHY' || kind === 'WEEK_AHEAD' || kind === 'ANALYST_VIEW'
        ? 'week'
        : kind === 'COMPANY' || kind === 'MACRO_RELEASE' || kind === 'CENTRAL_BANK'
          ? 'month'
          : 'week'

  return {
    kind,
    depth: DEEP.test(line) ? 'deep' : 'quick',
    freshness,
    freshnessCritical,
    region,
    period,
    instruments,
    companies: companiesResolved,
    institution: institutionResolved,
    release: releaseResolved,
    country: countryOf(
      institutionResolved,
      region,
      instruments,
      companiesResolved,
      releaseResolved,
      line,
    ),
    explicit: { subject: explicitSubject, period: namedPeriod !== null },
    continues,
    line,
    method: 'research-query-v1',
  }
}

/** What the research conversation remembers after this query was answered. */
export function researchContextAfter(
  query: ResearchQuery,
  evidenceIds: readonly string[],
  asOf: string | null,
): ResearchContext {
  return {
    topic: topicOf(query),
    region: query.region,
    period: query.period,
    instruments: query.instruments,
    companies: query.companies,
    institution: query.institution,
    release: query.release,
    evidenceIds,
    asOf,
  }
}

/** A short topic key for the context and the cache: `fed`, `us:cpi`, `company:nvidia`, `idx:sp500`. */
export function topicOf(query: ResearchQuery): string | null {
  if (query.institution) return query.institution
  if (query.release) return `${query.country ?? 'us'}:${query.release}`
  if (query.companies[0]) return `company:${query.companies[0].name.toLowerCase()}`
  if (query.instruments[0]) return query.instruments[0]
  if (query.region) return `region:${query.region}`
  return null
}

export const INSTITUTION_NAMES: Record<Institution, string> = {
  fed: 'Federal Reserve',
  riksbank: 'Riksbanken',
  ecb: 'ECB',
  boe: 'Bank of England',
  boj: 'Bank of Japan',
}

export const RELEASE_NAMES: Record<MacroRelease, string> = {
  cpi: 'KPI',
  jobs: 'jobbrapporten',
  unemployment: 'arbetslösheten',
  pmi: 'PMI',
  ism: 'ISM',
  gdp: 'BNP',
  retail: 'detaljhandeln',
  pce: 'PCE',
}

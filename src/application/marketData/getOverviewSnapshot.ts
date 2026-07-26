/**
 * `getOverviewSnapshot` — the Overview's single application-level use case.
 *
 * The browser makes one request; the server assembles every category. Each
 * category is independently timestamped, because their sources genuinely
 * update at different frequencies, and `snapshot.asOf` is the OLDEST of them —
 * the conservative answer to "how current is this screen?", and what the
 * "Data uppdaterad" label displays (decisions D5 and D10).
 *
 * Categories resolve concurrently and independently: one slow or failing
 * category degrades its own panel and nothing else.
 */

import {
  hasData,
  OVERVIEW_COMMODITY_SYMBOLS,
  OVERVIEW_CRYPTO_SYMBOLS,
  OVERVIEW_FX_SYMBOLS,
  OVERVIEW_INDEX_SYMBOLS,
  OVERVIEW_SECTOR_SYMBOLS,
  OVERVIEW_WATCHLIST_SYMBOLS,
  OVERVIEW_YIELD_SYMBOLS,
  instrumentRef,
  type CanonicalSymbol,
  type Envelope,
  type GovernmentYield,
  type InstrumentRef,
  type MarketQuote,
  type MarketSentiment,
  type MarketSeries,
  type NewsItem,
  type SeriesRange,
  type YieldCurve,
} from '~/domain/market'

/** Everything the Overview renders, in one coherent snapshot. */
export interface OverviewSnapshot {
  indices: Envelope<MarketQuote[]>
  /** Tile sparklines, keyed by the symbol they belong to. */
  indexSparklines: Envelope<Record<CanonicalSymbol, MarketSeries>>
  fx: Envelope<MarketQuote[]>
  commodities: Envelope<MarketQuote[]>
  crypto: Envelope<MarketQuote[]>
  yields: Envelope<GovernmentYield[]>
  yieldCurve: Envelope<YieldCurve>
  sectors: Envelope<MarketQuote[]>
  sentiment: Envelope<MarketSentiment>
  news: Envelope<NewsItem[]>
  /**
   * All ranges, so the range selector stays instant.
   *
   * Deliberate Phase 0 choice: the legacy screen switched ranges with no
   * network call, and introducing one would add a loading state the visual
   * lock forbids. Revisit in Phase 6, when these become real series and
   * fetching six ranges up front stops being free.
   */
  intraday: Envelope<Record<SeriesRange, MarketSeries[]>>
  watchlist: Envelope<MarketQuote[]>
  watchlistSparklines: Envelope<Record<CanonicalSymbol, MarketSeries>>

  /** Reference data for every symbol referenced above. */
  instruments: Record<CanonicalSymbol, InstrumentRef>

  /**
   * The request chain this snapshot belongs to.
   *
   * Not rendered. It exists so a reported problem can be traced to exact log
   * lines, and so future support or tracing surfaces have something to join
   * on. Deliberately never used as a metric label — it is unbounded, and a
   * label is a time series.
   */
  correlationId: string
  /** Oldest `asOf` across populated categories. Never the newest, never a mean. */
  asOf: string
  generatedAt: string
  /** True when any category is stale, fixture, delayed or proxied. */
  hasDegradedCategory: boolean
}

/**
 * Everything the use case needs. Deliberately not the infrastructure
 * `Container`: this signature is what keeps the application layer unable to
 * name a provider, a cache or an HTTP client.
 */
export interface OverviewDataSource {
  /** The correlation id every category in this snapshot was resolved under. */
  correlationId(): string
  quotes(symbols: readonly CanonicalSymbol[]): Promise<Envelope<MarketQuote[]>>
  fx(symbols: readonly CanonicalSymbol[]): Promise<Envelope<MarketQuote[]>>
  commodities(symbols: readonly CanonicalSymbol[]): Promise<Envelope<MarketQuote[]>>
  crypto(symbols: readonly CanonicalSymbol[]): Promise<Envelope<MarketQuote[]>>
  sectors(symbols: readonly CanonicalSymbol[]): Promise<Envelope<MarketQuote[]>>
  watchlist(symbols: readonly CanonicalSymbol[]): Promise<Envelope<MarketQuote[]>>
  yields(symbols: readonly CanonicalSymbol[]): Promise<Envelope<GovernmentYield[]>>
  yieldCurve(countryCode: string): Promise<Envelope<YieldCurve>>
  news(limit: number): Promise<Envelope<NewsItem[]>>
  sentiment(): Promise<Envelope<MarketSentiment>>
  sparklines(
    symbols: readonly CanonicalSymbol[],
  ): Promise<Envelope<Record<CanonicalSymbol, MarketSeries>>>
  watchlistSparklines(
    symbols: readonly CanonicalSymbol[],
  ): Promise<Envelope<Record<CanonicalSymbol, MarketSeries>>>
  intraday(): Promise<Envelope<Record<SeriesRange, MarketSeries[]>>>
  now(): Date
}

/** Oldest `asOf` across every envelope that carries data. */
function oldestAsOf(envelopes: Array<Envelope<unknown>>, fallback: string): string {
  let oldest: string | null = null
  for (const envelope of envelopes) {
    if (!hasData(envelope)) continue
    if (oldest === null || new Date(envelope.provenance.asOf) < new Date(oldest)) {
      oldest = envelope.provenance.asOf
    }
  }
  return oldest ?? fallback
}

function isDegradedEnvelope(envelope: Envelope<unknown>): boolean {
  if (envelope.state === 'error' || envelope.state === 'stale') return true
  if (envelope.state === 'fixture') return true
  if (envelope.state === 'loading') return false
  return envelope.provenance.isDelayed || envelope.provenance.isProxy
}

const ALL_SYMBOLS: CanonicalSymbol[] = [
  ...OVERVIEW_INDEX_SYMBOLS,
  ...OVERVIEW_FX_SYMBOLS,
  ...OVERVIEW_COMMODITY_SYMBOLS,
  ...OVERVIEW_CRYPTO_SYMBOLS,
  ...OVERVIEW_YIELD_SYMBOLS,
  ...OVERVIEW_SECTOR_SYMBOLS,
  ...OVERVIEW_WATCHLIST_SYMBOLS,
]

/**
 * Isolates one category.
 *
 * `resolve()` is designed never to throw, but "designed never to" is not a
 * guarantee: a bug in an adapter, a normalizer or the pipeline itself would
 * otherwise reject `Promise.all` and take the entire page down with it. One
 * failing category must degrade one panel.
 */
async function isolate<T>(
  label: string,
  run: () => Promise<Envelope<T>>,
): Promise<Envelope<T>> {
  try {
    return await run()
  } catch (error) {
    return {
      state: 'error',
      error: {
        code: 'unknown',
        message: `Category "${label}" failed unexpectedly: ${
          error instanceof Error ? error.message : String(error)
        }`,
        providerId: null,
        retryable: true,
      },
    }
  }
}

export async function getOverviewSnapshot(
  source: OverviewDataSource,
): Promise<OverviewSnapshot> {
  const [
    indices,
    indexSparklines,
    fx,
    commodities,
    crypto,
    yields,
    yieldCurve,
    sectors,
    sentiment,
    news,
    intraday,
    watchlist,
    watchlistSparklines,
  ] = await Promise.all([
    isolate('indices', () => source.quotes(OVERVIEW_INDEX_SYMBOLS)),
    isolate('indexSparklines', () => source.sparklines(OVERVIEW_INDEX_SYMBOLS)),
    isolate('fx', () => source.fx(OVERVIEW_FX_SYMBOLS)),
    isolate('commodities', () => source.commodities(OVERVIEW_COMMODITY_SYMBOLS)),
    isolate('crypto', () => source.crypto(OVERVIEW_CRYPTO_SYMBOLS)),
    isolate('yields', () => source.yields(OVERVIEW_YIELD_SYMBOLS)),
    isolate('yieldCurve', () => source.yieldCurve('US')),
    isolate('sectors', () => source.sectors(OVERVIEW_SECTOR_SYMBOLS)),
    isolate('sentiment', () => source.sentiment()),
    isolate('news', () => source.news(4)),
    isolate('intraday', () => source.intraday()),
    isolate('watchlist', () => source.watchlist(OVERVIEW_WATCHLIST_SYMBOLS)),
    isolate('watchlistSparklines', () =>
      source.watchlistSparklines(OVERVIEW_WATCHLIST_SYMBOLS),
    ),
  ])

  const categories: Array<Envelope<unknown>> = [
    indices,
    indexSparklines,
    fx,
    commodities,
    crypto,
    yields,
    yieldCurve,
    sectors,
    sentiment,
    news,
    intraday,
    watchlist,
    watchlistSparklines,
  ]

  const now = source.now().toISOString()
  const instruments = Object.fromEntries(
    ALL_SYMBOLS.map((symbol) => [symbol, instrumentRef(symbol)]),
  ) as Record<CanonicalSymbol, InstrumentRef>

  return {
    indices,
    indexSparklines,
    fx,
    commodities,
    crypto,
    yields,
    yieldCurve,
    sectors,
    sentiment,
    news,
    intraday,
    watchlist,
    watchlistSparklines,
    instruments,
    correlationId: source.correlationId(),
    asOf: oldestAsOf(categories, now),
    generatedAt: now,
    hasDegradedCategory: categories.some(isDegradedEnvelope),
  }
}

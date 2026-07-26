/**
 * Markets data on the shared resolution pipeline.
 *
 * Four existing categories, no new ones. Cache keys are built the same way as
 * everywhere else, so where the symbol set matches another page's the entry is
 * shared — OMXS30 and Bitcoin are already resolved for the Overview.
 *
 * The FX pair set differs from the Overview's (EUR/SEK + USD/SEK here, versus
 * USD/SEK + EUR/USD there), so that one is a genuinely separate entry. It asks
 * Frankfurter for different data, which is the honest reason for a separate
 * key rather than an oversight.
 *
 * Written as four explicit resolutions rather than one generic helper: each
 * capability has a different port method, and the typed registry gives them to
 * us directly. A shared helper would have to erase the provider type to accept
 * all four, which is precisely the `as never` pattern H3 removed.
 */

import type { CanonicalSymbol, MarketQuote, Provenance } from '~/domain/market'
import type { CorrelationId } from '~/domain/shared/correlation'
import type { DataCategory, FetchContext } from '~/application/marketData/ports'
import type { MarketsDataSource } from '~/application/marketData/getMarkets'
import { resolve, type ResolveDeps } from '~/application/marketData/resolution'
import type { Container } from './container'
import { quotesKey } from './keys'

function mergedProvenance(items: Array<{ provenance: Provenance }>): Provenance {
  const oldest = items.reduce((worst, item) =>
    item.provenance.ageMs > worst.provenance.ageMs ? item : worst,
  )
  return oldest.provenance
}

export function createMarketsDataSource(
  container: Container,
  correlationId: CorrelationId = container.newCorrelationId(),
): MarketsDataSource {
  const deps: ResolveDeps = {
    registry: container.registry,
    clock: container.clock,
    production: container.config.production,
    cache: container.cache,
    logger: container.logger,
    metrics: container.metrics,
    runAttempt: container.runAttempt,
    singleFlight: (key, execute) => container.singleFlight.run(key, execute),
    correlationId,
  }

  const common = (category: DataCategory) => ({
    category,
    chain: container.config.chains[category],
    // No trading session applies across a mixed-asset card; both TTLs are
    // configured per category and this flag selects the open one.
    marketOpen: true,
  })

  const quotesIn = (category: DataCategory, symbols: readonly CanonicalSymbol[]) =>
    resolve<MarketQuote[], 'quotes'>(deps, {
      ...common(category),
      capability: 'quotes',
      cacheKey: quotesKey('quotes', symbols),
      attempt: async (provider, ctx: FetchContext) => {
        const data = await provider.fetchQuotes(symbols, ctx)
        return { data, provenance: mergedProvenance(data) }
      },
    })

  return {
    now: () => container.clock.now(),
    correlationId: () => correlationId,

    indicesSe: (symbols) => quotesIn('equity-index-se', symbols),
    indicesIntl: (symbols) => quotesIn('equity-index-intl', symbols),

    fx: (symbols) =>
      resolve<MarketQuote[], 'fx'>(deps, {
        ...common('fx'),
        capability: 'fx',
        cacheKey: quotesKey('fx', symbols),
        attempt: async (provider, ctx: FetchContext) => {
          const data = await provider.fetchFxRates(symbols, ctx)
          return { data, provenance: mergedProvenance(data) }
        },
      }),

    crypto: (symbols) =>
      resolve<MarketQuote[], 'crypto'>(deps, {
        ...common('crypto'),
        capability: 'crypto',
        cacheKey: quotesKey('crypto', symbols),
        attempt: async (provider, ctx: FetchContext) => {
          const data = await provider.fetchCrypto(symbols, ctx)
          return { data, provenance: mergedProvenance(data) }
        },
      }),
  }
}

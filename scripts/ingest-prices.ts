/**
 * Ingests real daily closes for a governed security, for development.
 *
 * The counterpart to `ingest-yields`, and deliberately its twin: it fetches
 * from a source, normalizes at the adapter boundary, and records durable
 * observations through the same `ingestObservations` act the institution uses.
 *
 * > external source acquisition → durable institutional observation
 *
 * It assembles nothing. After this runs the firm holds observations and no
 * evidence set: assembly is a separate institutional act performed by a desk,
 * and collapsing the two would let a fetch decide what a case rests on.
 *
 *   npm run dev:ingest-prices -- --security sec-nvda --range 2y
 *
 * `--security` is a governed `SecurityId`, never a ticker. The symbol sent to
 * the provider is read from the registry, so this script cannot fetch a listing
 * the firm has not admitted.
 */

import { createAnalysisContainer } from '../src/infrastructure/analysis/container.ts'
import { createHttpClient } from '../src/infrastructure/marketData/providers/httpClient.ts'
import {
  YAHOO_SOURCE,
  fetchDailyHistory,
} from '../src/infrastructure/marketData/providers/yahoo.ts'
import { ingestPriceHistory } from '../src/application/analysis/ingestObservations.ts'
import {
  providerSymbol,
  requireSecurity,
} from '../src/application/analysis/securities.ts'
import { systemClock } from '../src/domain/shared/clock.ts'

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return undefined
  const value = process.argv[index + 1]
  return value && !value.startsWith('--') ? value : undefined
}

function refuse(why: string): never {
  console.error(`\n  ${why}\n`)
  process.exit(1)
}

const securityId = option('security') ?? 'sec-nvda'
const range = (option('range') ?? '2y') as '1y' | '2y' | '5y'
if (!['1y', '2y', '5y'].includes(range)) {
  refuse(`--range must be 1y, 2y or 5y. Got "${range}".`)
}

const connectionString = process.env.ANALYSIS_DATABASE_URL
if (!connectionString) {
  refuse('ANALYSIS_DATABASE_URL is not configured. Run this through `npm run`.')
}

/* Loud before any network call if the security is not governed. */
const security = requireSecurity(securityId)
const symbol = providerSymbol(security, YAHOO_SOURCE.providerId)

const container = await createAnalysisContainer({
  connectionString,
  buildId: 'dev-ingest-prices',
  clock: systemClock,
})

try {
  const http = createHttpClient({ networkDisabled: false })
  const correlationId = `dev-ingest-prices-${Date.now()}`

  console.log(
    `\n  Fetching ${range} of daily closes for ${security.displayName}` +
      ` (${security.symbol}/${security.mic}, ${security.currency})` +
      `\n  Provider ${YAHOO_SOURCE.providerId} calls it "${symbol}".`,
  )

  /*
   * Unadjusted. An adjusted close is a derived series whose values change when
   * a later corporate action occurs, which would silently revise observations
   * the firm already holds and already cited. Adjustment is a derivation the
   * firm should perform and record explicitly, not something a fetch applies.
   */
  const bars = await fetchDailyHistory(http, symbol, range, false, {
    signal: AbortSignal.timeout(120_000),
    clock: systemClock,
    correlationId,
  })

  const observedAt = systemClock.isoNow()
  const report = await ingestPriceHistory({
    repositories: container.repositories,
    securityId: security.id,
    providerSymbol: symbol,
    sessions: bars.map((bar) => ({ sessionDate: bar.date, close: bar.value })),
    provenance: {
      asOf: observedAt,
      receivedAt: observedAt,
      source: {
        providerId: YAHOO_SOURCE.providerId,
        kind: YAHOO_SOURCE.kind,
        retrievedAt: observedAt,
      },
    } as never,
    /*
     * Knowledge time: when the FIRM learned these. Read once and passed in — a
     * store stamping its own would give two observations of one fetch two
     * different knowledge times.
     */
    recordedAt: observedAt,
    correlationId,
  })

  console.log(`\n  Source        ${report.sourceId}`)
  console.log(`  Offered       ${report.offered} sessions`)
  console.log(`  Recorded      ${report.recorded.length} new`)
  console.log(`  Already held  ${report.alreadyHeld}`)
  console.log(
    `\n  The firm now holds these as observations. Nothing is an evidence set:\n` +
      `  assembly is a desk's act, performed against the ` +
      `equity-price-history@1 rule.\n`,
  )
} finally {
  await container.close()
}

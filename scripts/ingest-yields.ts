/**
 * Ingests real US Treasury par yields into the observation store, for development.
 *
 * **Bootstrap tooling, not a product surface** — the same category as
 * `open-case.ts`, and the reasoning is the same. Ingestion is machine work that
 * makes no claim and takes no actor by ruling (`phase-c3-evidence-gate.md`
 * §0.3), so it has no natural button and no operator to book it to. It will
 * eventually be a scheduled job with storage provenance; this is not that, and
 * it does something only when a person types it.
 *
 * ## What it does NOT do
 *
 * It writes no SQL, inserts no rows and creates no fixture state. Every effect
 * comes from `ingestYields`, over values the real `usTreasury` adapter fetched
 * and normalized — so the identities, the reference periods, the provenance and
 * the idempotency are exactly what any other ingestion would produce.
 *
 * It also assembles nothing. After this runs the firm holds observations and
 * **zero new evidence sets**; declaring a body of evidence fit for analysis is
 * `AssembleEvidenceSet`, a separate act with an actor and a mandate, performed
 * from the product. That boundary is asserted by
 * `ingestObservations.test.ts`, not merely described here.
 *
 *   npm run dev:ingest-yields -- --from 2026-07-01 --to 2026-08-19
 *
 * Options:
 *   --from   inclusive first reference date. Defaults to 30 days ago.
 *   --to     inclusive last reference date. Defaults to today.
 */

import { createAnalysisContainer } from '../src/infrastructure/analysis/container.ts'
import { createHttpClient } from '../src/infrastructure/marketData/providers/httpClient.ts'
import { createUsTreasuryProvider } from '../src/infrastructure/marketData/providers/usTreasury.ts'
import { ingestYields } from '../src/application/analysis/ingestObservations.ts'
import { systemClock } from '../src/domain/shared/clock.ts'
import type { CanonicalSymbol } from '../src/domain/market/index.ts'

/**
 * The tenors ingested.
 *
 * The same eleven `sovereign-yield-curve@1` expands `us-par-curve` to. Two
 * lists that could disagree would mean assembling a window the firm never
 * ingested, so this one is deliberately the shorter statement of the same set —
 * and the selection rule remains the authority on what a family IS.
 */
const SYMBOLS = [
  'rate:us1m',
  'rate:us3m',
  'rate:us6m',
  'rate:us1y',
  'rate:us2y',
  'rate:us3y',
  'rate:us5y',
  'rate:us7y',
  'rate:us10y',
  'rate:us20y',
  'rate:us30y',
] as unknown as readonly CanonicalSymbol[]

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

const iso = (date: Date) => date.toISOString().slice(0, 10)
const today = new Date()
const to = option('to') ?? iso(today)
const from = option('from') ?? iso(new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000))

if (from > to) refuse(`The range ${from}..${to} ends before it starts.`)

const connectionString = process.env.ANALYSIS_DATABASE_URL
if (!connectionString) {
  refuse('ANALYSIS_DATABASE_URL is not configured. Run this through `npm run`.')
}

const container = await createAnalysisContainer({
  connectionString,
  buildId: 'dev-ingest-yields',
  clock: systemClock,
})

try {
  const http = createHttpClient({ networkDisabled: false })
  const provider = createUsTreasuryProvider(http)

  console.log(`\n  Fetching US Treasury par yields ${from}..${to}`)
  const yields = await provider.fetchYieldHistory(
    SYMBOLS,
    { from, to },
    {
      signal: AbortSignal.timeout(120_000),
      clock: systemClock,
      correlationId: `dev-ingest-${Date.now()}`,
    },
  )

  const report = await ingestYields({
    repositories: container.repositories,
    yields,
    /*
     * Knowledge time: when the FIRM learned these. Read once, from the clock,
     * and passed in — a store that stamped its own would give two observations
     * of one poll two different knowledge times.
     */
    recordedAt: systemClock.isoNow(),
    correlationId: `dev-ingest-${Date.now()}`,
  })

  console.log(`\n  Source        ${report.sourceId}`)
  console.log(`  Offered       ${report.offered}`)
  console.log(`  Newly held    ${report.recorded.length}`)
  console.log(`  Already held  ${report.alreadyHeld}`)
  console.log(
    `\n  The firm now holds these as observations. Nothing is an evidence set:\n` +
      `  assemble one at /evidence, which records who declared it fit and why.\n`,
  )
} finally {
  await container.close().catch(() => {})
}

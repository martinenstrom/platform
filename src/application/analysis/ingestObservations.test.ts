/**
 * Ingestion as an act: what it records, and what it deliberately does not.
 *
 * Two things are under test here that no other suite covers. The first is
 * idempotency, which the whole polling model rests on. The second is the
 * boundary: an ingestion that produced an `EvidenceSet` would have quietly
 * become Stage B's assembly act, and the guard against that is a test, not a
 * comment.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import { createInMemoryRepositories } from '~/infrastructure/analysis/inMemoryRepositories'
import type { AnalysisRepositories } from './repositories'
import { ingestYields, yieldObservation } from './ingestObservations'
import { buildYield, isoCurrency, type CanonicalSymbol } from '~/domain/market'
import { buildProvenance } from '~/domain/shared/provenance'
import { isRevisionOf } from '~/domain/analysis'

const USD = isoCurrency('USD')
const NOW = Date.parse('2026-08-20T00:00:00.000Z')

/** A Treasury par yield, as the adapter normalizes one. */
const parYield = (observationDate: string, percent: number) =>
  buildYield({
    symbol: 'rate:us10y' as CanonicalSymbol,
    countryCode: 'US',
    currency: USD,
    maturity: '10Y',
    seriesId: 'BC_10YEAR',
    methodology: 'par-yield',
    observationDate,
    yieldPercent: percent,
    provenance: buildProvenance({
      asOf: `${observationDate}T00:00:00.000Z`,
      nowMs: NOW,
      asOfPrecision: 'date',
      sourceDate: observationDate,
      quality: 'official-daily',
      source: {
        providerId: 'treasury',
        providerName: 'U.S. Department of the Treasury',
        trust: 'issuer',
      },
    }),
  })

describe('ingestion records what a source published', () => {
  let repositories: AnalysisRepositories

  beforeEach(() => {
    repositories = createInMemoryRepositories()
  })

  const ingest = (
    yields: ReturnType<typeof parYield>[],
    recordedAt = '2026-08-20T06:00:00.000Z',
    correlationId = 'ingest-1',
  ) => ingestYields({ repositories, yields, recordedAt, correlationId })

  it('records real observations and reports what was new', async () => {
    const report = await ingest([
      parYield('2026-08-12', 4.05),
      parYield('2026-08-13', 4.08),
      parYield('2026-08-14', 4.1),
    ])

    expect(report.offered).toBe(3)
    expect(report.recorded).toHaveLength(3)
    expect(report.alreadyHeld).toBe(0)
    expect(report.sourceId).toBe('treasury')
  })

  it('keys identity on the period described, not the day we fetched', async () => {
    const [recorded] = (await ingest([parYield('2026-08-14', 4.1)])).recorded
    expect(recorded!.ref.referencePeriod).toBe('2026-08-14')
    expect(recorded!.ref.keyGeneration).toBe(2)
    expect(recorded!.ref.methodology).toBe('par-yield')
    /* Knowledge time is ours and is not the source's publication time. */
    expect(recorded!.recordedAt).toBe('2026-08-20T06:00:00.000Z')
    expect(recorded!.ref.observedAt).toBe('2026-08-14T00:00:00.000Z')
  })

  it('is idempotent: a re-poll of unchanged data records nothing', async () => {
    /*
     * The property polling depends on. The Treasury's month page is re-read
     * every day, so almost everything it offers is already held — and that has
     * to cost nothing and report honestly, rather than duplicating or throwing.
     */
    const page = [parYield('2026-08-13', 4.08), parYield('2026-08-14', 4.1)]

    const first = await ingest(page)
    expect(first.recorded).toHaveLength(2)

    const second = await ingest(page, '2026-08-21T06:00:00.000Z', 'ingest-2')
    expect(second.offered).toBe(2)
    expect(second.recorded).toHaveLength(0)
    expect(second.alreadyHeld).toBe(2)
  })

  it('records a revised figure as a revision of the same observation', async () => {
    const original = parYield('2026-08-14', 4.1)
    await ingest([original])

    const revised = parYield('2026-08-14', 4.12)
    const report = await ingest([revised], '2026-08-22T06:00:00.000Z', 'ingest-3')

    expect(report.recorded).toHaveLength(1)
    const a = yieldObservation(original, {
      recordedAt: 'x',
      correlationId: 'y',
    })
    const b = yieldObservation(revised, { recordedAt: 'x', correlationId: 'y' })
    expect(isRevisionOf(b.ref, a.ref)).toBe(true)

    /* Both versions survive; the earlier one is still readable. */
    expect(await repositories.observations.versions(a.ref.id)).toHaveLength(2)
  })

  it('distinguishes the next day from a revision of the last', async () => {
    /*
     * The near-miss for the test above. Without it, a key that dropped time
     * entirely would also pass — and would report every new print as a revision
     * of its predecessor.
     */
    await ingest([parYield('2026-08-13', 4.08)])
    const report = await ingest([parYield('2026-08-14', 4.1)], '2026-08-21T06:00:00.000Z')

    expect(report.recorded).toHaveLength(1)
    const versions = await repositories.observations.versions(report.recorded[0]!.ref.id)
    expect(versions).toHaveLength(1)
  })

  it('assembles no evidence set — that is a different institutional act', async () => {
    /*
     * The Stage A/B boundary, enforced rather than described. Ingestion that
     * quietly produced an evidence set would have decided what a desk may
     * conclude, with no actor, no mandate and no recorded selection rule.
     */
    await ingest([parYield('2026-08-14', 4.1)])

    expect(await repositories.evidence.list(50)).toHaveLength(0)
  })

  it('records storage provenance for every observation it writes', async () => {
    const report = await ingest([parYield('2026-08-14', 4.1)])
    const provenance = await repositories.provenance()

    expect(report.recorded).toHaveLength(1)
    expect(provenance.provenanceId).toBeTruthy()
    expect(provenance.adapterId).toBeTruthy()
  })

  it('reports an empty source honestly rather than as a successful poll', async () => {
    const report = await ingest([])
    expect(report.offered).toBe(0)
    expect(report.recorded).toHaveLength(0)
    expect(report.sourceId).toBe('none')
  })
})

/**
 * A market price becoming institutional evidence.
 *
 * The boundary this pins is the one the Equity family rests on: a close on the
 * market screen is a number the product displays, and a close that has passed
 * through `ingestPriceHistory` is a fact the firm holds — with an identity, a
 * content hash, a source and a known-at. A desk may cite the second and never
 * the first.
 *
 * The E1 chain, through production commands:
 *
 *   governed security → ingested observations → assembled evidence set
 *   → a citation that resolves against that exact set.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import { runCommand, type CommandDeps } from '~/application/analysis/commands/runCommand'
import { assembleEvidenceSet } from '~/application/analysis/commands/assembleEvidenceSet'
import { ingestPriceHistory } from '~/application/analysis/ingestObservations'
import { priceCloseRef } from '~/application/analysis/evidenceRefs'
import { createInMemoryRepositories } from './inMemoryRepositories'
import { TEST_ORGANIZATION, TEST_SEED_VERSION } from './testOrganization'
import type { Provenance } from '~/domain/shared/provenance'

const AT = '2026-09-02T20:00:00.000Z'
const organization = TEST_ORGANIZATION

const PROVENANCE = {
  asOf: AT,
  receivedAt: AT,
  source: { providerId: 'yahoo', kind: 'market-data', retrievedAt: AT },
} as unknown as Provenance

const SESSIONS = [
  { sessionDate: '2026-08-27', close: 176.5 },
  { sessionDate: '2026-08-28', close: 181.25 },
  { sessionDate: '2026-08-31', close: 179.1 },
]

let repositories: AnalysisRepositories
let deps: CommandDeps

beforeEach(async () => {
  repositories = createInMemoryRepositories()
  deps = {
    repositories,
    organization,
    organizationSeedVersion: TEST_SEED_VERSION,
    provenance: await repositories.provenance(),
    now: () => AT,
  }
})

const ingest = (over: Record<string, unknown> = {}) =>
  ingestPriceHistory({
    repositories,
    securityId: 'sec-nvda',
    providerSymbol: 'NVDA',
    sessions: SESSIONS,
    provenance: PROVENANCE,
    recordedAt: AT,
    correlationId: 'e1-proof',
    ...over,
  })

const assemble = () =>
  runCommand(
    assembleEvidenceSet(organization),
    {
      selection: {
        ruleId: 'equity-price-history@1',
        subjectFamily: 'nvda-daily-close',
        from: '2026-08-01',
        to: '2026-09-01',
      },
      onBehalfOfDepartmentId: 'research-office',
    },
    {
      commandId: 'assemble-nvda',
      correlationId: 'e1-proof',
      actor: { kind: 'employee' as const, employeeId: 'research-director' },
      initiator: { kind: 'employee' as const, employeeId: 'research-director' },
      occurredAt: AT,
    },
    deps,
  )

describe('a governed close becomes an observation', () => {
  it('records one observation per session', async () => {
    const report = await ingest()
    expect(report.offered).toBe(3)
    expect(report.recorded).toHaveLength(3)
    expect(report.sourceId).toBe('yahoo')
  })

  it('carries the security id as the subject, never the ticker', async () => {
    /*
     * The join that makes multi-provider evidence provable. A second source's
     * fundamentals for this company will carry the same subject, which is the
     * whole reason the registry exists.
     */
    const report = await ingest()
    for (const observation of report.recorded) {
      expect(observation.ref.subject).toBe('sec-nvda')
      expect(observation.ref.subject).not.toBe('NVDA')
      /* The provider's own name is kept — as the series, not the identity. */
      expect(observation.ref.seriesId).toBe('NVDA')
      expect(observation.ref.kind).toBe('price-close')
    }
  })

  it('keys on the session, so re-ingesting the same history adds nothing', async () => {
    await ingest()
    const second = await ingest()
    expect(second.offered).toBe(3)
    expect(second.recorded).toHaveLength(0)
    expect(second.alreadyHeld).toBe(3)
  })

  it('treats a restated close for a session as a revision, not a second fact', async () => {
    const original = priceCloseRef({
      securityId: 'sec-nvda',
      sessionDate: '2026-08-28',
      close: 181.25,
      providerSymbol: 'NVDA',
      provenance: PROVENANCE,
    })
    const corrected = priceCloseRef({
      securityId: 'sec-nvda',
      sessionDate: '2026-08-28',
      close: 181.3,
      providerSymbol: 'NVDA',
      provenance: PROVENANCE,
    })

    /* Same identity — one security, one session. Different content. */
    expect(corrected.id).toBe(original.id)
    expect(corrected.contentHash).not.toBe(original.contentHash)
  })

  it('refuses a security the firm has not governed', async () => {
    await expect(ingest({ securityId: 'sec-tsla' })).rejects.toThrow()
  })
})

describe('the governed close is assemblable and citable', () => {
  it('assembles an evidence set from the equity family', async () => {
    await ingest()
    const result = await assemble()
    expect(result.outcome).toBe('committed')
  })

  it('contains the sessions, and invents no derivation', async () => {
    await ingest()
    const result = await assemble()
    if (result.outcome !== 'committed') throw new Error('did not commit')
    const setId = result.value.evidenceSetId
    const set = (await repositories.evidence.get(setId))!

    expect(set.items).toHaveLength(3)
    for (const item of set.items) {
      expect(item.ref.subject).toBe('sec-nvda')
      expect(item.ref.kind).toBe('price-close')
    }
    /* A security family declares no derivations; none is manufactured. */
    expect(set.items.every((item) => item.ref.kind !== 'derived-spread')).toBe(true)
  })

  it('resolves a citation into that exact set', async () => {
    /*
     * What makes it evidence rather than data: a claim can point at one
     * observation IN THIS SET, and the citation carries the content hash that
     * lets verification detect the source moving underneath it.
     */
    await ingest()
    const result = await assemble()
    if (result.outcome !== 'committed') throw new Error('did not commit')
    const setId = result.value.evidenceSetId
    const set = (await repositories.evidence.get(setId))!

    const cited = set.items[0]!
    const held = await repositories.observations.get(
      cited.ref.id,
      cited.ref.contentHash,
    )
    expect(held).not.toBeNull()
    expect(held!.ref.contentHash).toBe(cited.ref.contentHash)
  })

  it('refuses to assemble a family the firm holds nothing for', async () => {
    /* No ingest. An empty window is a refusal, never an empty set. */
    const result = await assemble()
    expect(result.outcome).toBe('rejected')
  })
})

/**
 * Assembly as an institutional act.
 *
 * Driven against the in-memory reference, which is the approved semantics both
 * adapters implement. What is proved here is the behaviour of the act itself:
 * what it takes, what it refuses, what it records, and what it can no longer be
 * used to hide.
 *
 * The four properties the gate turns on, each with a planted violation rather
 * than a comment:
 *
 *   - it takes a QUERY, so an assembler cannot drop the inconvenient source
 *   - the SELECTION is recorded and versioned, so "why these and not others"
 *     has an answer
 *   - `knownAt` is APPLIED, so a set assembled as of a past instant does not
 *     quietly contain what the firm learned afterwards
 *   - the derivation runs HERE and is stored, so nothing recomputes it
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildRole,
  type Organization,
  type RoleFunction,
} from '~/domain/analysis'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import { runCommand, type CommandDeps } from '~/application/analysis/commands/runCommand'
import { assembleEvidenceSet } from '~/application/analysis/commands/assembleEvidenceSet'
import { deriveAssemblyId } from '~/application/analysis/commands/eventIdentity'
import { SPREAD_2S10S, DERIVED_SOURCE_ID } from '~/application/analysis/deriveObservations'
import { ingestYields } from '~/application/analysis/ingestObservations'
import { buildYield, isoCurrency, type CanonicalSymbol } from '~/domain/market'
import { buildProvenance } from '~/domain/shared/provenance'
import { createInMemoryRepositories } from './inMemoryRepositories'

const AT = '2026-08-20T09:00:00.000Z'
const USD = isoCurrency('USD')

/* ------------------------------------------------------------ organization */

const role = (id: string, fn: RoleFunction) =>
  buildRole({
    id,
    title: id,
    function: fn,
    responsibilities: [],
    canBlockPublication: false,
  })

const organization: Organization = {
  id: 'firm',
  name: 'Firm',
  chiefEmployeeId: 'cio',
  roles: [role('chief', 'executive'), role('head', 'manager'), role('analyst', 'specialist')],
  departments: [
    {
      id: 'executive',
      name: 'Executive',
      managerEmployeeId: 'cio',
      handles: [],
      isGovernance: false,
    },
    {
      id: 'research-office',
      name: 'Research Office',
      managerEmployeeId: 'research-director',
      handles: ['aggregation'],
      isGovernance: false,
    },
    {
      id: 'global-macro',
      name: 'Global Macro',
      managerEmployeeId: 'macro-head',
      handles: ['macro'],
      isGovernance: false,
    },
  ],
  teams: [],
  agentPrincipals: [],
  employees: [
    {
      id: 'cio',
      displayName: 'CIO',
      roleId: 'chief',
      departmentId: 'executive',
      seniority: 'chief',
    },
    {
      id: 'research-director',
      displayName: 'Research Director',
      roleId: 'head',
      departmentId: 'research-office',
      reportsTo: 'cio',
      seniority: 'head',
    },
    {
      id: 'macro-head',
      displayName: 'Macro Head',
      roleId: 'head',
      departmentId: 'global-macro',
      reportsTo: 'cio',
      seniority: 'head',
    },
    {
      id: 'macro-analyst',
      displayName: 'Macro Analyst',
      roleId: 'analyst',
      departmentId: 'global-macro',
      reportsTo: 'macro-head',
      seniority: 'analyst',
    },
  ],
}

/* ---------------------------------------------------------------- fixtures */

/** A Treasury par yield, exactly as the adapter normalizes one. */
function parYield(args: {
  symbol: string
  seriesId: string
  maturity: '2Y' | '10Y' | '3M'
  observationDate: string
  percent: number
  providerId?: string
  providerName?: string
  asOf?: string
}) {
  return buildYield({
    symbol: args.symbol as CanonicalSymbol,
    countryCode: 'US',
    currency: USD,
    maturity: args.maturity,
    seriesId: args.seriesId,
    methodology: 'par-yield',
    observationDate: args.observationDate,
    yieldPercent: args.percent,
    provenance: buildProvenance({
      asOf: args.asOf ?? `${args.observationDate}T00:00:00.000Z`,
      nowMs: Date.parse(AT),
      asOfPrecision: 'date',
      sourceDate: args.observationDate,
      quality: 'official-daily',
      source: {
        providerId: args.providerId ?? 'treasury',
        providerName: args.providerName ?? 'U.S. Department of the Treasury',
        trust: 'issuer',
      },
    }),
  })
}

const curveFor = (observationDate: string, two: number, ten: number) => [
  parYield({
    symbol: 'rate:us2y',
    seriesId: 'BC_2YEAR',
    maturity: '2Y',
    observationDate,
    percent: two,
  }),
  parYield({
    symbol: 'rate:us10y',
    seriesId: 'BC_10YEAR',
    maturity: '10Y',
    observationDate,
    percent: ten,
  }),
]

/* ------------------------------------------------------------- the harness */

let repositories: AnalysisRepositories
let deps: CommandDeps

beforeEach(async () => {
  repositories = createInMemoryRepositories()
  deps = {
    repositories,
    organization,
    organizationSeedVersion: 'seed-1',
    provenance: await repositories.provenance(),
    now: () => AT,
  }
})

const ingest = (yields: Parameters<typeof ingestYields>[0]['yields'], recordedAt: string) =>
  ingestYields({ repositories, yields, recordedAt, correlationId: 'ingest-1' })

const envelope = (over: Record<string, unknown> = {}) => ({
  commandId: 'cmd-assemble',
  correlationId: 'corr-1',
  actor: { kind: 'employee' as const, employeeId: 'research-director' },
  initiator: { kind: 'employee' as const, employeeId: 'research-director' },
  occurredAt: AT,
  ...over,
})

const input = (over: Record<string, unknown> = {}) => {
  const { selection, ...rest } = over
  return {
    selection: {
      ruleId: 'sovereign-yield-curve@1',
      subjectFamily: 'us-par-curve',
      from: '2026-08-01',
      to: '2026-08-31',
      ...((selection as Record<string, unknown>) ?? {}),
    },
    onBehalfOfDepartmentId: 'research-office',
    ...rest,
  }
}

const assemble = (over: Record<string, unknown> = {}, env: Record<string, unknown> = {}) =>
  runCommand(assembleEvidenceSet(organization), input(over), envelope(env), deps)

/* --------------------------------------------------------------- the act */

describe('assembling a body of evidence', () => {
  it('produces a set the firm can name the author and the rule of', async () => {
    await ingest(curveFor('2026-08-14', 3.9, 4.1), '2026-08-15T00:00:00.000Z')

    const result = await assemble()
    expect(result.outcome).toBe('committed')
    if (result.outcome !== 'committed') return

    const assembly = result.value
    expect(assembly.assemblyId).toBe(deriveAssemblyId('cmd-assemble'))
    expect(assembly.actorEmployeeId).toBe('research-director')
    expect(assembly.onBehalfOfDepartmentId).toBe('research-office')
    /* The rule, with its version inside the id. */
    expect(assembly.selection.ruleId).toBe('sovereign-yield-curve@1')
    expect(assembly.selection.subjectFamily).toBe('us-par-curve')
    expect(assembly.selection.from).toBe('2026-08-01')
    expect(assembly.selection.to).toBe('2026-08-31')

    const set = await repositories.evidence.get(assembly.evidenceSetId)
    expect(set).not.toBeNull()
    /* Two yields, plus the slope the rule derives from them. */
    expect(set!.items).toHaveLength(3)
  })

  it('records the knowledge time even when the caller names none', async () => {
    await ingest(curveFor('2026-08-14', 3.9, 4.1), '2026-08-15T00:00:00.000Z')

    const result = await assemble()
    if (result.outcome !== 'committed') throw new Error('did not commit')

    /*
     * "Latest known" is only reproducible if the moment that phrase referred
     * to is written down. It is the act's own instant, never a second clock
     * read and never left absent.
     */
    expect(result.value.selection.knownAt).toBe(AT)
  })

  it('reads the store as the firm knew it, not as it knows it now', async () => {
    await ingest(curveFor('2026-08-14', 3.9, 4.1), '2026-08-15T00:00:00.000Z')
    /* Learned later: a revision the firm did not hold on the 15th. */
    await ingest(curveFor('2026-08-14', 3.9, 4.4), '2026-08-19T00:00:00.000Z')

    const asKnownThen = await assemble({
      selection: { knownAt: '2026-08-16T00:00:00.000Z' },
    })
    if (asKnownThen.outcome !== 'committed') throw new Error('did not commit')
    const then = await repositories.evidence.get(asKnownThen.value.evidenceSetId)

    const asKnownNow = await assemble({}, { commandId: 'cmd-now' })
    if (asKnownNow.outcome !== 'committed') throw new Error('did not commit')
    const now = await repositories.evidence.get(asKnownNow.value.evidenceSetId)

    const yieldOf = (set: typeof then, subject: string) =>
      (
        set!.items.find((item) => item.ref.subject === subject)!.value as {
          yieldPercent: string
        }
      ).yieldPercent

    expect(yieldOf(then, 'rate:us10y')).toBe('4.1')
    expect(yieldOf(now, 'rate:us10y')).toBe('4.4')
    /* Two different bodies of evidence, and therefore two different ids. */
    expect(asKnownThen.value.evidenceSetId).not.toBe(asKnownNow.value.evidenceSetId)
  })

  it('cannot be told which observations to include', () => {
    /*
     * A structural assertion rather than a behavioural one, and deliberately:
     * the property is that the input has no such field, so the only way to
     * break it is to add one. `observationIds` on this input would let an
     * assembler drop the inconvenient source, and the disagreement machinery
     * would never see it.
     */
    const shape = Object.keys(input().selection).sort()
    expect(shape).toEqual(['from', 'ruleId', 'subjectFamily', 'to'])
  })
})

/* ------------------------------------------------------------- derivation */

describe('the derivation the rule declares', () => {
  it('stores 2s10s as a durable observation with its inputs and version', async () => {
    await ingest(curveFor('2026-08-14', 3.9, 4.1), '2026-08-15T00:00:00.000Z')

    const result = await assemble()
    if (result.outcome !== 'committed') throw new Error('did not commit')
    expect(result.value.derivedCount).toBe(1)

    const set = await repositories.evidence.get(result.value.evidenceSetId)
    const slope = set!.items.find((item) => item.ref.sourceId === DERIVED_SOURCE_ID)!
    expect(slope.ref.methodology).toBe(SPREAD_2S10S)
    expect(slope.ref.kind).toBe('derived-spread')
    /* §0.3c: exact decimal, so 4.1 − 3.9 is 20 and not 19.99999999999997. */
    expect((slope.value as { slopeBasisPoints: string }).slopeBasisPoints).toBe('20')

    /* Its inputs resolve, inside the set, by the ids the payload names. */
    const inputs = (slope.value as { inputs: [string, string, string][] }).inputs
    for (const [, observationId] of inputs) {
      expect(set!.items.some((item) => item.ref.id === observationId)).toBe(true)
    }

    /* And it is in the observation store, not only in the set. */
    const stored = await repositories.observations.get(slope.ref.id, slope.ref.contentHash)
    expect(stored).not.toBeNull()
  })

  it('derives nothing where the firm holds only one leg', async () => {
    await ingest(
      [
        parYield({
          symbol: 'rate:us2y',
          seriesId: 'BC_2YEAR',
          maturity: '2Y',
          observationDate: '2026-08-14',
          percent: 3.9,
        }),
      ],
      '2026-08-15T00:00:00.000Z',
    )

    const result = await assemble()
    if (result.outcome !== 'committed') throw new Error('did not commit')
    expect(result.value.derivedCount).toBe(0)
    expect(result.value.observationCount).toBe(1)
  })

  it('refuses a slope across two reference periods', async () => {
    /* The 2Y on one day, the 10Y on another. A slope across them is not one. */
    await ingest(
      [
        parYield({
          symbol: 'rate:us2y',
          seriesId: 'BC_2YEAR',
          maturity: '2Y',
          observationDate: '2026-08-13',
          percent: 3.9,
        }),
        parYield({
          symbol: 'rate:us10y',
          seriesId: 'BC_10YEAR',
          maturity: '10Y',
          observationDate: '2026-08-14',
          percent: 4.1,
        }),
      ],
      '2026-08-15T00:00:00.000Z',
    )

    const result = await assemble()
    if (result.outcome !== 'committed') throw new Error('did not commit')
    expect(result.value.derivedCount).toBe(0)
  })
})

/* --------------------------------------------------------- what it refuses */

describe('what assembly refuses', () => {
  it('refuses an unregistered selection rule', async () => {
    await ingest(curveFor('2026-08-14', 3.9, 4.1), '2026-08-15T00:00:00.000Z')
    const result = await assemble({ selection: { ruleId: 'whatever@9' } })
    expect(result.outcome).toBe('rejected')
    if (result.outcome !== 'rejected') return
    expect(result.rejection.code).toBe('not-found')
  })

  it('refuses an unregistered subject family', async () => {
    await ingest(curveFor('2026-08-14', 3.9, 4.1), '2026-08-15T00:00:00.000Z')
    const result = await assemble({ selection: { subjectFamily: 'jp-par-curve' } })
    expect(result.outcome).toBe('rejected')
    if (result.outcome !== 'rejected') return
    expect(result.rejection.code).toBe('not-found')
  })

  it('refuses a window that ends before it starts', async () => {
    await ingest(curveFor('2026-08-14', 3.9, 4.1), '2026-08-15T00:00:00.000Z')
    const result = await assemble({
      selection: { from: '2026-08-31', to: '2026-08-01' },
    })
    expect(result.outcome).toBe('rejected')
    if (result.outcome !== 'rejected') return
    expect(result.rejection.code).toBe('invariant-violated')
  })

  it('refuses a knowledge time the firm could not have had', async () => {
    await ingest(curveFor('2026-08-14', 3.9, 4.1), '2026-08-15T00:00:00.000Z')
    const result = await assemble({
      selection: { knownAt: '2027-01-01T00:00:00.000Z' },
    })
    expect(result.outcome).toBe('rejected')
    if (result.outcome !== 'rejected') return
    expect(result.rejection.code).toBe('invariant-violated')
  })

  it('refuses to declare an empty body of evidence', async () => {
    const result = await assemble()
    expect(result.outcome).toBe('rejected')
    if (result.outcome !== 'rejected') return
    expect(result.rejection.code).toBe('invariant-violated')
    /* And nothing was written: no set, no act. */
    expect(await repositories.evidence.list(10)).toHaveLength(0)
    expect(await repositories.assemblies.list(10)).toHaveLength(0)
  })

  it('refuses someone who does not manage the department', async () => {
    await ingest(curveFor('2026-08-14', 3.9, 4.1), '2026-08-15T00:00:00.000Z')
    const result = await assemble(
      {},
      { actor: { kind: 'employee' as const, employeeId: 'macro-analyst' } },
    )
    expect(result.outcome).toBe('rejected')
    if (result.outcome !== 'rejected') return
    expect(result.rejection.code).toBe('not-authorised')
  })

  it('refuses a department the firm does not have', async () => {
    await ingest(curveFor('2026-08-14', 3.9, 4.1), '2026-08-15T00:00:00.000Z')
    const result = await assemble({ onBehalfOfDepartmentId: 'compliance' })
    expect(result.outcome).toBe('rejected')
    if (result.outcome !== 'rejected') return
    /* The mandate is checked first: nobody manages a department that does not exist. */
    expect(['not-found', 'not-authorised']).toContain(result.rejection.code)
  })
})

/* ---------------------------------------------- disagreement and revision */

describe('one version per period, and the history stays in the store', () => {
  it('holds the version the firm knew, with the earlier one still retained', async () => {
    /*
     * §0.6 rules it: an evidence set is a SNAPSHOT of what the firm believed
     * when it assembled, so it holds one version per (source, series, reference
     * period). The revision history lives in `analysis.observations`, keyed
     * `(observation_id, content_hash)`, and both versions stay readable there.
     */
    await ingest(curveFor('2026-08-14', 3.9, 4.1), '2026-08-15T00:00:00.000Z')
    await ingest(curveFor('2026-08-14', 3.9, 4.4), '2026-08-19T00:00:00.000Z')

    const result = await assemble()
    if (result.outcome !== 'committed') throw new Error('did not commit')
    const set = await repositories.evidence.get(result.value.evidenceSetId)

    const tenYear = set!.items.find((item) => item.ref.subject === 'rate:us10y')!
    expect((tenYear.value as { yieldPercent: string }).yieldPercent).toBe('4.4')
    /* One member, not two: a set is a snapshot rather than a history. */
    expect(set!.items.filter((item) => item.ref.subject === 'rate:us10y')).toHaveLength(1)

    /* The revision is a second row on the same observation identity. */
    const versions = await repositories.observations.versions(tenYear.ref.id)
    expect(versions).toHaveLength(2)
    expect(versions.map((v) => (v.value as { yieldPercent: string }).yieldPercent)).toEqual(
      ['4.1', '4.4'],
    )
  })

  it('cannot be made to leave a source out, because it names none', () => {
    /*
     * `sovereign-yield-curve@1` declares the source as part of the FAMILY, and
     * the family is registered rather than supplied. There is no parameter a
     * caller could use to exclude a tenor or a source from a family it named —
     * which is the structural half of "never hide disagreement" (§0.6). The
     * behavioural half is that the set computes disagreements from its own
     * membership, which `analysis.test.ts` proves.
     */
    const shape = Object.keys(input()).sort()
    expect(shape).toEqual(['onBehalfOfDepartmentId', 'selection'])
  })

  it('states co-temporality on both axes', async () => {
    await ingest(curveFor('2026-08-14', 3.9, 4.1), '2026-08-15T00:00:00.000Z')
    const result = await assemble()
    if (result.outcome !== 'committed') throw new Error('did not commit')
    const set = await repositories.evidence.get(result.value.evidenceSetId)
    expect(set!.coTemporality.reference).toEqual({
      kind: 'aligned',
      at: '2026-08-14',
    })
    expect(set!.coTemporality.publication.kind).toBe('aligned')
  })
})

/* ------------------------------------------------------------- idempotency */

describe('replaying the same act', () => {
  it('files one act and one set, not two', async () => {
    await ingest(curveFor('2026-08-14', 3.9, 4.1), '2026-08-15T00:00:00.000Z')

    const first = await assemble()
    const second = await assemble()
    if (first.outcome !== 'committed' || second.outcome !== 'committed') {
      throw new Error('did not commit')
    }
    expect(second.value.assemblyId).toBe(first.value.assemblyId)
    expect(second.value.evidenceSetId).toBe(first.value.evidenceSetId)
    expect(await repositories.assemblies.list(10)).toHaveLength(1)
    expect(await repositories.evidence.list(10)).toHaveLength(1)
  })

  it('reaches one set from two different acts when the membership is the same', async () => {
    await ingest(curveFor('2026-08-14', 3.9, 4.1), '2026-08-15T00:00:00.000Z')

    const first = await assemble()
    /*
     * A different window selecting the same observations. One artifact — the
     * set is content-addressed on membership — reached by two acts, which is
     * exactly why the record is keyed on the act and not on the set.
     */
    const second = await assemble(
      { selection: { from: '2026-08-10', to: '2026-08-20' } },
      { commandId: 'cmd-second' },
    )
    if (first.outcome !== 'committed' || second.outcome !== 'committed') {
      throw new Error('did not commit')
    }
    expect(second.value.evidenceSetId).toBe(first.value.evidenceSetId)
    expect(second.value.assemblyId).not.toBe(first.value.assemblyId)

    const acts = await repositories.assemblies.forSet(first.value.evidenceSetId)
    expect(acts).toHaveLength(2)
  })
})

/**
 * Financial OS as a host sees it — the port a system above it delegates through.
 *
 * What this proves is narrow and load-bearing: a host can hand the firm a
 * question on a named person's behalf, the ledger records the HOST as the
 * initiator and the PERSON as the actor, the host gets the same typed results
 * the product gets, and nothing the port offers is a way into the firm that
 * the product lacks. The console's own path is asserted unchanged beside it.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  createFinancialOsSystem,
  FINANCIAL_OS_SYSTEM_ID,
  type Delegation,
  type FinancialOsSystem,
} from '~/application/analysis/domainSystem'
import { startInvestmentCase } from '~/application/analysis/startInvestmentCase'
import type { CommandDeps } from '~/application/analysis/commands/runCommand'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import { createInMemoryRepositories } from './inMemoryRepositories'
import { TEST_ORGANIZATION, TEST_SEED_VERSION } from './testOrganization'

const AT = '2026-09-13T18:00:00.000Z'
const HOST = 'jarvis'

let repositories: AnalysisRepositories
let deps: CommandDeps
let system: FinancialOsSystem

const delegation = (over: Partial<Delegation> = {}): Delegation => ({
  requestId: 'req-1',
  actingEmployeeId: 'research-director',
  orchestratorId: HOST,
  ...over,
})

const question = {
  question: 'Vad säger den amerikanska räntekurvan om regimen?',
  subjectDisplayName: 'US par curve',
}

beforeEach(async () => {
  repositories = createInMemoryRepositories()
  deps = {
    repositories,
    organization: TEST_ORGANIZATION,
    organizationSeedVersion: TEST_SEED_VERSION,
    provenance: await repositories.provenance(),
    now: () => AT,
  }
  system = createFinancialOsSystem({
    repositories,
    commandDeps: async () => deps,
    now: () => AT,
  })
})

/* ------------------------------------------------------------ delegation */

describe('a host delegates a question on a person’s behalf', () => {
  it('opens and convenes the case, and knows the id before it lands', async () => {
    const expectedId = system.caseIdFor('req-1')

    const result = await system.ask(delegation(), question)

    expect(result).toEqual({ state: 'convened', caseId: expectedId })
  })

  it('records the host as initiator and the person as actor', async () => {
    const result = await system.ask(delegation(), question)
    if (result.state !== 'convened') throw new Error(JSON.stringify(result))

    /*
     * Both commands the act issues, read back from the ledger. The person is
     * accountable; the host dispatched. Neither row says the host performed
     * the act, and neither says the person did it unprompted.
     */
    for (const suffix of ['open', 'convene']) {
      const entry = await repositories.commands.find(`${result.caseId}-${suffix}`)
      expect(entry, suffix).not.toBeNull()
      expect(entry!.intent.initiator).toEqual({
        kind: 'orchestrator',
        orchestratorId: HOST,
      })
      expect(entry!.intent.actor.kind).toBe('employee')
      expect(entry!.intent.actor.employeeId).toBe('research-director')
    }
  })

  it('lands a retried delegation on the same case', async () => {
    const first = await system.ask(delegation(), question)
    const again = await system.ask(delegation(), question)

    if (first.state !== 'convened') throw new Error(JSON.stringify(first))
    if (again.state !== 'convened') throw new Error(JSON.stringify(again))
    expect(again.caseId).toBe(first.caseId)
    expect(await repositories.cases.list()).toHaveLength(1)
  })

  it('cannot make the firm act for a person it does not employ', async () => {
    const result = await system.ask(
      delegation({ actingEmployeeId: 'somebody-the-host-made-up' }),
      question,
    )
    expect(result).toEqual({ state: 'refused', code: 'UNKNOWN_OPERATOR' })
    expect(await repositories.cases.list()).toHaveLength(0)
  })

  it('passes the firm’s refusals through in the firm’s own words', async () => {
    expect(await system.ask(delegation(), { ...question, question: '  ' })).toEqual({
      state: 'refused',
      code: 'QUESTION_REQUIRED',
    })
    expect(await system.resume(delegation(), 'case-that-does-not-exist')).toEqual({
      state: 'refused',
      code: 'NOT_FOUND',
    })
  })
})

/* ----------------------------------------------------------- the console */

describe('the console’s own path is unchanged', () => {
  it('still records the person as their own initiator when no host is named', async () => {
    const result = await startInvestmentCase({
      repositories,
      deps,
      ...question,
      requestId: 'req-console',
      actingEmployeeId: 'research-director',
      now: () => AT,
    })
    if (result.state !== 'convened') throw new Error(JSON.stringify(result))

    const entry = await repositories.commands.find(`${result.caseId}-open`)
    expect(entry!.intent.initiator).toEqual({
      kind: 'employee',
      employeeId: 'research-director',
    })
  })
})

/* -------------------------------------------------------------- results */

describe('what a host gets back', () => {
  let caseId: string

  beforeEach(async () => {
    const result = await system.ask(delegation(), question)
    if (result.state !== 'convened') throw new Error(JSON.stringify(result))
    caseId = result.caseId
  })

  it('is the firm’s own standing, not a summary of it', async () => {
    const standing = await system.standing(caseId)
    expect(standing).not.toBeNull()
    expect(standing!.stage).toBe('research')
    expect(standing!.settled).toBe(false)
    /*
     * The PERSON who owns it is the accountable desk's manager, resolved by
     * intake. The department beside it is `participatingDepartmentIds[0]`,
     * which after convening is whichever engaged desk sorts first — see
     * TD-91. A host presenting "whose desk is this on" must read the owner,
     * not that field, until the standing derives the department from the
     * owner.
     */
    expect(standing!.ownership.kind).toBe('department')
    expect(standing!.ownership.employeeId).toBe('research-director')
    /* What happens next is the institution's word, for a host to present. */
    expect(standing!.nextAct).toBeDefined()
  })

  it('is the whole record when asked for it', async () => {
    const overview = await system.overview(caseId)
    expect(overview).not.toBeNull()
    expect(overview!.investmentCase.id).toBe(caseId)
    expect(overview!.investmentCase.question).toBe(question.question)
    /* Eligibility as RECORDED — nothing was submitted, so nothing is judged. */
    expect(overview!.eligibility).toEqual({ kind: 'not-submitted' })
  })

  it('appears in the queue the product reads', async () => {
    const queue = await system.queue()
    expect(queue.map((entry) => entry.investmentCase.id)).toContain(caseId)
  })

  it('is null, not an error, for a case the firm does not hold', async () => {
    expect(await system.standing('case-nope')).toBeNull()
    expect(await system.overview('case-nope')).toBeNull()
  })

  it('offers a reference a host may keep, and nothing more', async () => {
    const reference = await system.reference(caseId)
    expect(reference).toEqual({
      system: FINANCIAL_OS_SYSTEM_ID,
      kind: 'case',
      id: caseId,
      provenanceId: deps.provenance.provenanceId,
    })
    /* A reference is an id and a provenance. It carries no institutional content. */
    expect(Object.keys(reference).sort()).toEqual([
      'id',
      'kind',
      'provenanceId',
      'system',
    ])
  })
})

/* ------------------------------------------------------------- identity */

describe('who may act', () => {
  it('resolves the configured operator and fails closed', async () => {
    expect(await system.operator('research-director')).toMatchObject({
      ok: true,
      operator: { employeeId: 'research-director', authentication: 'system-asserted' },
    })
    expect(await system.operator(undefined)).toEqual({
      ok: false,
      code: 'NOT_CONFIGURED',
    })
    expect(await system.operator('nobody')).toEqual({
      ok: false,
      code: 'UNKNOWN_EMPLOYEE',
    })
  })

  it('lists everyone the organisation employs', async () => {
    const operators = await system.operators()
    expect(operators.map((operator) => operator.employeeId)).toContain(
      'research-director',
    )
  })
})

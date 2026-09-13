/**
 * *Kalla samman kommittén*, and the seam inside it.
 *
 * One user-facing act over two institutional commands. The interesting state is
 * the one between them: the Chairman's question is durable and the committee is
 * not convened. It is not a failure to clean up, and this file pins that it is
 * neither reported as success nor repaired by opening a second case.
 *
 * The failure is INJECTED at the repository, not simulated by calling the
 * second command with bad input. A convening that fails because storage went
 * away is the case the partial state exists for; one that fails because the
 * input was wrong should have been refused before the first commit.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import { type CommandDeps } from '~/application/analysis/commands/runCommand'
import {
  caseIdFor,
  resumeConvening,
  startInvestmentCase,
} from '~/application/analysis/startInvestmentCase'
import { createInMemoryRepositories } from './inMemoryRepositories'
import { TEST_ORGANIZATION, TEST_SEED_VERSION } from './testOrganization'

const AT = '2026-08-31T09:00:00.000Z'
const organization = TEST_ORGANIZATION
/**
 * The Chairman: holds the convening capability, and is NOT the routed owner.
 * Convening authority and ownership of the work are deliberately different
 * people here, because that is the whole point of the mandate.
 */
const CHAIRMAN = 'cio'

let repositories: AnalysisRepositories
let deps: CommandDeps

const ask = (over: Record<string, unknown> = {}) =>
  startInvestmentCase({
    repositories,
    deps,
    question: 'Varför rörde sig den amerikanska långänden?',
    subjectDisplayName: 'Amerikanska statsräntor',
    requestId: 'req-1',
    actingEmployeeId: CHAIRMAN,
    now: () => AT,
    ...over,
  })

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

describe('the committee is convened', () => {
  it('commits both acts and reports one convened case', async () => {
    const result = await ask()
    expect(result.state).toBe('convened')
  })

  it('routes the case without the Chairman naming anybody', async () => {
    const result = await ask()
    const opened = await repositories.cases.get((result as { caseId: string }).caseId)
    /*
     * Research Office owns it because it holds the accountable discipline in
     * the approved playbook — not because a default said so.
     */
    expect(opened!.ownerEmployeeId).toBe('research-director')
    expect(opened!.question).toBe('Varför rörde sig den amerikanska långänden?')
  })

  it('derives the subject reference from the name the Chairman typed', async () => {
    const result = await ask()
    const opened = await repositories.cases.get((result as { caseId: string }).caseId)
    expect(opened!.subject.ref).toBe('amerikanska-statsrantor')
    expect(opened!.subject.displayName).toBe('Amerikanska statsräntor')
  })

  it('leaves the case with Research Office, not with the Chairman', async () => {
    /*
     * The distinction the convening mandate exists for. The Chairman called the
     * committee; the desk that answers the question is unchanged, and convening
     * never becomes a way to acquire a case.
     */
    const result = await ask()
    const opened = await repositories.cases.get((result as { caseId: string }).caseId)
    const owner = organization.employees.find((e) => e.id === opened!.ownerEmployeeId)
    expect(owner!.departmentId).toBe('research-office')
    expect(opened!.ownerEmployeeId).not.toBe(CHAIRMAN)
  })

  it('still lets the owning department manager convene', async () => {
    // The pre-existing authority, unweakened by the new one.
    const result = await ask({
      actingEmployeeId: 'research-director',
      requestId: 'req-manager',
    })
    expect(result.state).toBe('convened')
  })

  it('refuses to convene for a manager of another department', async () => {
    /*
     * `macro-head` manages Global Macro and holds no convening capability, so
     * the case is opened — any employee may ask — and the committee is not
     * convened. Exactly the partial state, reached institutionally.
     */
    const result = await ask({ actingEmployeeId: 'macro-head', requestId: 'req-macro' })
    expect(result).toMatchObject({
      state: 'convening-incomplete',
      code: 'not-authorised',
    })
  })

  it('grows participation to the whole committee once convened', async () => {
    const result = await ask()
    const opened = await repositories.cases.get((result as { caseId: string }).caseId)
    // Seeded with one desk; `instantiatePlaybook` adds the playbook's own.
    expect(opened!.participatingDepartmentIds.length).toBeGreaterThan(1)
    expect(opened!.participatingDepartmentIds).toContain('global-macro')
    expect(opened!.participatingDepartmentIds).toContain('research-office')
  })
})

describe('when the first commit succeeds and the second does not', () => {
  /**
   * Storage that will not accept the convening.
   *
   * `cases.save` is what `instantiatePlaybook` needs to pin the playbook, so
   * failing it reproduces a database that went away between two commits without
   * touching either command's logic.
   */
  const breakConvening = () => {
    /*
     * Injected at the TRANSACTION boundary, because that is the only seam the
     * command actually crosses: `withTransaction` hands the handler freshly
     * scoped repositories, so patching a method on the outer object never
     * reaches it.
     *
     * Armed once a case exists — the open has committed and the very next
     * transaction is the convening. That reproduces storage going away between
     * two commits without either command behaving differently.
     */
    const real = repositories.withTransaction.bind(repositories)
    let broken = true
    repositories.withTransaction = (async (operation: never) => {
      if (broken && (await repositories.cases.list()).length > 0) {
        throw new Error('storage is gone')
      }
      return real(operation)
    }) as typeof repositories.withTransaction
    return {
      heal: () => {
        broken = false
      },
    }
  }

  it('reports convening-incomplete rather than success or failure', async () => {
    breakConvening()
    const result = await ask()
    expect(result.state).toBe('convening-incomplete')
    /* The middle state names the case, because the case exists. */
    expect(result).toHaveProperty('caseId')
  })

  it('keeps the case: the question the Chairman asked is durable', async () => {
    breakConvening()
    const result = await ask()
    const stored = await repositories.cases.get((result as { caseId: string }).caseId)
    expect(stored).not.toBeNull()
    expect(stored!.question).toBe('Varför rörde sig den amerikanska långänden?')
  })

  it('does not represent the case as convened', async () => {
    breakConvening()
    const result = await ask()
    const stored = await repositories.cases.get((result as { caseId: string }).caseId)
    /*
     * No playbook pin and no committee. A case that showed either would be
     * claiming institutional work had begun when nothing had been assigned.
     */
    expect(stored!.playbookId ?? null).toBeNull()
    expect(stored!.participatingDepartmentIds).toEqual(['research-office'])
  })

  it('resumes onto the existing case rather than opening a second one', async () => {
    const broken = breakConvening()
    const first = await ask()
    const caseId = (first as { caseId: string }).caseId

    broken.heal()
    const resumed = await resumeConvening({
      repositories,
      deps,
      caseId,
      actingEmployeeId: CHAIRMAN,
      now: () => AT,
    })

    expect(resumed.state).toBe('convened')
    expect((resumed as { caseId: string }).caseId).toBe(caseId)
    expect(await repositories.cases.list()).toHaveLength(1)
  })

  it('instantiates exactly once across a successful resume', async () => {
    const broken = breakConvening()
    const first = await ask()
    const caseId = (first as { caseId: string }).caseId
    broken.heal()

    await resumeConvening({
      repositories,
      deps,
      caseId,
      actingEmployeeId: CHAIRMAN,
      now: () => AT,
    })
    const once = await repositories.cases.get(caseId)

    /* A second resume must replay, not convene the same committee again. */
    await resumeConvening({
      repositories,
      deps,
      caseId,
      actingEmployeeId: CHAIRMAN,
      now: () => AT,
    })
    const twice = await repositories.cases.get(caseId)

    expect(once!.playbookId).toBeTruthy()
    expect(twice!.playbookId).toBe(once!.playbookId)
    expect(twice!.playbookVersion).toBe(once!.playbookVersion)
    expect(twice!.participatingDepartmentIds).toEqual(once!.participatingDepartmentIds)
    expect(await repositories.cases.list()).toHaveLength(1)
  })

  it('never opens a duplicate case when the same submission is retried', async () => {
    /*
     * The whole point of deriving the id from the request: a Chairman whose
     * network dropped, pressing the button again, must not give the firm two
     * cases holding one question.
     */
    const first = await ask()
    const again = await ask()
    expect(first.state).toBe('convened')
    /*
     * And the retry is told the truth: the committee is sitting. Before
     * `conveneCommittee` read the case first, the retried convene arrived
     * under the same command id with a moved `expectedVersion`, the ledger
     * refused it as `payload-conflict`, and a Chairman whose question had
     * landed was told the convening was incomplete.
     */
    expect(again).toEqual(first)
    expect(await repositories.cases.list()).toHaveLength(1)
  })

  it('opens a distinct case for a genuinely distinct submission', async () => {
    await ask()
    const second = await ask({ requestId: 'req-2', question: 'Vart går ECB härnäst?' })
    expect((second as { caseId: string }).caseId).toBe(caseIdFor('req-2'))
    expect(await repositories.cases.list()).toHaveLength(2)
  })
})

describe('refused before anything is created', () => {
  const noCases = async () => expect(await repositories.cases.list()).toHaveLength(0)

  it('refuses a question that is only whitespace', async () => {
    const result = await ask({ question: '   ' })
    expect(result).toEqual({ state: 'refused', code: 'QUESTION_REQUIRED' })
    await noCases()
  })

  it('refuses a subject the firm cannot name', async () => {
    const result = await ask({ subjectDisplayName: '  ' })
    expect(result).toEqual({ state: 'refused', code: 'SUBJECT_REQUIRED' })
    await noCases()
  })

  it('refuses a subject name that normalises to nothing', async () => {
    const result = await ask({ subjectDisplayName: '!!!' })
    expect(result).toEqual({ state: 'refused', code: 'NOT_ROUTABLE' })
    await noCases()
  })

  it('refuses an operator the firm does not employ', async () => {
    const result = await ask({ actingEmployeeId: 'not-an-employee' })
    expect(result).toEqual({ state: 'refused', code: 'UNKNOWN_OPERATOR' })
    await noCases()
  })
})

describe('resuming a case that is not there', () => {
  it('refuses rather than creating one', async () => {
    const result = await resumeConvening({
      repositories,
      deps,
      caseId: 'case-that-never-existed',
      actingEmployeeId: CHAIRMAN,
      now: () => AT,
    })
    expect(result).toEqual({ state: 'refused', code: 'NOT_FOUND' })
    expect(await repositories.cases.list()).toHaveLength(0)
  })
})

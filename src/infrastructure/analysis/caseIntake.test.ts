/**
 * The routing the firm applies when it is asked a question.
 *
 * What is pinned here is that the routing is DERIVED. A test asserting
 * `ownerEmployeeId === 'research-director'` against a literal would pass just
 * as happily if the value were hard-coded, which is the thing this policy
 * exists to prevent — so the identities are checked against the playbook and
 * the organisation the derivation claims to read, and the failure paths are
 * checked by moving that ground.
 */

import { describe, expect, it } from 'vitest'
import {
  CASE_INTAKE_POLICY,
  CASE_INTAKE_POLICY_VERSION,
  IntakeRoutingUnsatisfiableError,
  UnroutableCaseKindError,
  deriveSubjectRef,
  resolveCaseIntake,
} from '~/application/analysis/caseIntake'
import { MACRO_REGIME_CASE_KIND } from '~/application/analysis/macroPlaybook'
import { requirePlaybook, resolveForCaseKind } from '~/application/analysis/playbookRegistry'
import { TEST_ORGANIZATION } from './testOrganization'

const organization = TEST_ORGANIZATION

describe('routing a macro-regime case', () => {
  it('resolves the accountable desk from the playbook, not from a name here', () => {
    const approved = resolveForCaseKind(MACRO_REGIME_CASE_KIND)
    const playbook = requirePlaybook(approved.playbookId, approved.version)
    const aggregating = playbook.entries.filter((e) => e.disciplineTag === 'aggregation')

    const intake = resolveCaseIntake(MACRO_REGIME_CASE_KIND, organization)

    expect(aggregating.length).toBeGreaterThan(0)
    expect(intake.accountableDepartmentId).toBe(aggregating[0]!.departmentId)
  })

  it('makes the accountable department, not the case kind, own the case', () => {
    const intake = resolveCaseIntake(MACRO_REGIME_CASE_KIND, organization)
    const department = organization.departments.find(
      (d) => d.id === intake.accountableDepartmentId,
    )!
    // The owner IS that department's manager, as the organisation names them.
    expect(intake.ownerEmployeeId).toBe(department.managerEmployeeId)
    expect(
      organization.employees.some((e) => e.id === intake.ownerEmployeeId),
    ).toBe(true)
  })

  it('pins the playbook the registry approves rather than one named here', () => {
    const approved = resolveForCaseKind(MACRO_REGIME_CASE_KIND)
    const intake = resolveCaseIntake(MACRO_REGIME_CASE_KIND, organization)
    expect(intake.playbookId).toBe(approved.playbookId)
    expect(intake.playbookVersion).toBe(approved.version)
  })

  it('seeds only the accountable desk and leaves the rest to convening', () => {
    /*
     * `instantiatePlaybook` grows participation from `playbook.entries`. Seeding
     * the full committee here would be a second derivation of the same fact,
     * and would also claim, before the committee is convened, that desks are
     * involved which have not been asked for anything.
     */
    const intake = resolveCaseIntake(MACRO_REGIME_CASE_KIND, organization)
    expect(intake.participatingDepartmentIds).toEqual([intake.accountableDepartmentId])
  })

  it('acts on behalf of the desk that is accountable', () => {
    const intake = resolveCaseIntake(MACRO_REGIME_CASE_KIND, organization)
    expect(intake.onBehalfOfDepartmentId).toBe(intake.accountableDepartmentId)
  })

  it('reports the routing policy version it applied', () => {
    expect(resolveCaseIntake(MACRO_REGIME_CASE_KIND, organization).policyVersion).toBe(
      CASE_INTAKE_POLICY_VERSION,
    )
  })

  it('never routes a case kind nobody has ruled on', () => {
    expect(() => resolveCaseIntake('crypto-regime', organization)).toThrow(
      UnroutableCaseKindError,
    )
  })

  it('covers every routed kind with an approved playbook', () => {
    // A routing entry whose playbook does not exist is a rule that cannot fire.
    for (const routing of CASE_INTAKE_POLICY) {
      expect(() => resolveCaseIntake(routing.caseKind, organization)).not.toThrow()
    }
  })
})

describe('when the ground the routing stands on moves', () => {
  it('refuses when the accountable department is not in the firm', () => {
    const withoutResearch = {
      ...organization,
      departments: organization.departments.filter((d) => d.id !== 'research-office'),
    }
    expect(() => resolveCaseIntake(MACRO_REGIME_CASE_KIND, withoutResearch)).toThrow(
      IntakeRoutingUnsatisfiableError,
    )
  })

  it('refuses when the department names a manager who is not an employee', () => {
    const orphaned = {
      ...organization,
      departments: organization.departments.map((d) =>
        d.id === 'research-office' ? { ...d, managerEmployeeId: 'nobody' } : d,
      ),
    }
    expect(() => resolveCaseIntake(MACRO_REGIME_CASE_KIND, orphaned)).toThrow(
      IntakeRoutingUnsatisfiableError,
    )
  })

  it('never substitutes another desk when the routing cannot be satisfied', () => {
    /*
     * The conservative direction. An unsatisfiable routing must stop the
     * request; picking the next department would give the case an owner the
     * firm never designated.
     */
    const withoutResearch = {
      ...organization,
      departments: organization.departments.filter((d) => d.id !== 'research-office'),
    }
    let owner: string | undefined
    try {
      owner = resolveCaseIntake(MACRO_REGIME_CASE_KIND, withoutResearch).ownerEmployeeId
    } catch {
      owner = undefined
    }
    expect(owner).toBeUndefined()
  })
})

describe('the subject reference the Chairman never types', () => {
  it('derives a stable slug from the displayed name', () => {
    expect(deriveSubjectRef('Amerikanska statsräntor')).toBe('amerikanska-statsrantor')
  })

  it('is deterministic', () => {
    const once = deriveSubjectRef('US Treasury long end')
    const twice = deriveSubjectRef('US Treasury long end')
    expect(once).toBe(twice)
    expect(once).toBe('us-treasury-long-end')
  })

  it('folds diacritics rather than dropping the letters', () => {
    // "räntor" must not become "rntor" — the word has to survive.
    expect(deriveSubjectRef('räntor')).toBe('rantor')
    expect(deriveSubjectRef('Öresund')).toBe('oresund')
  })

  it('collapses punctuation without leaving separators at the edges', () => {
    expect(deriveSubjectRef('  ECB — policy path!  ')).toBe('ecb-policy-path')
  })

  it('refuses a name that normalises to nothing', () => {
    // Better a refusal than a case whose subject reference is the empty string.
    expect(() => deriveSubjectRef('!!!')).toThrow()
    expect(() => deriveSubjectRef('   ')).toThrow()
  })

  it('distinguishes subjects that are genuinely different', () => {
    expect(deriveSubjectRef('German 10y')).not.toBe(deriveSubjectRef('US 10y'))
  })
})

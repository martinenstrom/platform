/**
 * Analysis domain contracts (AI Phase A).
 *
 * Two groups matter most. The extensibility tests prove a new department is
 * data rather than code — the requirement that decides whether ESG Research,
 * Credit Research or Private Equity can be added without redesigning anything.
 * The rest prove that the illegal states are actually illegal.
 */

import { describe, expect, it } from 'vitest'
import {
  buildAssignment,
  buildChallenge,
  buildClaim,
  blockingChallenges,
  buildEvidenceSet,
  buildRiskVerdict,
  buildRole,
  buildRunRecord,
  budgetOverruns,
  NON_CONSUMING_BUDGET,
  type ExecutionBudget,
  buildVerificationFinding,
  canTransition,
  challengeBlocks,
  DISAGREEMENT_MATERIALITIES,
  eligibilityPolicy,
  disagreementBlocksEligibility,
  citeFrom,
  composeConfidence,
  departmentsHandling,
  evaluateGate,
  governanceDepartments,
  isPublishable,
  isRevisionOf,
  observationRef,
  projectActivity,
  reportingLine,
  resolveCitation,
  runCacheKey,
  transitionCase,
  unresolvedChallenges,
  validateOrganization,
  workQueueFor,
  workloadFor,
  waitingChains,
  type AgentClaim,
  type Assignment,
  type Challenge,
  type Department,
  type DevilsAdvocateReview,
  type EvidenceSignals,
  type InvestmentCase,
  type Organization,
  type RiskReview,
  type RiskStatus,
  type VerificationReview,
  type VerificationVerdict,
} from './index'
import type { CanonicalValue } from '~/domain/shared/canonicalValue'

/* ------------------------------------------------------------- test fixtures */

const responsibilities = [{ id: 'r1', summary: 'Analyse', interpretive: false }]

const specialistRole = buildRole({
  id: 'role-specialist',
  title: 'Specialist',
  function: 'specialist',
  responsibilities,
  canBlockPublication: false,
})
const managerRole = buildRole({
  id: 'role-manager',
  title: 'Manager',
  function: 'manager',
  responsibilities,
  canBlockPublication: false,
})
const governanceRole = buildRole({
  id: 'role-governance',
  title: 'Fact Checker',
  function: 'governance',
  responsibilities,
  canBlockPublication: true,
})
const executiveRole = buildRole({
  id: 'role-cio',
  title: 'Chief Investment Officer',
  function: 'executive',
  responsibilities,
  canBlockPublication: false,
})

function firm(extraDepartments: Department[] = []): Organization {
  return {
    id: 'org',
    name: 'Financial OS',
    chiefEmployeeId: 'cio',
    roles: [specialistRole, managerRole, governanceRole, executiveRole],
    departments: [
      {
        id: 'macro',
        name: 'Global Macro',
        managerEmployeeId: 'macro-head',
        handles: ['macro', 'rates'],
        isGovernance: false,
      },
      {
        id: 'verification',
        name: 'Fact Checker',
        managerEmployeeId: 'fact-head',
        handles: ['verification'],
        isGovernance: true,
      },
      {
        id: 'executive',
        name: 'Executive',
        managerEmployeeId: 'cio',
        handles: [],
        isGovernance: false,
      },
      ...extraDepartments,
    ],
    teams: [],
    employees: [
      {
        id: 'cio',
        displayName: 'CIO',
        roleId: 'role-cio',
        departmentId: 'executive',
        seniority: 'chief',
      },
      {
        id: 'macro-head',
        displayName: 'Head of Macro',
        roleId: 'role-manager',
        departmentId: 'macro',
        reportsTo: 'cio',
        seniority: 'head',
      },
      {
        id: 'macro-analyst',
        displayName: 'Macro Analyst',
        roleId: 'role-specialist',
        departmentId: 'macro',
        reportsTo: 'macro-head',
        seniority: 'senior',
      },
      {
        id: 'fact-head',
        displayName: 'Head of Verification',
        roleId: 'role-governance',
        departmentId: 'verification',
        reportsTo: 'cio',
        seniority: 'head',
      },
      ...extraDepartments.flatMap((d) => [
        {
          id: `${d.id}-head`,
          displayName: `Head of ${d.name}`,
          roleId: 'role-manager',
          departmentId: d.id,
          reportsTo: 'cio',
          seniority: 'head' as const,
        },
      ]),
    ],
  }
}

/* -------------------------------------------------------------- organization */

describe('the organization is a firm, not a list of agents', () => {
  it('validates a well-formed structure', () => {
    expect(() => validateOrganization(firm())).not.toThrow()
  })

  it('walks a reporting line up to the chief', () => {
    expect(reportingLine(firm(), 'macro-analyst')).toEqual([
      'macro-analyst',
      'macro-head',
      'cio',
    ])
  })

  it('refuses a chief who reports to someone', () => {
    const broken = firm()
    const employees = broken.employees.map((e) =>
      e.id === 'cio' ? { ...e, reportsTo: 'macro-head' } : e,
    )
    expect(() => validateOrganization({ ...broken, employees })).toThrow(
      /must not report/,
    )
  })

  it('refuses a department managed from outside itself', () => {
    const broken = firm()
    const departments = broken.departments.map((d) =>
      d.id === 'macro' ? { ...d, managerEmployeeId: 'fact-head' } : d,
    )
    expect(() => validateOrganization({ ...broken, departments })).toThrow(
      /another department/,
    )
  })

  it('detects a reporting cycle instead of looping forever', () => {
    const broken = firm()
    const employees = broken.employees.map((e) =>
      e.id === 'macro-head' ? { ...e, reportsTo: 'macro-analyst' } : e,
    )
    expect(() => reportingLine({ ...broken, employees }, 'macro-analyst')).toThrow(
      /cycle/,
    )
  })

  it('lets only governance roles block publication', () => {
    expect(() => buildRole({ ...specialistRole, canBlockPublication: true })).toThrow(
      /cannot block/,
    )
  })

  it('requires a governance role to actually be able to block', () => {
    // A control function that cannot stop anything is advisory, not control.
    expect(() => buildRole({ ...governanceRole, canBlockPublication: false })).toThrow(
      /must be able to block/,
    )
  })

  it('lists governance departments as first-class', () => {
    expect(governanceDepartments(firm()).map((d) => d.id)).toEqual(['verification'])
  })
})

describe('a new department is data, not code', () => {
  /**
   * The requirement this whole module was shaped around. ESG Research is a
   * department the codebase has never heard of; adding it must need no type
   * change, no enum entry and no new branch.
   */
  const esg: Department = {
    id: 'esg-research',
    name: 'ESG Research',
    managerEmployeeId: 'esg-research-head',
    handles: ['esg', 'sustainability', 'climate-risk'],
    isGovernance: false,
  }

  it('accepts a department the codebase has never heard of', () => {
    const organization = firm([esg])
    expect(() => validateOrganization(organization)).not.toThrow()
    expect(organization.departments.map((d) => d.id)).toContain('esg-research')
  })

  it('routes work to it by discipline, with no enum to extend', () => {
    expect(departmentsHandling(firm([esg]), 'climate-risk').map((d) => d.id)).toEqual([
      'esg-research',
    ])
  })

  it('accepts every asset-class department named in the roadmap at once', () => {
    const departments: Department[] = [
      'credit-research',
      'fixed-income',
      'commodities',
      'fx',
      'emerging-markets',
      'options',
      'private-equity',
      'venture-capital',
      'alternative-investments',
    ].map((id) => ({
      id,
      name: id,
      managerEmployeeId: `${id}-head`,
      handles: [id],
      isGovernance: false,
    }))

    const organization = firm(departments)
    expect(() => validateOrganization(organization)).not.toThrow()
    expect(organization.departments).toHaveLength(12)
  })
})

/* --------------------------------------------------------------------- cases */

const baseCase: InvestmentCase = {
  id: 'case-1',
  version: 1,
  subject: { kind: 'instrument', ref: 'eq:xsto:volv-b', displayName: 'Volvo B' },
  question: 'Is the current valuation supported by the earnings trajectory?',
  stage: 'intake',
  openedAt: '2026-07-27T08:00:00.000Z',
  ownerEmployeeId: 'macro-head',
  participatingDepartmentIds: ['macro'],
  transitions: [],
}

const mover = {
  employeeId: 'macro-head',
  departmentId: 'macro',
  at: '2026-07-27T09:00:00.000Z',
}

describe('cases move through the firm', () => {
  it('follows the lifecycle', () => {
    const moved = transitionCase(baseCase, 'research', mover)
    expect(moved.stage).toBe('research')
    expect(moved.transitions).toHaveLength(1)
    // Every movement advances the aggregate version, for concurrency control.
    expect(moved.version).toBe(baseCase.version + 1)
  })

  it('does not mutate the case it was given', () => {
    transitionCase(baseCase, 'research', mover)
    // History is evidence; an aggregate whose past can be rewritten in place
    // cannot be audited.
    expect(baseCase.stage).toBe('intake')
    expect(baseCase.transitions).toHaveLength(0)
  })

  it('refuses a move the lifecycle does not allow', () => {
    expect(() => transitionCase(baseCase, 'published', mover)).toThrow(/cannot move/)
  })

  it('lets nothing reach the CIO except through review', () => {
    // The structural guarantee behind "nothing reaches the CIO unverified".
    expect(canTransition('review', 'decision')).toBe(true)
    expect(canTransition('research', 'decision')).toBe(false)
    expect(canTransition('aggregation', 'decision')).toBe(false)
    expect(canTransition('intake', 'decision')).toBe(false)
  })

  it('publishes only from a completed decision', () => {
    /*
     * `decision` is now "awaiting the CIO", and publication follows a decision
     * that was actually taken. Publishing straight out of the queue would
     * publish work nobody decided on.
     */
    expect(canTransition('decided', 'published')).toBe(true)
    expect(canTransition('decision', 'published')).toBe(false)
    expect(canTransition('review', 'published')).toBe(false)
  })

  it('separates awaiting the CIO from decided and deferred', () => {
    expect(canTransition('decision', 'decided')).toBe(true)
    expect(canTransition('decision', 'deferred')).toBe(true)
    // Taken by no command in C1D-1: the reconsideration command is TD-50.
    expect(canTransition('deferred', 'decision')).toBe(true)
    expect(canTransition('decided', 'decision')).toBe(false)
  })

  it('requires a reason to block or return work', () => {
    const inResearch = transitionCase(baseCase, 'research', mover)
    expect(() => transitionCase(inResearch, 'blocked', mover)).toThrow(
      /requires a reason/,
    )
  })

  it('reports why a case is stalled', () => {
    const inResearch = transitionCase(baseCase, 'research', mover)
    const blocked = transitionCase(inResearch, 'blocked', {
      ...mover,
      reason: 'awaiting Q2 filing',
    })
    expect(blocked.stage).toBe('blocked')
    expect(blocked.transitions[blocked.transitions.length - 1]?.reason).toBe(
      'awaiting Q2 filing',
    )
  })
})

/* ---------------------------------------------------------------------- work */

describe('work queues', () => {
  const assignment = (over: Partial<Assignment> = {}): Assignment =>
    buildAssignment({
      id: 'a1',
      caseId: 'case-1',
      departmentId: 'macro',
      brief: 'Assess the policy backdrop',
      status: 'queued',
      createdAt: '2026-07-27T08:00:00.000Z',
      priority: 1,
      ...over,
    })

  it('orders a queue by priority then age', () => {
    const queue = workQueueFor('macro', [
      assignment({ id: 'low', priority: 1 }),
      assignment({ id: 'high', priority: 9 }),
    ])
    expect(queue.assignments.map((a) => a.id)).toEqual(['high', 'low'])
  })

  it('excludes closed work from the queue', () => {
    const queue = workQueueFor('macro', [
      assignment({ id: 'done', status: 'completed' }),
      assignment({ id: 'open' }),
    ])
    expect(queue.assignments.map((a) => a.id)).toEqual(['open'])
  })

  it('summarises a department workload', () => {
    const queue = workQueueFor('macro', [
      assignment({ id: 'a', status: 'active' }),
      assignment({ id: 'b', status: 'queued' }),
      assignment({
        id: 'c',
        status: 'waiting',
        waitingOn: { kind: 'evidence', evidenceSought: 'Q2 filing' },
      }),
    ])
    expect(workloadFor(queue)).toMatchObject({ active: 1, queued: 1, waiting: 1 })
  })

  it('refuses a wait with no stated cause', () => {
    // An unexplained wait is indistinguishable from a stall.
    expect(() => assignment({ status: 'waiting' })).toThrow(/waiting but does not say/)
  })

  it('refuses a return with no reason', () => {
    expect(() => assignment({ status: 'returned' })).toThrow(/without a reason/)
  })

  it('reports who is waiting on whom', () => {
    const blocking = assignment({ id: 'macro-work', departmentId: 'macro' })
    const waiter = assignment({
      id: 'equity-work',
      departmentId: 'equity',
      status: 'waiting',
      waitingOn: { kind: 'assignment', assignmentId: 'macro-work' },
    })
    const chains = waitingChains([blocking, waiter])
    expect(chains).toHaveLength(1)
    // Structure, not a sentence: the UI phrases this, the domain identifies it.
    expect(chains[0]?.basis).toEqual({ kind: 'assignment', blockedBy: blocking })
  })

  it('reports a broken chain as a missing assignment rather than as prose', () => {
    const waiter = assignment({
      id: 'equity-work',
      status: 'waiting',
      waitingOn: { kind: 'assignment', assignmentId: 'gone' },
    })
    expect(waitingChains([waiter])[0]?.basis).toEqual({
      kind: 'missing-assignment',
      assignmentId: 'gone',
    })
  })
})

/* ------------------------------------------------------------------ identity */

describe('observation identity', () => {
  const key = {
    subjectKind: 'instrument' as const,
    subject: 'rate:us10y',
    kind: 'yield' as const,
    observedAt: '2026-07-24T00:00:00.000Z',
    referencePeriod: '2026-07-24',
    sourceId: 'treasury',
    seriesId: 'BC_10YEAR',
    methodology: 'par-yield',
  }

  it('is stable across re-retrieval', () => {
    const first = observationRef(key, {
      yieldPercent: '4.69',
      changeBasisPoints: null,
      observationDate: '2026-07-28',
    })
    const second = observationRef(key, {
      yieldPercent: '4.69',
      changeBasisPoints: null,
      observationDate: '2026-07-28',
    })
    expect(second.id).toBe(first.id)
    expect(second.contentHash).toBe(first.contentHash)
  })

  it('ignores field order when hashing content', () => {
    const a = observationRef(key, {
      yieldPercent: '4.69',
      changeBasisPoints: '-2',
      observationDate: '2026-07-28',
    })
    const b = observationRef(key, {
      observationDate: '2026-07-28',
      changeBasisPoints: '-2',
      yieldPercent: '4.69',
    })
    // Without canonical ordering, a provider emitting fields differently would
    // register as a revision on every fetch.
    expect(b.contentHash).toBe(a.contentHash)
  })

  it('detects a revision: same identity, different content', () => {
    const original = observationRef(key, {
      yieldPercent: '4.69',
      changeBasisPoints: null,
      observationDate: '2026-07-28',
    })
    const revised = observationRef(key, {
      yieldPercent: '4.71',
      changeBasisPoints: null,
      observationDate: '2026-07-28',
    })
    expect(revised.id).toBe(original.id)
    expect(isRevisionOf(revised, original)).toBe(true)
  })

  it('recognises a revision PUBLISHED LATER, which is how revisions arrive', () => {
    /*
     * The reason the v2 key exists, planted as the violation it was.
     *
     * A source does not revise a figure at the instant it first published it —
     * it republishes days later. Under v1 that later `observedAt` was part of
     * the key, so the revision minted a fresh id and read as an unrelated
     * observation: a claim citing the original still resolved cleanly, and the
     * firm never learned the number had moved beneath it.
     */
    const published = observationRef(
      { ...key, observedAt: '2026-07-24T00:00:00.000Z' },
      { yieldPercent: '4.69', changeBasisPoints: null, observationDate: '2026-07-24' },
    )
    const revisedLater = observationRef(
      { ...key, observedAt: '2026-07-27T00:00:00.000Z' },
      { yieldPercent: '4.71', changeBasisPoints: null, observationDate: '2026-07-24' },
    )

    expect(revisedLater.id).toBe(published.id)
    expect(isRevisionOf(revisedLater, published)).toBe(true)
  })

  it('does not mistake the NEXT day for a revision of the last one', () => {
    /*
     * The near-miss. Without it the test above would also pass under a key that
     * dropped time altogether, which would collapse a whole series into one
     * observation and call every new print a revision of its predecessor.
     */
    const friday = observationRef(
      { ...key, observedAt: '2026-07-24T00:00:00.000Z' },
      { yieldPercent: '4.69', changeBasisPoints: null, observationDate: '2026-07-24' },
    )
    const monday = observationRef(
      { ...key, observedAt: '2026-07-27T00:00:00.000Z', referencePeriod: '2026-07-27' },
      { yieldPercent: '4.71', changeBasisPoints: null, observationDate: '2026-07-27' },
    )

    expect(monday.id).not.toBe(friday.id)
    expect(isRevisionOf(monday, friday)).toBe(false)
  })

  it('treats a different methodology as a different observation', () => {
    // A par yield and a fitted zero rate for the same bond on the same day are
    // two things, not one thing revised.
    const par = observationRef(key, {
      yieldPercent: '4.69',
      changeBasisPoints: null,
      observationDate: '2026-07-28',
    })
    const fitted = observationRef(
      { ...key, methodology: 'zero-coupon-fitted' },
      { yieldPercent: '4.69', changeBasisPoints: null, observationDate: '2026-07-28' },
    )
    expect(fitted.id).not.toBe(par.id)
    expect(isRevisionOf(fitted, par)).toBe(false)
  })

  it('produces a wide hash, because a collision means citing the wrong thing', () => {
    expect(observationRef(key, { v: 1 }).id).toHaveLength(32)
  })
})

/* ------------------------------------------------------------------ evidence */

describe('the evidence set', () => {
  /*
   * Each reference is kept beside the payload it was built over. They used to
   * drift -- the refs carried real projections while every item stored `{}` --
   * which nothing checked until the content hash became verifiable.
   */
  const yieldPayload = {
    yieldPercent: '4.69',
    changeBasisPoints: null,
    observationDate: '2026-07-28',
  }
  const policyPayload = {
    regime: {
      level: '2.25',
      effectiveDate: '2026-06-15',
      effectiveDateConfidence: 'exact',
      change: null,
    },
  }

  const refA = observationRef(
    {
      subjectKind: 'instrument',
      subject: 'rate:us10y',
      kind: 'yield',
      observedAt: '2026-07-24T00:00:00.000Z',
      sourceId: 'treasury',
      referencePeriod: '2026-07-24',
    },
    yieldPayload,
  )
  const refB = observationRef(
    {
      subjectKind: 'central-bank',
      subject: 'ecb',
      kind: 'policy-state',
      observedAt: '2026-07-26T00:00:00.000Z',
      sourceId: 'ecb',
      referencePeriod: '2026-07-26',
    },
    policyPayload.regime,
  )
  const provenance = { source: { providerId: 'x' } } as never

  /*
   * Takes each reference WITH the payload it was built over. Deriving the
   * payload from the reference is what broke here: a helper that guessed by
   * kind handed every yield ref one payload, so refs built over other values
   * failed verification. A reference and its payload are one fact.
   */
  const setOf = (items: { ref: typeof refA; value: CanonicalValue }[]) =>
    buildEvidenceSet({
      items: items.map(({ ref, value }) => ({ ref, value, provenance })),
      assembledAt: '2026-07-27T08:00:00.000Z',
      correlationId: 'corr-1',
    })

  const A = { ref: refA, value: yieldPayload }
  const B = { ref: refB, value: policyPayload }

  it('hashes identically regardless of assembly order', () => {
    expect(setOf([A, B]).id).toBe(setOf([B, A]).id)
  })

  it('states the publication spread when observations are not co-temporal', () => {
    const set = setOf([A, B])
    expect(set.coTemporality.publication.kind).toBe('mixed')
    if (set.coTemporality.publication.kind !== 'mixed') throw new Error('unreachable')
    // Two days apart — an agent comparing them must be told.
    expect(set.coTemporality.publication.spreadMs).toBe(2 * 86_400_000)
  })

  it('reports co-temporality when everything shares a moment', () => {
    expect(setOf([A]).coTemporality.publication.kind).toBe('aligned')
  })

  it('reports the REFERENCE spread beside the publication spread', () => {
    /*
     * The axis that matters for macro evidence, and the one the set could not
     * state before. Two figures published an hour apart can describe periods six
     * weeks apart, and an agent told only the first would read them as
     * contemporaneous.
     */
    const set = setOf([A, B])
    expect(set.coTemporality.reference.kind).toBe('mixed')
    expect(set.coTemporality.publication.kind).toBe('mixed')
  })

  it('retains disagreement rather than resolving it', () => {
    const sameThingKey = {
      subjectKind: 'instrument' as const,
      subject: 'rate:de10y',
      kind: 'yield' as const,
      observedAt: '2026-07-24T00:00:00.000Z',
      /* The period both sources describe — which is what makes them rivals. */
      referencePeriod: '2026-07-28',
    }
    const bundes = {
      yieldPercent: '3.24',
      changeBasisPoints: null,
      observationDate: '2026-07-28',
    }
    const vendorValue = {
      yieldPercent: '3.31',
      changeBasisPoints: null,
      observationDate: '2026-07-28',
    }
    const bundesbank = observationRef({ ...sameThingKey, sourceId: 'bundesbank' }, bundes)
    const vendor = observationRef({ ...sameThingKey, sourceId: 'riksbank' }, vendorValue)
    const set = setOf([
      { ref: bundesbank, value: bundes },
      { ref: vendor, value: vendorValue },
    ])

    // Never averaged into 3.275. Both survive, and the conflict is named.
    expect(set.disagreements).toHaveLength(1)
    // Copied before sorting: the set freezes its arrays, which is the point.
    expect([...(set.disagreements[0]?.sourceIds ?? [])].sort()).toEqual([
      'bundesbank',
      'riksbank',
    ])
    expect(set.items).toHaveLength(2)
  })

  it('finds a cross-source disagreement published HOURS APART', () => {
    /*
     * The planted violation, and the measured pathology v2 exists to fix.
     * Grouping on `observedAt` reported ZERO here: two authoritative sources
     * publishing the same reference-period figure sixteen hours apart never met
     * in a group, so macro disagreement was effectively undetectable.
     */
    const shared = {
      subjectKind: 'instrument' as const,
      subject: 'rate:de10y',
      kind: 'yield' as const,
      referencePeriod: '2026-07-28',
    }
    const bundesValue = {
      yieldPercent: '3.24',
      changeBasisPoints: null,
      observationDate: '2026-07-28',
    }
    const rivalValue = {
      yieldPercent: '3.31',
      changeBasisPoints: null,
      observationDate: '2026-07-28',
    }
    const bundesbank = observationRef(
      { ...shared, observedAt: '2026-07-28T06:00:00.000Z', sourceId: 'bundesbank' },
      bundesValue,
    )
    const rival = observationRef(
      { ...shared, observedAt: '2026-07-28T22:00:00.000Z', sourceId: 'riksbank' },
      rivalValue,
    )
    const set = setOf([
      { ref: bundesbank, value: bundesValue },
      { ref: rival, value: rivalValue },
    ])

    expect(set.disagreements).toHaveLength(1)
    expect(set.disagreements[0]!.referencePeriod).toBe('2026-07-28')
    expect([...set.disagreements[0]!.sourceIds].sort()).toEqual([
      'bundesbank',
      'riksbank',
    ])
    /* A disagreement is not a revision. The two shapes stay separate. */
    expect(set.revisions).toHaveLength(0)
  })

  it('reports ONE source restating a period as a revision, not a disagreement', () => {
    /*
     * The near-miss. Same shape as the test above in every respect except that
     * one source is correcting itself — which is a different institutional fact
     * and must not arrive in the same field with its own name listed twice.
     */
    const shared = {
      subjectKind: 'instrument' as const,
      subject: 'rate:de10y',
      kind: 'yield' as const,
      referencePeriod: '2026-07-28',
      sourceId: 'bundesbank',
    }
    const firstValue = {
      yieldPercent: '3.24',
      changeBasisPoints: null,
      observationDate: '2026-07-28',
    }
    const correctedValue = {
      yieldPercent: '3.26',
      changeBasisPoints: null,
      observationDate: '2026-07-28',
    }
    const first = observationRef(
      { ...shared, observedAt: '2026-07-28T06:00:00.000Z' },
      firstValue,
    )
    const corrected = observationRef(
      { ...shared, observedAt: '2026-07-31T06:00:00.000Z' },
      correctedValue,
    )
    const set = setOf([
      { ref: first, value: firstValue },
      { ref: corrected, value: correctedValue },
    ])

    expect(set.disagreements).toHaveLength(0)
    expect(set.revisions).toHaveLength(1)
    expect(set.revisions[0]!.sourceId).toBe('bundesbank')
    expect(set.revisions[0]!.observationId).toBe(first.id)
    /* Earliest publication first, so a reader can see which way it moved. */
    expect(set.revisions[0]!.versions.map((v) => v.observedAt)).toEqual([
      '2026-07-28T06:00:00.000Z',
      '2026-07-31T06:00:00.000Z',
    ])
  })

  it('records agreement between two sources as no disagreement', () => {
    const shared = {
      subjectKind: 'instrument' as const,
      subject: 'rate:de10y',
      kind: 'yield' as const,
      observedAt: '2026-07-24T00:00:00.000Z',
      /* The period both sources describe — which is what makes them rivals. */
      referencePeriod: '2026-07-28',
    }
    const agreed = {
      yieldPercent: '3.24',
      changeBasisPoints: null,
      observationDate: '2026-07-28',
    }
    const set = setOf([
      { ref: observationRef({ ...shared, sourceId: 'a' }, agreed), value: agreed },
      { ref: observationRef({ ...shared, sourceId: 'b' }, agreed), value: agreed },
    ])
    expect(set.disagreements).toHaveLength(0)
  })
})

describe('citations resolve against the set they were made in', () => {
  const ref = observationRef(
    {
      subjectKind: 'instrument',
      subject: 'rate:us10y',
      kind: 'yield',
      observedAt: '2026-07-24T00:00:00.000Z',
      sourceId: 'treasury',
      referencePeriod: '2026-07-24',
    },
    { yieldPercent: '4.69', changeBasisPoints: null, observationDate: '2026-07-28' },
  )
  const set = buildEvidenceSet({
    items: [
      {
        ref,
        // The payload the ref was built over, not an empty object.
        value: {
          yieldPercent: '4.69',
          changeBasisPoints: null,
          observationDate: '2026-07-28',
        },
        provenance: {} as never,
      },
    ],
    assembledAt: '2026-07-27T08:00:00.000Z',
    correlationId: 'c',
  })

  it('resolves a good citation', () => {
    expect(resolveCitation(set, citeFrom(set, ref)).status).toBe('resolved')
  })

  it('refuses to mint a citation for something not in the set', () => {
    const outsider = observationRef(
      {
        subjectKind: 'instrument',
        subject: 'rate:us2y',
        kind: 'yield',
        observedAt: '2026-07-24T00:00:00.000Z',
        sourceId: 'treasury',
        referencePeriod: '2026-07-24',
      },
      { yieldPercent: '4.33', changeBasisPoints: null, observationDate: '2026-07-28' },
    )
    expect(() => citeFrom(set, outsider)).toThrow(/not in evidence set/)
  })

  it('detects a citation carried across evidence sets', () => {
    const citation = { ...citeFrom(set, ref), setId: 'some-other-set' }
    expect(resolveCitation(set, citation)).toMatchObject({
      status: 'unresolved',
      reason: 'wrong-set',
    })
  })

  it('detects evidence revised after it was cited', () => {
    const citation = { ...citeFrom(set, ref), contentHash: 'stale-hash' }
    expect(resolveCitation(set, citation).status).toBe('revised')
  })
})

/* -------------------------------------------------------------------- claims */

const claimBase = {
  id: 'claim-1',
  statement: 'The US 10Y yield fell 2 basis points.',
  evidenceRefs: [{ setId: 's', observationId: 'o', contentHash: 'h' }],
  contradictingEvidenceRefs: [],
  confidence: { level: 'high' as const, basis: [] },
  temporalScope: { asOf: '2026-07-24T00:00:00.000Z' },
  status: 'supported' as const,
}

describe('claims', () => {
  it('builds a descriptive claim', () => {
    expect(() =>
      buildClaim({ ...claimBase, type: 'observation' } as AgentClaim),
    ).not.toThrow()
  })

  it('refuses a supported claim with no evidence', () => {
    expect(() =>
      buildClaim({ ...claimBase, type: 'observation', evidenceRefs: [] } as AgentClaim),
    ).toThrow(/supported with no evidence/)
  })

  it('refuses a contested claim citing nothing against it', () => {
    expect(() =>
      buildClaim({
        ...claimBase,
        type: 'observation',
        status: 'contested',
      } as AgentClaim),
    ).toThrow(/contradicts/)
  })

  it('requires a horizon on a forecast', () => {
    // A forecast with no horizon cannot be wrong, which means it cannot be right.
    expect(() => buildClaim({ ...claimBase, type: 'forecast' } as AgentClaim)).toThrow(
      /needs a horizon/,
    )
  })

  it('requires a counterclaim to name what it contests', () => {
    expect(() =>
      buildClaim({ ...claimBase, type: 'counterclaim' } as AgentClaim),
    ).toThrow(/what it contests/)
  })

  it('will not typecheck a causal claim without attribution', () => {
    // @ts-expect-error a causal claim requires an attribution
    const invalid: AgentClaim = { ...claimBase, type: 'causal' }
    expect(invalid).toBeDefined()
  })

  it('accepts a causal claim attributed to an official statement', () => {
    const claim = buildClaim({
      ...claimBase,
      type: 'causal',
      statement: 'The 2Y rose because the FOMC signalled fewer cuts.',
      attribution: {
        kind: 'official-statement',
        evidence: { setId: 's', observationId: 'o', contentHash: 'h' },
      },
    })
    expect(claim.type).toBe('causal')
  })
})

/* ---------------------------------------------------------------- confidence */

describe('confidence composition', () => {
  const signals = (over: Partial<EvidenceSignals> = {}): EvidenceSignals => ({
    weakestEvidence: 'high',
    anyFixtureBacked: false,
    anyMissingProvenance: false,
    anyStale: false,
    methodologyMismatch: false,
    conflictingEvidence: false,
    evidenceCount: 3,
    ...over,
  })

  it('cannot exceed the weakest evidence', () => {
    const result = composeConfidence(signals({ weakestEvidence: 'low' }), 'observation')
    expect(result.level).toBe('low')
    expect(result.cappedBy).toBe('weakest-evidence')
  })

  it('makes a fixture-backed claim unpublishable', () => {
    const result = composeConfidence(signals({ anyFixtureBacked: true }), 'observation')
    expect(result.level).toBe('insufficient')
    expect(isPublishable(result)).toBe(false)
  })

  it('makes an unprovenanced claim unpublishable', () => {
    const result = composeConfidence(
      signals({ anyMissingProvenance: true }),
      'observation',
    )
    expect(isPublishable(result)).toBe(false)
  })

  it('invalidates a comparison across mismatched methodologies', () => {
    const result = composeConfidence(signals({ methodologyMismatch: true }), 'comparison')
    expect(result.level).toBe('insufficient')
    expect(result.cappedBy).toBe('methodology-mismatch')
  })

  it('lowers, rather than invalidates, a non-comparison with mixed methodologies', () => {
    const result = composeConfidence(signals({ methodologyMismatch: true }), 'trend')
    expect(result.level).toBe('low')
  })

  it('reduces confidence for stale evidence', () => {
    expect(composeConfidence(signals({ anyStale: true }), 'observation').level).toBe(
      'moderate',
    )
  })

  it('lowers confidence on disagreement instead of averaging it away', () => {
    const result = composeConfidence(
      signals({ conflictingEvidence: true }),
      'observation',
    )
    expect(result.level).toBe('low')
    expect(result.cappedBy).toBe('conflicting-evidence')
  })

  it('returns insufficient with no evidence at all', () => {
    expect(composeConfidence(signals({ evidenceCount: 0 }), 'observation').level).toBe(
      'insufficient',
    )
  })

  it('never raises confidence — agreement is not independent evidence', () => {
    // There is no signal that can produce a level above the weakest evidence.
    const ceiling = composeConfidence(
      signals({ weakestEvidence: 'moderate' }),
      'observation',
    )
    expect(ceiling.level).toBe('moderate')
  })

  it('explains itself', () => {
    const result = composeConfidence(signals({ anyStale: true }), 'observation')
    expect(result.basis.join(' ')).toMatch(/stale/)
  })
})

/* ---------------------------------------------------------------- governance */

describe('the governance gate', () => {
  const verification = (over: Partial<VerificationVerdict> = {}): VerificationReview => ({
    scope: 'case',
    caseId: 'case-1',
    reviewId: 'rev-verification-1',
    sequence: 1,
    byEmployeeId: 'fact-head',
    byDepartmentId: 'verification',
    at: '2026-07-27T10:00:00.000Z',
    status: 'verified',
    findings: [],
    claimsReviewed: ['claim-1'],
    ...over,
  })

  /** Risk resolved as not applying, so the Risk gate is not what is under test. */
  const riskSettled = { riskRequirement: 'not-required' } as const
  const kinds = (result: { blockers: readonly { kind: string }[] }) =>
    result.blockers.map((blocker) => blocker.kind)

  it('blocks when verification has not happened at all', () => {
    // A missing check must not be a pass, or skipping it is the way through.
    const result = evaluateGate({
      ...riskSettled,
      challengeBlocksAtOrAbove: 'material',
    })
    expect(result.passed).toBe(false)
    expect(kinds(result)).toContain('verification-missing')
  })

  it('passes a verified case', () => {
    expect(
      evaluateGate({
        challengeBlocksAtOrAbove: 'material',
        ...riskSettled,
        verification: verification(),
      }).passed,
    ).toBe(true)
  })

  it('blocks on a correction requirement', () => {
    const result = evaluateGate({
      challengeBlocksAtOrAbove: 'material',
      ...riskSettled,
      verification: verification({ status: 'correction-required' }),
    })
    expect(result.passed).toBe(false)
    expect(kinds(result)).toEqual(['verification-correction-required'])
  })

  it('names the claims a blocking verdict is about, rather than describing them', () => {
    /*
     * The property the structured blocker exists for. The floor links to a
     * claim; it does not parse a sentence to find one.
     */
    const result = evaluateGate({
      challengeBlocksAtOrAbove: 'material',
      ...riskSettled,
      verification: verification({
        status: 'correction-required',
        findings: [
          buildVerificationFinding({
            kind: 'value-mismatch',
            claimId: 'claim-7',
            detail: 'CPI print does not match the cited release',
            blocking: true,
            severity: 'critical',
            expected: { amount: '3.1', unit: 'percent' },
            observed: { amount: '3.4', unit: 'percent' },
            correctionRequired: 'Recompute against the September release.',
          }),
        ],
      }),
    })
    const blocker = result.blockers[0]!
    expect(blocker.kind).toBe('verification-correction-required')
    expect(blocker).toMatchObject({
      blockingClaimIds: ['claim-7'],
      status: 'correction-required',
    })
  })

  it('blocks on a single blocking finding even when the status looks benign', () => {
    const review = verification({
      status: 'verified-with-qualifications',
      findings: [
        buildVerificationFinding({
          kind: 'basis-point-confusion',
          claimId: 'claim-1',
          detail: '0.25 % reported as 25 bp',
          blocking: true,
          severity: 'critical',
          correctionRequired: 'Restate as 25 basis points.',
        }),
      ],
    })
    expect(
      evaluateGate({
        challengeBlocksAtOrAbove: 'material',
        ...riskSettled,
        verification: review,
      }).passed,
    ).toBe(false)
  })

  it('refuses a blocking finding that does not say what would clear it', () => {
    expect(() =>
      buildVerificationFinding({
        kind: 'value-mismatch',
        claimId: 'claim-1',
        detail: 'wrong',
        blocking: true,
        severity: 'critical',
      }),
    ).toThrow(/what would clear it/)
  })

  const challengeReview = (challenges: Challenge[]): DevilsAdvocateReview => ({
    scope: 'case',
    caseId: 'case-1',
    reviewId: 'rev-da-1',
    sequence: 1,
    byEmployeeId: 'da',
    byDepartmentId: 'devils-advocate',
    at: '2026-07-27T10:05:00.000Z',
    challenges,
    outcomes: {},
  })

  const challenge = (over: Partial<Challenge> = {}) =>
    buildChallenge({
      id: 'ch-1',
      contests: 'claim-1',
      kind: 'contradicting-evidence',
      argument: 'The order book says otherwise.',
      counterEvidence: [{ setId: 's', observationId: 'o2', contentHash: 'h2' }],
      materiality: 'material',
      ...over,
    })

  it('blocks while a material challenge is unresolved', () => {
    const result = evaluateGate({
      challengeBlocksAtOrAbove: 'material',
      ...riskSettled,
      verification: verification(),
      devilsAdvocate: challengeReview([challenge()]),
    })
    expect(result.passed).toBe(false)
    expect(result.blockers[0]).toMatchObject({
      kind: 'unresolved-material-challenge',
      challengeId: 'ch-1',
      contests: 'claim-1',
      materiality: 'material',
    })
  })

  it('does not block on a non-material challenge, and keeps it visible', () => {
    const review = challengeReview([challenge({ materiality: 'non-material' })])
    const result = evaluateGate({
      challengeBlocksAtOrAbove: 'material',
      ...riskSettled,
      verification: verification(),
      devilsAdvocate: review,
    })
    expect(result.passed).toBe(true)
    // Not a blocker, and not gone: the CIO reads it beside the thesis.
    expect(unresolvedChallenges(review)).toHaveLength(1)
    expect(blockingChallenges(review, 'material')).toEqual([])
  })

  it('blocks on a decision-critical challenge', () => {
    const result = evaluateGate({
      challengeBlocksAtOrAbove: 'material',
      ...riskSettled,
      verification: verification(),
      devilsAdvocate: challengeReview([challenge({ materiality: 'decision-critical' })]),
    })
    expect(result.passed).toBe(false)
  })

  it('applies a lower threshold to a challenge than to an aggregation disagreement', () => {
    /*
     * The asymmetry, asserted rather than described. A formal objection from
     * the desk whose mandate is to attack the argument blocks at `material`; a
     * manager noting that two desks disagreed blocks only at
     * `decision-critical`.
     */
    expect(challengeBlocks('material', 'material')).toBe(true)
    expect(disagreementBlocksEligibility('material', 'decision-critical')).toBe(false)
    expect(challengeBlocks('decision-critical', 'material')).toBe(true)
    expect(disagreementBlocksEligibility('decision-critical', 'decision-critical')).toBe(
      true,
    )
    expect(challengeBlocks('non-material', 'material')).toBe(false)
    expect(disagreementBlocksEligibility('non-material', 'decision-critical')).toBe(false)
  })

  it('answers exactly as it did before the threshold became a parameter', () => {
    /*
     * `challengeBlocks` used to hardcode `!== 'non-material'`. Making the
     * threshold an input must not move the firm's line -- this stage exists to
     * stop a threshold being changed silently, and would be self-defeating if
     * it changed one on the way.
     *
     * Under policy v1's `challengeBlocksAtOrAbove: 'material'`, every value
     * gives the answer the constant gave.
     */
    const v1 = eligibilityPolicy('1').challengeBlocksAtOrAbove
    expect(v1).toBe('material')
    for (const materiality of DISAGREEMENT_MATERIALITIES) {
      expect(challengeBlocks(materiality, v1)).toBe(materiality !== 'non-material')
    }
  })

  it('reads the threshold rather than agreeing with it by coincidence', () => {
    // A stricter policy blocks what v1 lets through; a looser one does not.
    expect(challengeBlocks('non-material', 'non-material')).toBe(true)
    expect(challengeBlocks('material', 'decision-critical')).toBe(false)
  })

  it('reports every blocker at once, so one pass fixes them all', () => {
    const result = evaluateGate({
      challengeBlocksAtOrAbove: 'material',
      ...riskSettled,
      verification: verification({ status: 'unresolved-discrepancy' }),
      compliance: {
        scope: 'case',
        caseId: 'case-1',
        reviewId: 'rev-compliance-1',
        sequence: 1,
        byEmployeeId: 'c',
        byDepartmentId: 'compliance',
        at: '2026-07-27T10:10:00.000Z',
        status: 'rejected',
        findings: [],
      },
    })
    expect(kinds(result)).toEqual([
      'verification-correction-required',
      'compliance-block',
    ])
  })

  it('refuses an objection with nothing behind it', () => {
    expect(() =>
      buildChallenge({
        id: 'ch-2',
        contests: 'claim-1',
        kind: 'contradicting-evidence',
        argument: 'I disagree.',
        counterEvidence: [],
        materiality: 'material',
      }),
    ).toThrow(/argues from evidence/)
  })

  it('allows an assumption challenge without counter-evidence, if it says what would settle it', () => {
    // Naming a fragile assumption is legitimate without a counter-observation.
    expect(() =>
      buildChallenge({
        id: 'ch-3',
        contests: 'claim-1',
        kind: 'fragile-assumption',
        argument: 'The terminal growth rate assumes no competitive entry.',
        counterEvidence: [],
        materiality: 'material',
        wouldBeResolvedBy: 'Entry barriers evidenced from the last two cycles.',
      }),
    ).not.toThrow()
  })

  it('refuses an assumption challenge that nothing could settle', () => {
    expect(() =>
      buildChallenge({
        id: 'ch-4',
        contests: 'claim-1',
        kind: 'overconfidence',
        argument: 'This feels too certain.',
        counterEvidence: [],
        materiality: 'material',
      }),
    ).toThrow(/nothing could settle/)
  })
})

describe('the conditional Risk gate', () => {
  const verified = (): VerificationReview => ({
    scope: 'case',
    caseId: 'case-1',
    reviewId: 'rev-v',
    sequence: 1,
    byEmployeeId: 'fact-head',
    byDepartmentId: 'verification',
    at: '2026-07-27T10:00:00.000Z',
    status: 'verified',
    findings: [],
    claimsReviewed: [],
  })

  const risk = (status: RiskStatus): RiskReview => ({
    scope: 'case',
    caseId: 'case-1',
    reviewId: 'rev-risk',
    sequence: 1,
    byEmployeeId: 'risk-head',
    byDepartmentId: 'risk',
    at: '2026-07-27T11:00:00.000Z',
    status,
    findings:
      status === 'rejected'
        ? [{ kind: 'tail-risk', detail: 'unhedged', severity: 'critical' }]
        : [],
    ...(status === 'accepted-with-limits' ? { limits: ['2% of NAV'] } : {}),
  })

  const kinds = (result: { blockers: readonly { kind: string }[] }) =>
    result.blockers.map((b) => b.kind)

  it('treats an unresolved requirement as unsatisfied', () => {
    expect(
      kinds(
        evaluateGate({
          challengeBlocksAtOrAbove: 'material',
          verification: verified(),
          riskRequirement: 'unresolved',
        }),
      ),
    ).toEqual(['risk-requirement-unresolved'])
  })

  it('defaults to unresolved when nothing supplies the requirement', () => {
    // The safe direction: forgetting to supply it must be visible, not silent.
    expect(
      kinds(
        evaluateGate({ challengeBlocksAtOrAbove: 'material', verification: verified() }),
      ),
    ).toEqual(['risk-requirement-unresolved'])
  })

  it('lets no Risk approval satisfy a gate whose requirement was never resolved', () => {
    /*
     * The load-bearing one. An approval of a review nobody established was
     * needed is not evidence that the question was asked.
     */
    const result = evaluateGate({
      challengeBlocksAtOrAbove: 'material',
      verification: verified(),
      riskRequirement: 'unresolved',
      risk: risk('accepted'),
    })
    expect(result.passed).toBe(false)
    expect(kinds(result)).toContain('risk-requirement-unresolved')
  })

  it('satisfies the gate with an explicit not-required and no review', () => {
    const result = evaluateGate({
      challengeBlocksAtOrAbove: 'material',
      verification: verified(),
      riskRequirement: 'not-required',
    })
    expect(result.passed).toBe(true)
    expect(result.blockers).toEqual([])
  })

  it('blocks a Risk verdict against a revision recorded as not needing one', () => {
    // Otherwise the Risk desk establishes its own mandate.
    expect(
      kinds(
        evaluateGate({
          challengeBlocksAtOrAbove: 'material',
          verification: verified(),
          riskRequirement: 'not-required',
          risk: risk('accepted'),
        }),
      ),
    ).toEqual(['risk-review-not-expected'])
  })

  it('blocks when required and missing', () => {
    expect(
      kinds(
        evaluateGate({
          challengeBlocksAtOrAbove: 'material',
          verification: verified(),
          riskRequirement: 'required',
        }),
      ),
    ).toEqual(['risk-review-missing'])
  })

  it('blocks when required and rejected', () => {
    expect(
      kinds(
        evaluateGate({
          challengeBlocksAtOrAbove: 'material',
          verification: verified(),
          riskRequirement: 'required',
          risk: risk('rejected'),
        }),
      ),
    ).toEqual(['risk-review-rejected'])
  })

  it('passes when required and accepted, with or without limits', () => {
    for (const status of ['accepted', 'accepted-with-limits'] as const) {
      expect(
        evaluateGate({
          challengeBlocksAtOrAbove: 'material',
          verification: verified(),
          riskRequirement: 'required',
          risk: risk(status),
        }).passed,
      ).toBe(true)
    }
  })

  it('refuses a limited acceptance that states no limits', () => {
    expect(() =>
      buildRiskVerdict({ status: 'accepted-with-limits', findings: [], limits: [] }),
    ).toThrow(/state.* no limits/)
  })

  it('refuses a rejection that records no finding', () => {
    expect(() => buildRiskVerdict({ status: 'rejected', findings: [] })).toThrow(
      /records no finding/,
    )
  })
})

/* -------------------------------------------------------------- run records */

describe('run records and the activity feed', () => {
  const run = buildRunRecord({
    id: 'run-1',
    caseId: 'case-1',
    assignmentId: 'a1',
    departmentId: 'macro',
    employeeId: 'macro-analyst',
    agentContractVersion: '1.0.0',
    outputSchemaVersion: '1.0.0',
    usage: { state: 'not-applicable' },
    budget: NON_CONSUMING_BUDGET,
    evidenceSetId: 'set-1',
    state: 'completed',
    startedAt: '2026-07-27T09:00:00.000Z',
    completedAt: '2026-07-27T09:02:00.000Z',
    execution: {
      playbookId: 'macro-regime',
      playbookVersion: '1',
      playbookEntryKey: 'macro-analysis',
      providerId: 'recorded-macro',
      providerVersion: '1',
      providerKind: 'recorded',
      identity: {
        kind: 'model',
        prompt: { id: 'p', version: '1', contentHash: 'ph' },
        model: {
          id: 'm',
          provider: 'anthropic',
          parameters: {},
          parametersHash: 'mh',
        },
      },
    },
    missingOptionalInputs: [],
    events: [{ runId: 'run-1', at: '2026-07-27T09:00:00.000Z', state: 'running' }],
    claims: [],
  })

  it('keys a cache on every input that can change the output', () => {
    const key = runCacheKey({ ...run, identity: run.execution.identity })
    expect(key).toContain('set-1')
    expect(key).toContain('ph')
    expect(key).toContain('mh')
    // A different model configuration must not hit the same entry.
    const other = runCacheKey({
      ...run,
      identity: {
        kind: 'model',
        prompt: { id: 'macro', version: '3', contentHash: 'ph' },
        model: { id: 'm', provider: 'p', parameters: {}, parametersHash: 'different' },
      },
    })
    expect(other).not.toBe(key)
  })

  it('refuses a failed run with no reason', () => {
    expect(() => buildRunRecord({ ...run, state: 'failed', failure: undefined })).toThrow(
      /without a failure record/,
    )
  })

  describe('the execution budget', () => {
    const liveRun = (budget: ExecutionBudget) =>
      buildRunRecord({
        ...run,
        budget,
        // A live call always consumed something; the question is whether
        // anyone measured it.
        usage: { state: 'not-reported' },
        execution: { ...run.execution, providerKind: 'live' },
      })

    const bounded: ExecutionBudget = {
      tokens: { kind: 'limit', tokens: 40_000 },
      cost: { kind: 'limit', costMinorUnits: 5_000, currency: 'USD' },
      deadline: { kind: 'limit', deadlineMs: 30_000 },
    }

    it('refuses a live run against a dimension nobody decided', () => {
      /*
       * The record is the thing that must not exist: a stored live run whose
       * authorization was never decided says the firm approved spend it never
       * approved. `StartAgentRun` refuses the same combination, so a caller
       * bypassing the command still cannot write one.
       */
      expect(() => liveRun({ ...bounded, cost: { kind: 'not-measured' } })).toThrow(
        /no decided budget for cost/,
      )
    })

    it('permits a live run whose dimensions are all bounded', () => {
      // The near-miss. Without this, the rule above would also pass if
      // `buildRunRecord` refused every live run.
      expect(liveRun(bounded).budget).toEqual(bounded)
    })

    it('permits an unmeasured dimension on a producer that cannot spend', () => {
      // A stub authorizes no spend, so an unmeasured dimension on one blocks
      // no fact. Refusing it would be refusing a fact rather than a policy.
      expect(buildRunRecord({ ...run, budget: NON_CONSUMING_BUDGET }).budget).toEqual(
        NON_CONSUMING_BUDGET,
      )
    })

    it('refuses a cost limit with no currency, because that is not a cost', () => {
      expect(() =>
        liveRun({
          ...bounded,
          cost: { kind: 'limit', costMinorUnits: 10, currency: '' },
        }),
      ).toThrow(/no currency/)
    })

    describe('overruns', () => {
      it('names the dimensions the reported spend exceeded', () => {
        expect(
          budgetOverruns(bounded, {
            state: 'measured',
            inputTokens: 30_000,
            outputTokens: 20_000,
            cost: { state: 'measured', costMinorUnits: 9_000, currency: 'USD' },
          }),
        ).toEqual(['tokens', 'cost'])
      })

      it('counts input and output tokens together against one limit', () => {
        // Neither half exceeds 40,000 alone. The limit is on what the run
        // spent, not on either side of the exchange.
        expect(
          budgetOverruns(bounded, {
            state: 'measured',
            inputTokens: 25_000,
            outputTokens: 20_000,
            cost: { state: 'measured', costMinorUnits: 100, currency: 'USD' },
          }),
        ).toEqual(['tokens'])
      })

      it('reports nothing when spend is inside every limit', () => {
        expect(
          budgetOverruns(bounded, {
            state: 'measured',
            inputTokens: 10,
            outputTokens: 10,
            cost: { state: 'measured', costMinorUnits: 10, currency: 'USD' },
          }),
        ).toEqual([])
      })

      it('does not treat an unreported cost as an overrun', () => {
        /*
         * A provider that said nothing cannot be shown to have exceeded
         * anything. Treating silence as an overrun would fail runs for the
         * provider's reticence rather than for their spend — what it actually
         * costs the firm is visibility, which `not-reported` records.
         */
        expect(budgetOverruns(bounded, { state: 'not-reported' })).toEqual([])
      })

      it('does not compare amounts across currencies', () => {
        // 9,000 öre is not 9,000 cents. Comparing the numbers would enforce a
        // limit nobody set.
        expect(
          budgetOverruns(bounded, {
            state: 'measured',
            inputTokens: 1,
            outputTokens: 1,
            cost: { state: 'measured', costMinorUnits: 9_000, currency: 'SEK' },
          }),
        ).toEqual([])
      })
    })
  })

  it('builds the activity feed only from recorded state changes', () => {
    const activity = projectActivity(
      [run],
      [
        {
          at: '2026-07-27T09:05:00.000Z',
          byDepartmentId: 'verification',
          caseId: 'case-1',
          from: 'aggregation',
          to: 'review',
        },
      ],
    )
    expect(activity).toHaveLength(2)
    // Newest first, and every line traceable to a run event or a transition.
    expect(activity[0]?.subject).toBe('case')
    // Structured only — the domain stores states, never prose.
    expect(activity[1]).toMatchObject({ subject: 'run', toState: 'running' })
    expect(JSON.stringify(activity)).not.toMatch(/studying|reading/i)
  })

  it('shows nothing when nothing has happened', () => {
    // The floor cannot look busy without work having occurred.
    expect(projectActivity([], [])).toEqual([])
  })
})

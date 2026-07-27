/**
 * Revision-scoped review storage, in the reference adapter.
 *
 * The store's job here is narrow but unforgiving: a retried submission must
 * collapse onto the review it is a retry OF, and must never collapse onto a
 * verdict about a different revision. Getting that wrong in the direction of
 * over-matching silently discards a real review; the case then shows a
 * governance record that belongs to an argument nobody re-examined.
 *
 * `reviews_natural_key_unique` in migration 0011 mirrors `reviewIdentity`, so
 * these expectations are the ones PostgreSQL must reproduce.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import type { ComplianceReview, RiskReview, VerificationReview } from '~/domain/analysis'
import { createInMemoryRepositories } from './inMemoryRepositories'

const AT = '2026-07-28T10:00:00.000Z'
const CASE = 'case-1'

const verification = (
  target: { thesisId: string; revisionId: string } | 'case',
  over: Partial<VerificationReview> = {},
): VerificationReview =>
  ({
    ...(target === 'case'
      ? { scope: 'case', caseId: CASE }
      : { scope: 'thesis-revision', caseId: CASE, ...target }),
    byEmployeeId: 'verification-head',
    byDepartmentId: 'verification',
    at: AT,
    status: 'verified',
    findings: [],
    claimsReviewed: ['claim-1'],
    ...over,
  }) as VerificationReview

const rev1 = { thesisId: 'th-buy', revisionId: 'buy-r1' }
const rev2 = { thesisId: 'th-buy', revisionId: 'buy-r2' }

let repos: AnalysisRepositories
beforeEach(() => {
  repos = createInMemoryRepositories()
})

describe('a replayed review submission', () => {
  it('is stored once', async () => {
    await repos.reviews.saveVerification(verification(rev1))
    await repos.reviews.saveVerification(verification(rev1))

    expect(await repos.reviews.verificationsForCase(CASE)).toHaveLength(1)
  })

  it('does not collapse onto a verdict about another revision', async () => {
    // The failure that would matter: the verifier reviews revision 2, and the
    // store discards it because revision 1 already has a verdict from the same
    // reviewer at the same instant.
    await repos.reviews.saveVerification(verification(rev1))
    await repos.reviews.saveVerification(verification(rev2))

    const stored = await repos.reviews.verificationsForCase(CASE)
    expect(stored).toHaveLength(2)
    expect(
      stored.map((r) => (r.scope === 'thesis-revision' ? r.revisionId : 'case')),
    ).toEqual(['buy-r1', 'buy-r2'])
  })

  it('does not collapse a case-wide review onto a revision-scoped one', async () => {
    await repos.reviews.saveVerification(verification('case'))
    await repos.reviews.saveVerification(verification(rev1))

    expect(await repos.reviews.verificationsForCase(CASE)).toHaveLength(2)
  })

  it('does not collapse two departments reviewing the same revision', async () => {
    await repos.reviews.saveVerification(verification(rev1))
    await repos.reviews.saveVerification(
      verification(rev1, { byDepartmentId: 'risk', byEmployeeId: 'chief-risk-officer' }),
    )

    expect(await repos.reviews.verificationsForCase(CASE)).toHaveLength(2)
  })

  it('keeps the original when a retry differs only in its verdict', async () => {
    /*
     * Same scope, same reviewer, same instant — a retry, not a changed mind. A
     * changed mind carries a later `at` and is a separate review, which is how
     * the record shows that the verdict moved.
     */
    await repos.reviews.saveVerification(verification(rev1, { status: 'verified' }))
    await repos.reviews.saveVerification(
      verification(rev1, { status: 'correction-required' }),
    )

    const stored = await repos.reviews.verificationsForCase(CASE)
    expect(stored).toHaveLength(1)
    expect(stored[0]!.status).toBe('verified')
  })

  it('records a genuine re-review as a second review', async () => {
    await repos.reviews.saveVerification(verification(rev1))
    await repos.reviews.saveVerification(
      verification(rev1, {
        at: '2026-07-28T14:00:00.000Z',
        status: 'correction-required',
      }),
    )

    expect(await repos.reviews.verificationsForCase(CASE)).toHaveLength(2)
  })
})

describe('ordering is deterministic across scopes', () => {
  it('breaks a tie on revision, and places case-wide reviews first', async () => {
    // Two verdicts at the same instant by the same reviewer differ only in
    // scope. Without the revision tie-break, their order would be whichever
    // arrived first in memory and whatever the planner returned in PostgreSQL.
    await repos.reviews.saveVerification(verification(rev2))
    await repos.reviews.saveVerification(verification(rev1))
    await repos.reviews.saveVerification(verification('case'))

    const stored = await repos.reviews.verificationsForCase(CASE)
    expect(
      stored.map((r) => (r.scope === 'thesis-revision' ? r.revisionId : '(case)')),
    ).toEqual(['(case)', 'buy-r1', 'buy-r2'])
  })

  it('is independent of insertion order', async () => {
    const forward = createInMemoryRepositories()
    await forward.reviews.saveVerification(verification(rev1))
    await forward.reviews.saveVerification(verification(rev2))

    const backward = createInMemoryRepositories()
    await backward.reviews.saveVerification(verification(rev2))
    await backward.reviews.saveVerification(verification(rev1))

    expect(await forward.reviews.verificationsForCase(CASE)).toEqual(
      await backward.reviews.verificationsForCase(CASE),
    )
  })
})

describe('all four control functions carry a scope', () => {
  it('stores a case-wide compliance review and a revision-scoped risk review', async () => {
    const compliance: ComplianceReview = {
      scope: 'case',
      caseId: CASE,
      byEmployeeId: 'compliance-head',
      byDepartmentId: 'compliance',
      at: AT,
      status: 'approved',
      findings: [],
    }
    const risk: RiskReview = {
      scope: 'thesis-revision',
      caseId: CASE,
      ...rev1,
      byEmployeeId: 'chief-risk-officer',
      byDepartmentId: 'risk',
      at: AT,
      status: 'accepted',
      concerns: [],
    }

    await repos.reviews.saveCompliance(compliance)
    await repos.reviews.saveRisk(risk)

    expect((await repos.reviews.complianceForCase(CASE))[0]!.scope).toBe('case')
    expect((await repos.reviews.riskForCase(CASE))[0]!.scope).toBe('thesis-revision')
  })
})

describe('a review written inside a transaction', () => {
  it('is rolled back with everything else', async () => {
    await expect(
      repos.withTransaction(async (tx) => {
        await tx.reviews.saveVerification(verification(rev1))
        throw new Error('the gate rejected the case')
      }),
    ).rejects.toThrow()

    expect(await repos.reviews.verificationsForCase(CASE)).toEqual([])
  })

  it('cannot be retargeted afterwards, because it is sealed', async () => {
    // Deep sealing plus the domain's discriminated union: a stored review's
    // scope cannot be edited in place, matching the PostgreSQL trigger.
    const review = verification(rev1)
    await repos.reviews.saveVerification(review)

    expect(() => {
      ;(review as { revisionId: string }).revisionId = 'buy-r2'
    }).toThrow(TypeError)
  })
})

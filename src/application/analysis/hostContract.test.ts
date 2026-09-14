/**
 * The semantic boundaries of the host contract, proved against records the
 * institution actually produced.
 *
 * The five `caseOverview.*` fixtures were generated from cases driven through
 * the whole workflow against PostgreSQL. What is checked here is not that the
 * derivation returns *something* but that each product state means what the
 * ruling says it means — and that the states it must never return, it does
 * not. Above all: the firm having work, the firm being unable to proceed, and
 * the firm needing the person are three different states.
 */

import { describe, expect, it } from 'vitest'
import { dissentRequiresAcknowledgement, type Blocker } from '~/domain/analysis'
import type { CaseOverview } from './caseOverview'
import {
  activityFor,
  committeeConclusionReady,
  inspectionFor,
  institutionalAnswerFor,
  productStateFor,
} from './hostGateway'
import { parseHostRequest } from './hostContract'
import decided from '~/test/fixtures/caseOverview.decided.json'
import awaiting from '~/test/fixtures/caseOverview.awaiting.json'
import inflight from '~/test/fixtures/caseOverview.inflight.json'
import noRisk from '~/test/fixtures/caseOverview.noRisk.json'
import reconsidered from '~/test/fixtures/caseOverview.reconsidered.json'

const overview = (fixture: unknown) => fixture as unknown as CaseOverview

/*
 * The fixtures' runs started at 2026-08-01T09:00:00Z under a 30 s deadline.
 * "Now" for the suite is inside that window, so a run grafted as `running`
 * is one still inside its execution window — and a later clock is what a
 * dead process looks like.
 */
const NOW = '2026-08-01T09:00:10.000Z'
const LATER = '2026-08-01T09:01:00.000Z'

/** A run inside its execution window, grafted onto a fixture's first run. */
const withRunning = (fixture: CaseOverview): CaseOverview => ({
  ...fixture,
  runs: [{ ...fixture.runs[0]!, id: 'run-live', state: 'running' }, ...fixture.runs],
})

/**
 * The committee's conclusion, ready and not yet put to the CIO.
 *
 * No dev case is in this state yet — every governed case in the firm was
 * submitted to the CIO as soon as governance cleared it — so it is built
 * from the `awaiting` record with the submission removed: same synthesis,
 * same verdicts, same absence of blockers, one step earlier in the process.
 */
const committeeReady = (): CaseOverview => {
  const base = overview(awaiting)
  return {
    ...base,
    submissions: [],
    standing: {
      ...base.standing,
      stage: 'review',
      settled: false,
      steps: base.standing.steps.map((step) =>
        step.step === 'cio-submission' ? { ...step, status: 'outstanding' } : step,
      ),
      nextAct: { act: 'submit-for-cio-decision', owningDepartmentId: 'research-office' },
    },
  }
}

const ALL = [decided, awaiting, inflight, noRisk, reconsidered]

/* ---------------------------------------------------------- working */

describe('working means a run is inside its execution window', () => {
  it('is never returned for a case with nothing running', () => {
    for (const fixture of ALL) {
      expect(productStateFor(overview(fixture), NOW).state).not.toBe('working')
    }
  })

  it('is returned when a run is in its window, whatever else the case owes', () => {
    expect(productStateFor(withRunning(overview(inflight)), NOW).state).toBe('working')
    expect(productStateFor(withRunning(overview(awaiting)), NOW).state).toBe('working')
  })

  it('is never returned for a running row the clock has passed', () => {
    /*
     * The orphan. Measured on the dev firm: a run left `running` by a process
     * that died a week earlier. Its own recorded deadline is what says it is
     * outside any execution window — and it is the firm's to recover, not the
     * person's to decide.
     */
    const stale = withRunning(overview(inflight))
    expect(productStateFor(stale, LATER)).toMatchObject({
      state: 'blocked',
      block: { reason: 'execution-recovery-required' },
    })
    expect(activityFor(stale, LATER).inFlight).toBe(0)
    expect(activityFor(stale, LATER).expired).toBe(1)
    /* And the same row, inside its window, is work. */
    expect(productStateFor(stale, NOW).state).toBe('working')
  })

  it('is never returned for a running row with no measured deadline', () => {
    const base = withRunning(overview(inflight))
    const unbounded: CaseOverview = {
      ...base,
      runs: base.runs.map((run) =>
        run.id === 'run-live'
          ? { ...run, budget: { ...run.budget, deadline: { kind: 'not-measured' } } }
          : run,
      ),
    }
    expect(productStateFor(unbounded, NOW).state).toBe('blocked')
    expect(activityFor(unbounded, NOW).expired).toBe(1)
  })
})

/* ----------------------------------------------------------- blocked */

describe('blocked means the firm cannot proceed, and it is not the person’s decision', () => {
  it('reports produced work awaiting its desk as blocked on adoption', () => {
    /*
     * A run that finished and awaits adoption is not executing, and nothing
     * continues it on its own. The person is not asked whether a desk should
     * accept its own work.
     */
    const base = overview(inflight)
    const held: CaseOverview = {
      ...base,
      runs: [
        { ...base.runs[0]!, id: 'run-held', state: 'awaiting-acceptance' },
        ...base.runs,
      ],
    }
    expect(productStateFor(held, NOW)).toMatchObject({
      state: 'blocked',
      block: { reason: 'adoption-required', owner: { id: base.runs[0]!.departmentId } },
    })
    expect(activityFor(held, NOW).awaitingAdoption).toBe(1)
  })

  it('reports outstanding Verification, Devil’s Advocate and peer work as blocked, never as a decision', () => {
    expect(productStateFor(overview(inflight), NOW)).toEqual({
      state: 'blocked',
      block: {
        reason: 'verification-required',
        owner: { id: 'verification', name: expect.any(String), isGovernance: true },
      },
    })
    expect(productStateFor(overview(noRisk), NOW)).toEqual({
      state: 'blocked',
      block: {
        reason: 'challenge-required',
        owner: { id: 'devils-advocate', name: expect.any(String), isGovernance: true },
      },
    })
    const peer = overview(inflight)
    const peerOwed: CaseOverview = {
      ...peer,
      standing: {
        ...peer.standing,
        nextAct: { act: 'record-peer-examination', owningDepartmentId: null },
      },
    }
    expect(productStateFor(peerOwed, NOW)).toEqual({
      state: 'blocked',
      block: { reason: 'peer-scrutiny-required', owner: null },
    })
  })

  it('names the desk only from the governance table, never from array order', () => {
    /*
     * TD-91: the standing names `participatingDepartmentIds[0]` for the
     * analytical acts, which is whichever desk sorts first. Those owners are
     * not repeated to a host.
     */
    const base = overview(inflight)
    for (const act of ['aggregate-conclusion', 'submit-for-verification'] as const) {
      const state = productStateFor(
        {
          ...base,
          standing: {
            ...base.standing,
            nextAct: { act, owningDepartmentId: 'devils-advocate' },
          },
        },
        NOW,
      )
      expect(state).toMatchObject({ state: 'blocked', block: { owner: null } })
    }
  })

  it('reports a synthesis with a blocking objection as blocked, not as an answer', () => {
    const ready = committeeReady()
    const blocker: Blocker = {
      kind: 'unresolved-material-challenge',
      severity: 'blocks-decision',
      owningDepartmentId: 'devils-advocate',
      reviewId: 'rev-x',
      challengeId: 'ch-x',
      contests: 'claim-x',
      materiality: 'material',
    }
    const contested: CaseOverview = {
      ...ready,
      standing: { ...ready.standing, blockers: [blocker] },
    }
    expect(committeeConclusionReady(contested)).toBe(false)
    expect(productStateFor(contested, NOW)).toMatchObject({
      state: 'blocked',
      block: { reason: 'objections-unresolved', owner: { id: 'devils-advocate' } },
    })
    expect(institutionalAnswerFor(contested)).toBeNull()
  })
})

/* ------------------------------------------------------ answer-ready */

describe('answer-ready says what kind of authority it carries', () => {
  it('is a CIO decision for the decided and the reconsidered case', () => {
    expect(productStateFor(overview(decided), NOW)).toEqual({
      state: 'answer-ready',
      kind: 'cio-decision',
    })
    expect(productStateFor(overview(reconsidered), NOW)).toEqual({
      state: 'answer-ready',
      kind: 'cio-decision',
    })
  })

  it('is the committee’s conclusion once every gate is settled and nothing blocks', () => {
    const ready = committeeReady()
    expect(committeeConclusionReady(ready)).toBe(true)
    expect(productStateFor(ready, NOW)).toEqual({
      state: 'answer-ready',
      kind: 'committee-conclusion',
    })
  })

  it('never promotes a committee conclusion into a CIO decision', () => {
    const answer = institutionalAnswerFor(committeeReady())
    expect(answer?.kind).toBe('committee-conclusion')
    expect(answer).not.toHaveProperty('decision')
  })

  it('is not returned for a synthesis merely because prose exists', () => {
    /*
     * `noRisk` and `inflight` both hold a synthesised revision with a
     * statement. Neither has cleared its gates. Neither is an answer.
     */
    for (const fixture of [noRisk, inflight]) {
      expect(committeeConclusionReady(overview(fixture))).toBe(false)
      expect(productStateFor(overview(fixture), NOW).state).not.toBe('answer-ready')
      expect(institutionalAnswerFor(overview(fixture))).toBeNull()
    }
    /* A revision that was proposed and never synthesised is not a conclusion either. */
    const ready = committeeReady()
    const proposedOnly: CaseOverview = {
      ...ready,
      revisions: ready.revisions.map((revision) => ({
        ...revision,
        aggregationId: undefined,
      })),
    }
    expect(committeeConclusionReady(proposedOnly)).toBe(false)
  })

  it('is not returned for a decision that still stands on a reopened case', () => {
    /*
     * A deferral reopened: the deferral is the live decision until the CIO
     * decides again, and the case is back in the decision stage. That is the
     * CIO's queue, not an answer.
     */
    const base = overview(decided)
    const reopened: CaseOverview = {
      ...base,
      standing: {
        ...base.standing,
        stage: 'decision',
        settled: false,
        nextAct: { act: 'decide-or-return', owningDepartmentId: null },
      },
    }
    expect(productStateFor(reopened, NOW)).toEqual({
      state: 'needs-decision',
      decision: { reason: 'cio-decision-required' },
    })
  })
})

/* ----------------------------------------------------- needs-decision */

describe('needs-decision is the person’s, and nobody else’s', () => {
  it('surfaces TD-88 as institutional-initialization-required, never as working', () => {
    const base = overview(inflight)
    const fresh: CaseOverview = {
      ...base,
      revisions: [],
      runs: [],
      decision: null,
      standing: {
        ...base.standing,
        stage: 'research',
        settled: false,
        nextAct: { act: 'propose-thesis', owningDepartmentId: 'global-macro' },
      },
    }
    expect(productStateFor(fresh, NOW)).toEqual({
      state: 'needs-decision',
      decision: { reason: 'institutional-initialization-required' },
    })
  })

  it('is the CIO’s decision while the case is actually with the CIO', () => {
    expect(productStateFor(overview(awaiting), NOW)).toEqual({
      state: 'needs-decision',
      decision: { reason: 'cio-decision-required' },
    })
  })

  it('is never returned for anything a desk or a control function owes', () => {
    for (const fixture of [inflight, noRisk]) {
      expect(productStateFor(overview(fixture), NOW).state).not.toBe('needs-decision')
    }
  })

  it('is never returned for an orphaned run, even on a case that also awaits the person', () => {
    /* The person is not asked to repair infrastructure first. */
    const base = withRunning(overview(inflight))
    const orphanedAndFresh: CaseOverview = {
      ...base,
      standing: {
        ...base.standing,
        nextAct: { act: 'propose-thesis', owningDepartmentId: 'global-macro' },
      },
    }
    expect(productStateFor(orphanedAndFresh, LATER).state).toBe('blocked')
  })
})

/* ------------------------------------------------------------ result */

describe('the answer is the record, read and not written', () => {
  it('carries every field of a CIO decision from the persisted record', () => {
    const base = overview(decided)
    const answer = institutionalAnswerFor(base)
    if (answer?.kind !== 'cio-decision') throw new Error('expected a CIO decision')
    expect(answer.decision.decisionId).toBe(base.decision!.decisionId)
    expect(answer.decision.rationale).toBe(base.decision!.rationale)
    expect(answer.decision.outcome).toBe(base.decision!.outcome.kind)
    expect(answer.dissent).toHaveLength(base.decision!.unresolvedDissent.length)
    expect(answer.reconsiderationTriggers).toHaveLength(
      base.decision!.reconsiderationTriggers.length,
    )
    if (base.decision!.outcome.kind === 'selected') {
      const selected = base.revisions.find(
        (revision) => revision.revisionId === base.decision!.outcome.selectedRevisionId,
      )!
      expect(answer.thesis?.statement).toBe(selected.statement)
      expect(answer.thesis?.invalidationCriteria).toBe(selected.invalidationCriteria)
    }
  })

  it('carries the committee’s conclusion from the current revision and its verdicts', () => {
    const ready = committeeReady()
    const answer = institutionalAnswerFor(ready)
    if (answer?.kind !== 'committee-conclusion') throw new Error('expected a conclusion')
    const current = ready.revisions[ready.revisions.length - 1]!
    expect(answer.thesis.revisionId).toBe(current.revisionId)
    expect(answer.thesis.statement).toBe(current.statement)
    expect(answer.thesis.invalidationCriteria).toBe(current.invalidationCriteria)
    expect(answer.scrutiny.verification).toBe('verified')
    expect(answer.scrutiny.risk).toBe('accepted')
    expect(answer.scrutiny.devilsAdvocateReviews).toBeGreaterThan(0)
    expect(answer.synthesisedBy?.id).toBe(
      ready.aggregations.find((a) => a.producedRevisionId === current.revisionId)!
        .departmentId,
    )
  })

  it('invents no sentence: every string in an answer exists in the record', () => {
    /*
     * The strongest form of "not a second AI answer": there is no string in
     * the result that the institution did not write down. A gateway that
     * summarised, softened or explained would fail this on its first word.
     */
    for (const base of [overview(decided), overview(reconsidered), committeeReady()]) {
      const record = JSON.stringify(base)
      const leaves: string[] = []
      const walk = (value: unknown) => {
        if (typeof value === 'string') leaves.push(value)
        else if (Array.isArray(value)) value.forEach(walk)
        else if (value && typeof value === 'object') Object.values(value).forEach(walk)
      }
      const answer = institutionalAnswerFor(base)
      expect(answer).not.toBeNull()
      /* The kind is the contract's word, not the record's. Everything else is the record's. */
      walk({ ...answer, kind: undefined })
      expect(leaves.length).toBeGreaterThan(5)
      for (const leaf of leaves) {
        expect(record, leaf).toContain(JSON.stringify(leaf).slice(1, -1))
      }
    }
  })

  it('does not strip material dissent from a CIO decision', () => {
    const base = overview(decided)
    const answer = institutionalAnswerFor(base)
    if (answer?.kind !== 'cio-decision') throw new Error('expected a CIO decision')
    const material = base.decision!.unresolvedDissent.filter((entry) =>
      dissentRequiresAcknowledgement(entry.materiality),
    )
    expect(answer.materialDissentCount).toBe(material.length)
    for (const entry of material) {
      expect(answer.dissent.map((d) => d.rationale)).toContain(entry.rationale)
    }
  })

  it('keeps open objections beside a committee conclusion', () => {
    const answer = institutionalAnswerFor(committeeReady())
    if (answer?.kind !== 'committee-conclusion') throw new Error('expected a conclusion')
    for (const objection of answer.dissent) {
      expect(objection.outcome).toBe('open')
      expect(objection.superseded).toBe(false)
    }
    expect(answer.materialDissentCount).toBe(
      answer.dissent.filter((o) => dissentRequiresAcknowledgement(o.materiality)).length,
    )
  })

  it('is null where the firm stands behind nothing yet', () => {
    expect(institutionalAnswerFor(overview(awaiting))).toBeNull()
    expect(institutionalAnswerFor(overview(inflight))).toBeNull()
  })
})

/* ------------------------------------------------------------- leaks */

describe('no command-shaped vocabulary crosses the contract', () => {
  it('names no institutional act code in any product state or activity', () => {
    const cases: CaseOverview[] = [
      ...ALL.map(overview),
      committeeReady(),
      withRunning(overview(inflight)),
    ]
    const actCodes =
      /propose-thesis|aggregate-conclusion|submit-for-|record-verification|record-peer|record-devils|record-risk|resolve-risk|decide-or-return|resubmit-after|none-settled|unblock/
    for (const base of cases) {
      for (const at of [NOW, LATER]) {
        const text = JSON.stringify({
          product: productStateFor(base, at),
          activity: activityFor(base, at),
        })
        expect(text, base.investmentCase.id).not.toMatch(actCodes)
      }
    }
  })
})

/* ----------------------------------------------------------- inspect */

describe('inspect returns the firm’s own projections', () => {
  it('shows the debate as the Boardroom shows it', () => {
    const inspection = inspectionFor(overview(decided), { kind: 'debate' })
    expect(inspection?.view).toBe('debate')
    if (inspection?.view !== 'debate') throw new Error('expected debate')
    expect(inspection.entries.length).toBeGreaterThan(0)
    expect(inspection.seats.length).toBeGreaterThan(0)
  })

  it('answers "what did this desk say" with its own claims', () => {
    const base = overview(decided)
    const desk = base.runs[0]!.departmentId
    const inspection = inspectionFor(base, { kind: 'desk', departmentId: desk })
    if (inspection?.view !== 'desk') throw new Error('expected desk')
    expect(inspection.desk.id).toBe(desk)
    expect(inspection.participation).toBe('acted')
    for (const claim of inspection.claims) {
      expect(base.claims.map((c) => c.statement)).toContain(claim.statement)
    }
  })

  it('refuses a desk the organisation does not have', () => {
    expect(
      inspectionFor(overview(decided), { kind: 'desk', departmentId: 'ghost' }),
    ).toBeNull()
  })

  it('lists objections with who raised them and under what mandate', () => {
    const inspection = inspectionFor(overview(decided), { kind: 'objections' })
    if (inspection?.view !== 'objections') throw new Error('expected objections')
    for (const objection of inspection.objections) {
      expect(['peer-examination', 'devils-advocate']).toContain(objection.raisedAs)
      expect(objection.byDepartmentId).toBeTruthy()
    }
  })
})

/* ---------------------------------------------------------- activity */

describe('activity is what a host may repeat', () => {
  it('names engaged desks as the organisation does, and the steps still owed', () => {
    const activity = activityFor(overview(inflight), NOW)
    expect(activity.stage).toBe('review')
    expect(activity.desks.length).toBeGreaterThan(0)
    for (const desk of activity.desks) expect(desk.name).toBeTruthy()
    expect(activity.outstanding).toContain('verification')
  })
})

/* ------------------------------------------------------------ parsing */

describe('the request is parsed at the door', () => {
  const reference = {
    system: 'financial-os',
    kind: 'case',
    id: 'case-1',
    provenanceId: 'prov-1',
  }

  it('accepts each operation in its exact shape', () => {
    expect(
      parseHostRequest({ kind: 'ask', requestId: 'r', question: 'q', subject: 's' }).ok,
    ).toBe(true)
    for (const kind of ['resume', 'status', 'result']) {
      expect(parseHostRequest({ kind, reference }).ok).toBe(true)
    }
    expect(
      parseHostRequest({
        kind: 'inspect',
        reference,
        view: { kind: 'desk', departmentId: 'rates' },
      }).ok,
    ).toBe(true)
  })

  it('refuses an actor by any name', () => {
    /*
     * The one refusal that carries the doctrine: the browser does not choose
     * who acts. Each of these would be silently ignored by a permissive parser
     * and honoured by a naive one; both are refused by field name.
     */
    for (const field of [
      'actingEmployeeId',
      'actorId',
      'actor',
      'employeeId',
      'agentPrincipalId',
    ]) {
      expect(
        parseHostRequest({
          kind: 'ask',
          requestId: 'r',
          question: 'q',
          subject: 's',
          [field]: 'x',
        }),
      ).toEqual({ ok: false, field })
    }
  })

  it('refuses a playbook entry, a command or a candidate beside a read', () => {
    for (const field of ['entryKey', 'command', 'candidateFromRunId', 'initiator']) {
      expect(parseHostRequest({ kind: 'status', reference, [field]: 'x' })).toEqual({
        ok: false,
        field,
      })
    }
  })

  it('refuses an unknown operation and a malformed reference', () => {
    expect(parseHostRequest({ kind: 'advance', reference })).toEqual({
      ok: false,
      field: 'kind',
    })
    expect(parseHostRequest({ kind: 'status', reference: { id: 'case-1' } })).toEqual({
      ok: false,
      field: 'reference.system',
    })
    expect(
      parseHostRequest({ kind: 'status', reference: { ...reference, extra: 1 } }),
    ).toEqual({
      ok: false,
      field: 'reference.extra',
    })
    expect(parseHostRequest('status')).toEqual({ ok: false, field: 'request' })
  })

  it('refuses an empty question', () => {
    expect(
      parseHostRequest({ kind: 'ask', requestId: 'r', question: '  ', subject: 's' }),
    ).toEqual({ ok: false, field: 'question' })
  })
})

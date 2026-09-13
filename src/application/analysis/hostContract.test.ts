/**
 * The semantic boundaries of the host contract, proved against records the
 * institution actually produced.
 *
 * The five `caseOverview.*` fixtures were generated from cases driven through
 * the whole workflow against PostgreSQL. What is checked here is not that the
 * derivation returns *something* but that each product state means what the
 * ruling says it means — and that the states it must never return, it does
 * not.
 */

import { describe, expect, it } from 'vitest'
import { dissentRequiresAcknowledgement } from '~/domain/analysis'
import type { CaseOverview } from './caseOverview'
import {
  activityFor,
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
 * is one the firm can still verify — and a later clock is what a dead
 * process looks like.
 */
const NOW = '2026-08-01T09:00:10.000Z'
const LATER = '2026-08-01T09:01:00.000Z'

/** A run that is genuinely executing, grafted onto a fixture's first run. */
const withRunning = (fixture: CaseOverview): CaseOverview => ({
  ...fixture,
  runs: [{ ...fixture.runs[0]!, id: 'run-live', state: 'running' }, ...fixture.runs],
})

/* ---------------------------------------------------------- working */

describe('working means a run is genuinely in flight', () => {
  it('is never returned for a case with nothing running', () => {
    for (const fixture of [decided, awaiting, inflight, noRisk, reconsidered]) {
      expect(productStateFor(overview(fixture), NOW).state).not.toBe('working')
    }
  })

  it('is returned when a run is executing, whatever else the case owes', () => {
    expect(productStateFor(withRunning(overview(inflight)), NOW).state).toBe('working')
    expect(productStateFor(withRunning(overview(awaiting)), NOW).state).toBe('working')
  })

  it('is not returned for produced work awaiting its desk', () => {
    /*
     * A run that finished and awaits adoption is not executing. Nothing will
     * continue it on its own, so a host told `working` would be waiting for a
     * result that cannot arrive.
     */
    const base = overview(inflight)
    const held: CaseOverview = {
      ...base,
      runs: [
        { ...base.runs[0]!, id: 'run-held', state: 'awaiting-acceptance' },
        ...base.runs,
      ],
    }
    const state = productStateFor(held, NOW)
    expect(state.state).not.toBe('working')
    expect(activityFor(held, NOW).awaitingAdoption).toBe(1)
    expect(activityFor(held, NOW).inFlight).toBe(0)
  })

  it('is not returned for a running row the clock has passed', () => {
    /*
     * The orphan. Measured on the dev firm: a run left `running` by a process
     * that died a week earlier. Its own recorded deadline is what says it
     * cannot still be executing, and the host is told so rather than told
     * to wait.
     */
    const stale = withRunning(overview(inflight))
    expect(productStateFor(stale, LATER).state).not.toBe('working')
    expect(activityFor(stale, LATER).inFlight).toBe(0)
    expect(activityFor(stale, LATER).unverified).toBe(1)
    /* And the same row, inside its window, is work. */
    expect(productStateFor(stale, NOW).state).toBe('working')
  })

  it('is not returned for a running row with no measured deadline', () => {
    const base = withRunning(overview(inflight))
    const unbounded: CaseOverview = {
      ...base,
      runs: base.runs.map((run) =>
        run.id === 'run-live'
          ? { ...run, budget: { ...run.budget, deadline: { kind: 'not-measured' } } }
          : run,
      ),
    }
    expect(productStateFor(unbounded, NOW).state).not.toBe('working')
    expect(activityFor(unbounded, NOW).unverified).toBe(1)
  })
})

/* ------------------------------------------------------ answer-ready */

describe('answer-ready requires a live decision on a settled case', () => {
  it('is returned for the decided and the reconsidered case', () => {
    expect(productStateFor(overview(decided), NOW).state).toBe('answer-ready')
    expect(productStateFor(overview(reconsidered), NOW).state).toBe('answer-ready')
  })

  it('is not returned while the case is with the CIO', () => {
    const state = productStateFor(overview(awaiting), NOW)
    expect(state).toEqual({
      state: 'needs-decision',
      decision: { reason: 'cio-decision-required' },
    })
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

describe('needs-decision names the seam', () => {
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

  it('names the outstanding act and the desk that owes it', () => {
    expect(productStateFor(overview(inflight), NOW)).toEqual({
      state: 'needs-decision',
      decision: {
        reason: 'institutional-act-required',
        act: 'record-verification-review',
        owner: { id: 'verification', name: expect.any(String), isGovernance: true },
      },
    })
    expect(productStateFor(overview(noRisk), NOW)).toMatchObject({
      state: 'needs-decision',
      decision: {
        reason: 'institutional-act-required',
        act: 'record-devils-advocate-review',
      },
    })
  })
})

/* ------------------------------------------------------------ result */

describe('the answer is the decision, read and not written', () => {
  it('carries every field from a persisted record', () => {
    const base = overview(decided)
    const answer = institutionalAnswerFor(base)!
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

  it('invents no sentence: every string in the answer exists in the record', () => {
    /*
     * The strongest form of "not a second AI answer": there is no string in
     * the result that the institution did not write down. A gateway that
     * summarised, softened or explained would fail this on its first word.
     */
    for (const fixture of [decided, reconsidered]) {
      const base = overview(fixture)
      const record = JSON.stringify(base)
      const leaves: string[] = []
      const walk = (value: unknown) => {
        if (typeof value === 'string') leaves.push(value)
        else if (Array.isArray(value)) value.forEach(walk)
        else if (value && typeof value === 'object') Object.values(value).forEach(walk)
      }
      walk(institutionalAnswerFor(base))
      expect(leaves.length).toBeGreaterThan(5)
      for (const leaf of leaves) {
        expect(record, leaf).toContain(JSON.stringify(leaf).slice(1, -1))
      }
    }
  })

  it('does not strip material dissent', () => {
    const base = overview(decided)
    const answer = institutionalAnswerFor(base)!
    const material = base.decision!.unresolvedDissent.filter((entry) =>
      dissentRequiresAcknowledgement(entry.materiality),
    )
    expect(answer.materialDissentCount).toBe(material.length)
    for (const entry of material) {
      expect(answer.dissent.map((d) => d.rationale)).toContain(entry.rationale)
    }
  })

  it('is null where no decision exists', () => {
    expect(institutionalAnswerFor(overview(awaiting))).toBeNull()
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

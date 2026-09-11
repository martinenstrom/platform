/**
 * The Command Center projection, against captured institutional state.
 *
 * The rule this suite exists to hold: **the page may arrange and count; it may
 * not decide.** Every institutional judgement it displays was made by the
 * domain, and the assertions below are mostly about that — the act comes from
 * `nextAct`, settledness comes from `standing`, and nothing is inferred from a
 * stage or a name.
 *
 * The fixture is the same one the case queue is proved against, generated from
 * a run against PostgreSQL. Hand-written standings would prove the projection
 * maps fields; they would not prove it maps the firm.
 */

import { describe, expect, it } from 'vitest'
import { commandCenterView } from './commandCenter'
import type { CaseListing } from './caseListing'
import type { AgentDesk } from './agentDirectory'
import mixed from '~/test/fixtures/caseList.mixed.json'
import floor from '~/test/fixtures/agentFloor.mixed.json'

const cases = mixed as unknown as readonly CaseListing[]
const desks = floor as unknown as readonly AgentDesk[]

const view = (over: Partial<Parameters<typeof commandCenterView>[0]> = {}) =>
  commandCenterView({
    cases,
    desks,
    activity: [],
    evidenceSetCount: 0,
    latestAssemblyAt: null,
    ...over,
  })

describe('obligations are the domain’s answer, carried through', () => {
  it('lists only cases the firm still owes something on', () => {
    const result = view()
    const settledInFixture = cases.filter((entry) => entry.standing.settled)

    expect(settledInFixture.length).toBeGreaterThan(0)
    expect(result.obligations).toHaveLength(cases.length - settledInFixture.length)
    expect(result.settledCases).toBe(settledInFixture.length)
    expect(result.totalCases).toBe(cases.length)
  })

  it('takes the next act from the standing, never from the stage', () => {
    /*
     * The one assertion that keeps this a projection. If the act were derived
     * here it could disagree with the case page, and two surfaces telling a
     * desk two different things about what it owes is the failure the
     * presentation boundary exists to prevent.
     */
    for (const obligation of view().obligations) {
      const source = cases.find((entry) => entry.investmentCase.id === obligation.caseId)!
      expect(obligation.act).toBe(source.standing.nextAct.act)
      expect(obligation.ownershipKind).toBe(source.standing.ownership.kind)
      expect(obligation.owningDepartmentId).toBe(source.standing.ownership.departmentId)
    }
  })

  it('carries blockers as kinds, so the surface cannot invent a description', () => {
    const withBlockers = view().obligations.filter(
      (obligation) => obligation.blockerKinds.length > 0,
    )
    for (const obligation of withBlockers) {
      const source = cases.find((entry) => entry.investmentCase.id === obligation.caseId)!
      expect(obligation.blockerKinds).toEqual(source.standing.blockers.map((b) => b.kind))
    }
  })
})

describe('the floor counts what the desks actually hold', () => {
  it('separates control functions without ranking them', () => {
    const result = view()
    expect(result.floor).toHaveLength(desks.length)
    /* Both kinds are present and the flag is carried, not re-derived. */
    expect(result.floor.some((desk) => desk.isGovernance)).toBe(true)
    expect(result.floor.some((desk) => !desk.isGovernance)).toBe(true)
    for (const desk of result.floor) {
      const source = desks.find((entry) => entry.departmentId === desk.departmentId)!
      expect(desk.isGovernance).toBe(source.isGovernance)
    }
  })

  it('counts run states against the record, and never sums them into one number', () => {
    for (const desk of view().floor) {
      const source = desks.find((entry) => entry.departmentId === desk.departmentId)!
      const state = (name: string) =>
        source.runs.filter((run) => run.state === name).length
      expect(desk.awaitingAcceptance).toBe(state('awaiting-acceptance'))
      expect(desk.completed).toBe(state('completed'))
      expect(desk.failed).toBe(state('failed') + state('timed-out') + state('cancelled'))
    }
  })

  it('says a desk has never run rather than implying it did', () => {
    const never = view({ desks: [{ ...desks[0]!, runs: [] }] }).floor[0]!
    expect(never.lastRunAt).toBeNull()
    expect(never.completed).toBe(0)
  })
})

describe('what the firm cannot yet answer is measured, not asserted', () => {
  it('reports zero coverage for a step no case has reached', () => {
    const coverage = view().stepCoverage
    /*
     * The measurement the Command Center's honesty rests on. At the time of
     * writing the firm holds no thesis at all, so this is zero — and the page
     * says so in words instead of rendering an empty "firm view" panel.
     */
    const thesis = coverage.find((entry) => entry.step === 'thesis-proposed')!
    const expected = cases.filter((entry) =>
      entry.standing.steps.some(
        (step) => step.step === 'thesis-proposed' && step.status === 'complete',
      ),
    ).length
    expect(thesis.complete).toBe(expected)
  })

  it('covers every step the workflow defines, in the order it defines them', () => {
    expect(view().stepCoverage.map((entry) => entry.step)).toEqual([
      'thesis-proposed',
      'work-aggregated',
      /* Between synthesis and the control functions, as `CASE_STEPS` orders it:
       * a peer reads finished work, and the desks that check the argument come
       * after the desk that may dispute it. */
      'peer-examination',
      'verification',
      'devils-advocate',
      'risk',
      'cio-submission',
      'cio-decision',
    ])
  })

  it('holds an empty firm without inventing anything to show', () => {
    const empty = commandCenterView({
      cases: [],
      desks: [],
      activity: [],
      evidenceSetCount: 0,
      latestAssemblyAt: null,
    })
    expect(empty.obligations).toEqual([])
    expect(empty.floor).toEqual([])
    expect(empty.totalCases).toBe(0)
    /* Every step reports zero rather than being omitted. */
    expect(empty.stepCoverage).toHaveLength(8)
    for (const entry of empty.stepCoverage) expect(entry.complete).toBe(0)
  })
})

describe('activity is passed through, never generated', () => {
  it('carries exactly the items it was given', () => {
    const items = [
      {
        at: '2026-08-20T17:09:04.466Z',
        departmentId: 'global-macro',
        subject: 'run' as const,
        fromState: 'running',
        toState: 'completed',
        caseId: 'case-1',
      },
    ]
    expect(view({ activity: items }).activity).toEqual(items)
  })

  it('reports no activity as none, rather than filling the gap', () => {
    expect(view({ activity: [] }).activity).toEqual([])
  })
})

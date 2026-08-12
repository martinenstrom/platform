/**
 * The rule this surface is built on, asserted rather than described.
 *
 * *If two institutional states would lead to different obligations, they must
 * not render as the same visual state.*
 *
 * A mapping is the easiest place in the system to quietly undo months of
 * careful distinction: `not-applicable` and `complete` are one careless line
 * away from sharing a green tick, and nothing else in the codebase would
 * notice.
 */

import { describe, expect, it } from 'vitest'
import {
  ACT_LABEL,
  eligibilityText,
  GATE_STATUS,
  ownershipText,
  STAGE_LABEL,
  STAGE_TONE,
  STEP_LABEL,
  STEP_STATUS,
} from './caseStandingText'
import {
  CASE_STEPS,
  ELIGIBILITY_GATE_CODES,
  eligibilityPolicy,
  evaluateEligibilityGates,
} from '~/domain/analysis'
import { eligibilityBasis } from '~/domain/analysis/decisionFixtures'
import type { RecordedEligibility } from '~/application/analysis/caseOverview'

/* ------------------------------------------------------------ distinctness */

describe('states with different obligations look different', () => {
  it('never renders not-applicable the way it renders complete', () => {
    /*
     * A control the firm ruled was not owed, and a control that ran and
     * passed, place different duties on whoever audits this later. Same tone
     * OR same label and the distinction is gone on screen.
     */
    expect(STEP_STATUS['not-applicable'].tone).not.toBe(STEP_STATUS.complete.tone)
    expect(STEP_STATUS['not-applicable'].label).not.toBe(STEP_STATUS.complete.label)
  })

  it('gives all three step statuses a distinct tone and label', () => {
    const tones = Object.values(STEP_STATUS).map((entry) => entry.tone)
    const labels = Object.values(STEP_STATUS).map((entry) => entry.label)
    expect(new Set(tones).size).toBe(3)
    expect(new Set(labels).size).toBe(3)
  })

  it('never renders an out-of-scope gate the way it renders a passed one', () => {
    expect(GATE_STATUS['not-applicable'].tone).not.toBe(GATE_STATUS.passed.tone)
    expect(GATE_STATUS['not-applicable'].label).not.toBe(GATE_STATUS.passed.label)
  })

  it('keeps deferred distinct from decided', () => {
    /*
     * "Nobody has looked at this" and "the CIO looked and chose to wait" are
     * opposite institutional facts, which is why `deferred` is its own stage.
     * Rendering it as a committed decision would undo that at the last step.
     */
    expect(STAGE_TONE.deferred).not.toBe(STAGE_TONE.decided)
    expect(STAGE_LABEL.deferred).not.toBe(STAGE_LABEL.decided)
  })

  it('keeps returned and blocked distinct from each other and from decided', () => {
    expect(STAGE_LABEL.returned).not.toBe(STAGE_LABEL.blocked)
    expect(STAGE_TONE.returned).not.toBe(STAGE_TONE.decided)
  })
})

/* --------------------------------------------------------- exhaustiveness */

describe('every code the domain can produce has a rendering', () => {
  it('labels every step', () => {
    for (const step of CASE_STEPS) {
      expect(STEP_LABEL[step]).toBeTruthy()
    }
    expect(Object.keys(STEP_LABEL)).toHaveLength(CASE_STEPS.length)
  })

  it('labels every stage, with no blanks', () => {
    for (const [stage, label] of Object.entries(STAGE_LABEL)) {
      expect(label.trim(), stage).not.toBe('')
    }
    expect(Object.keys(STAGE_TONE).sort()).toEqual(Object.keys(STAGE_LABEL).sort())
  })

  it('gives every institutional act an instruction, not a description', () => {
    for (const [act, label] of Object.entries(ACT_LABEL)) {
      expect(label.trim(), act).not.toBe('')
    }
  })

  it('renders every gate status the domain declares', () => {
    expect(ELIGIBILITY_GATE_CODES.length).toBeGreaterThan(0)
    for (const status of ['passed', 'failed', 'not-applicable'] as const) {
      expect(GATE_STATUS[status].label.trim()).not.toBe('')
    }
  })
})

/* ------------------------------------------------------------- ownership */

describe('ownership', () => {
  it('gives a settled case no owner at all', () => {
    /*
     * `null`, so the caller must decide how to say "nobody". Returning a name
     * — the last actor, say — would read as an open obligation on a person
     * who has none.
     */
    expect(
      ownershipText({ kind: 'settled', departmentId: null, employeeId: null }),
    ).toBeNull()
  })

  it('names the chief for a case awaiting decision', () => {
    expect(ownershipText({ kind: 'chief', departmentId: null, employeeId: 'cio' })).toBe(
      'cio',
    )
  })

  it('names the department for work on the floor', () => {
    expect(
      ownershipText({
        kind: 'department',
        departmentId: 'verification',
        employeeId: null,
      }),
    ).toBe('verification')
  })
})

/* ----------------------------------------------------------- eligibility */

describe('the three eligibility states', () => {
  const recorded = (): RecordedEligibility => {
    const { manifest: _manifest, ...content } = eligibilityBasis()
    return {
      kind: 'recorded',
      policyVersion: '1',
      report: evaluateEligibilityGates(content, eligibilityPolicy('1')),
    }
  }

  it('renders all three distinctly', () => {
    const notSubmitted = eligibilityText({ kind: 'not-submitted' })
    const unresolvable = eligibilityText({
      kind: 'policy-unresolvable',
      policyVersion: '99',
    })
    const judged = eligibilityText(recorded())

    const labels = [notSubmitted.label, unresolvable.label, judged.label]
    expect(new Set(labels).size).toBe(3)
  })

  it('never presents "not submitted" as a failure', () => {
    /*
     * Nobody has judged this yet. Rendering it in the same tone as a refused
     * submission would tell a reader the argument was rejected when it was
     * never put.
     */
    const notSubmitted = eligibilityText({ kind: 'not-submitted' })
    expect(notSubmitted.tone).toBe('neutral')
    expect(notSubmitted.tone).not.toBe('negative')
    expect(notSubmitted.tone).not.toBe('warning')
  })

  it('treats an unreadable policy as a problem with the record', () => {
    /*
     * Not a soft "unknown". The firm cannot reproduce its own verdict, which
     * is a integrity failure and should look like one.
     */
    const unresolvable = eligibilityText({
      kind: 'policy-unresolvable',
      policyVersion: '99',
    })
    expect(unresolvable.tone).toBe('negative')
    expect(unresolvable.label).toContain('99')
  })

  it('names the policy version in the unresolvable case', () => {
    /* So an operator knows which rule the system has lost, not merely that it has. */
    expect(
      eligibilityText({ kind: 'policy-unresolvable', policyVersion: '7' }).label,
    ).toContain('7')
  })
})

/**
 * The kind of question, and what it permits (ruled 2026-09-18).
 *
 * Explanation governance and decision governance are different, and the
 * difference must not drift through model-generated prose. The kind is read
 * off the opening revision; it decides what a synthesis may be, and whether an
 * open objection stops the firm or is retained as dissent.
 */

import { describe, expect, it } from 'vitest'
import type { InvestmentThesis } from './theses'
import {
  challengeBlocks,
  EXPLANATORY_HARD_BLOCKING_KINDS,
  EXPLANATORY_POSITION,
  inquiryKindOf,
  synthesisPermittedFor,
} from './index'

const revision = (
  revisionNumber: number,
  position: string,
  lifecycle: InvestmentThesis['lifecycle'] = 'superseded',
): InvestmentThesis =>
  ({
    thesisId: 'thesis-1',
    revisionId: `rev-${revisionNumber}`,
    revisionNumber,
    position,
    lifecycle,
    ...(revisionNumber > 1 ? { supersedesRevisionId: `rev-${revisionNumber - 1}` } : {}),
  }) as unknown as InvestmentThesis

describe('the kind of question is read off the opening revision', () => {
  it('is an explanation when the opening was explanatory, whatever the synthesis later said', () => {
    expect(inquiryKindOf([revision(1, EXPLANATORY_POSITION), revision(2, 'hold', 'under-analysis')], 'thesis-1')).toBe(
      'explanation',
    )
  })

  it('is a judgement when the opening took, or examined, a position', () => {
    expect(inquiryKindOf([revision(1, 'hold', 'under-analysis')], 'thesis-1')).toBe('judgement')
    expect(inquiryKindOf([revision(1, 'open', 'under-analysis')], 'thesis-1')).toBe('judgement')
    expect(inquiryKindOf([], 'thesis-1')).toBe('judgement')
  })
})

describe('what a synthesis may be', () => {
  it('lets an explanation explain, and nothing more', () => {
    expect(synthesisPermittedFor('explanation', EXPLANATORY_POSITION, [])).toEqual({ permitted: true })
  })

  it('refuses an explanation that takes a position', () => {
    const verdict = synthesisPermittedFor('explanation', 'hold', [])
    expect(verdict.permitted).toBe(false)
    if (!verdict.permitted) expect(verdict.reason).toMatch(/did not ask the firm what to do/)
  })

  it('refuses an explanation that declares an implementation implication', () => {
    const verdict = synthesisPermittedFor('explanation', EXPLANATORY_POSITION, ['portfolio-risk'])
    expect(verdict.permitted).toBe(false)
    if (!verdict.permitted) expect(verdict.reason).toMatch(/portfolio-risk/)
  })

  it('lets a judgement take any position and declare its implications', () => {
    expect(synthesisPermittedFor('judgement', 'hold', ['portfolio-risk', 'position-sizing'])).toEqual({
      permitted: true,
    })
  })
})

describe('whether an open objection stops the firm', () => {
  it('keeps the policy threshold where no scope is given', () => {
    expect(challengeBlocks('material', 'material')).toBe(true)
    expect(challengeBlocks('non-material', 'material')).toBe(false)
  })

  it('stops a judgement on any objection at or above the threshold', () => {
    expect(challengeBlocks('material', 'material', { inquiry: 'judgement', kind: 'fragile-assumption' })).toBe(true)
    expect(challengeBlocks('decision-critical', 'material', { inquiry: 'judgement', kind: 'overconfidence' })).toBe(true)
  })

  it('retains analytical dissent on an explanation, whatever its weight', () => {
    for (const kind of [
      'alternative-explanation',
      'fragile-assumption',
      'overconfidence',
      'correlation-not-causation',
      'adverse-scenario',
    ] as const) {
      expect(challengeBlocks('decision-critical', 'material', { inquiry: 'explanation', kind })).toBe(false)
    }
  })

  it('stops an explanation only on a factual contradiction, and only when it weighs enough', () => {
    expect(EXPLANATORY_HARD_BLOCKING_KINDS).toEqual(['contradicting-evidence'])
    expect(challengeBlocks('material', 'material', { inquiry: 'explanation', kind: 'contradicting-evidence' })).toBe(true)
    expect(challengeBlocks('non-material', 'material', { inquiry: 'explanation', kind: 'contradicting-evidence' })).toBe(
      false,
    )
  })
})

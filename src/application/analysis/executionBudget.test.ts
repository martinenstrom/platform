/**
 * Resolving the effective execution budget.
 *
 * The properties here are the ones the C2 gate rules on, tested as behaviour
 * rather than as shape: the ceiling is hard, capability is not policy, and the
 * two absences — "cannot spend this" and "nobody decided" — never collapse into
 * each other.
 */

import { describe, expect, it } from 'vitest'
import {
  BudgetCurrencyMismatch,
  resolveExecutionBudget,
  type BudgetSources,
} from './executionBudget'

const ceiling = (over: Partial<BudgetSources> = {}): BudgetSources => ({
  firmCeiling: { tokens: 100_000, cost: { costMinorUnits: 5_000, currency: 'USD' } },
  ...over,
})

describe('resolveExecutionBudget', () => {
  describe('the firm ceiling is hard', () => {
    it('caps a playbook that proposes more than the firm allows', () => {
      const budget = resolveExecutionBudget('live', {
        proposed: { tokens: 999_999 },
        firmCeiling: { tokens: 40_000 },
      })
      expect(budget.tokens).toEqual({ kind: 'limit', tokens: 40_000 })
    })

    it('caps a case that tries to constrain upward', () => {
      /*
       * A "constraint" that raised the limit would not be a constraint. The
       * resolver takes the minimum across every source that spoke, so no
       * ordering of the three can defeat the ceiling.
       */
      const budget = resolveExecutionBudget('live', {
        proposed: { tokens: 10_000 },
        caseConstraint: { tokens: 500_000 },
        firmCeiling: { tokens: 40_000 },
      })
      expect(budget.tokens).toEqual({ kind: 'limit', tokens: 10_000 })
    })

    it('lets a case constrain below what the playbook proposed', () => {
      const budget = resolveExecutionBudget('live', {
        proposed: { tokens: 40_000 },
        caseConstraint: { tokens: 5_000 },
        firmCeiling: { tokens: 100_000 },
      })
      expect(budget.tokens).toEqual({ kind: 'limit', tokens: 5_000 })
    })
  })

  describe('capability is a fact about the producer, not a policy choice', () => {
    it.each(['stub', 'recorded'] as const)(
      'gives %s work not-applicable rather than a limit it cannot spend',
      (kind) => {
        /*
         * The distinction the whole three-state design exists for. A stub
         * offered a generous ceiling still cannot spend money, and recording a
         * limit against it would authorize spend that cannot occur.
         */
        const budget = resolveExecutionBudget(kind, ceiling())
        expect(budget.tokens).toEqual({ kind: 'not-applicable' })
        expect(budget.cost).toEqual({ kind: 'not-applicable' })
      },
    )

    it('still binds a non-consuming producer to a deadline', () => {
      // A fixture that never resolves hangs the caller exactly as a live call
      // would, so time is the one dimension that applies to every producer.
      const budget = resolveExecutionBudget('stub', {
        firmCeiling: { deadlineMs: 30_000 },
      })
      expect(budget.deadline).toEqual({ kind: 'limit', deadlineMs: 30_000 })
    })

    it('gives live work a real limit from the same sources', () => {
      const budget = resolveExecutionBudget('live', ceiling())
      expect(budget.tokens).toEqual({ kind: 'limit', tokens: 100_000 })
      expect(budget.cost).toEqual({
        kind: 'limit',
        costMinorUnits: 5_000,
        currency: 'USD',
      })
    })
  })

  describe('"nobody decided" is not "not applicable"', () => {
    it('reports not-measured when no source bounded a live dimension', () => {
      /*
       * The two absences must stay distinguishable: this one refuses to start,
       * and `not-applicable` does not. A nullable number could not tell them
       * apart, and the ambiguity fell on the side that costs money.
       */
      const budget = resolveExecutionBudget('live', { firmCeiling: {} })
      expect(budget.tokens).toEqual({ kind: 'not-measured' })
      expect(budget.cost).toEqual({ kind: 'not-measured' })
      expect(budget.deadline).toEqual({ kind: 'not-measured' })
    })

    it('does not treat a silent source as unlimited', () => {
      // A source that says nothing about a dimension is declining to
      // constrain, not authorizing everything: the ceiling still decides.
      const budget = resolveExecutionBudget('live', {
        proposed: {},
        caseConstraint: {},
        firmCeiling: { tokens: 40_000 },
      })
      expect(budget.tokens).toEqual({ kind: 'limit', tokens: 40_000 })
    })
  })

  describe('a currency travels with its amount', () => {
    it('refuses to compare limits stated in different currencies', () => {
      /*
       * Taking the smaller number would treat 100 öre as 100 cents. Refused
       * rather than silently resolved, because the arithmetic is meaningless
       * and the result would be a limit nobody set.
       */
      expect(() =>
        resolveExecutionBudget('live', {
          proposed: { cost: { costMinorUnits: 100, currency: 'SEK' } },
          firmCeiling: { cost: { costMinorUnits: 100, currency: 'USD' } },
        }),
      ).toThrow(BudgetCurrencyMismatch)
    })

    it('takes the lower amount when the currencies agree', () => {
      const budget = resolveExecutionBudget('live', {
        proposed: { cost: { costMinorUnits: 900, currency: 'USD' } },
        firmCeiling: { cost: { costMinorUnits: 5_000, currency: 'USD' } },
      })
      expect(budget.cost).toEqual({
        kind: 'limit',
        costMinorUnits: 900,
        currency: 'USD',
      })
    })
  })
})

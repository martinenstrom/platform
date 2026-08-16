/**
 * Resolving what a run is allowed to spend.
 *
 * ```
 * Playbook proposes  ->  Case may constrain  ->  Firm-wide policy is the ceiling
 * ```
 *
 * Three sources, one answer, resolved **before** execution and recorded with
 * the run. Nothing downstream re-reads the sources, and that is the point: a
 * historical run must stay self-describing after the playbook has been
 * reversioned, the case closed and firm policy rewritten. A run whose limits
 * could only be recovered by reconstructing three documents would be a
 * reference to what the firm permitted rather than a record of it.
 *
 * ## Caps and capability are different questions
 *
 * A policy source expresses only **caps** — "no more than this". Whether a
 * dimension can be consumed at all is a fact about the producer, not about
 * policy: a stub cannot spend money however generous the ceiling, and a
 * firm-wide rule saying otherwise would not make it able to. So capability is
 * read from `ProviderKind` and caps are read from policy, and the two never
 * argue.
 *
 * That separation is what makes `not-applicable` and `not-measured` stay
 * distinct all the way down. A stub's cost budget is `not-applicable` because
 * a stub cannot spend; a live run's cost budget is `not-measured` only when no
 * source bounded it — and that one refuses to start.
 */

import type {
  CostBudget,
  DeadlineBudget,
  ExecutionBudget,
  ProviderKind,
} from '~/domain/analysis'

/**
 * A ceiling, from one policy source.
 *
 * Every field optional: a source that says nothing about a dimension is not
 * saying "unlimited", it is declining to constrain, and a lower source or the
 * firm ceiling may still bound it. Absent everywhere is what produces
 * `not-measured`.
 */
export interface BudgetCap {
  tokens?: number
  cost?: { costMinorUnits: number; currency: string }
  deadlineMs?: number
}

export interface BudgetSources {
  /** What the playbook entry asks for. */
  proposed?: BudgetCap
  /** What this particular case is willing to spend, where it says. */
  caseConstraint?: BudgetCap
  /** The hard ceiling. Nothing resolves above it. */
  firmCeiling: BudgetCap
}

export class BudgetCurrencyMismatch extends Error {
  constructor(readonly currencies: readonly string[]) {
    super(
      `Budget sources name different currencies (${currencies.join(', ')}). ` +
        `A limit in one currency does not bound spend in another, and taking ` +
        `the smaller number would treat 100 öre as 100 cents.`,
    )
    this.name = 'BudgetCurrencyMismatch'
  }
}

/** Which dimensions a producer of this kind is capable of consuming. */
function consumesTokensAndMoney(providerKind: ProviderKind): boolean {
  /*
   * The same split `USAGE_BY_PROVIDER` draws for what was spent. A replay and
   * a stub report `not-applicable` usage because they consume nothing
   * external — so authorizing them a token or cost limit would be authorizing
   * spend that cannot occur.
   */
  return providerKind === 'live'
}

/** The most restrictive value any source named, or undefined if none did. */
function lowestOf(values: readonly (number | undefined)[]): number | undefined {
  const present = values.filter((value): value is number => value !== undefined)
  return present.length === 0 ? undefined : Math.min(...present)
}

function resolveCost(sources: readonly (BudgetCap | undefined)[]): CostBudget {
  const costs = sources
    .map((source) => source?.cost)
    .filter((cost): cost is NonNullable<BudgetCap['cost']> => cost !== undefined)

  if (costs.length === 0) return { kind: 'not-measured' }

  const currencies = [...new Set(costs.map((cost) => cost.currency))]
  if (currencies.length > 1) throw new BudgetCurrencyMismatch(currencies)

  return {
    kind: 'limit',
    costMinorUnits: Math.min(...costs.map((cost) => cost.costMinorUnits)),
    currency: currencies[0]!,
  }
}

/**
 * The effective limit, as the three sources come to it.
 *
 * Resolution is `min` across every source that spoke, per dimension. A case
 * cannot raise what the firm capped and a playbook cannot raise either, which
 * is what makes the firm ceiling hard rather than advisory — it participates in
 * the same minimum, so no ordering of the sources can defeat it.
 */
export function resolveExecutionBudget(
  providerKind: ProviderKind,
  sources: BudgetSources,
): ExecutionBudget {
  const ordered: readonly (BudgetCap | undefined)[] = [
    sources.proposed,
    sources.caseConstraint,
    sources.firmCeiling,
  ]

  const deadlineMs = lowestOf(ordered.map((source) => source?.deadlineMs))
  const deadline: DeadlineBudget =
    deadlineMs === undefined ? { kind: 'not-measured' } : { kind: 'limit', deadlineMs }

  if (!consumesTokensAndMoney(providerKind)) {
    return {
      tokens: { kind: 'not-applicable' },
      cost: { kind: 'not-applicable' },
      deadline,
    }
  }

  const tokens = lowestOf(ordered.map((source) => source?.tokens))

  return {
    tokens: tokens === undefined ? { kind: 'not-measured' } : { kind: 'limit', tokens },
    cost: resolveCost(ordered),
    deadline,
  }
}

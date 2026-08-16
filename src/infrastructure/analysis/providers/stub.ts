/**
 * The stub contribution provider.
 *
 * Produces controlled outcomes on demand, so every branch of the contribution
 * path can be exercised deterministically: a contribution that lands, one that
 * errors, one that never answers, one that answers late, one that answers with
 * something inadmissible, and one that answers with nothing at all.
 *
 * ## The malformed outcome is the point
 *
 * It is easy to prove that good provider output is stored. What matters is
 * that BAD provider output is refused rather than stored — a claim asserting
 * support with nothing behind it, arriving from a provider that is confident
 * about it. Without an outcome that produces one, the validation path is
 * written and never executed, which is indistinguishable from not having it.
 *
 * ## What the success outcome deliberately does not do
 *
 * It asserts nothing supported. One claim, `insufficient-evidence`, citing
 * nothing, with confidence capped at `no-evidence`. A stub that returned
 * plausible-looking analysis would let a test pass on invented reasoning, and
 * the fixtures for real content are the recorded provider's job.
 */

import type { AgentClaim } from '~/domain/analysis'
import type {
  ContributionProvider,
  ContributionRequest,
  ContributionResult,
} from '~/application/analysis/contributionPort'

export const STUB_PROVIDER_ID = 'stub'

/**
 * What the stub does when a department asks.
 *
 * A closed set. Anything a test needs that is not here is a new outcome with a
 * name, not an option bag that grows until nobody knows what the stub does.
 */
export type StubOutcome =
  /** One admissible claim that asserts nothing supported. */
  | { kind: 'success' }
  /** Throws. The orchestrator records `provider-error`. */
  | { kind: 'failure' }
  /** Never resolves. The deadline is what ends it. */
  | { kind: 'timeout' }
  /** Answers, slowly. Resolves after `ms`. */
  | { kind: 'delayed'; ms: number }
  /** Answers with a claim the firm must refuse: supported, with no evidence. */
  | { kind: 'malformed' }
  /** Answers with no claims at all, which is not a contribution. */
  | { kind: 'silent' }

/**
 * The stub's build. Part of its identity, because changing what the stub
 * produces changes the output as surely as changing a prompt would.
 */
const STUB_VERSION = '1'

/**
 * What a stub claim speaks to.
 *
 * Fixed rather than read from a clock: the stub exists to make outcomes
 * reproducible, and a claim whose temporal scope moved between two runs of the
 * same test would be the one thing about it that was not deterministic.
 */
const STUB_AS_OF = '2026-01-01T00:00:00.000Z'

/** The one claim a successful stub asserts. Deterministic, and says nothing. */
function inertClaim(request: ContributionRequest, asOf: string): AgentClaim {
  return {
    id: `stub-${request.departmentId}`,
    type: 'observation',
    statement: `${request.departmentId} produced a stub contribution`,
    evidenceRefs: [],
    contradictingEvidenceRefs: [],
    confidence: {
      level: 'insufficient',
      basis: ['stub provider; no evidence was examined'],
      cappedBy: 'no-evidence',
    },
    temporalScope: { asOf },
    status: 'insufficient-evidence',
  }
}

/**
 * A claim that must not be stored.
 *
 * `supported` with an empty `evidenceRefs` — the shape a confident provider
 * produces when its own validation is missing or wrong.
 */
function malformedClaim(request: ContributionRequest, asOf: string): AgentClaim {
  return {
    id: `stub-malformed-${request.departmentId}`,
    type: 'observation',
    statement: 'asserted without evidence',
    evidenceRefs: [],
    contradictingEvidenceRefs: [],
    confidence: { level: 'high', basis: ['the provider was sure'] },
    temporalScope: { asOf },
    status: 'supported',
  }
}

export function createStubContributionProvider(
  options: {
    /** Per department. Anything unlisted succeeds. */
    outcomes?: Readonly<Record<string, StubOutcome>>
    /** What its claims speak to. Fixed by default, never a clock. */
    asOf?: string
  } = {},
): ContributionProvider {
  const outcomes = options.outcomes ?? {}
  const asOf = options.asOf ?? STUB_AS_OF

  return {
    id: STUB_PROVIDER_ID,
    version: STUB_VERSION,
    kind: 'stub',

    /*
     * A scenario, never a model. There is no prompt and no model here, and the
     * type system is what stops one being invented: `ExecutionIdentity` gives a
     * stub nowhere to put one.
     */
    declare(request: ContributionRequest) {
      const outcome: StubOutcome = outcomes[request.departmentId] ?? { kind: 'success' }
      return {
        agentContractVersion: '0',
        outputSchemaVersion: '0',
        identity: {
          kind: 'scenario' as const,
          scenarioId: outcome.kind,
          stubVersion: STUB_VERSION,
        },
      }
    },

    async contribute(request: ContributionRequest): Promise<ContributionResult> {
      const outcome: StubOutcome = outcomes[request.departmentId] ?? { kind: 'success' }

      if (outcome.kind === 'failure') {
        throw new Error(`stub failure for ${request.departmentId}`)
      }
      if (outcome.kind === 'timeout') {
        // Never settles. The caller's deadline is what ends this, which is the
        // behaviour a hung provider actually has.
        return new Promise<never>(() => {})
      }
      if (outcome.kind === 'delayed') {
        await new Promise((resolve) => setTimeout(resolve, outcome.ms))
      }
      if (request.signal.aborted) {
        throw new Error('contribution cancelled')
      }

      const claims =
        outcome.kind === 'silent'
          ? []
          : outcome.kind === 'malformed'
            ? [malformedClaim(request, asOf)]
            : [inertClaim(request, asOf)]

      return {
        claims,
        agentContractVersion: '0',
        outputSchemaVersion: '0',
        // Synthetic work spends nothing. Not zero — nothing to spend.
        usage: { state: 'not-applicable' },
        /*
         * Progress, not an outcome. A provider does not report `completed`:
         * completion is a person accepting the work, and this one is a stub.
         */
        observedStates: ['running'],
      }
    },
  }
}

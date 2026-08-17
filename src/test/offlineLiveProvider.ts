/**
 * A provider that is **live to the institution and offline to the world**.
 *
 * Test support, and the only thing that makes the commissioning path provable
 * without spending money. It exists because of one measured asymmetry:
 * `resolveExecutionBudget` and `budgetPermitsStart` treat `live` differently
 * from every other kind, on purpose. A stub's tokens and cost resolve to
 * `not-applicable` — it cannot spend, so no limit is required — which means a
 * suite that verified commissioning with `createStubContributionProvider` would
 * verify a path where the budget rules **do not apply**, and would pass just as
 * happily against a case whose workflow authorizes nothing at all.
 *
 * So this declares `kind: 'live'` and answers from a fixed script. Everything
 * the firm does around it is the real thing: the budget resolves from the
 * playbook proposal, `StartAgentRun` refuses an unmeasured dimension,
 * `budgetOverruns` reads measured usage, the claims go through
 * `validateContribution`, and the run lands in `awaiting-acceptance` awaiting a
 * person. The only thing that is not real is the sentence the model would have
 * written.
 *
 * ## What it must never become
 *
 * A fourth production provider. It lives under `src/test/` and nothing outside
 * a test may import it — a "live" producer that answers without calling
 * anything is a lie the moment it is reachable from the product, because every
 * run it wrote would carry a model identity for a call nobody made.
 *
 * The identity it declares says so as plainly as the type system permits: the
 * model id is `offline-test-double`, which no provider serves and no reader
 * could mistake for an answer the firm paid for.
 */

import { citeFrom, type AgentClaim, type EvidenceSet } from '~/domain/analysis'
import {
  ContributionFailure,
  type ContributionDeclaration,
  type ContributionProvider,
  type ContributionRequest,
  type ContributionResult,
} from '~/application/analysis/contributionPort'
import { stableHashHex } from '~/domain/shared/hash'

export const OFFLINE_LIVE_PROVIDER_ID = 'live-offline-double'

/**
 * The model that did not answer.
 *
 * Named rather than borrowed from `LIVE_MODEL_ID`: a run recorded against the
 * real model id would be indistinguishable, in the database and in every read
 * model, from one the firm actually paid for.
 */
export const OFFLINE_MODEL_ID = 'offline-test-double'

export interface OfflineLiveOptions {
  loadEvidenceSet: (evidenceSetId: string) => Promise<EvidenceSet | null>
  /**
   * What it reports having spent.
   *
   * Real token counts by default, in the shape the Messages API actually
   * produces — counted tokens, and no price, because that combination is what
   * makes a token budget enforceable and a cost budget unverifiable. A test
   * that needs an overrun passes numbers above the authorization.
   */
  usage?: { inputTokens: number; outputTokens: number }
  /** Answers with nothing the firm can store, so the refusal path is reachable. */
  outcome?: 'produces' | 'malformed' | 'unavailable'
}

const CONTRACT_VERSION = '1'
const OUTPUT_SCHEMA_VERSION = '1'

export function createOfflineLiveProvider(
  options: OfflineLiveOptions,
): ContributionProvider {
  const parameters = { maxTokens: 4_096 }
  const usage = options.usage ?? { inputTokens: 900, outputTokens: 300 }
  const outcome = options.outcome ?? 'produces'

  const declare = (request: ContributionRequest): ContributionDeclaration => ({
    agentContractVersion: CONTRACT_VERSION,
    outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
    identity: {
      kind: 'model',
      prompt: {
        id: 'macro-analysis-brief',
        version: '1',
        /* Over the actual brief, so two entries do not share a prompt address. */
        contentHash: stableHashHex(`offline-double\n\n${request.brief}`),
      },
      model: {
        id: OFFLINE_MODEL_ID,
        provider: 'offline',
        parameters,
        parametersHash: stableHashHex(JSON.stringify(parameters)),
      },
    },
  })

  return {
    id: OFFLINE_LIVE_PROVIDER_ID,
    version: '1',
    kind: 'live',
    declare,

    async contribute(request: ContributionRequest): Promise<ContributionResult> {
      if (outcome === 'unavailable') throw new ContributionFailure('provider-unavailable')

      const evidence = await options.loadEvidenceSet(request.evidenceSetId)
      if (!evidence) throw new ContributionFailure('evidence-unavailable')

      const item = evidence.items[0]
      if (!item) throw new ContributionFailure('evidence-unavailable')

      /*
       * The claim cites the evidence through `citeFrom`, exactly as the live
       * provider does. Writing an `EvidenceRef` by hand would skip the one
       * check that makes a hallucinated citation impossible, and the test would
       * then be proving a path production does not take.
       */
      const claim: AgentClaim = {
        id: 'offline-1',
        type: 'observation',
        statement:
          outcome === 'malformed'
            ? 'The regime is restrictive.'
            : `The observation the firm holds reads ${JSON.stringify(item.value)}.`,
        evidenceRefs: outcome === 'malformed' ? [] : [citeFrom(evidence, item.ref)],
        contradictingEvidenceRefs: [],
        confidence:
          outcome === 'malformed'
            ? { level: 'high', basis: ['the double was sure'] }
            : {
                level: 'low',
                basis: [
                  'produced by an offline test double; no model was called',
                  'the firm has not independently corroborated this level',
                ],
              },
        temporalScope: { asOf: evidence.assembledAt },
        /* `supported` with no citation is what `validateContribution` refuses. */
        status: outcome === 'malformed' ? 'supported' : 'partially-supported',
      } as AgentClaim

      return {
        claims: [claim],
        agentContractVersion: CONTRACT_VERSION,
        outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
        /*
         * Tokens measured, money not reported — the truthful combination a real
         * Messages API call produces, and therefore the one the budget rules
         * have to cope with.
         */
        usage: {
          state: 'measured',
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cost: { state: 'not-reported' },
        },
        observedStates: ['running'],
      }
    },
  }
}

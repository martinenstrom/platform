/**
 * The stub control functions, for the tests that prove the chain without a
 * model: a verification that verifies or asks for a correction, a Devil's
 * Advocate that objects at a chosen materiality — or, planted, objects to
 * nothing — and a peer that raises nothing or one thing.
 *
 * Like `stub.ts`: a scenario, never a model; the identity says so; it
 * spends nothing. The candidate it returns is built from the context the
 * firm assembled, so the ids are the firm's.
 */

import type { DisagreementMateriality, ProposedChallenge, VerificationStatus } from '~/domain/analysis'
import type {
  ContributionProvider,
  ContributionRequest,
  ContributionResult,
} from '~/application/analysis/contributionPort'
import { ContributionFailure } from '~/application/analysis/contributionPort'
import type { GovernanceContext, GovernanceKind } from '~/application/analysis/governanceContext'

export type StubGovernanceOutcome =
  | { kind: 'verify'; status?: VerificationStatus }
  | { kind: 'object'; materiality: DisagreementMateriality; count?: number }
  /** The planted violation: a Devil's Advocate that says nothing. */
  | { kind: 'silent' }
  | { kind: 'failure' }

export const STUB_GOVERNANCE_PROVIDER_ID = 'stub-governance'

export function createStubGovernanceProvider(options: {
  kind: GovernanceKind
  outcome: StubGovernanceOutcome
  loadContext: (request: ContributionRequest) => Promise<GovernanceContext | null>
}): ContributionProvider {
  const { kind, outcome, loadContext } = options
  return {
    id: `${STUB_GOVERNANCE_PROVIDER_ID}-${kind}`,
    version: '1',
    kind: 'stub',
    declare() {
      return {
        agentContractVersion: '0',
        outputSchemaVersion: '0',
        identity: { kind: 'scenario', scenarioId: `${kind}-${outcome.kind}`, stubVersion: '1' },
      }
    },
    async contribute(request: ContributionRequest): Promise<ContributionResult> {
      if (outcome.kind === 'failure') throw new ContributionFailure('provider-error')
      const context = await loadContext(request)
      if (!context) throw new ContributionFailure('evidence-unavailable')
      const claims = context.claims
      const base = {
        claims: [],
        agentContractVersion: '0',
        outputSchemaVersion: '0',
        usage: { state: 'not-applicable' as const },
        observedStates: ['running' as const],
      }
      if (kind === 'verification') {
        const status = outcome.kind === 'verify' ? (outcome.status ?? 'verified') : 'verified'
        return {
          ...base,
          governance: {
            kind: 'verification',
            artifact: {
              status,
              findings:
                status === 'verified'
                  ? []
                  : [
                      {
                        kind: 'unresolved-citation',
                        claimId: claims[0]!.id,
                        detail: 'stub finding: the citation could not be checked',
                        severity: 'material',
                        blocking: true,
                        correctionRequired: 'stub correction: cite the observation the claim rests on',
                      },
                    ],
              claimsReviewed: claims.map((claim) => claim.id),
            },
          },
        }
      }
      const challenges: ProposedChallenge[] =
        outcome.kind === 'object'
          ? claims.slice(0, outcome.count ?? 1).map((claim) => ({
              contests: claim.id,
              contestsThesis: context.revision.thesisId,
              kind: 'fragile-assumption',
              argument: `stub objection: ${claim.statement} rests on an assumption the evidence does not settle`,
              counterEvidence: [],
              /* An objection with no counter-evidence says what would settle it — the domain files nothing less. */
              wouldBeResolvedBy: 'an observation over the window that the assumption held',
              materiality: outcome.materiality,
            }))
          : []
      return {
        ...base,
        governance:
          kind === 'devils-advocate'
            ? { kind: 'devils-advocate', artifact: { challenges } }
            : { kind: 'peer-examination', artifact: { challenges }, examinedDepartmentId: context.examinedDepartmentId ?? '' },
      }
    },
  }
}

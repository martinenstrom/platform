/**
 * Financial OS, as the system above it sees it.
 *
 * JARVIS is the personal AI layer. Financial OS is a specialist domain system
 * inside it: the user talks to JARVIS, JARVIS decides a request belongs to the
 * firm, delegates it here, and presents what the firm concluded through its own
 * single identity. This module is the face Financial OS turns towards that
 * host — and towards any host, because nothing here knows what JARVIS is.
 *
 * ## What it is
 *
 * A port. Application-layer and transport-agnostic, constructed by the
 * composition root and callable from a test against the in-memory store. It
 * wraps use cases and read models that already exist and adds no institutional
 * behaviour: every act still goes through `runCommand`, every refusal is still
 * the firm's own word for it, and every result is a typed record the
 * presentation boundary already forbids anyone from recomputing.
 *
 * ## The delegation contract, and why it needs no new vocabulary
 *
 * The command envelope has always separated who is ACCOUNTABLE (the actor) from
 * who DISPATCHED (the initiator), and `orchestrator` has always been an
 * initiator kind. A host is an orchestrator. The person asking is the actor.
 * The ledger records both, and a reader can see that JARVIS dispatched an act
 * a named employee is answerable for — which is the truthful provenance, and
 * different from either "the person clicked" or "the system did it".
 *
 * ## What a host may keep
 *
 * A `DomainReference`: an id and the storage provenance it was read under.
 * Never a copy of the record. A copy in a host's memory would be a second
 * answer free to disagree with the firm; a reference is verifiable later,
 * because every Financial OS identity carries its canonicalization version.
 *
 * ## What it does not do
 *
 * It does not authenticate — `authentication` stays `system-asserted`, and
 * TD-8 becomes a fact the host resolves and this port consumes. It does not
 * decide whether a request belongs to the firm; that is the host's. It does
 * not expose commissioning or governance acts yet: what a host may do
 * autonomously against a decision gate is a ruling this port waits for.
 */

import type { CaseStanding } from '~/domain/analysis'
import type { AnalysisRepositories } from './repositories'
import type { CommandDeps } from './commands/runCommand'
import {
  caseIdFor,
  resumeConvening,
  startInvestmentCase,
  type StartInvestmentCaseResult,
} from './startInvestmentCase'
import { caseListing, type CaseListing } from './caseListing'
import { caseOverview, type CaseOverview } from './caseOverview'
import { standingForCase } from './caseStandingFor'
import { resolveCurrentOperator, type CurrentOperatorResult } from './currentOperator'
import { operatorIdentities, type OperatorIdentity } from './operatorIdentity'

/** How this system names itself to a host's registry of domain systems. */
export const FINANCIAL_OS_SYSTEM_ID = 'financial-os' as const

/**
 * What a host supplies when it hands work to the firm.
 *
 * Deliberately three things. The host's idempotency key, because a retried
 * delegation must land on the same case rather than open a second one; the
 * person, as the firm employs them, because the firm refuses to invent a
 * principal; and the host's own name, recorded as the initiator so the ledger
 * says who dispatched the act without ever saying the host performed it.
 *
 * No correlation id of the host's own. Financial OS correlates by case, and
 * the case id derives from `requestId` — so the host's key already links the
 * two, and a second correlation would be a second place for them to disagree.
 */
export interface Delegation {
  /** Minted once per request by the host. Same key, same case. */
  requestId: string
  /** Who is asking, as the seeded organisation employs them. */
  actingEmployeeId: string
  /** The host, as the ledger will record the initiator. Never the actor. */
  orchestratorId: string
}

/**
 * What a host may keep about a Financial OS record.
 *
 * The id and the storage provenance it was read under — enough to find the
 * record again and to notice, later, that the firm's storage has moved since.
 * Not the record: the firm is the source of truth for its own state.
 */
export interface DomainReference {
  system: typeof FINANCIAL_OS_SYSTEM_ID
  kind: 'case'
  id: string
  provenanceId: string
}

export interface FinancialOsSystem {
  readonly id: typeof FINANCIAL_OS_SYSTEM_ID

  /* ------------------------------------------------------------ identity */

  /**
   * The operator this deployment is configured to act for, resolved against
   * the organisation. Fails closed: absent, unknown or departed refuses.
   */
  operator(configuredEmployeeId: string | undefined): Promise<CurrentOperatorResult>
  /** Everyone who may act, as the organisation names them. */
  operators(): Promise<readonly OperatorIdentity[]>

  /* ---------------------------------------------------------- delegation */

  /** The case a delegation will land on, knowable before it lands. */
  caseIdFor(requestId: string): string
  /** The Chairman's question, asked on the host's behalf by the person named. */
  ask(
    delegation: Delegation,
    request: { question: string; subjectDisplayName: string },
  ): Promise<StartInvestmentCaseResult>
  /** Convene the committee on a case whose first commit landed and second did not. */
  resume(delegation: Delegation, caseId: string): Promise<StartInvestmentCaseResult>

  /* ------------------------------------------------------------- results */

  /** Every case the firm holds, outstanding first. */
  queue(): Promise<readonly CaseListing[]>
  /** Where one case stands: stage, ownership, blockers, and what happens next. */
  standing(caseId: string): Promise<CaseStanding | null>
  /** Everything the firm holds on one case, with eligibility as recorded. */
  overview(caseId: string): Promise<CaseOverview | null>
  /** What a host may keep. */
  reference(caseId: string): Promise<DomainReference>
}

export function createFinancialOsSystem(input: {
  repositories: AnalysisRepositories
  /** Assembled per call, so the organisation read is the current one. */
  commandDeps: () => Promise<CommandDeps>
  /** Domain time, from the clock the container was built with. */
  now: () => string
}): FinancialOsSystem {
  const { repositories, commandDeps, now } = input

  /** The initiator every delegated act is recorded under. */
  const initiatedBy = (delegation: Delegation) =>
    ({ kind: 'orchestrator', orchestratorId: delegation.orchestratorId }) as const

  return {
    id: FINANCIAL_OS_SYSTEM_ID,

    async operator(configuredEmployeeId) {
      const deps = await commandDeps()
      return resolveCurrentOperator(configuredEmployeeId, deps.organization)
    },

    async operators() {
      const deps = await commandDeps()
      return operatorIdentities(deps.organization)
    },

    caseIdFor,

    async ask(delegation, request) {
      return startInvestmentCase({
        repositories,
        deps: await commandDeps(),
        question: request.question,
        subjectDisplayName: request.subjectDisplayName,
        requestId: delegation.requestId,
        actingEmployeeId: delegation.actingEmployeeId,
        initiator: initiatedBy(delegation),
        now,
      })
    },

    async resume(delegation, caseId) {
      return resumeConvening({
        repositories,
        deps: await commandDeps(),
        caseId,
        actingEmployeeId: delegation.actingEmployeeId,
        initiator: initiatedBy(delegation),
        now,
      })
    },

    async queue() {
      const deps = await commandDeps()
      return caseListing({ repositories, organization: deps.organization, now: now() })
    },

    async standing(caseId) {
      const investmentCase = await repositories.cases.get(caseId)
      if (!investmentCase) return null
      const deps = await commandDeps()
      return standingForCase({
        repositories,
        organization: deps.organization,
        investmentCase,
        now: now(),
      })
    },

    async overview(caseId) {
      const deps = await commandDeps()
      return caseOverview({
        repositories,
        organization: deps.organization,
        caseId,
        now: now(),
      })
    },

    async reference(caseId) {
      const deps = await commandDeps()
      return {
        system: FINANCIAL_OS_SYSTEM_ID,
        kind: 'case',
        id: caseId,
        provenanceId: deps.provenance.provenanceId,
      }
    },
  }
}

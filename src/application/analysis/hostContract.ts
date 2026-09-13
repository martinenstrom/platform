/**
 * The contract between JARVIS and Financial OS — what a host may ask, and what
 * the firm answers in.
 *
 * JARVIS decides that a request needs the firm. This is what it then says, and
 * what it gets back. Five operations in, five product states out, and nothing
 * in either direction that names a command, an actor, a playbook entry, a
 * candidate or a run state.
 *
 * ## The request side is narrow on purpose
 *
 * `ask` delegates a question. `resume` retries a convening that landed half
 * way. `status`, `result` and `inspect` read. There is no `advance`: the firm
 * does not yet have the deterministic execution path that would make
 * "carry this as far as policy permits" a truthful promise, and a gateway that
 * offered it would be a hand-written runner in disguise. The concept is
 * reserved, not implemented.
 *
 * A request carries **no actor**. Who is asking is resolved by the server from
 * its own configuration; a browser that could name an employee — or an agent —
 * would be choosing the firm's accountability from outside the firm.
 * `parseHostRequest` refuses any field it does not know, which is how an
 * `actingEmployeeId` smuggled beside the question is stopped at the door.
 *
 * ## The result side is derived, never kept
 *
 * Every product state is read off persisted institutional state at the moment
 * of the call. The host holds a `DomainReference` and asks again; it never
 * holds the thesis. `working` means a run is genuinely in flight — not that a
 * case id exists, not that the firm has work it cannot continue.
 * `answer-ready` means the institution has decided and stands behind it.
 * `needs-decision` means the next act is somebody's to take, and says whose.
 *
 * ## No model in the contract
 *
 * Nothing here names a provider, a model or a reasoning tier. Which model does
 * what is a configuration below the orchestration that calls this, and the
 * contract has to outlive every one of them.
 */

import type {
  CaseStage,
  CaseStep,
  CioDecisionOutcome,
  ConfidenceLevel,
  DisagreementMateriality,
  DisclosedDissent,
  DissentSource,
  InstitutionalAct,
  TriggerConditionType,
} from '~/domain/analysis'
import type { DomainReference } from './domainSystem'
import type { BoardroomEntry, BoardroomObjection } from './boardroomTimeline'
import type { BoardroomSeat, SeatParticipation } from './boardroomSeating'

/** Bumped when the shape or meaning of a request or result changes. */
export const HOST_CONTRACT_VERSION = '1'

/* ------------------------------------------------------------- requests */

/**
 * What deeper material a host may ask for.
 *
 * Each view is a typed projection the firm already produces for its own
 * surfaces — never a storage object, and never a second reading of the record.
 */
export type InspectView =
  /** The debate as the Boardroom shows it: every persisted act, and the seats. */
  | { kind: 'debate' }
  /** One desk's own acts and claims — "vad sa Rates?" */
  | { kind: 'desk'; departmentId: string }
  /** Every objection filed in the case, open or settled — "vilka invändningar återstår?" */
  | { kind: 'objections' }

export type HostRequest =
  /** Delegate a question into the firm on the operator's behalf. */
  | { kind: 'ask'; requestId: string; question: string; subject: string }
  /** Convene the committee on a case whose first commit landed and second did not. */
  | { kind: 'resume'; reference: DomainReference }
  /** What the persisted state means, at the product level. */
  | { kind: 'status'; reference: DomainReference }
  /** The institutional result, where one genuinely exists. */
  | { kind: 'result'; reference: DomainReference }
  /** Deeper material for a follow-up, or for a contextual surface. */
  | { kind: 'inspect'; reference: DomainReference; view: InspectView }

/* -------------------------------------------------------------- results */

/** Where the product's own surfaces for this case live. */
export interface HostSurfaces {
  boardroom: string
  record: string
}

export interface HostDesk {
  id: string
  /** As the organisation names it. Never invented. */
  name: string
  isGovernance: boolean
}

/**
 * What the firm is doing, in words a host may repeat.
 *
 * Enough for "Investeringskommittén arbetar · Equity · Rates · Macro", and
 * nothing a host would have to understand the run table to read.
 */
export interface HostActivity {
  /** Where the case is, as the firm's process names it. */
  stage: CaseStage
  /** The desks the case engages — assigned or acted, as the organisation names them. */
  desks: readonly HostDesk[]
  /** The institutional steps still owed. */
  outstanding: readonly CaseStep[]
  /** Runs genuinely in flight at the moment of the read: running, inside their own deadline. */
  inFlight: number
  /**
   * Runs the record calls `running` that the firm cannot verify are: past
   * their recorded deadline, or without one. A process that died leaves
   * exactly this behind. Never counted as work.
   */
  unverified: number
  /** Produced work the firm holds that its desk has not yet adopted. */
  awaitingAdoption: number
}

/**
 * Why the firm has stopped, and whose act it is.
 *
 * Typed so a host can explain the missing decision naturally without knowing
 * a command name. `institutional-initialization-required` is TD-88: the
 * question is registered and the committee convened, and the firm has no
 * authorised path to its own opening thesis. The gateway never manufactures
 * one.
 */
export type HostDecision =
  | { reason: 'institutional-initialization-required' }
  | { reason: 'cio-decision-required' }
  | {
      reason: 'institutional-act-required'
      /** The firm's own name for the outstanding act. */
      act: InstitutionalAct
      /** Whose queue it is in, where the firm names one. */
      owner: HostDesk | null
    }

/**
 * The institution's result, in typed form.
 *
 * Every field is read from a persisted record — the live decision, the
 * revision it selected, the dissent it acknowledged, the triggers it set. No
 * model is consulted to produce it and nothing is summarised. A host phrases
 * it; it does not get to improve it.
 */
export interface InstitutionalAnswer {
  decision: {
    decisionId: string
    outcome: CioDecisionOutcome['kind']
    /** Every revision the decision considered, so an alternative is never lost. */
    consideredRevisionIds: readonly string[]
    rationale: string
    decidedAt: string
    decidedByEmployeeId: string
    authorizationBasis: string
    evidenceSetId: string
  }
  /** The revision the firm now holds, where the outcome selected one. */
  thesis: {
    revisionId: string
    statement: string
    position: string
    /** What would have to happen for the firm to be wrong. */
    invalidationCriteria: string
    horizon?: string
    implications: readonly string[]
    proposedByDepartmentId: string
  } | null
  /** Objections acknowledged and decided against. Never dropped, never softened. */
  dissent: readonly {
    sourceId: string
    source: DissentSource
    materiality: DisagreementMateriality
    /** In the words of whoever raised it. */
    rationale: string
    raisedByDepartmentId?: string
    /** The CIO's own words on why they decided anyway, where materiality required them. */
    acknowledgement?: string
    disposition: DisclosedDissent['dispositionAtDecision']
  }[]
  /** How many of those are material or above — the count a host must not hide. */
  materialDissentCount: number
  /** What would bring the case back. */
  reconsiderationTriggers: readonly {
    id: string
    conditionType: TriggerConditionType
    rationale: string
    qualitativeCondition?: string
    threshold?: { amount: string; unit: string; currency?: string }
  }[]
}

export interface HostClaim {
  id: string
  statement: string
  type: string
  status: string
  confidence: ConfidenceLevel
  supportsThesisId?: string
  opposesThesisId?: string
}

/** One objection with the act that filed it beside it. */
export interface HostObjection extends BoardroomObjection {
  reviewId: string
  byDepartmentId: string
  /** Under which mandate it was raised. */
  raisedAs: 'peer-examination' | 'devils-advocate'
  /** True when a later act of the same kind replaced the review it came from. */
  superseded: boolean
}

export type HostInspection =
  | {
      view: 'debate'
      entries: readonly BoardroomEntry[]
      seats: readonly BoardroomSeat[]
    }
  | {
      view: 'desk'
      desk: HostDesk
      participation: SeatParticipation
      entries: readonly BoardroomEntry[]
      claims: readonly HostClaim[]
    }
  | { view: 'objections'; objections: readonly HostObjection[] }

/** What every positive answer carries: enough to bind the next turn back here. */
interface HostCaseContext {
  reference: DomainReference
  question: string
  subject: string
  surfaces: HostSurfaces
  activity: HostActivity
}

export type UnsupportedReason =
  /** Not a Financial OS case reference, or a case the firm does not hold. */
  | 'unknown-reference'
  /** The firm has no approved workflow for this kind of question. */
  | 'not-routable'
  /** A desk the organisation does not have. */
  | 'unknown-desk'
  /** Settled without a conclusion the product can present. */
  | 'no-institutional-conclusion'

export type FailureReason =
  | 'invalid-request'
  | 'operator-unresolved'
  /** The question is registered; the committee was not convened. `resume` it. */
  | 'convening-incomplete'
  | 'not-configured'
  | 'service-unavailable'
  /** The institution declined, with its own bounded code beside. */
  | 'refused'

export type HostResult =
  /** A run is genuinely in flight. Only then. */
  | (HostCaseContext & { state: 'working'; inspection?: HostInspection })
  /**
   * The institution has decided and stands behind it. `answer` is carried by
   * `result`; `status` states the fact without the material.
   */
  | (HostCaseContext & {
      state: 'answer-ready'
      answer?: InstitutionalAnswer
      inspection?: HostInspection
    })
  /** The next act is somebody's to take, and `decision` says whose and which. */
  | (HostCaseContext & {
      state: 'needs-decision'
      decision: HostDecision
      inspection?: HostInspection
    })
  | { state: 'unsupported'; reason: UnsupportedReason; reference?: DomainReference }
  | {
      state: 'failed'
      reason: FailureReason
      /** The institution's own bounded code, where it gave one. */
      code?: string
      /** The request field that failed validation, where one did. */
      field?: string
      reference?: DomainReference
      /** True when `resume` against `reference` is the remedy. */
      resumable?: boolean
    }

/* --------------------------------------------------------------- parsing */

export type ParsedHostRequest =
  { ok: true; request: HostRequest } | { ok: false; field: string }

const REQUEST_KINDS = new Set(['ask', 'resume', 'status', 'result', 'inspect'])
const INSPECT_KINDS = new Set(['debate', 'desk', 'objections'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

/**
 * Refuses any key the contract does not name.
 *
 * The important refusal is a field like `actingEmployeeId` or `actorId`
 * beside an `ask`: silently ignoring it would let a caller believe it chose
 * the actor, and honouring it would let it actually do so. Both are worse
 * than saying no by name.
 */
function onlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): string | null {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return key
  }
  return null
}

function parseReference(value: unknown, path: string): DomainReference | string {
  if (!isRecord(value)) return path
  const stray = onlyKeys(value, ['system', 'kind', 'id', 'provenanceId'])
  if (stray) return `${path}.${stray}`
  for (const key of ['system', 'kind', 'id', 'provenanceId'] as const) {
    if (!nonEmptyString(value[key])) return `${path}.${key}`
  }
  /*
   * Shape only. Whether `system` and `kind` name something the firm holds is
   * the gateway's answer (`unsupported`), not a malformed request.
   */
  return {
    system: value.system as DomainReference['system'],
    kind: value.kind as DomainReference['kind'],
    id: value.id as string,
    provenanceId: value.provenanceId as string,
  }
}

function parseView(value: unknown): InspectView | string {
  if (!isRecord(value)) return 'view'
  if (typeof value.kind !== 'string' || !INSPECT_KINDS.has(value.kind)) return 'view.kind'
  if (value.kind === 'desk') {
    const stray = onlyKeys(value, ['kind', 'departmentId'])
    if (stray) return `view.${stray}`
    if (!nonEmptyString(value.departmentId)) return 'view.departmentId'
    return { kind: 'desk', departmentId: value.departmentId }
  }
  const stray = onlyKeys(value, ['kind'])
  if (stray) return `view.${stray}`
  return { kind: value.kind as 'debate' | 'objections' }
}

/**
 * The only way a request enters the gateway. Unknown input in, a typed
 * request or the name of the offending field out.
 */
export function parseHostRequest(input: unknown): ParsedHostRequest {
  if (!isRecord(input)) return { ok: false, field: 'request' }
  if (typeof input.kind !== 'string' || !REQUEST_KINDS.has(input.kind)) {
    return { ok: false, field: 'kind' }
  }

  if (input.kind === 'ask') {
    const stray = onlyKeys(input, ['kind', 'requestId', 'question', 'subject'])
    if (stray) return { ok: false, field: stray }
    for (const key of ['requestId', 'question', 'subject'] as const) {
      if (!nonEmptyString(input[key])) return { ok: false, field: key }
    }
    return {
      ok: true,
      request: {
        kind: 'ask',
        requestId: input.requestId as string,
        question: input.question as string,
        subject: input.subject as string,
      },
    }
  }

  const allowed =
    input.kind === 'inspect' ? ['kind', 'reference', 'view'] : ['kind', 'reference']
  const stray = onlyKeys(input, allowed)
  if (stray) return { ok: false, field: stray }

  const reference = parseReference(input.reference, 'reference')
  if (typeof reference === 'string') return { ok: false, field: reference }

  if (input.kind === 'inspect') {
    const view = parseView(input.view)
    if (typeof view === 'string') return { ok: false, field: view }
    return { ok: true, request: { kind: 'inspect', reference, view } }
  }

  return {
    ok: true,
    request: { kind: input.kind as 'resume' | 'status' | 'result', reference },
  }
}

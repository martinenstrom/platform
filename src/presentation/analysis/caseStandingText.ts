/**
 * Institutional codes → what a person reads, and how it looks.
 *
 * The domain speaks in identifiers: `record-verification-review`,
 * `not-applicable`, `decide-or-return`. This is the one place they become
 * Swedish, and the one place they acquire a colour.
 *
 * ## Why the mapping is exhaustive rather than defaulted
 *
 * Every record below is keyed by the union it renders, with no fallback entry.
 * A new institutional act therefore fails the typecheck here rather than
 * rendering as a blank on the floor — the reader would have no way of telling
 * "nothing is owed" from "the interface has not been taught this yet".
 *
 * ## Distinct obligations get distinct visuals
 *
 * The governing rule for this whole surface: if two institutional states would
 * lead a reader to do different things, they must not look the same. That is
 * why `not-applicable` is not styled as `complete` — a control the firm decided
 * it did not need, and a control that passed, place different obligations on
 * whoever reads the record later, and a shared green tick would erase that.
 *
 * Domain vocabulary is NOT translated. `decision-critical` and
 * `CHALLENGE_UNRESOLVED` are identifiers the firm uses in its records; turning
 * them into Swedish prose here would invent a second vocabulary for one fact.
 */

import type {
  CaseStep,
  InstitutionalAct,
  StepStatus,
  CaseOwnership,
  CaseStage,
} from '~/domain/analysis'
import type { RecordedEligibility } from '~/application/analysis/caseOverview'
import type { Tone } from '~/types'

export interface Rendered {
  label: string
  tone: Tone
}

/* ---------------------------------------------------------------- the steps */

export const STEP_LABEL: Record<CaseStep, string> = {
  'thesis-proposed': 'Tes formulerad',
  'peer-examination': 'Kollegial granskning',
  'work-aggregated': 'Arbetet sammanvägt',
  verification: 'Faktagranskning',
  'devils-advocate': "Devil's Advocate",
  risk: 'Riskgranskning',
  'cio-submission': 'Inlämnad till CIO',
  'cio-decision': 'CIO-beslut',
}

/**
 * Three states, three appearances.
 *
 * `not-applicable` is deliberately neutral rather than positive: the firm ruled
 * the control was not owed here, which is a different fact from the control
 * having run and passed. A reader auditing this case later needs to see which
 * of the two happened.
 */
export const STEP_STATUS: Record<StepStatus, Rendered> = {
  complete: { label: 'Klart', tone: 'positive' },
  outstanding: { label: 'Utestående', tone: 'warning' },
  'not-applicable': { label: 'Ej tillämplig', tone: 'neutral' },
}

/* ---------------------------------------------------------------- the stage */

export const STAGE_LABEL: Record<CaseStage, string> = {
  intake: 'Inkommen',
  research: 'Analysarbete',
  aggregation: 'Sammanvägning',
  review: 'Granskning',
  returned: 'Återsänd',
  blocked: 'Blockerad',
  decision: 'Hos CIO',
  decided: 'Beslutad',
  deferred: 'Bordlagd',
  published: 'Publicerad',
  withdrawn: 'Tillbakadragen',
}

/**
 * `blocked` and `returned` are warnings, not failures.
 *
 * Both are legitimate institutional states — work comes back and work gets
 * stuck — and rendering either as an error would tell a reader something went
 * wrong with the *system* rather than with the argument.
 *
 * `deferred` is neutral and NOT the same as `decided`: the CIO chose to wait,
 * which is an answer, but not the same answer as committing.
 */
export const STAGE_TONE: Record<CaseStage, Tone> = {
  intake: 'neutral',
  research: 'accent',
  aggregation: 'accent',
  review: 'accent',
  returned: 'warning',
  blocked: 'warning',
  decision: 'accent',
  decided: 'positive',
  deferred: 'neutral',
  published: 'positive',
  withdrawn: 'neutral',
}

/* -------------------------------------------------------------- the next act */

/**
 * What the institution does next, in the imperative.
 *
 * Phrased as an instruction because that is what it is. "Faktagranskning
 * utestående" describes a state; "Registrera faktagranskning" tells the desk
 * holding this case what to do about it.
 */
export const ACT_LABEL: Record<InstitutionalAct, string> = {
  'propose-thesis': 'Formulera en tes',
  'aggregate-conclusion': 'Sammanväg desken arbete',
  'submit-for-verification': 'Lämna in för granskning',
  'record-verification-review': 'Registrera faktagranskning',
  'record-peer-examination': 'Låt ett analysdesk granska slutsatsen',
  'record-devils-advocate-review': "Registrera Devil's Advocate-utlåtande",
  'resolve-risk-requirement': 'Avgör om Risk ska granska',
  'record-risk-review': 'Registrera riskgranskning',
  'submit-for-cio-decision': 'Lämna in för CIO-beslut',
  'decide-or-return': 'Fatta beslut eller återsänd',
  'resubmit-after-return': 'Åtgärda och lämna in på nytt',
  unblock: 'Undanröj det som blockerar',
  'none-settled': 'Inget utestående — ärendet är avgjort',
}

/* ------------------------------------------------------------- the ownership */

/**
 * Whose desk it is on.
 *
 * A settled case returns `null`, and the caller must render that as "nobody"
 * rather than as an empty name. An unattributed owner and no owner are
 * different claims: the first says the system lost track, the second says the
 * work is finished.
 */
export function ownershipText(ownership: CaseOwnership): string | null {
  if (ownership.kind === 'settled') return null
  if (ownership.kind === 'chief') return ownership.employeeId ?? 'CIO'
  return ownership.departmentId ?? ownership.employeeId ?? null
}

/* ------------------------------------------------------------- eligibility */

/**
 * The three eligibility states, kept apart.
 *
 * `not-submitted` is not a failure and not a pass — nobody has judged this yet.
 * `policy-unresolvable` is a genuine problem with the record: the basis names a
 * rule this build cannot resolve, so the firm cannot reproduce its own verdict.
 * Collapsing any of these into "not eligible" would tell a reader the argument
 * was rejected when it was not.
 */
export function eligibilityText(eligibility: RecordedEligibility): Rendered {
  switch (eligibility.kind) {
    case 'not-submitted':
      return { label: 'Inte inlämnad för beslut', tone: 'neutral' }
    case 'policy-unresolvable':
      return {
        label: `Policy "${eligibility.policyVersion}" kan inte läsas`,
        tone: 'negative',
      }
    case 'recorded':
      return eligibility.report.eligible
        ? { label: 'Uppfyllde kraven', tone: 'positive' }
        : { label: 'Uppfyllde inte kraven', tone: 'warning' }
  }
}

/**
 * Gate status, with the same three-way discipline as steps.
 *
 * `not-applicable` means the policy placed that control outside its scope. It
 * is not a pass, and the wording says so rather than leaving a reader to infer
 * that everything was checked.
 */
/**
 * What the CIO decided, in the words the firm shows for it.
 *
 * One mapping, because two would drift: the decision history and the committee
 * table must never name the same stored outcome differently. The keys are the
 * persisted `outcome.kind` and nothing is worded for a kind the domain cannot
 * produce.
 */
export const DECISION_OUTCOME_LABEL: Record<string, string> = {
  selected: 'Position tagen',
  declined: 'Avböjt',
  /* The CIO looked and chose to wait — an answer, not a commitment. */
  deferred: 'Bordlagt',
}

export const GATE_STATUS: Record<'passed' | 'failed' | 'not-applicable', Rendered> = {
  passed: { label: 'Godkänd', tone: 'positive' },
  failed: { label: 'Ej uppfylld', tone: 'warning' },
  'not-applicable': { label: 'Utanför policyns omfattning', tone: 'neutral' },
}

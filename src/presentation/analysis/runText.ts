/**
 * What a run is, in Swedish, and how it looks.
 *
 * The sibling of `caseStandingText`, for the staff side of the institution.
 * The domain speaks in identifiers — `awaiting-acceptance`, `budget-exhausted`,
 * `unsupported-by-evidence` — and this is the one place they become words a
 * person reads.
 *
 * ## Exhaustive, with no fallback
 *
 * Every record is keyed by the union it renders. A new run state therefore
 * fails the typecheck here rather than appearing on the floor as a blank or as
 * its own identifier — a reader has no way of telling "nothing happened" from
 * "the interface has not been taught this yet".
 *
 * ## The three distinctions this module exists to keep visible
 *
 * **`rejected` is not `failed`.** A failed run produced nothing and something
 * went wrong with the provider; a rejected run produced work every call
 * succeeded at, which a person then judged inadequate. Rendering both in the
 * same red would collapse "how often does this desk break" and "how often is
 * its work not good enough" into one signal, and those are the two different
 * questions worth asking about an employee.
 *
 * **`awaiting-acceptance` owes somebody something.** It is the one state on
 * this surface where the institution is waiting on a *person*, so it is styled
 * like every other outstanding obligation rather than like work in progress.
 *
 * **A stub is never dressed as a model.** `PROVIDER_KIND_LABEL` exists so that
 * replayed and synthetic work cannot read as analysis the firm stands behind —
 * the same rule `ExecutionIdentity` enforces in the record, carried onto the
 * screen where a reader could otherwise be misled by a plausible-looking row.
 *
 * ## It decides nothing
 *
 * Every function here maps a value it is given. Nothing computes a state,
 * infers a standing, or derives a confidence — those are institutional answers
 * with exactly one home each, and none of them is this file.
 */

import type {
  ContributionRejection,
  ContributionRejectionCode,
  ExecutionBudget,
  ExecutionIdentity,
  ProviderKind,
  RunFailureCategory,
  RunState,
  RunUsage,
} from '~/domain/analysis'
import type { Tone } from '~/types'

export interface Rendered {
  label: string
  tone: Tone
}

/* ----------------------------------------------------------------- states */

export const RUN_STATE_LABEL: Record<RunState, string> = {
  queued: 'I kö',
  'waiting-for-dependencies': 'Väntar på underlag',
  ready: 'Redo',
  running: 'Pågår',
  'awaiting-acceptance': 'Väntar på godkännande',
  completed: 'Godkänd och införd',
  rejected: 'Avvisad',
  failed: 'Misslyckades',
  'timed-out': 'Hann inte klart',
  cancelled: 'Avbruten',
  superseded: 'Ersatt',
  blocked: 'Blockerad',
}

/**
 * How each state looks, and why.
 *
 * `awaiting-acceptance` is a warning because a person owes an act — the same
 * treatment an outstanding workflow step gets, for the same reason.
 *
 * `rejected` is a warning and NOT negative: the firm declined the work, which
 * is the institution working correctly rather than something breaking.
 * `failed` and `timed-out` are negative because something actually went wrong.
 *
 * `superseded` and `cancelled` are neutral: neither is a fault and neither owes
 * anybody anything. They are distinguished from each other, and from `queued`,
 * by their labels — a shared tone is not a shared meaning.
 */
export const RUN_STATE_TONE: Record<RunState, Tone> = {
  queued: 'neutral',
  'waiting-for-dependencies': 'neutral',
  ready: 'neutral',
  running: 'accent',
  'awaiting-acceptance': 'warning',
  completed: 'positive',
  rejected: 'warning',
  failed: 'negative',
  'timed-out': 'negative',
  cancelled: 'neutral',
  superseded: 'neutral',
  blocked: 'warning',
}

export function runStateText(state: RunState): Rendered {
  return { label: RUN_STATE_LABEL[state], tone: RUN_STATE_TONE[state] }
}

/* ---------------------------------------------------------------- failures */

/**
 * Why a run stopped, from the closed vocabulary.
 *
 * Phrased as what happened, never as what to do about it: the category is a
 * fact the record carries, and turning it into an instruction here would be
 * this file deciding something.
 */
export const RUN_FAILURE_LABEL: Record<RunFailureCategory, string> = {
  'provider-unavailable': 'Leverantören kunde inte nås',
  'provider-timeout': 'Leverantören svarade inte i tid',
  'provider-error': 'Leverantören svarade med ett fel',
  'malformed-output': 'Svaret gick inte att tolka',
  'schema-violation': 'Svaret följde ett annat kontrakt än det deklarerade',
  'budget-exhausted': 'Budgeten tog slut',
  'evidence-unavailable': 'Underlaget kunde inte hämtas',
  'upstream-failed': 'Ett tidigare steg misslyckades',
  'cancelled-by-organization': 'Firman drog tillbaka arbetet',
  'revision-superseded': 'Tesen ersattes under arbetets gång',
  'internal-error': 'Ett internt fel',
}

/* -------------------------------------------------------------- rejections */

/**
 * Why a person declined the work.
 *
 * Each names what was wrong, never how it scored — the same discipline the code
 * vocabulary itself was written under, carried into the wording so that a
 * reader counting rejections over years reads the same categories the record
 * stores.
 */
export const REJECTION_CODE_LABEL: Record<ContributionRejectionCode, string> = {
  'unsupported-by-evidence': 'Går längre än underlaget visar',
  'misread-the-brief': 'Besvarade en annan fråga',
  'internally-inconsistent': 'Resonemanget motsäger sig självt',
  'duplicates-existing-work': 'Tillför inget nytt',
  'insufficient-analysis': 'Analysen gick inte tillräckligt långt',
  'out-of-scope': 'Riktigt, men inte den här avdelningens arbete',
}

/**
 * Who declined the work, named as what they are.
 *
 * A rejection is declined by exactly one accountable principal, and that
 * principal is a person or a desk agent. Reading only the employee field left a
 * blank wherever an agent had refused work — which reads as "nobody declined
 * this" rather than as the institutional act it was.
 */
export function rejectedByText(rejection: ContributionRejection): string {
  if (rejection.rejectedByAgentPrincipalId) {
    /*
     * Said out loud. A desk agent's id rendered bare would read as a person's,
     * and the human/agent boundary is not something a reader should have to
     * infer from an id's spelling.
     */
    return `${rejection.rejectedByAgentPrincipalId} (agent)`
  }
  /*
   * The domain guarantees exactly one principal, but presentation may not
   * import the domain to assert it — so an empty pair renders as the honest
   * answer rather than as a blank, which would read as "nobody declined this".
   */
  return rejection.rejectedByEmployeeId ?? 'okänd principal'
}

/* ---------------------------------------------------------------- producers */

/**
 * What produced the work.
 *
 * The label a reader most needs and would least expect to matter: replayed and
 * synthetic work must never present as live analysis. A row that did not say
 * which it was would let a fixture read as something the firm paid for and
 * stands behind.
 */
export const PROVIDER_KIND_LABEL: Record<ProviderKind, string> = {
  live: 'Live-modell',
  recorded: 'Inspelad körning',
  stub: 'Simulerad',
}

/** Only live work is the firm's own analysis; the rest is machinery. */
export const PROVIDER_KIND_TONE: Record<ProviderKind, Tone> = {
  live: 'accent',
  recorded: 'neutral',
  stub: 'neutral',
}

/**
 * Which model answered, where one legitimately did.
 *
 * `null` for the two identities that have no model, rather than a placeholder:
 * "there was no model" and "we do not know which" are different facts, and the
 * union exists precisely so neither can be dressed as the other.
 */
export function modelText(identity: ExecutionIdentity): string | null {
  switch (identity.kind) {
    case 'model':
      return `${identity.model.provider}/${identity.model.id}`
    case 'unavailable':
      return null
    case 'scenario':
      return null
  }
}

/* ------------------------------------------------------- budget and usage */

/**
 * A number a person can read, with a space as the thousands separator.
 *
 * Written out rather than taken from `toLocaleString`, which would render
 * differently depending on the environment's locale data — a token count that
 * changes shape between a developer's machine and a server is a number nobody
 * can quote back.
 */
function grouped(value: number): string {
  return Math.abs(value)
    .toFixed(0)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

/** Minor units to a plain decimal, so 100 USD-cents reads as `1.00 USD`. */
function money(costMinorUnits: number, currency: string): string {
  return `${(costMinorUnits / 100).toFixed(2)} ${currency}`
}

/**
 * What the firm authorized, per dimension.
 *
 * Each of the three states is rendered distinctly, because they are three
 * different facts about the firm: a limit it set, a dimension the producer
 * cannot consume at all, and a dimension nobody decided. Collapsing
 * `not-applicable` and `not-measured` into one blank would erase exactly the
 * distinction the budget type was reshaped to express.
 */
export function budgetText(budget: ExecutionBudget): readonly string[] {
  const lines: string[] = []

  lines.push(
    budget.tokens.kind === 'limit'
      ? `${grouped(budget.tokens.tokens)} tokens`
      : budget.tokens.kind === 'not-applicable'
        ? 'Tokens: inte tillämpligt'
        : 'Tokens: inte fastställt',
  )
  lines.push(
    budget.cost.kind === 'limit'
      ? money(budget.cost.costMinorUnits, budget.cost.currency)
      : budget.cost.kind === 'not-applicable'
        ? 'Kostnad: inte tillämpligt'
        : 'Kostnad: inte fastställd',
  )
  lines.push(
    budget.deadline.kind === 'limit'
      ? `${Math.round(budget.deadline.deadlineMs / 1000)} s`
      : budget.deadline.kind === 'not-applicable'
        ? 'Tidsgräns: inte tillämplig'
        : 'Tidsgräns: inte fastställd',
  )
  return lines
}

/**
 * What it actually spent.
 *
 * `not-reported` is rendered as the provider having said nothing, never as
 * zero. A silent provider and a free call are different facts, and the whole
 * reason usage is a state rather than a nullable number is that reading one as
 * the other falls on the side that costs money.
 */
export function usageText(usage: RunUsage): string {
  switch (usage.state) {
    case 'not-applicable':
      return 'Förbrukade ingenting'
    case 'not-reported':
      return 'Leverantören rapporterade ingen förbrukning'
    case 'measured': {
      const tokens = `${grouped(usage.inputTokens)} in / ${grouped(usage.outputTokens)} ut`
      return usage.cost.state === 'measured'
        ? `${tokens} · ${money(usage.cost.costMinorUnits, usage.cost.currency)}`
        : `${tokens} · kostnad ej rapporterad`
    }
  }
}

/**
 * Commissioning, in Swedish.
 *
 * The sibling of `runText` for the act rather than the record. Every value here
 * is a mapping of something the institution decided: which cases it will not
 * take work against and why, and what came of an act it was asked to perform.
 *
 * ## A refusal is an answer, and it says what to do
 *
 * The refusal vocabulary is the whole reason this file exists. "Commissioning
 * unavailable" tells a person nothing and reads as a fault; *"this case runs
 * under macro-regime v1, which authorizes no budget for live work"* tells them
 * the firm looked, decided, and what would have to change. Each line below is
 * written to leave the reader knowing which of those two happened.
 *
 * ## It decides nothing
 *
 * Every function maps a value it is handed. Nothing here evaluates eligibility,
 * resolves a budget or infers a state — the read model did all three, and a
 * second opinion formed on the way to the screen would be the second answer the
 * architecture exists to prevent.
 */

import type { CaseStage } from '~/domain/analysis'
import type {
  CommissionActRefusal,
  CommissionEligibility,
  CommissionRefusalReason,
  EvidenceOffer,
} from '~/application/analysis/commissionAnalysis'
import type { Tone } from '~/types'

/**
 * Why the firm will not take this work against this case.
 *
 * Exhaustive over the closed vocabulary, with no fallback: a reason added to
 * the institution and not to this record fails the typecheck here rather than
 * reaching a person as a blank.
 */
export const COMMISSION_REFUSAL_LABEL: Record<CommissionRefusalReason, string> = {
  'case-accepts-no-new-work': 'Ärendet är avslutat och tar inte emot nytt arbete.',
  'workflow-does-not-assign-this':
    'Ärendets arbetsflöde ger inte den här avdelningen det här uppdraget.',
  'no-assignment': 'Ärendet har inget uppdrag för den här avdelningen att plocka upp.',
  'assignment-not-waiting':
    'Uppdraget väntar inte på att plockas upp — det pågår eller är redan avslutat.',
  'dependencies-not-met':
    'Arbetet bygger på underlag som ingen har godkänt ännu. Producerat arbete räcker inte.',
  /*
   * The v1 refusal, and the one most likely to be misread as a bug. It names
   * the workflow version because that is the thing that would have to change,
   * and it says "not decided" rather than "missing": `not-measured` is not
   * `unlimited`, and the firm not having authorized spend is the budget design
   * working rather than a gap in it.
   */
  'no-authorized-budget':
    'Ärendets arbetsflödesversion har ingen fastställd budget för det här uppdraget. ' +
    'Firman påbörjar inte arbete den inte har godkänt kostnaden för.',
}

/**
 * Every refusal the act itself can return.
 *
 * The eligibility reasons, plus the two a person could not have seen coming:
 * the surface offers only cases and evidence it read a moment ago, so these are
 * races rather than choices, and each says to look again rather than implying
 * the firm decided something.
 */
export const COMMISSION_ACT_REFUSAL_LABEL: Record<CommissionActRefusal, string> = {
  ...COMMISSION_REFUSAL_LABEL,
  'case-not-found': 'Ärendet finns inte längre. Läs om sidan.',
  'evidence-not-found': 'Underlaget finns inte längre. Läs om sidan.',
  'evidence-has-no-observations':
    'Underlaget innehåller inga observationer och kan inte ligga till grund för arbete.',
}

/**
 * The refusal, with the specifics the read model carried alongside it.
 *
 * The extra clause is the difference between a rule and an explanation: a
 * reader told "dependencies not met" still has to go and find out which.
 */
export function commissionRefusalText(eligibility: CommissionEligibility): string {
  if (eligibility.kind === 'eligible') return ''
  const base = COMMISSION_REFUSAL_LABEL[eligibility.reason]
  switch (eligibility.reason) {
    case 'dependencies-not-met':
      return `${base} Väntar på: ${eligibility.unmet.join(', ')}.`
    case 'assignment-not-waiting':
      return `${base} Status: ${ASSIGNMENT_STATUS_LABEL[eligibility.status] ?? eligibility.status}.`
    case 'no-authorized-budget':
      return `${base} Ofastställt: ${eligibility.unmeasured
        .map((dimension) => BUDGET_DIMENSION_LABEL[dimension] ?? dimension)
        .join(', ')}.`
    case 'case-accepts-no-new-work':
      return `${base} Skede: ${CASE_STAGE_LABEL[eligibility.stage] ?? eligibility.stage}.`
    default:
      return base
  }
}

/** Keyed loosely on purpose: these annotate a refusal rather than carry it. */
const ASSIGNMENT_STATUS_LABEL: Record<string, string> = {
  queued: 'i kö',
  active: 'pågår',
  waiting: 'väntar',
  submitted: 'inlämnat',
  returned: 'återsänt',
  completed: 'avslutat',
  failed: 'misslyckat',
  cancelled: 'avbrutet',
}

const BUDGET_DIMENSION_LABEL: Record<string, string> = {
  tokens: 'tokens',
  cost: 'kostnad',
  deadline: 'tidsgräns',
}

export const CASE_STAGE_LABEL: Record<CaseStage, string> = {
  intake: 'Inkommet',
  research: 'Analys',
  aggregation: 'Sammanvägning',
  review: 'Granskning',
  returned: 'Återsänt',
  blocked: 'Blockerat',
  decision: 'Hos CIO',
  decided: 'Beslutat',
  deferred: 'Uppskjutet',
  published: 'Publicerat',
  withdrawn: 'Avskrivet',
}

/** What an evidence set is, and whether the firm will reason over it. */
/**
 * How the set came to exist, in one line.
 *
 * `null` for a pre-C3 set, and the surface says so rather than leaving a blank:
 * a set assembled before `AssembleEvidenceSet` existed genuinely has no
 * recorded selection, and inventing one would describe an act nobody performed.
 */
export function evidenceSelectionText(offer: EvidenceOffer): string | null {
  if (!offer.selection) return null
  const selection = offer.selection
  return (
    `${selection.ruleId} · ${selection.subjectFamily} · ` +
    `${selection.from}–${selection.to} · som firman visste ${selection.knownAt} · ` +
    `sammanställt av ${selection.actorEmployeeId}`
  )
}

/** Said once, where a set carries no recorded selection. */
export const EVIDENCE_WITHOUT_SELECTION =
  'Sammanställdes innan firman bokförde urvalsregler. Innehållet är läsbart och ' +
  'citerbart, men urvalet kan inte reproduceras.'

export function evidenceOfferText(offer: EvidenceOffer): {
  summary: string
  refusal: string | null
  tone: Tone
} {
  /*
   * The derived members are named by their methodology rather than counted
   * anonymously. `spread-2s10s@1` is what the firm actually holds, version
   * included, and a reader choosing between two sets needs to see which
   * derivation each one carries.
   */
  const summary = [
    `${offer.observationCount} observationer`,
    offer.derivedCount > 0
      ? `${offer.derivedCount} härledda (${offer.derivedMethodologies.join(', ')})`
      : null,
    offer.sources.length > 0 ? offer.sources.join(', ') : 'ingen källa',
    offer.disagreementCount > 0
      ? `${offer.disagreementCount} motsägelser mellan källor`
      : null,
    offer.revisionCount > 0 ? `${offer.revisionCount} revideringar` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')

  return offer.eligibility.kind === 'eligible'
    ? { summary, refusal: null, tone: 'neutral' }
    : {
        summary,
        /*
         * An assembled set holding nothing. Refused rather than offered, so a
         * live desk is never handed nothing to reason over and asked to
         * produce something anyway.
         */
        refusal:
          'Underlaget innehåller inga observationer och kan inte ligga till grund för arbete.',
        tone: 'warning',
      }
}

/**
 * What the firm did, once asked.
 *
 * The three outcomes are kept apart because they place different obligations
 * on the reader: work exists and is waiting on them, the institution declined
 * and they may be able to correct it, or nothing was attempted at all.
 */
export const COMMISSION_DECLINE_TEXT: Record<string, string> = {
  'not-authorised':
    'Den du agerar som får inte beställa arbete åt den här avdelningen. Bara avdelningens egna medarbetare kan det.',
  'unknown-actor': 'Den du agerar som är inte anställd i firman.',
  'not-found': 'Ärendet, uppdraget eller medarbetaren finns inte.',
  'illegal-prior-state':
    'Uppdraget är inte i ett läge där det kan påbörjas. Läs om sidan — någon kan ha hunnit före.',
  'invariant-violated':
    'Beställningen bröt mot en regel firman upprätthåller, och ingenting påbörjades.',
  'aggregate-conflict': 'Ärendet ändrades under tiden. Läs om sidan och försök igen.',
  'payload-conflict':
    'Ett tidigare försök med samma identitet hade ett annat innehåll. Läs om sidan.',
}

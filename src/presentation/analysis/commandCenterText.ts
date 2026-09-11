/**
 * The Command Center's vocabulary, and the one fact it adds that the
 * institution does not hold: which acts this product can currently perform.
 *
 * ## Why reachability lives here and not in the domain
 *
 * The firm registers **twenty** institutional acts. The product can reach
 * four. That gap is a fact about the interface, not about the institution — a
 * case owing `record-verification-review` owes it whether or not anyone has
 * built a screen for it, and writing "unavailable" into the domain would let a
 * missing button change what the firm believes it owes.
 *
 * So the domain says what is owed, and this table says whether you can do
 * anything about it from here. When the answer is no, the surface says so
 * plainly rather than rendering a dead control or, worse, quietly omitting the
 * obligation — an obligation hidden because it is inconvenient to act on is
 * the failure this whole product exists to prevent.
 *
 * **This table is expected to shrink.** Every entry that becomes a route is a
 * capability phase closing part of the measured twenty-versus-four gap.
 */

import type { CaseStep, InstitutionalAct } from '~/domain/analysis'
import { ACT_LABEL, STEP_LABEL } from './caseStandingText'

/**
 * Where an act can be performed, or `null` when no surface exists yet.
 *
 * Read as data by the obligation list, so adding a screen is one edit here and
 * nothing conditional anywhere else.
 */
export const ACT_SURFACE: Readonly<Record<InstitutionalAct, string | null>> =
  Object.freeze({
    /*
     * Every entry is `null` today, and that is measured rather than pessimistic:
     * none of the acts a case can owe has a screen. The four acts the product
     * CAN perform — assemble evidence, commission a desk, accept, reject — are
     * desk-level and evidence-level acts, and none of them is what `nextAct`
     * names. So a person can put a desk to work and judge what it produces, and
     * still cannot advance the case itself one step.
     *
     * The Command Center's job in v1 is to make that visible instead of leaving
     * it to be discovered. It is not to hide it behind a button that does
     * nothing.
     */
    'propose-thesis': null,
    'aggregate-conclusion': null,
    'submit-for-verification': null,
    'record-verification-review': null,
    'record-peer-examination': null,
    'record-devils-advocate-review': null,
    'resolve-risk-requirement': null,
    'record-risk-review': null,
    'submit-for-cio-decision': null,
    'decide-or-return': null,
    'resubmit-after-return': null,
    /* Not an act with a screen: something else must move first. */
    unblock: null,
    'none-settled': null,
  })

/** True when a person can currently act on this from the product. */
export const actIsReachable = (act: InstitutionalAct): boolean =>
  ACT_SURFACE[act] !== null

/** The act, in the imperative, reusing the vocabulary the case pages use. */
export const actLabel = (act: InstitutionalAct): string => ACT_LABEL[act]

/**
 * What a step's absence means, said in the firm's own terms.
 *
 * Used by the panel that states what the Command Center cannot yet show. Each
 * line names the act that would produce the missing record, so the reader sees
 * a route rather than a dead end.
 */
export const STEP_ABSENCE: Readonly<Record<CaseStep, string>> = Object.freeze({
  'thesis-proposed':
    'Firman håller ingen investeringstes. Ingen tes har formulerats för något ärende.',
  'work-aggregated':
    'Inget deskarbete har sammanvägts till en slutsats av en ansvarig chef.',
  'peer-examination':
    'Inget analysdesk har granskat slutsatsen som kollega.',
  verification: 'Ingen faktagranskning har registrerats.',
  'devils-advocate': "Inget Devil's Advocate-utlåtande har registrerats.",
  risk: 'Ingen riskgranskning har registrerats.',
  'cio-submission': 'Inget ärende har lämnats in för CIO-beslut.',
  'cio-decision': 'Inget investeringsbeslut har fattats.',
})

export const stepLabel = (step: CaseStep): string => STEP_LABEL[step]

/**
 * A blocker kind as a short phrase.
 *
 * Falls back to the kind itself rather than to prose nobody wrote: an
 * unrecognised blocker must still be visible, and inventing a description for
 * it would be worse than showing the code.
 */
export const BLOCKER_TEXT: Readonly<Record<string, string>> = Object.freeze({
  'verification-missing': 'Faktagranskning saknas',
  'verification-correction-required': 'Faktagranskning kräver rättelse',
  'unresolved-citation': 'Olöst källhänvisning',
  'unresolved-material-challenge': 'Väsentlig invändning kvarstår',
  'decision-critical-disagreement': 'Beslutskritisk oenighet',
  'risk-requirement-unresolved': 'Riskkravet är inte avgjort',
  'risk-review-missing': 'Riskgranskning saknas',
  'risk-review-rejected': 'Riskgranskningen avslogs',
  'risk-review-not-expected': 'Riskgranskning som inte var väntad',
  'missing-required-contribution': 'Obligatoriskt underlag saknas',
  'required-assignment-failed': 'Ett obligatoriskt uppdrag misslyckades',
  'missing-evidence': 'Underlag saknas',
  'missing-provenance': 'Underlag utan härkomst',
  'superseded-revision': 'Arbetet avser en ersatt tes',
  'compliance-block': 'Compliance-spärr',
})

export const blockerText = (kind: string): string => BLOCKER_TEXT[kind] ?? kind

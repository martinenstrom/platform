/**
 * A claim, its evidence and its confidence, in words a person can judge.
 *
 * The third of the presentation vocabularies, beside `caseStandingText` (where
 * a case stands) and `runText` (what a run did). This one covers what an agent
 * actually asserted — and it is the vocabulary a reviewer reads most closely,
 * because accepting work is agreeing to be answerable for it.
 *
 * ## It renders confidence; it never computes it
 *
 * `ClaimConfidence` arrives with a level, a basis and — where a rule bit — the
 * cap that limited it. All three are already decided: `composeConfidence` in
 * the domain applies the rules, `resolveModelConfidence` takes the lower of
 * that and the model's proposal. Nothing here recalculates, re-weights or
 * summarises them into a score.
 *
 * ## The basis is shown as recorded, not translated
 *
 * `basis` strings are institutional text — `'proposed by the model'`,
 * `'rests on fixture data'` — written where the confidence was decided. They
 * are rendered verbatim, in the language the record holds them in, for the
 * reason `caseStandingText` states about domain vocabulary: turning them into
 * Swedish prose here would invent a second wording for one fact, and a reader
 * comparing a claim against the record would find two versions of the firm's
 * own reasoning.
 *
 * What this module does instead is say *what the basis is* — the firm's
 * recorded reasoning — and make the cap that bit legible beside it.
 */

import type {
  ClaimStatus,
  ClaimType,
  ConfidenceCap,
  ConfidenceLevel,
} from '~/domain/analysis'
import type { Quality, ProviderTrust } from '~/domain/shared/provenance'
import type { ReviewedCitation } from '~/application/analysis/runReview'
import type { Rendered } from './runText'

/* ----------------------------------------------------------------- claims */

/**
 * What kind of assertion this is.
 *
 * `causal` keeps its own word rather than being folded into an observation: a
 * claim that the 2Y rose and a claim that it rose BECAUSE the Fed turned
 * hawkish are different epistemic objects, and the reviewer's job is different
 * for each.
 */
export const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  observation: 'Observation',
  comparison: 'Jämförelse',
  trend: 'Trend',
  risk: 'Risk',
  forecast: 'Prognos',
  causal: 'Orsakssamband',
  recommendation: 'Rekommendation',
  counterclaim: 'Invändning',
}

/**
 * How well the evidence carries the claim, as the record states it.
 *
 * `insufficient-evidence` is a warning rather than an error: an agent saying
 * its own evidence does not carry the claim is the agent behaving correctly,
 * and colouring it red would tell a reviewer something went wrong.
 */
export const CLAIM_STATUS: Record<ClaimStatus, Rendered> = {
  supported: { label: 'Stöds av underlaget', tone: 'positive' },
  'partially-supported': { label: 'Delvis stött', tone: 'warning' },
  contested: { label: 'Motsägs av underlag', tone: 'warning' },
  'insufficient-evidence': { label: 'Otillräckligt underlag', tone: 'warning' },
}

/* ------------------------------------------------------------- confidence */

/**
 * The four levels.
 *
 * `insufficient` is not "low confidence" — it is the firm saying the claim
 * cannot be published at all on this evidence, and it must not read as the
 * bottom of a scale.
 */
export const CONFIDENCE_LEVEL: Record<ConfidenceLevel, Rendered> = {
  high: { label: 'Hög tillförlitlighet', tone: 'positive' },
  moderate: { label: 'Måttlig tillförlitlighet', tone: 'accent' },
  low: { label: 'Låg tillförlitlighet', tone: 'warning' },
  insufficient: { label: 'Otillräcklig — får inte publiceras', tone: 'negative' },
}

/** Which rule limited the level, where one did. */
export const CONFIDENCE_CAP_LABEL: Record<ConfidenceCap, string> = {
  'weakest-evidence': 'Begränsad av det svagaste underlaget',
  'fixture-evidence': 'Vilar på testdata',
  'stale-evidence': 'Delar av underlaget är inaktuellt',
  'methodology-mismatch': 'Jämför mått som inte är jämförbara',
  'missing-provenance': 'Underlag utan härkomst',
  'conflicting-evidence': 'Källorna säger emot varandra',
  'no-evidence': 'Ingen evidens är åberopad',
}

/**
 * Whether the firm capped this level itself, or is passing on the model's word.
 *
 * The distinction TD-75 exists to keep visible, and the one a reviewer most
 * needs: an uncapped level is the model's proposal that the firm could not
 * independently corroborate, because four of the seven confidence signals have
 * no institutional definition yet. Presenting that as the firm's own judgement
 * would be the model grading its own work through a longer route.
 */
export function confidenceOrigin(cappedBy: ConfidenceCap | undefined): Rendered {
  return cappedBy
    ? { label: 'Nedgraderad av firmans regler', tone: 'neutral' }
    : {
        label: 'Modellens förslag — inte oberoende bekräftat av firman',
        tone: 'warning',
      }
}

/* --------------------------------------------------------------- evidence */

/** How the source relates to the real market. */
export const QUALITY_LABEL: Record<Quality, string> = {
  realtime: 'Realtid',
  'near-realtime': 'Nära realtid',
  delayed: 'Fördröjd',
  eod: 'Stängningskurs',
  'official-daily': 'Officiell dagsnotering',
  derived: 'Härledd',
  fixture: 'Testdata',
}

/** What the party actually is. A broker is not the venue; an aggregator is not the source. */
export const TRUST_LABEL: Record<ProviderTrust, string> = {
  issuer: 'Emittent',
  'central-bank': 'Centralbank',
  'official-statistics': 'Officiell statistik',
  exchange: 'Börs',
  'licensed-vendor': 'Licensierad leverantör',
  broker: 'Mäklare',
  aggregator: 'Aggregator',
  derived: 'Härledd',
  synthetic: 'Syntetisk',
}

/**
 * What became of a citation, and how alarmed to be.
 *
 * The two failures are the reason the review surface resolves citations at
 * all. **`revised` is the one a reviewer cannot be expected to notice**: the
 * observation is still there, still looks right, and its value moved after the
 * claim quoted it. A reviewer accepting that claim would be making the firm
 * answerable for a number that has since changed.
 *
 * `unresolved` is worse and easier to see — the claim cites evidence the set
 * does not contain.
 */
export function citationText(citation: ReviewedCitation): Rendered {
  switch (citation.status) {
    case 'resolved':
      return { label: 'Underlaget stämmer', tone: 'positive' }
    case 'revised':
      return { label: 'Underlaget har ändrats sedan påståendet gjordes', tone: 'warning' }
    case 'unresolved':
      return citation.reason === 'wrong-set'
        ? { label: 'Hänvisar till ett annat underlag', tone: 'negative' }
        : { label: 'Hänvisar till underlag som inte finns', tone: 'negative' }
  }
}

/** True for the two outcomes a reviewer must act on rather than skim past. */
export function isCitationFinding(citation: ReviewedCitation): boolean {
  return citation.status !== 'resolved'
}

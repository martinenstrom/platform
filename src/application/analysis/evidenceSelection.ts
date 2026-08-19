/**
 * The selection rules an assembly may run — versioned, named, and the only way
 * observations become a body of evidence.
 *
 * `AssembleEvidenceSet` takes one of these and a window. It does **not** take a
 * list of observation ids, and the difference is the whole point (gate §0.3):
 * an assembler who names individual observations can drop the inconvenient
 * source, and the disagreement machinery — which computes conflicts from the
 * set's membership rather than being told about them — would never see it. An
 * assembler who names a family and a window gets whatever the firm holds for
 * it, disagreements and revisions included.
 *
 * ## What a rule id means
 *
 * `sovereign-yield-curve@1` binds three things at once: which series the family
 * expands to, how the store is queried for them, and which derivations run over
 * the result. Changing any of them is `@2`. A set assembled under `@1` stays
 * explicable by reading `@1`, which is the property that makes a stored
 * selection worth storing.
 *
 * ## Knowledge time is applied, never approximated
 *
 * The query carries `knownAt` straight through to `observations.series`, which
 * excludes versions the firm learned later rather than back-dating them. A rule
 * that quietly read the latest figure while its record said *as we knew it on
 * the 14th* would produce a set nobody could reproduce, and would do it
 * silently — which is worse than refusing.
 *
 * ## Derivation happens here, at assembly, and is recorded
 *
 * Gate §0.5: an important institutional derivation is a WRITE.
 * `deriveObservations` owns the arithmetic and the identity; this module owns
 * *when* it runs and *over what*. Nothing downstream — no read model, no
 * component, no prompt — recomputes a spread.
 */

import type { DurableObservation, EvidenceSelection } from '~/domain/analysis'
import type { ObservationRepository } from './repositories'
import { deriveCurveSlope, SPREAD_2S10S } from './deriveObservations'
import type { Maturity } from '~/domain/market'

/** One series in a family, with the tenor the institution knows it to be. */
interface FamilyMember {
  subject: string
  /** The provider's own series identifier, part of the natural key. */
  seriesId: string
  maturity: Maturity
}

/**
 * A derivation the rule performs over the selected members.
 *
 * Declared as data rather than written as a special case, so the rule's stored
 * id genuinely accounts for every fact the set contains. A derivation nobody
 * could read off the rule would be a member of the set that the recorded
 * selection did not explain.
 */
interface FamilyDerivation {
  methodology: string
  shortSubject: string
  longSubject: string
}

interface SubjectFamily {
  id: string
  /** Whose figures these are. Part of the natural key, never inferred. */
  sourceId: string
  kind: DurableObservation['ref']['kind']
  methodology: string
  countryCode: string
  members: readonly FamilyMember[]
  derivations: readonly FamilyDerivation[]
}

/**
 * The US Treasury par yield curve.
 *
 * The one family C3 builds (gate Decision 3), chosen because `usTreasury` is
 * the only authoritative adapter already returning a full term structure with
 * history, keyless and public domain. The tenors are the ones the Treasury
 * itself publishes; nothing is interpolated and nothing is inferred from a
 * display name.
 */
const US_PAR_CURVE: SubjectFamily = {
  id: 'us-par-curve',
  sourceId: 'treasury',
  kind: 'yield',
  methodology: 'par-yield',
  countryCode: 'US',
  members: [
    { subject: 'rate:us1m', seriesId: 'BC_1MONTH', maturity: '1M' },
    { subject: 'rate:us3m', seriesId: 'BC_3MONTH', maturity: '3M' },
    { subject: 'rate:us6m', seriesId: 'BC_6MONTH', maturity: '6M' },
    { subject: 'rate:us1y', seriesId: 'BC_1YEAR', maturity: '1Y' },
    { subject: 'rate:us2y', seriesId: 'BC_2YEAR', maturity: '2Y' },
    { subject: 'rate:us3y', seriesId: 'BC_3YEAR', maturity: '3Y' },
    { subject: 'rate:us5y', seriesId: 'BC_5YEAR', maturity: '5Y' },
    { subject: 'rate:us7y', seriesId: 'BC_7YEAR', maturity: '7Y' },
    { subject: 'rate:us10y', seriesId: 'BC_10YEAR', maturity: '10Y' },
    { subject: 'rate:us20y', seriesId: 'BC_20YEAR', maturity: '20Y' },
    { subject: 'rate:us30y', seriesId: 'BC_30YEAR', maturity: '30Y' },
  ],
  derivations: [
    { methodology: SPREAD_2S10S, shortSubject: 'rate:us2y', longSubject: 'rate:us10y' },
  ],
}

interface SelectionRule {
  id: string
  /** What the rule selects, stated so a reader need not infer it from code. */
  states: string
  families: readonly SubjectFamily[]
}

/**
 * The one registered selection rule.
 *
 * A registry rather than a convention, for the reason `productionCommands` is
 * one: "the approved list" and "what the code does" are otherwise two documents
 * that agree until they do not.
 */
export const SOVEREIGN_YIELD_CURVE_V1: SelectionRule = {
  id: 'sovereign-yield-curve@1',
  states:
    'Every par-yield observation the firm holds for the named curve family, ' +
    'one version per tenor and reference period as the firm knew it at the ' +
    'stated instant, plus the curve slopes the family declares.',
  families: [US_PAR_CURVE],
}

export const SELECTION_RULES: readonly SelectionRule[] = [SOVEREIGN_YIELD_CURVE_V1]

/** What a caller may offer, as data the surface can render without inventing it. */
export interface SelectionRuleOffer {
  ruleId: string
  states: string
  families: readonly { id: string; sourceId: string; subjectCount: number }[]
}

export function selectionRuleOffers(): readonly SelectionRuleOffer[] {
  return SELECTION_RULES.map((rule) => ({
    ruleId: rule.id,
    states: rule.states,
    families: rule.families.map((family) => ({
      id: family.id,
      sourceId: family.sourceId,
      subjectCount: family.members.length,
    })),
  }))
}

export class UnknownSelectionRuleError extends Error {
  constructor(readonly ruleId: string) {
    super(
      `"${ruleId}" is not a registered selection rule. An evidence set whose ` +
        `rule cannot be resolved is a set nobody can explain.`,
    )
    this.name = 'UnknownSelectionRuleError'
  }
}

export class UnknownSubjectFamilyError extends Error {
  constructor(
    readonly ruleId: string,
    readonly family: string,
  ) {
    super(`Rule "${ruleId}" declares no subject family "${family}".`)
    this.name = 'UnknownSubjectFamilyError'
  }
}

function resolveFamily(selection: EvidenceSelection): SubjectFamily {
  const rule = SELECTION_RULES.find((candidate) => candidate.id === selection.ruleId)
  if (!rule) throw new UnknownSelectionRuleError(selection.ruleId)
  const family = rule.families.find(
    (candidate) => candidate.id === selection.subjectFamily,
  )
  if (!family) throw new UnknownSubjectFamilyError(rule.id, selection.subjectFamily)
  return family
}

export interface SelectionOutcome {
  /** The subjects the family expanded to, in the order the rule declares. */
  subjects: readonly string[]
  /** What the store returned, already resolved to the stated knowledge time. */
  selected: readonly DurableObservation[]
  /**
   * What the rule derived from the selection. Computed, not yet recorded — the
   * command writes them, because writing is what a command does.
   */
  derived: readonly DurableObservation[]
}

/**
 * Runs a selection against the observation store.
 *
 * Reads only. Every write this produces is returned for the caller to record
 * inside its own transaction, so the act stays one act.
 */
export async function runSelection(
  observations: ObservationRepository,
  selection: EvidenceSelection,
  args: { recordedAt: string; correlationId: string },
): Promise<SelectionOutcome> {
  const family = resolveFamily(selection)

  const perSubject = new Map<string, DurableObservation[]>()
  for (const member of family.members) {
    const series = await observations.series({
      subject: member.subject,
      kind: family.kind,
      sourceId: family.sourceId,
      seriesId: member.seriesId,
      methodology: family.methodology,
      from: selection.from,
      to: selection.to,
      /*
       * Passed through, never defaulted here. `EvidenceSelection.knownAt` is
       * resolved once, by the command, and stored — so this and the record
       * cannot describe two different queries.
       */
      knownAt: selection.knownAt,
    })
    perSubject.set(member.subject, series)
  }

  const selected = family.members.flatMap((member) => perSubject.get(member.subject) ?? [])

  const derived: DurableObservation[] = []
  for (const derivation of family.derivations) {
    const shortLeg = family.members.find((m) => m.subject === derivation.shortSubject)
    const longLeg = family.members.find((m) => m.subject === derivation.longSubject)
    /*
     * A family declaring a derivation over a series it does not list is a
     * definition error rather than a data condition, and there is nothing to
     * compute either way.
     */
    if (!shortLeg || !longLeg) continue

    const shorts = perSubject.get(shortLeg.subject) ?? []
    const longs = perSubject.get(longLeg.subject) ?? []
    for (const short of shorts) {
      /*
       * Paired on the reference period — what the two figures DESCRIBE — and
       * not on publication. `deriveCurveSlope` refuses a mismatched pair on its
       * own; this only avoids offering it an obvious mismatch.
       */
      const long = longs.find(
        (candidate) => candidate.ref.referencePeriod === short.ref.referencePeriod,
      )
      if (!long) continue

      const slope = deriveCurveSlope({
        short: { observation: short, maturity: shortLeg.maturity as '2Y' },
        long: { observation: long, maturity: longLeg.maturity as '10Y' },
        countryCode: family.countryCode,
        recordedAt: args.recordedAt,
        correlationId: args.correlationId,
      })
      if (slope) derived.push(slope)
    }
  }

  return { subjects: family.members.map((member) => member.subject), selected, derived }
}

/** Whether a rule and family are registered, without running anything. */
export function selectionIsKnown(selection: EvidenceSelection): boolean {
  try {
    resolveFamily(selection)
    return true
  } catch {
    return false
  }
}

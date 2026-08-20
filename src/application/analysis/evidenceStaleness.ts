/**
 * When a sovereign yield is too old to rest a claim on.
 *
 * The first of TD-75's four undefined confidence signals to acquire a
 * production definition, and it acquires one **for sovereign yields and
 * nothing else** (gate §5, Decision 5). The other three — `weakestEvidence`,
 * `conflictingEvidence`, `methodologyMismatch` — stay undefined, because each
 * needs an institutional policy decision and guessing one would put a number
 * the firm never agreed to behind a confidence it presents as its own. That is
 * the mistake TD-75 exists to record, and solving the fourth is not a licence
 * to repeat it for the other three.
 *
 * ## Judged against the reference period, never the publication instant
 *
 * Gate Decision 5's table: *stale versus fresh — judged against
 * `referencePeriod`, per family.* The distinction is the whole reason v2
 * identity carries a reference period at all. A Treasury print published on
 * Monday for Friday's close describes **Friday**, and a desk asking "how
 * current is the curve I am reasoning from" is asking about Friday, not about
 * Monday's press release.
 *
 * ## The moment it is judged against is the assembly, not a clock
 *
 * `assembledAt` — the instant the firm declared this body of evidence fit for
 * analysis — and never `Date.now()`. Two reasons, and the second is the one
 * that matters:
 *
 *   - it is what the claim's own `temporalScope.asOf` already is, so a claim
 *     and its confidence are judged against one coordinate rather than two;
 *   - a confidence resolved against wall-clock time is **irreproducible**. The
 *     same stored claim, re-derived a month later, would carry a different
 *     level with nothing in the record saying why. Every other identity in
 *     this codebase is reproducible from what was written down, and a
 *     confidence cap is not the place to break that.
 *
 * ## Recency, for this cap, is the freshest cited in-scope observation
 *
 * **The ruling, in the words it was ruled in (2026-08-19):**
 *
 * > For the C3 sovereign-yield confidence cap, evidence recency is determined
 * > by the freshest cited in-scope observation.
 *
 * That sentence is the whole of its scope, and the narrowness is deliberate.
 * **It is not a domain statement that staleness is always the age of the
 * freshest evidence**, and nothing here may be read, cited or generalised as
 * one. Freshness, historical coverage and completeness are three different
 * questions, and a later evidence family may well need them separated —
 * a quarterly series with one recent print and an eighteen-month hole is
 * *recent* and badly *incomplete*, and this rule says nothing about the
 * second. What is settled is one cap over one family.
 *
 * Why it was ruled this way, for that one family. C3 exists to give a desk a
 * **history**: a term structure across a window, every point individually
 * citable. Under an oldest-wins reading, a claim resting on more than five
 * days of that history would be capped as stale — so the capability C3 built
 * would be penalised for having been built, and a claim like *"the 2s10s has
 * steepened over three weeks"* would be downgraded precisely because it cited
 * the three weeks it is about. An observation deliberately cited as historical
 * context is not stale evidence; it is context.
 *
 * So: among the in-scope observations a claim actually cited, take the latest
 * reference period, and ask how far it sits behind the assembly. A claim citing
 * three weeks of history including yesterday's print is recent. A claim citing
 * only figures from three weeks ago is stale — and that is exactly the claim a
 * reader should be warned about.
 *
 * Note this cannot understate: when the freshest cited figure is stale, every
 * other one cited is older still, so `STALE_EVIDENCE_BASIS` — *"some evidence
 * is stale"* — stays true of the evidence it describes.
 *
 * ## Out of scope means not judged, and says so
 *
 * A family the firm has stated no policy for, an observation with no reference
 * period (every v1 record), a reference period that is not a calendar date —
 * none of these is judged, and none is reported as stale. A cap the firm
 * cannot derive must not be asserted; that is the rule `resolveModelConfidence`
 * exists to enforce, and it is not suspended because a new signal arrived.
 */

import type { EvidenceItem } from '~/domain/analysis'

/**
 * How old a family's figures may be before the firm calls them stale.
 *
 * A table keyed by methodology, which is the coordinate that says what a
 * number IS — a par yield and a fitted zero rate are two measures, and the
 * natural key already separates them. Structurally per-family, per Decision 5,
 * so a family gains a policy by gaining a row with its own stated reasoning
 * rather than by widening a condition somewhere.
 */
export interface StalenessPolicy {
  /** The `methodology` on the observation's natural key. */
  methodology: string
  /** Stale beyond this many days between reference period and assembly. */
  maxAgeDays: number
  /** Why this number, in the firm's words. Recorded, not inferred. */
  states: string
}

/**
 * Five days, and the number is the publication calendar rather than a round
 * figure.
 *
 * A sovereign debt office publishes one figure per business day for that day's
 * close. The gaps that occur while the source is working perfectly:
 *
 *   normal weekend                    Friday's close, read Monday   = 3 days
 *   holiday Monday                    Friday's close, read Tuesday  = 4 days
 *   a holiday adjoining a weekend     Thursday's close, read Monday = 4 days
 *
 * A ceiling under four days would mark the newest figure the source has
 * published as stale every long weekend — a finding about the calendar
 * presented as a finding about the evidence. Five clears the longest scheduled
 * run with one day of margin. No holiday calendar is consulted anywhere; this
 * is a wall-clock approximation of "a few missed business days", exactly as
 * `CATEGORY_POLICY` says of its own ceilings.
 *
 * **Deliberately not imported from `CATEGORY_POLICY`.** That file's
 * `maxStaleMs` for `yields-us`, `yields-de` and `yields-se` is also five days
 * and was chosen against the same calendar, which is why the arithmetic
 * agrees — but it answers a different question, *may a cached value still be
 * served*, measured from a different coordinate, `provenance.asOf`. Binding
 * them would mean a change to a cache ceiling silently changed what the firm
 * is willing to claim. Two decisions that happen to share a number are still
 * two decisions.
 */
const SOVEREIGN_BUSINESS_DAY_GAP_DAYS = 5

const SOVEREIGN_CADENCE =
  'One figure per business day for that day’s close. Five days clears the ' +
  'longest scheduled run of non-publication days — a holiday adjoining a ' +
  'weekend — so the newest figure a working source has published is never ' +
  'reported as stale.'

/**
 * The families the firm has ruled on. Everything else is unjudged.
 *
 * The three sovereign methodologies are the ones the firm's own adapters
 * declare — `usTreasury` par yields, Bundesbank fitted zero rates, Riksbank
 * benchmark bond yields — and they share a number for the reason
 * `POLICY_RATE_POLICY` is shared by three central banks: they share a
 * publication model, and the firm has already recorded that same judgement for
 * all three of them in `CATEGORY_POLICY`.
 */
export const SOVEREIGN_YIELD_STALENESS: readonly StalenessPolicy[] = Object.freeze([
  {
    methodology: 'par-yield',
    maxAgeDays: SOVEREIGN_BUSINESS_DAY_GAP_DAYS,
    states: SOVEREIGN_CADENCE,
  },
  {
    methodology: 'zero-coupon-fitted',
    maxAgeDays: SOVEREIGN_BUSINESS_DAY_GAP_DAYS,
    states: SOVEREIGN_CADENCE,
  },
  {
    methodology: 'benchmark-bond-yield',
    maxAgeDays: SOVEREIGN_BUSINESS_DAY_GAP_DAYS,
    states: SOVEREIGN_CADENCE,
  },
  /*
   * The derived 2s10s, under a rule the firm already states: *a derivation is
   * never fresher than its stalest input* (`derivedProvenance`). Its reference
   * period IS its inputs' — `deriveCurveSlope` refuses a pair that does not
   * share one — so judging it on its own coordinate gives the same answer as
   * judging its stalest leg. Nothing new is decided here; what would be new is
   * leaving it out, because then a claim citing only the spread would escape a
   * cap the two yields behind it would have taken.
   */
  {
    methodology: 'spread-2s10s@1',
    maxAgeDays: SOVEREIGN_BUSINESS_DAY_GAP_DAYS,
    states:
      'Derived from two par yields sharing one reference period, and never ' +
      'fresher than its stalest input, so it is judged on the period both ' +
      'legs describe.',
  },
])

/** What the firm concluded about a claim's evidence, and whether it could. */
export interface StalenessVerdict {
  /** False when no cited observation falls under a policy the firm has stated. */
  judged: boolean
  /** Only ever true when `judged`. */
  stale: boolean
  /** The latest reference period among the cited in-scope observations. */
  freshestReferencePeriod?: string
  /** Whole days between that period and the assembly. */
  ageDays?: number
  /** The horizon applied, so the record survives a later policy change. */
  maxAgeDays?: number
}

const NOT_JUDGED: StalenessVerdict = Object.freeze({ judged: false, stale: false })

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** A daily reference period. `2026-Q2` and friends are not judged, not guessed. */
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/

function policyFor(item: EvidenceItem): StalenessPolicy | undefined {
  const methodology = item.ref.methodology
  if (methodology === undefined) return undefined
  return SOVEREIGN_YIELD_STALENESS.find((rule) => rule.methodology === methodology)
}

/**
 * Judges the sovereign-yield evidence a claim cited.
 *
 * `assembledAt` is passed in rather than read from a clock — see the module
 * header. `citedItems` are the resolved items behind the claim's citations,
 * the same set `resolveModelConfidence` caps against: the question is what
 * THIS claim rests on, not what the set happened to contain.
 */
export function judgeStaleness(
  citedItems: readonly EvidenceItem[],
  assembledAt: string,
): StalenessVerdict {
  const assembledMs = Date.parse(assembledAt)
  if (Number.isNaN(assembledMs)) return NOT_JUDGED

  let freshest: { period: string; ms: number; policy: StalenessPolicy } | undefined

  for (const item of citedItems) {
    const policy = policyFor(item)
    if (!policy) continue
    const period = item.ref.referencePeriod
    /*
     * A v1 sovereign yield carries no reference period at all — the coordinate
     * did not exist when it was minted. There is nothing to judge it against,
     * and the publication instant is not a substitute: it is a different fact,
     * which is the entire reason v2 separated them.
     */
    if (period === undefined || !CALENDAR_DATE.test(period)) continue
    const ms = Date.parse(`${period}T00:00:00.000Z`)
    if (Number.isNaN(ms)) continue
    if (!freshest || ms > freshest.ms) freshest = { period, ms, policy }
  }

  if (!freshest) return NOT_JUDGED

  /*
   * Whole days, floored. A figure describing Friday, assembled Monday morning,
   * is three days old rather than two-and-a-fraction — the policy is stated in
   * days because the publication calendar is, and a fractional day would put
   * the same pair of dates either side of the line depending on the hour
   * somebody happened to press the button.
   */
  const ageDays = Math.floor((assembledMs - freshest.ms) / MS_PER_DAY)

  return Object.freeze({
    judged: true,
    stale: ageDays > freshest.policy.maxAgeDays,
    freshestReferencePeriod: freshest.period,
    ageDays,
    maxAgeDays: freshest.policy.maxAgeDays,
  })
}

/**
 * The verdict as one basis line.
 *
 * States the FACTS it rested on — the period, the age, the horizon in force —
 * rather than only the conclusion, so a later change to the policy cannot make
 * this sentence a lie about what the firm did on the day.
 */
export function stalenessBasis(verdict: StalenessVerdict): string {
  return (
    `the freshest sovereign yield cited describes ${verdict.freshestReferencePeriod}, ` +
    `${verdict.ageDays} days before the evidence was assembled; the policy in ` +
    `force treats such evidence as stale beyond ${verdict.maxAgeDays} days`
  )
}

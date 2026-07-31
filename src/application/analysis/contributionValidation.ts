/**
 * What a contribution has to satisfy before it becomes a record.
 *
 * A provider hands back claims. Between that moment and the moment they are
 * stored is the only place the firm gets to decide whether they are admissible
 * — afterwards a claim is cited by theses, weighed by governance and rendered
 * as the firm's own reasoning, and the citation has already happened.
 *
 * ## Why this is not inside the command
 *
 * The command decides what to DO about a defect: reject, with a bounded code,
 * durably recorded. This module decides what a defect IS, over domain values
 * only, with no repository and no clock — which is what makes each rule
 * testable on its own and keeps the handler readable.
 *
 * ## Why it returns a list rather than throwing
 *
 * A malformed contribution usually has more than one thing wrong with it, and
 * a provider being told about the first defect it happens to trip is how a
 * contract negotiation turns into a guessing game. Every defect is reported;
 * the command turns them into one rejection.
 *
 * Nothing here carries provider prose. A defect names the claim and the rule,
 * never the statement, the evidence value or the model's own words — the same
 * discipline `RunFailure` applies to failures, for the same reason: these
 * strings reach logs.
 */

import {
  isPublishable,
  resolveCitation,
  type AgentClaim,
  type EvidenceItem,
  type EvidenceRef,
  type EvidenceSet,
} from '~/domain/analysis'
import { effectiveTrust } from '~/domain/shared/provenance'

/**
 * One reason a contribution may not be stored.
 *
 * Closed, and each variant carries only identifiers — a claim id, an
 * observation id, a rule name.
 */
export type ContributionDefect =
  /** A run that finished and asserted nothing did not contribute. */
  | { code: 'no-claims' }
  /** Two claims in one contribution sharing a name. */
  | { code: 'duplicate-claim-id'; claimId: string }
  /** Cites evidence the run was not given, or a version of it that moved. */
  | {
      code: 'unresolved-citation'
      claimId: string
      observationId: string
      why: 'not-in-set' | 'wrong-set' | 'revised'
    }
  /** Asserted as supported with nothing behind it. */
  | { code: 'support-without-evidence'; claimId: string }
  /** Contested while citing nothing that contradicts it. */
  | { code: 'contested-without-contradiction'; claimId: string }
  /** A mechanism asserted as established fact. */
  | { code: 'causal-without-attribution'; claimId: string }
  /** A counterclaim that does not say what it contests. */
  | { code: 'counterclaim-without-target'; claimId: string }
  /** A forecast or recommendation with no horizon is unfalsifiable. */
  | { code: 'missing-horizon'; claimId: string }
  /** Rests on fixture evidence and does not say so in its confidence. */
  | { code: 'uncapped-fixture-evidence'; claimId: string }

/**
 * True when an evidence item is invented rather than observed.
 *
 * Both coordinates are checked because they can disagree and the weaker one
 * governs: a synthetic source is fixture data whatever it labels its quality,
 * and `quality: 'fixture'` is fixture data whatever tier the source claims.
 */
export function isFixtureBacked(item: EvidenceItem): boolean {
  const trust = effectiveTrust(
    item.provenance.source.trust ?? 'aggregator',
    item.provenance.source.originatorTrust,
  )
  return item.provenance.quality === 'fixture' || trust === 'synthetic'
}

/** Every citation a claim makes, in both directions. */
function citations(claim: AgentClaim): readonly EvidenceRef[] {
  return [...claim.evidenceRefs, ...claim.contradictingEvidenceRefs]
}

/**
 * Checks a set of claims against the evidence set the run reasoned over.
 *
 * Deliberately takes the SET rather than a set id: resolving a citation means
 * comparing content hashes, and a rule that could only compare ids would pass
 * a claim quoting a number that has since been revised — which is precisely
 * the case `resolveCitation` exists to detect.
 */
export function validateContribution(args: {
  claims: readonly AgentClaim[]
  evidenceSet: EvidenceSet
}): ContributionDefect[] {
  const { claims, evidenceSet } = args
  const defects: ContributionDefect[] = []

  if (claims.length === 0) {
    // A desk that completes and asserts nothing has not contributed. Silence
    // is recorded as a failure, which is a different institutional fact.
    defects.push({ code: 'no-claims' })
  }

  const seen = new Set<string>()
  for (const claim of claims) {
    if (seen.has(claim.id)) {
      defects.push({ code: 'duplicate-claim-id', claimId: claim.id })
    }
    seen.add(claim.id)

    /* ------------------------------------------------------- citations */

    for (const ref of citations(claim)) {
      const resolution = resolveCitation(evidenceSet, ref)
      if (resolution.status === 'resolved') continue
      defects.push({
        code: 'unresolved-citation',
        claimId: claim.id,
        observationId: ref.observationId,
        why: resolution.status === 'revised' ? 'revised' : resolution.reason,
      })
    }

    /* ----------------------------------------------- the domain's rules */

    /*
     * `buildClaim` enforces these by construction, and a provider result is
     * exactly where a value arrives without having gone through it. Checked
     * here so the outcome is a durable rejection with a code rather than a
     * thrown error the ledger would file as an operational failure.
     */
    if (
      (claim.status === 'supported' || claim.status === 'partially-supported') &&
      claim.evidenceRefs.length === 0
    ) {
      defects.push({ code: 'support-without-evidence', claimId: claim.id })
    }
    if (claim.status === 'contested' && claim.contradictingEvidenceRefs.length === 0) {
      defects.push({ code: 'contested-without-contradiction', claimId: claim.id })
    }
    if (claim.type === 'causal' && !claim.attribution) {
      defects.push({ code: 'causal-without-attribution', claimId: claim.id })
    }
    if (claim.type === 'counterclaim' && !claim.contests) {
      defects.push({ code: 'counterclaim-without-target', claimId: claim.id })
    }
    if (
      (claim.type === 'forecast' || claim.type === 'recommendation') &&
      !claim.temporalScope.horizon
    ) {
      defects.push({ code: 'missing-horizon', claimId: claim.id })
    }

    /* -------------------------------------------- fixture provenance */

    /*
     * The storage-side half of the standing rule that fixture data is never
     * presented as live.
     *
     * `composeConfidence` already caps a fixture-backed claim at `insufficient`
     * with `cappedBy: 'fixture-evidence'`. A provider is free not to call it —
     * a recorded fixture states its confidence directly, and a live provider
     * will one day report its own. So the cap is verified rather than trusted:
     * a claim resting on invented evidence that arrives publishable is refused,
     * because by the time it is stored nothing downstream can tell that the
     * numbers underneath it were never observed.
     */
    const restsOnFixture = claim.evidenceRefs.some((ref) => {
      const item = evidenceSet.items.find((i) => i.ref.id === ref.observationId)
      return item ? isFixtureBacked(item) : false
    })
    if (restsOnFixture && isPublishable(claim.confidence)) {
      defects.push({ code: 'uncapped-fixture-evidence', claimId: claim.id })
    }
  }

  return defects
}

/**
 * A defect as a sentence, for the rejection's `detail`.
 *
 * Bounded by construction: every value interpolated is an identifier the firm
 * produced or a rule name from this module.
 */
export function describeDefect(defect: ContributionDefect): string {
  switch (defect.code) {
    case 'no-claims':
      return (
        `A contribution with no claims is not a contribution. Work that ` +
        `produced nothing is recorded through FailAgentRun, so the difference ` +
        `between "found nothing" and "never answered" survives.`
      )
    case 'duplicate-claim-id':
      return `Two claims in this contribution are both named "${defect.claimId}"`
    case 'unresolved-citation':
      return (
        `Claim "${defect.claimId}" cites observation "${defect.observationId}", ` +
        `which is ${
          defect.why === 'revised'
            ? 'in the evidence set with different content — the number moved ' +
              'after it was quoted'
            : defect.why === 'wrong-set'
              ? 'a citation into another evidence set entirely'
              : 'not in the evidence set this run was given'
        }.`
      )
    case 'support-without-evidence':
      return (
        `Claim "${defect.claimId}" asserts support with no evidence behind it. ` +
        `A claim with nothing behind it can only be insufficient-evidence.`
      )
    case 'contested-without-contradiction':
      return `Claim "${defect.claimId}" is contested but cites nothing that contradicts it`
    case 'causal-without-attribution':
      return (
        `Causal claim "${defect.claimId}" states no attribution. A mechanism ` +
        `may be quoted, cited or labelled as our own inference — never ` +
        `asserted as established fact.`
      )
    case 'counterclaim-without-target':
      return `Counterclaim "${defect.claimId}" does not say what it contests`
    case 'missing-horizon':
      return `Claim "${defect.claimId}" states no horizon, which makes it unfalsifiable`
    case 'uncapped-fixture-evidence':
      return (
        `Claim "${defect.claimId}" rests on fixture evidence and is not capped ` +
        `by it. Fixture-backed reasoning is never publishable, and storing it ` +
        `without the cap would let invented numbers reach a thesis as analysis.`
      )
  }
}

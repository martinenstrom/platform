/**
 * What the firm holds, and what it has declared fit for analysis.
 *
 * The read model behind the first user-visible capability C3 adds
 * (`phase-c3-evidence-gate.md` §5): *the user selects a subject family and a
 * window, sees every observation the firm holds for it, and records the
 * assembly as an institutional act with their name on it.*
 *
 * ## It decides nothing
 *
 * Holdings are counted from `observations.series`, which is the same query
 * `AssembleEvidenceSet` runs — so what a person is shown and what the command
 * would select come from one place. It is deliberately **not** an eligibility
 * answer: the command refuses independently, and would refuse identically if
 * this file did not exist. The same rule `commissionEligibility` follows.
 *
 * ## Why the counts and not the observations
 *
 * A par curve over a month is several hundred individually citable
 * observations, and a screen that listed them would be a screen nobody reads.
 * What a person needs before assembling is whether the firm holds the tenor at
 * all, over what span, and as of when — which is what a holding is. The
 * observations themselves are reached through the set once it exists, where
 * they carry their citation identity.
 */

import type { AnalysisRepositories } from './repositories'
import type { EvidenceAssembly } from '~/domain/analysis'
import { SELECTION_RULES, selectionRuleOffers, type SelectionRuleOffer } from './evidenceSelection'
import { runSelection } from './evidenceSelection'

/** One tenor of one family, as much of it as deciding to assemble needs. */
export interface SubjectHolding {
  subject: string
  /** Individually citable observations in the window, one per period. */
  observationCount: number
  /** The span the firm actually holds, which may be narrower than the window. */
  earliestReferencePeriod: string | null
  latestReferencePeriod: string | null
}

export interface FamilyHoldings {
  ruleId: string
  subjectFamily: string
  from: string
  to: string
  /** Resolved by the caller and echoed, so the screen shows what it asked. */
  knownAt: string
  subjects: readonly SubjectHolding[]
  /** Across the family. What an assembly would select right now. */
  totalObservations: number
  /**
   * What the rule would derive. Computed by running the rule's own derivation,
   * never by a second count of what "should" be derivable — a screen that
   * predicted a different number from the command's would be the second answer
   * this architecture exists to prevent.
   */
  derivableCount: number
}

/** One assembled set, with the act that produced it. */
export interface AssembledEvidence {
  assembly: EvidenceAssembly
  /** Distinct provider names in the set, so a reader sees whose numbers these are. */
  sources: readonly string[]
  disagreementCount: number
  revisionCount: number
  /** True when the set the act points at no longer reads back. */
  missing: boolean
}

export interface EvidenceDeskView {
  /** Every registered rule, as data the surface renders rather than invents. */
  rules: readonly SelectionRuleOffer[]
  holdings: FamilyHoldings | null
  recent: readonly AssembledEvidence[]
}

/** How many acts the surface shows. A bound, for the reason the offers are bounded. */
const RECENT_LIMIT = 20

export interface EvidenceDeskInput {
  repositories: AnalysisRepositories
  /** Which family to count. Absent means offer the rules and count nothing. */
  selection?: { ruleId: string; subjectFamily: string; from: string; to: string; knownAt: string }
}

export async function evidenceDesk(input: EvidenceDeskInput): Promise<EvidenceDeskView> {
  const { repositories, selection } = input

  const holdings = selection ? await countHoldings(repositories, selection) : null

  const acts = await repositories.assemblies.list(RECENT_LIMIT)
  const recent: AssembledEvidence[] = []
  for (const assembly of acts) {
    const set = await repositories.evidence.get(assembly.evidenceSetId)
    recent.push({
      assembly,
      sources: set
        ? [...new Set(set.items.map((item) => item.provenance.source.providerName))].sort()
        : [],
      disagreementCount: set?.disagreements.length ?? 0,
      revisionCount: set?.revisions.length ?? 0,
      /*
       * Stated rather than hidden. A recorded act whose set does not read back
       * is an institutional inconsistency, and a surface that quietly dropped
       * the row would make it invisible to the only person who could notice.
       */
      missing: set === null,
    })
  }

  return { rules: selectionRuleOffers(), holdings, recent }
}

async function countHoldings(
  repositories: AnalysisRepositories,
  selection: { ruleId: string; subjectFamily: string; from: string; to: string; knownAt: string },
): Promise<FamilyHoldings | null> {
  const known = SELECTION_RULES.some((rule) => rule.id === selection.ruleId)
  if (!known) return null

  let outcome
  try {
    outcome = await runSelection(repositories.observations, selection, {
      /*
       * A read. `runSelection` returns derived observations rather than writing
       * them — writing is what a command does — so counting them here records
       * nothing and cannot become a second way to mint a derived fact.
       */
      recordedAt: selection.knownAt,
      correlationId: 'evidence-desk-read',
    })
  } catch {
    /* An unregistered family. The surface offers only registered ones. */
    return null
  }

  const perSubject = new Map<string, { count: number; earliest: string; latest: string }>()
  for (const observation of outcome.selected) {
    const subject = observation.ref.subject
    const period = observation.ref.referencePeriod ?? ''
    const held = perSubject.get(subject)
    if (!held) {
      perSubject.set(subject, { count: 1, earliest: period, latest: period })
      continue
    }
    held.count += 1
    if (period < held.earliest) held.earliest = period
    if (period > held.latest) held.latest = period
  }

  return {
    ruleId: selection.ruleId,
    subjectFamily: selection.subjectFamily,
    from: selection.from,
    to: selection.to,
    knownAt: selection.knownAt,
    subjects: outcome.subjects.map((subject) => {
      const held = perSubject.get(subject)
      return {
        subject,
        observationCount: held?.count ?? 0,
        earliestReferencePeriod: held?.earliest ?? null,
        latestReferencePeriod: held?.latest ?? null,
      }
    }),
    totalObservations: outcome.selected.length,
    derivableCount: outcome.derived.length,
  }
}

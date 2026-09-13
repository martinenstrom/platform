/**
 * The analysis domain — an investment organization, modelled as a firm.
 *
 * Independent of `domain/market` and `domain/policy`, and asserted so by the
 * import graph. It shares `domain/shared` for provenance, primitives and
 * hashing; the typed bridges into the other two domains live in
 * `application/analysis`, which is the one place allowed to know all three.
 *
 * Aggregate root: the **investment case**. Everything else describes who works
 * on it, what they contributed, and who checked it.
 */

export * from './organization'
export * from './cases'
export * from './lifecycle'
export * from './theses'
export * from './events'
export * from './decisions'
export * from './eligibilityPolicy'
export * from './eligibilityGates'
export * from './caseStanding'
export * from './aggregateValidation'
export * from './basisManifest'
export * from './work'
export * from './identity'
export * from './evidence'
export * from './observationRecord'
export * from './evidenceAssembly'
export * from './claims'
export * from './review'
export * from './contributions'
export * from './authority'
export * from './requirements'
export * from './aggregation'
export * from './synthesisCandidate'
export * from './governanceCandidates'

/** One advance of the domain contract, and what it changed about stored meaning. */
export interface DomainContractRevision {
  version: string
  /** What a stored record MEANS differently from here on. */
  states: string
}

/**
 * Every version of the analysis domain contracts, oldest first.
 *
 * A declaration rather than a comment, because a comment cannot be required.
 * Versions 7 and 8 were described by their plans and **the constant was never
 * advanced**: provenance written throughout C1D-1A and C1D-1B recorded `'6'`.
 * No retained row is affected — no durable database exists — but the coordinate
 * was untrue for two phases, and nothing noticed.
 *
 * Why nothing noticed is the part worth keeping. The only assertion was that
 * the in-memory and PostgreSQL adapters reported the *same* version, and they
 * did, because both read this constant. **Agreement between two readers of one
 * wrong value is not correctness**, and no parity test can distinguish a version
 * that was deliberately held from one that was forgotten.
 *
 * So advancing the contract now takes three deliberate acts, none of them
 * inferable from a source diff: add an entry here, change the constant, and
 * update the literal pinned in `domainContractVersion.test.ts`. A test cannot
 * judge whether a change was material — that is the author's judgement — but it
 * can insist the judgement was recorded.
 */
export const DOMAIN_CONTRACT_HISTORY: readonly DomainContractRevision[] = [
  {
    version: '1',
    states: 'Phase A/B — the original analysis contracts, the baseline for the rest',
  },
  { version: '2', states: 'storage stage 1.5 — reviews became revision-scoped' },
  {
    version: '3',
    states:
      'Phase C1B — a revision declares its investment implications, and ' +
      'conditional requirements resolve against an exact revision',
  },
  {
    version: '4',
    states:
      'Phase C1C — runs carry execution provenance, failures are a bounded ' +
      'category rather than free text, and an assignment can be failed',
  },
  {
    version: '5',
    states:
      'Phase C1C-2 — a run states its execution identity as one of three shapes ' +
      'rather than always a prompt and a model, and what it consumed as one of ' +
      'three states rather than a nullable amount. Both change what a stored run ' +
      'MEANS: a null cost used to be readable as free, and a model reference used ' +
      'to be readable as a model having run.',
  },
  {
    version: '6',
    states:
      'Phase C1C-3 — a manager aggregation is a first-class record, a revision ' +
      'points at the one that produced it, unresolved disagreement carries ' +
      'materiality that can block the CIO, and a requirement resolution hashes ' +
      'the input it was computed from',
  },
  {
    version: '7',
    states:
      'Phase C1C-4 — a blocker is a discriminated union rather than a kind beside ' +
      'a sentence, reviews carry an explicit order, and the Risk requirement is ' +
      'three-state rather than a boolean',
  },
  {
    version: '8',
    states:
      'Phase C1D-1A — the CIO outcome is a union rather than a nullable selection, ' +
      'dissent and reconsideration conditions are first-class, and the eligibility ' +
      'policy is versioned',
  },
  {
    version: '9',
    states:
      'TD-58 — an eligibility basis carries an immutable integrity manifest, so a ' +
      'stored basis can be checked against the one that was stored',
  },
  {
    version: '10',
    states:
      'TD-61 — identity generation is specified rather than inherited from ' +
      'JSON.stringify. Derived identities change: evidence-set ids, observation ' +
      'content hashes, requirement and playbook hashes, command payload hashes ' +
      'and write-once semantic keys are all computed from canonical value v1. ' +
      'Values that previously collided are refused, EvidenceItem.value is a ' +
      'canonical value rather than unknown, decimals are exact strings rather ' +
      'than doubles, and key ordering no longer depends on the host locale.',
  },
  {
    version: '11',
    states:
      'TD-61 follow-up — a claim disposition records materiality and nothing ' +
      'about its consequence for eligibility. `blocks_eligibility` was derived ' +
      'at aggregation time from materiality alone, but whether a materiality ' +
      'blocks is a POLICY judgement and the policy is chosen later, at ' +
      'submission. A stored value written before its governing policy is known ' +
      'is a future judgement, not a historical fact. Migration 0023 removed it; ' +
      'the judgement is derived through disagreementBlocksEligibility with the ' +
      'threshold from the versioned policy in force.',
  },
]

/**
 * The version of the analysis domain contracts.
 *
 * Recorded alongside stored analysis so that "which contracts were active when
 * this was produced" has an answer years later. Bumped when a contract in this
 * directory changes in a way that alters what a stored record means — a new
 * field is not a bump, a changed rule is.
 *
 * Written as a literal rather than derived from the last history entry, so that
 * adding an entry and advancing the version are two separate decisions. Deriving
 * it would let a documentation edit change what every provenance row records.
 */
export const DOMAIN_CONTRACT_VERSION = '11'

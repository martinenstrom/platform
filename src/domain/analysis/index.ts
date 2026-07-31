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
export * from './work'
export * from './identity'
export * from './evidence'
export * from './claims'
export * from './review'
export * from './contributions'
export * from './authority'
export * from './requirements'
export * from './aggregation'

/**
 * The version of the analysis domain contracts.
 *
 * Recorded alongside stored analysis so that "which contracts were active when
 * this was produced" has an answer years later. Bumped when a contract in this
 * directory changes in a way that alters what a stored record means — a new
 * field is not a bump, a changed rule is.
 *
 * History:
 *   1  Phase A/B contracts
 *   2  storage stage 1.5 — reviews became revision-scoped
 *   3  Phase C1B — a revision declares its investment implications, and
 *      conditional requirements resolve against an exact revision
 *   4  Phase C1C — runs carry execution provenance, failures are a bounded
 *      category rather than free text, and an assignment can be failed
 *   5  Phase C1C-2 — a run states its execution identity as one of three
 *      shapes rather than always a prompt and a model, and what it consumed
 *      as one of three states rather than a nullable amount. Both change what
 *      a stored run MEANS: a null cost used to be readable as free, and a
 *      model reference used to be readable as a model having run.
 *   6  Phase C1C-3 — a manager aggregation is a first-class record, a revision
 *      points at the one that produced it, unresolved disagreement carries
 *      materiality that can block the CIO, and a requirement resolution hashes
 *      the input it was computed from
 */
export const DOMAIN_CONTRACT_VERSION = '6'

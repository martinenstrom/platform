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
 */
export const DOMAIN_CONTRACT_VERSION = '3'

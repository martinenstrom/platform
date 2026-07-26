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

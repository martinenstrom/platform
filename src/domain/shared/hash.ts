/**
 * Stable string hashing.
 *
 * Used for deterministic log sampling: the decision to keep or drop a record
 * must be reproducible from the record's own identity, not drawn from a random
 * source. That way every log line belonging to one resolution is sampled
 * together — a sampled success whose retry lines were dropped would be worse
 * than not sampling at all — and tests get the same answer on every run.
 *
 * FNV-1a, 32-bit: not cryptographic, and does not need to be. It needs to be
 * fast, stable across processes, and evenly distributed.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193

export function stableHash(input: string): number {
  let hash = FNV_OFFSET_BASIS
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME)
  }
  // Unsigned, so callers can take a modulus without sign surprises.
  return hash >>> 0
}

/**
 * Deterministic 1-in-`denominator` decision.
 *
 * `denominator <= 1` means "keep everything", which is the safe reading of a
 * misconfigured value.
 */
export function sampledIn(key: string, denominator: number): boolean {
  if (!Number.isFinite(denominator) || denominator <= 1) return true
  return stableHash(key) % Math.floor(denominator) === 0
}

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

/**
 * Wide stable hash, as 32 hex characters (128 bits).
 *
 * `stableHash` above is 32 bits, which is right for sampling and wrong for
 * identity: at a few thousand items a 32-bit collision is a percentage-level
 * event, and a collision in evidence identity means a claim citing the wrong
 * observation. That is not a risk worth taking to save a few bytes.
 *
 * FNV-1a over 64-bit BigInt lanes, run twice with different offset bases and
 * concatenated. Still not cryptographic — nothing here defends against a
 * deliberate collision, only against an accidental one — but the accidental
 * probability at a million observations is around 1e-27.
 *
 * Deliberately BigInt rather than `node:crypto`: the domain layer must not
 * depend on a platform module, and this runs identically in Node and jsdom.
 */
const FNV64_PRIME = 0x100000001b3n
const FNV64_MASK = 0xffffffffffffffffn
const FNV64_BASIS_A = 0xcbf29ce484222325n
/** An arbitrary second basis, so the two lanes are independent. */
const FNV64_BASIS_B = 0x9e3779b97f4a7c15n

function fnv64(input: string, basis: bigint): bigint {
  let hash = basis
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i))
    hash = (hash * FNV64_PRIME) & FNV64_MASK
  }
  return hash
}

export function stableHashHex(input: string): string {
  const a = fnv64(input, FNV64_BASIS_A).toString(16).padStart(16, '0')
  const b = fnv64(input, FNV64_BASIS_B).toString(16).padStart(16, '0')
  return `${a}${b}`
}

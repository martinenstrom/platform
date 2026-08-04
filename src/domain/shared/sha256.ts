/**
 * SHA-256, in the domain, without a platform module.
 *
 * ## Why this exists rather than `node:crypto`
 *
 * `importGraph.test.ts` forbids node builtins in `src/domain`, and `hash.ts`
 * says why in its own words: the domain must not depend on a platform module,
 * and it has to run identically in Node and in jsdom. The eligibility-basis
 * manifest is built by the domain — that is the whole point, so that
 * canonicalisation and its digest cannot drift apart — so the digest has to be
 * computable there too.
 *
 * ## Why not the existing hash
 *
 * `stableHashHex` is FNV-1a and says of itself: *"not cryptographic, and does
 * not need to be."* True for what it does — sampling, derived ids, content
 * addresses where a collision is a bug rather than an attack. Untrue for a
 * tamper-evidence witness, where an attacker who can delete a row can also
 * craft a substitute that hashes the same.
 *
 * **FNV identifies conveniently. SHA-256 attests content integrity.**
 *
 * ## Why hand-written code is acceptable here
 *
 * SHA-256 is fully specified, deterministic and has published test vectors.
 * `sha256.test.ts` checks it against the NIST vectors **and** against
 * `node:crypto` over generated inputs — the test layer may use builtins, so the
 * implementation is proven to agree with the platform's rather than merely
 * looking right. That is stronger evidence than either check alone, and it is
 * why this is not the usual bad idea about writing your own crypto: nothing
 * here is secret, and the property needed is correctness against a published
 * standard.
 */

/** FIPS 180-4 §4.2.2 — the first 32 bits of the fractional parts of the cube
 * roots of the first 64 primes. */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
  0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
  0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
  0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
  0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
])

/** The fractional parts of the square roots of the first eight primes. */
const INITIAL = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
  0x5be0cd19,
])

const rotr = (value: number, bits: number) =>
  ((value >>> bits) | (value << (32 - bits))) >>> 0

/** UTF-8 bytes, without `TextEncoder` — which jsdom has but the contract does not promise. */
function utf8Bytes(input: string): Uint8Array {
  const bytes: number[] = []
  for (let index = 0; index < input.length; index += 1) {
    let code = input.charCodeAt(index)

    // A surrogate pair is one code point, and encoding the halves separately
    // would produce different bytes for the same string.
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < input.length) {
      const low = input.charCodeAt(index + 1)
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00)
        index += 1
      }
    }

    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      )
    }
  }
  return Uint8Array.from(bytes)
}

/**
 * The digest of a UTF-8 string, as lowercase hex.
 *
 * One representation and no options: two call sites that disagreed about
 * encoding or case would produce two attestations of the same content.
 */
export function sha256Hex(input: string): string {
  const message = utf8Bytes(input)
  const bitLength = message.length * 8

  /* FIPS 180-4 §5.1.1 — append 0x80, pad to 56 mod 64, then a 64-bit length. */
  const paddedLength = (((message.length + 8) >> 6) + 1) << 6
  const padded = new Uint8Array(paddedLength)
  padded.set(message)
  padded[message.length] = 0x80

  // 53-bit safe: a string long enough to overflow the high word cannot be held
  // in memory anyway, and the high word is written as zero rather than omitted.
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false)
  view.setUint32(paddedLength - 4, bitLength >>> 0, false)

  const hash = new Uint32Array(INITIAL)
  const schedule = new Uint32Array(64)

  for (let block = 0; block < paddedLength; block += 64) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = view.getUint32(block + index * 4, false)
    }
    for (let index = 16; index < 64; index += 1) {
      const a = schedule[index - 15]!
      const b = schedule[index - 2]!
      const s0 = (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) >>> 0
      const s1 = (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10)) >>> 0
      schedule[index] =
        (schedule[index - 16]! + s0 + schedule[index - 7]! + s1) >>> 0
    }

    let [a, b, c, d, e, f, g, h] = hash as unknown as number[]

    for (let index = 0; index < 64; index += 1) {
      const S1 = (rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25)) >>> 0
      const ch = ((e! & f!) ^ (~e! & g!)) >>> 0
      const temp1 = (h! + S1 + ch + K[index]! + schedule[index]!) >>> 0
      const S0 = (rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22)) >>> 0
      const maj = ((a! & b!) ^ (a! & c!) ^ (b! & c!)) >>> 0
      const temp2 = (S0 + maj) >>> 0

      h = g
      g = f
      f = e
      e = (d! + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }

    const round = [a, b, c, d, e, f, g, h]
    for (let index = 0; index < 8; index += 1) {
      hash[index] = (hash[index]! + round[index]!) >>> 0
    }
  }

  let hex = ''
  for (const word of hash) hex += word.toString(16).padStart(8, '0')
  return hex
}

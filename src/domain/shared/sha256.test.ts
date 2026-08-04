/**
 * The hand-written SHA-256 agrees with the standard, and with the platform.
 *
 * Two independent checks, because either alone would be weaker. The published
 * NIST vectors prove it implements the specification; comparing it against
 * `node:crypto` over generated inputs proves it agrees with the implementation
 * everything else in the world uses. A subtle padding or surrogate bug survives
 * one of those and not both.
 *
 * The test layer may import node builtins; `src/domain` may not, which is why
 * the implementation is hand-written in the first place.
 */

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sha256Hex } from './sha256'

const reference = (input: string) =>
  createHash('sha256').update(input, 'utf8').digest('hex')

describe('the published vectors', () => {
  it('hashes the empty string', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('hashes "abc"', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('hashes the 448-bit vector, which straddles the padding boundary', () => {
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })

  it('hashes a million "a"s', () => {
    expect(sha256Hex('a'.repeat(1_000_000))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    )
  })
})

describe('it agrees with node:crypto', () => {
  it('on every length across the padding boundaries', () => {
    /*
     * 55, 56 and 64 are where the padding rules change: a message that just
     * fits, one that forces an extra block, and one exactly a block long. A
     * padding bug hides everywhere else.
     */
    for (let length = 0; length <= 130; length += 1) {
      const input = 'x'.repeat(length)
      expect(sha256Hex(input), `length ${length}`).toBe(reference(input))
    }
  })

  it('on multi-byte and astral characters', () => {
    for (const input of [
      'é',
      'åäö',
      '日本語',
      '𝄞', // astral: a surrogate pair that must encode as one code point
      '🇸🇪 flag',
      'mixed é 日 𝄞 ascii',
    ]) {
      expect(sha256Hex(input), input).toBe(reference(input))
    }
  })

  it('on generated JSON of the shape a manifest actually hashes', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const input = JSON.stringify({
        submissionId: `sub-${seed}`,
        revisionId: `rev-${seed}`,
        work: Array.from({ length: seed % 7 }, (_, n) => `run-${n}`),
        evaluatedAt: `2026-07-${String((seed % 28) + 1).padStart(2, '0')}T09:00:00.000Z`,
      })
      expect(sha256Hex(input), input).toBe(reference(input))
    }
  })
})

describe('the output shape is fixed', () => {
  it('is always 64 lowercase hex characters', () => {
    for (const input of ['', 'abc', 'x'.repeat(1000)]) {
      expect(sha256Hex(input)).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('is deterministic across calls', () => {
    expect(sha256Hex('same')).toBe(sha256Hex('same'))
  })
})

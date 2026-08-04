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
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

  it('on the padding boundaries reached by multi-byte characters', () => {
    /*
     * The sweep above moves one BYTE per step because its input is ASCII, so a
     * padding length computed from `String.length` instead of the UTF-8 byte
     * length would pass it, pass every NIST vector, and still be wrong.
     *
     * These cross the same boundaries in code units that do not equal bytes:
     * 28 x U+00E9 is 28 units and 56 bytes; 14 x U+1D11E is 28 units and 56
     * bytes through surrogate pairs.
     */
    const boundaries = [54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128]
    for (const bytes of boundaries) {
      const twoByte = 'é'.repeat(bytes >> 1) + (bytes % 2 === 1 ? 'x' : '')
      expect(sha256Hex(twoByte), `${bytes} bytes as U+00E9`).toBe(reference(twoByte))

      const fourByte = '\u{1d11e}'.repeat(bytes >> 2) + 'x'.repeat(bytes % 4)
      expect(sha256Hex(fourByte), `${bytes} bytes as U+1D11E`).toBe(reference(fourByte))
    }
  })

  it('on canonical renderings sized to every padding boundary', () => {
    /*
     * The boundaries that matter are the ones the real input hits, and the real
     * input is a canonical rendering with a domain prefix in front of it. Grown
     * one byte at a time so the prefixed length sweeps the boundaries rather
     * than landing near them by luck.
     */
    for (let padding = 0; padding <= 140; padding += 1) {
      const input = `financial-os:eligibility-basis:v1|l1:s${padding}:${'w'.repeat(padding)}`
      expect(sha256Hex(input), `padding ${padding}`).toBe(reference(input))
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

describe('the module stays inside its mandate', () => {
  /*
   * Hand-written cryptographic code is retained here on stated conditions
   * (`docs/decision-integrity-hashing.md`): an unkeyed digest, nothing else.
   * The conditions are worth exactly as much as their enforcement, so the
   * export surface is pinned rather than described.
   *
   * A hand-written HMAC, signature, cipher or key-derivation function would be
   * a different risk class entirely — one that differential testing does not
   * cover, because a correct-looking result can still leak. Adding one must
   * fail here and go back to review.
   */
  it('exports a digest and a byte counter, and nothing else', async () => {
    const module = await import('./sha256')
    expect(Object.keys(module).sort()).toEqual(['sha256Hex', 'utf8ByteLength'])
  })

  it('offers no keyed, signing or key-handling surface', () => {
    /*
     * Comments are stripped before scanning. The header explains that nothing
     * here is secret and that correctness is the only property needed — a
     * sentence worth keeping, and one a naive text search reads as a violation.
     * The mandate is about what the code does, not about which words describe it.
     */
    const source = readFileSync(
      resolve(process.cwd(), 'src/domain/shared/sha256.ts'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ')

    for (const forbidden of [
      'hmac',
      'sign',
      'verify',
      'encrypt',
      'decrypt',
      'cipher',
      'pbkdf',
      'privateKey',
      'secret',
    ]) {
      expect(
        source.toLowerCase(),
        `${forbidden} has no place in this module`,
      ).not.toContain(forbidden)
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

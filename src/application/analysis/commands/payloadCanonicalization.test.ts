/**
 * Payload identity is versioned by its own coordinate, and that coordinate is
 * inside the hash.
 *
 * TD-61 changed how a command payload is encoded and changed nothing about the
 * envelope, the outcome vocabulary or `expectedVersion`. Two version numbers
 * describe those two things, and the whole point of keeping them separate is
 * that one change moves one of them. These tests hold that line: a future
 * encoding change must move `PAYLOAD_CANONICALIZATION_VERSION` and must not be
 * allowed to drag `COMMAND_CONTRACT_VERSION` along with it.
 */

import { describe, expect, it } from 'vitest'
import { stableHashHex } from '~/domain/shared/hash'
import {
  canonicalIdentityInput,
  type CanonicalValue,
} from '~/domain/shared/canonicalValue'
import {
  COMMAND_CONTRACT_VERSION,
  PAYLOAD_CANONICALIZATION_VERSION,
  commandPayloadHash,
} from './envelope'

const DOMAIN = 'financial-os:command-payload:v1'

const base = {
  commandType: 'open-investment-case',
  caseId: 'case-1',
  accountableEmployeeId: 'emp-1',
  payload: { question: 'Is the curve mispriced?', ownerEmployeeId: 'emp-1' },
}

/**
 * The hash as it would be computed under a stated canonicalization version.
 *
 * Rebuilt here rather than imported, so the test can express "what version 1
 * produced" and "what version 2 produces" independently of whichever the
 * production constant currently names.
 */
const hashUnderVersion = (version: string, payload: CanonicalValue) =>
  stableHashHex(
    canonicalIdentityInput(DOMAIN, {
      canonicalization: version,
      contract: COMMAND_CONTRACT_VERSION,
      type: base.commandType,
      caseId: base.caseId,
      thesisRevisionId: null,
      expectedVersion: null,
      accountable: base.accountableEmployeeId,
      reason: null,
      payload,
    }),
  )

describe('the payload canonicalization version', () => {
  it('is 2, and the command contract is still 2', () => {
    /*
     * Pinned together on purpose. TD-61 advanced the encoding and left command
     * semantics alone; if a later change moves the contract, it must be because
     * the envelope, the outcome vocabulary or `expectedVersion` changed — not
     * because this file was edited.
     */
    expect(PAYLOAD_CANONICALIZATION_VERSION).toBe('2')
    expect(COMMAND_CONTRACT_VERSION).toBe('2')
  })

  it('binds the version inside the hashed input', () => {
    // Not merely recorded beside the hash: a version-1 rendering and a
    // version-2 rendering of one payload differ by construction.
    expect(hashUnderVersion('1', base.payload)).not.toBe(
      hashUnderVersion('2', base.payload),
    )
  })

  it('produces the version-2 hash for a version-2 build', () => {
    expect(commandPayloadHash(base)).toBe(hashUnderVersion('2', base.payload))
  })

  it('leaves a version-1 payload identified as version 1', () => {
    /*
     * A stored command keeps the version it was written under. Recomputing an
     * old entry under today's rules would replace a fact about a past write
     * with an assertion about this build.
     */
    const asStored = hashUnderVersion('1', base.payload)
    expect(asStored).not.toBe(commandPayloadHash(base))
    expect(asStored).toBe(hashUnderVersion('1', base.payload))
  })

  it('never lets hashes from two canonicalization versions be interchangeable', () => {
    /*
     * The property that matters: across a range of payloads, no version-1 hash
     * ever equals any version-2 hash. If one collided, a replay check would
     * read an old entry as matching a new request and skip the work.
     */
    const payloads = Array.from({ length: 25 }, (_, index) => ({
      question: `q-${index}`,
      ownerEmployeeId: `emp-${index % 5}`,
    }))

    const v1 = new Set(payloads.map((p) => hashUnderVersion('1', p)))
    const v2 = payloads.map((p) => hashUnderVersion('2', p))

    for (const hash of v2) expect(v1.has(hash)).toBe(false)
  })

  it('replays a semantically identical payload under one version', () => {
    // The reason the version is bound at all: within a version, two requests
    // that mean the same thing must hash the same, or every retry looks like a
    // conflicting command.
    expect(commandPayloadHash(base)).toBe(commandPayloadHash({ ...base }))
    expect(
      commandPayloadHash({
        ...base,
        payload: { ownerEmployeeId: 'emp-1', question: 'Is the curve mispriced?' },
      }),
      'key order in the payload is not part of its meaning',
    ).toBe(commandPayloadHash(base))
  })

  it('does not require a contract bump when only the encoding changes', () => {
    /*
     * Stated as a test because it is the ruling that is easiest to lose: the
     * contract version appears in the hash, so it is *observable* here, and a
     * reader could reasonably assume both must move together. They must not.
     * Changing the canonicalization alone changes the hash; the contract stays
     * where it is.
     */
    const underNewEncoding = hashUnderVersion('3', base.payload)
    expect(underNewEncoding).not.toBe(commandPayloadHash(base))
    expect(COMMAND_CONTRACT_VERSION).toBe('2')
  })
})

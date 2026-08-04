/**
 * Every way the harness can be asked to kill something, and what it answers.
 *
 * Exhaustive over synthetic inputs, because the alternative — starting a
 * foreign PostgreSQL to prove we do not terminate it — is a test that could
 * itself kill something. The decision is proven here; the thin caller that acts
 * on it is integration-tested only against a process the harness started.
 *
 * The row that matters most is `our process is dead and the port is still
 * occupied`. A harness optimising for convenience kills there. This one
 * refuses, and that is the case worth reading the table for.
 */

import { describe, expect, it } from 'vitest'
import {
  MARKER_VERSION,
  decideOwnership,
  parseMarker,
  parsePostmasterPid,
  permitsTermination,
  type MarkerRead,
  type OwnershipInput,
  type PostmasterRead,
} from './pgOwnership'

const DIRECTORY = '/tmp/finos-pg-abc123'

const marker = (over: Partial<OwnershipInput['marker'] & object> = {}): MarkerRead => ({
  kind: 'ok',
  marker: {
    version: MARKER_VERSION,
    runId: 'run-1',
    directory: DIRECTORY,
    port: 54_991,
    pid: 4242,
    createdAt: '2026-08-03T10:00:00.000Z',
  },
  ...over,
}) as MarkerRead

const postmaster = (over: Partial<{ pid: number; port: number }> = {}): PostmasterRead => ({
  kind: 'ok',
  pid: 4242,
  port: 54_991,
  ...over,
})

const input = (over: Partial<OwnershipInput> = {}): OwnershipInput => ({
  marker: marker(),
  directoryUnderPrefix: true,
  postmaster: postmaster(),
  pidAlive: true,
  portOccupied: true,
  ...over,
})

describe('termination is permitted only when nothing disagrees', () => {
  it('permits it when all four evidences agree', () => {
    const decision = decideOwnership(input())
    expect(decision).toEqual({
      action: 'terminate-owned-process',
      pid: 4242,
      directory: DIRECTORY,
      reason: 'ownership-proven',
    })
    expect(permitsTermination(decision)).toBe(true)
  })
})

describe('every ambiguity refuses', () => {
  const cases: Array<[string, OwnershipInput, string]> = [
    [
      'no marker while the port is occupied',
      input({ marker: { kind: 'none' } }),
      'no-marker-port-occupied',
    ],
    ['a malformed marker', input({ marker: { kind: 'malformed' } }), 'marker-malformed'],
    [
      'a marker from a version this harness does not know',
      input({ marker: { kind: 'unsupported-version', version: 99 } }),
      'marker-unsupported-version',
    ],
    [
      'a cluster directory outside the harness prefix',
      input({ directoryUnderPrefix: false }),
      'directory-outside-harness-prefix',
    ],
    [
      'a live pid with no postmaster.pid to corroborate it',
      input({ postmaster: { kind: 'missing' }, pidAlive: true }),
      'postmaster-pid-missing',
    ],
    [
      'a malformed postmaster.pid',
      input({ postmaster: { kind: 'malformed' } }),
      'postmaster-pid-malformed',
    ],
    [
      'a postmaster.pid naming a different pid',
      input({ postmaster: postmaster({ pid: 9999 }) }),
      'pid-mismatch',
    ],
    [
      'a postmaster.pid naming a different port',
      input({ postmaster: postmaster({ port: 1234 }) }),
      'port-mismatch',
    ],
    [
      'our process dead while something still holds the port',
      input({ pidAlive: false, portOccupied: true }),
      'port-held-by-unproven-process',
    ],
    [
      'our process dead, no postmaster.pid, port still held',
      input({ postmaster: { kind: 'missing' }, pidAlive: false, portOccupied: true }),
      'port-held-by-unproven-process',
    ],
  ]

  for (const [name, given, reason] of cases) {
    it(`refuses ${name}`, () => {
      const decision = decideOwnership(given)
      expect(decision.action).toBe('refuse-ambiguous')
      expect(decision.reason).toBe(reason)
      expect(permitsTermination(decision)).toBe(false)
    })
  }

  it('never names a pid when it refuses', () => {
    // A refusal that carried a pid would be one edit away from being acted on.
    for (const [, given] of cases) {
      const decision = decideOwnership(given)
      expect('pid' in decision).toBe(false)
    }
  })
})

describe('stale artifacts are cleaned only when they are provably ours', () => {
  it('cleans when the owned process is gone and the port is free', () => {
    expect(decideOwnership(input({ pidAlive: false, portOccupied: false }))).toEqual({
      action: 'clean-owned-stale-artifacts',
      directory: DIRECTORY,
      reason: 'owned-process-already-gone',
    })
  })

  it('cleans after a clean stop, where postmaster.pid is already gone', () => {
    expect(
      decideOwnership(
        input({ postmaster: { kind: 'missing' }, pidAlive: false, portOccupied: false }),
      ),
    ).toEqual({
      action: 'clean-owned-stale-artifacts',
      directory: DIRECTORY,
      reason: 'owned-process-already-gone',
    })
  })

  it('does nothing at all when there is no marker and no conflict', () => {
    /*
     * The idempotent case: teardown already finished, or this is a first run.
     */
    expect(
      decideOwnership(input({ marker: { kind: 'none' }, portOccupied: false })),
    ).toEqual({ action: 'safe-no-op', reason: 'no-marker-port-free' })
  })
})

describe('pid reuse cannot authorise a termination', () => {
  it('refuses when a stale marker names a pid that is now something else', () => {
    /*
     * The pid is alive and matches the marker — but `postmaster.pid` in our
     * directory names a different one, so the live process is not the cluster
     * the marker describes. Mechanically indistinguishable from reuse, and
     * therefore refused.
     */
    const decision = decideOwnership(
      input({ postmaster: postmaster({ pid: 4243 }), pidAlive: true }),
    )
    expect(decision.action).toBe('refuse-ambiguous')
    expect(decision.reason).toBe('pid-mismatch')
  })
})

/* ----------------------------------------------------------- parsing */

describe('postmaster.pid is parsed strictly', () => {
  it('reads the pid from line 1 and the port from line 4', () => {
    expect(parsePostmasterPid('4242\n/tmp/dir\n1750000000\n54991\n')).toEqual({
      kind: 'ok',
      pid: 4242,
      port: 54_991,
    })
  })

  it('treats an absent file as missing rather than empty', () => {
    expect(parsePostmasterPid(null)).toEqual({ kind: 'missing' })
  })

  for (const [name, contents] of [
    ['an empty file', ''],
    ['a truncated file', '4242\n/tmp/dir\n'],
    ['a non-numeric pid', 'postgres\n/tmp/dir\n17\n54991\n'],
    ['a negative pid', '-1\n/tmp/dir\n17\n54991\n'],
    ['a port outside the range', '4242\n/tmp/dir\n17\n99999\n'],
  ] as const) {
    it(`refuses ${name}`, () => {
      expect(parsePostmasterPid(contents).kind).toBe('malformed')
    })
  }
})

describe('the marker is validated, not trusted', () => {
  const complete = {
    version: MARKER_VERSION,
    runId: 'run-1',
    directory: DIRECTORY,
    port: 54_991,
    pid: 4242,
    createdAt: '2026-08-03T10:00:00.000Z',
  }

  it('accepts a complete marker of the current version', () => {
    expect(parseMarker(JSON.stringify(complete))).toEqual({
      kind: 'ok',
      marker: complete,
    })
  })

  it('treats an absent marker as none', () => {
    expect(parseMarker(null)).toEqual({ kind: 'none' })
  })

  it('refuses a half-written marker', () => {
    // Exactly what an interrupted write leaves, and it must never be read as
    // ownership.
    expect(parseMarker('{"version":1,"runId":"run').kind).toBe('malformed')
  })

  it('refuses a marker missing any required field', () => {
    for (const field of ['runId', 'directory', 'port', 'pid', 'createdAt'] as const) {
      const partial: Record<string, unknown> = { ...complete }
      delete partial[field]
      expect(parseMarker(JSON.stringify(partial)).kind, field).toBe('malformed')
    }
  })

  it('refuses a future marker version rather than guessing', () => {
    expect(parseMarker(JSON.stringify({ ...complete, version: 2 }))).toEqual({
      kind: 'unsupported-version',
      version: 2,
    })
  })
})

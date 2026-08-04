/**
 * Whether the harness may terminate a PostgreSQL process.
 *
 * The rule this exists to enforce, in one sentence: **an occupied port, a
 * process named `postgres` and a stray pid file are evidence of a conflict, not
 * evidence of ownership.** A developer's own database on the chosen port must
 * produce a failed test run, never a terminated server.
 *
 * So termination requires four independent pieces of evidence to agree, three
 * of which the harness created and one of which PostgreSQL wrote:
 *
 *   1. a marker file this harness wrote after a successful start
 *   2. a cluster directory this harness created under a known prefix
 *   3. `postmaster.pid` inside that exact directory, written by PostgreSQL
 *   4. a live pid that all of the above name
 *
 * ## Pure, deliberately
 *
 * No filesystem, no `process.kill`, no sockets. Everything is passed in, so
 * every combination — including the ones that must refuse — is unit-testable
 * without manufacturing a real postmaster to prove a negative. The thin caller
 * that actually kills does what this returns and decides nothing.
 */

/** The marker schema. An unrecognised version is treated as foreign. */
export const MARKER_VERSION = 1

export interface OwnershipMarker {
  version: number
  /** Unique per harness run: what stops a stale marker authorising a reused pid. */
  runId: string
  directory: string
  port: number
  pid: number
  createdAt: string
  /** The runner that wrote it, for diagnostics only. Never used to decide. */
  parentPid?: number
}

/** What reading the marker file produced. */
export type MarkerRead =
  | { kind: 'none' }
  | { kind: 'malformed' }
  | { kind: 'unsupported-version'; version: number }
  | { kind: 'ok'; marker: OwnershipMarker }

/** What reading `postmaster.pid` from the owned directory produced. */
export type PostmasterRead =
  | { kind: 'missing' }
  | { kind: 'malformed' }
  | { kind: 'ok'; pid: number; port: number }

export interface OwnershipInput {
  marker: MarkerRead
  /** Whether the marker's directory sits under the harness's own tmp prefix. */
  directoryUnderPrefix: boolean
  postmaster: PostmasterRead
  /** Whether the pid the marker names is currently alive. */
  pidAlive: boolean
  /** Whether anything is currently listening on the marker's port. */
  portOccupied: boolean
}

export type OwnershipReason =
  | 'no-marker-port-free'
  | 'no-marker-port-occupied'
  | 'marker-malformed'
  | 'marker-unsupported-version'
  | 'directory-outside-harness-prefix'
  | 'postmaster-pid-missing'
  | 'postmaster-pid-malformed'
  | 'pid-mismatch'
  | 'port-mismatch'
  | 'port-held-by-unproven-process'
  | 'ownership-proven'
  | 'owned-process-already-gone'

export type OwnershipDecision =
  | { action: 'terminate-owned-process'; pid: number; directory: string; reason: OwnershipReason }
  | { action: 'clean-owned-stale-artifacts'; directory: string; reason: OwnershipReason }
  | { action: 'safe-no-op'; reason: OwnershipReason }
  | { action: 'refuse-ambiguous'; reason: OwnershipReason }

const refuse = (reason: OwnershipReason): OwnershipDecision => ({
  action: 'refuse-ambiguous',
  reason,
})

/**
 * The decision, from evidence alone.
 *
 * Reads as a series of ways to say no, which is the intended shape: every
 * ambiguity resolves to a refusal, and `terminate` is reachable only when
 * nothing disagreed.
 */
export function decideOwnership(input: OwnershipInput): OwnershipDecision {
  const { marker, directoryUnderPrefix, postmaster, pidAlive, portOccupied } = input

  /*
   * No marker at all. Nothing this harness started is recorded, so nothing may
   * be terminated — whatever holds the port, if anything, is somebody else's.
   */
  if (marker.kind === 'none') {
    return portOccupied
      ? refuse('no-marker-port-occupied')
      : { action: 'safe-no-op', reason: 'no-marker-port-free' }
  }

  /*
   * A half-written or unrecognised marker is not weaker evidence — it is no
   * evidence. Best-effort interpretation here is exactly how a harness ends up
   * killing something on a guess.
   */
  if (marker.kind === 'malformed') return refuse('marker-malformed')
  if (marker.kind === 'unsupported-version') return refuse('marker-unsupported-version')

  const owned = marker.marker

  // A marker naming a directory we did not create proves nothing about it.
  if (!directoryUnderPrefix) return refuse('directory-outside-harness-prefix')

  if (postmaster.kind === 'malformed') return refuse('postmaster-pid-malformed')

  if (postmaster.kind === 'missing') {
    /*
     * PostgreSQL removes `postmaster.pid` on a clean stop, so its absence with
     * a dead pid and a free port is the ordinary shape of a run that ended
     * badly: artifacts to clean, nothing to kill.
     */
    if (pidAlive) return refuse('postmaster-pid-missing')
    if (portOccupied) return refuse('port-held-by-unproven-process')
    return {
      action: 'clean-owned-stale-artifacts',
      directory: owned.directory,
      reason: 'owned-process-already-gone',
    }
  }

  // Every field must agree. Any disagreement is pid reuse or a stale marker.
  if (postmaster.pid !== owned.pid) return refuse('pid-mismatch')
  if (postmaster.port !== owned.port) return refuse('port-mismatch')

  if (pidAlive) {
    return {
      action: 'terminate-owned-process',
      pid: owned.pid,
      directory: owned.directory,
      reason: 'ownership-proven',
    }
  }

  /*
   * The case that matters most, and the one a convenient harness gets wrong:
   * OUR process is dead, and something still holds the port. That something is
   * not ours. It is not killed.
   */
  if (portOccupied) return refuse('port-held-by-unproven-process')

  return {
    action: 'clean-owned-stale-artifacts',
    directory: owned.directory,
    reason: 'owned-process-already-gone',
  }
}

/** Whether a decision permits touching anything. For the caller's guard. */
export const permitsTermination = (decision: OwnershipDecision): boolean =>
  decision.action === 'terminate-owned-process'

/* --------------------------------------------------------------- parsing */

/**
 * The two fields of `postmaster.pid` this harness needs.
 *
 * PostgreSQL writes a fixed-order file: line 1 is the postmaster pid, line 4 is
 * the port. Anything that does not parse as those is `malformed` rather than
 * partially trusted.
 */
export function parsePostmasterPid(contents: string | null): PostmasterRead {
  if (contents === null) return { kind: 'missing' }

  const lines = contents.split(/\r?\n/)
  const pid = Number(lines[0])
  const port = Number(lines[3])

  const valid = (value: number) => Number.isInteger(value) && value > 0
  if (!valid(pid) || !valid(port) || port > 65_535) return { kind: 'malformed' }

  return { kind: 'ok', pid, port }
}

/** A marker, validated rather than trusted. */
export function parseMarker(contents: string | null): MarkerRead {
  if (contents === null) return { kind: 'none' }

  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    return { kind: 'malformed' }
  }

  if (typeof parsed !== 'object' || parsed === null) return { kind: 'malformed' }
  const candidate = parsed as Partial<OwnershipMarker>

  if (typeof candidate.version !== 'number') return { kind: 'malformed' }
  if (candidate.version !== MARKER_VERSION) {
    return { kind: 'unsupported-version', version: candidate.version }
  }

  const complete =
    typeof candidate.runId === 'string' &&
    candidate.runId.length > 0 &&
    typeof candidate.directory === 'string' &&
    candidate.directory.length > 0 &&
    Number.isInteger(candidate.port) &&
    Number.isInteger(candidate.pid) &&
    typeof candidate.createdAt === 'string'

  return complete
    ? { kind: 'ok', marker: candidate as OwnershipMarker }
    : { kind: 'malformed' }
}

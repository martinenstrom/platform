/**
 * Starts one real PostgreSQL cluster for the integration suite, and cleans up
 * after itself — including after a run that did not get to clean up.
 *
 * ## Why this is not the default test config
 *
 * The unit suite runs sixteen hundred tests in a couple of seconds against the
 * in-memory adapter, and that speed is worth protecting. Starting a database
 * would add ten seconds to every run of every test, including the ones that
 * have nothing to do with storage. So the integration tests live behind
 * `npm run test:db` and their own config, and `npm test` is unchanged.
 *
 * ## Real PostgreSQL, not a substitute
 *
 * SQLite would run anywhere and prove nothing here: no roles, no column-level
 * grants, no deferred constraint triggers, different transactional-DDL
 * behaviour — which is most of what this schema relies on.
 *
 * Set `TEST_DATABASE_URL` to run against an existing server instead, and every
 * mechanism below is skipped.
 *
 * ## The fixed port is gone
 *
 * It used to be 54330, and that was the cause of a whole class of failure: one
 * run killed without teardown kept the port, the next could not bind, and the
 * symptom was `Timeout waiting for worker to respond` — a message with nothing
 * in it about ports. A dynamic port removes the collision; ownership handles
 * the leftovers; and the diagnostics below name causes rather than symptoms.
 *
 * ## What this will never do
 *
 * Terminate a PostgreSQL process it cannot prove it started. An occupied port,
 * a process named `postgres` and a stray pid file are evidence of a *conflict*,
 * not evidence of ownership. When the evidence is ambiguous this fails and asks
 * a human, and the occasional manual cleanup is the price of never killing
 * somebody's database. See `pgOwnership.ts`.
 */

import { createServer } from 'node:net'
import { connect } from 'node:net'
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestProject } from 'vitest/node'
import {
  MARKER_VERSION,
  decideOwnership,
  parseMarker,
  parsePostmasterPid,
  type OwnershipMarker,
} from './pgOwnership'

const SUPERUSER = 'postgres'
const PASSWORD = 'integration-test'

/** Cluster directories this harness creates. Ownership keys on this prefix. */
const DIRECTORY_PREFIX = 'finos-pg-'
/** Where the ownership marker lives. One harness, one marker. */
const MARKER_PATH = join(tmpdir(), 'finos-pg-harness.json')

/** Attempts before giving up on the bind race. Approved at five. */
const MAX_START_ATTEMPTS = 5
const READY_TIMEOUT_MS = 30_000

/** Named causes, so a failure says what happened rather than that it took too long. */
type Diagnostic =
  | 'candidate-port-already-occupied'
  | 'bind-race-lost'
  | 'postgres-start-failed'
  | 'postmaster-pid-timeout'
  | 'postmaster-pid-malformed'
  | 'marker-write-failed'
  | 'readiness-timeout'
  | 'ownership-ambiguous'
  | 'owned-process-termination-failed'
  | 'teardown-incomplete'

class HarnessError extends Error {
  constructor(
    readonly diagnostic: Diagnostic,
    detail: string,
  ) {
    // Never a connection string: the password is in it.
    super(`[${diagnostic}] ${detail}`)
    this.name = 'HarnessError'
  }
}

/* ------------------------------------------------------------- primitives */

/** A port the OS says is free. Free *now* — see the race note in `start`. */
async function selectPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        probe.close()
        reject(new Error('the probe socket reported no port'))
        return
      }
      const { port } = address
      probe.close(() => resolve(port))
    })
  })
}

/** Whether anything answers on the port. Never a reason to kill, only to ask. */
async function portOccupied(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' })
    const done = (answer: boolean) => {
      socket.destroy()
      resolve(answer)
    }
    socket.setTimeout(500)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

const alive = (pid: number): boolean => {
  try {
    // Signal 0 tests for existence without delivering anything.
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const readOrNull = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * Writes the marker atomically.
 *
 * A half-written marker is the one artifact that could be mistaken for
 * ownership, so it is written elsewhere and renamed into place — rename is
 * atomic on the platforms this runs on, and a reader sees either the whole
 * marker or none.
 */
async function writeMarker(marker: OwnershipMarker): Promise<void> {
  const temporary = `${MARKER_PATH}.${marker.runId}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(marker, null, 2), 'utf8')
    await rename(temporary, MARKER_PATH)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw new HarnessError('marker-write-failed', String(error))
  }
}

/* --------------------------------------------------------- prior runs */

/**
 * Deals with whatever the last run left, or refuses to.
 *
 * The decision itself is `decideOwnership`, which touches nothing. This is the
 * thin part that acts on it — and the only place in the harness that may
 * terminate a process.
 */
async function reconcilePriorRun(): Promise<void> {
  const markerRead = parseMarker(await readOrNull(MARKER_PATH))

  const directory = markerRead.kind === 'ok' ? markerRead.marker.directory : null
  const postmaster =
    directory === null
      ? ({ kind: 'missing' } as const)
      : parsePostmasterPid(await readOrNull(join(directory, 'postmaster.pid')))

  const decision = decideOwnership({
    marker: markerRead,
    directoryUnderPrefix: directory !== null && directory.includes(DIRECTORY_PREFIX),
    postmaster,
    pidAlive: markerRead.kind === 'ok' && alive(markerRead.marker.pid),
    portOccupied:
      markerRead.kind === 'ok' && (await portOccupied(markerRead.marker.port)),
  })

  switch (decision.action) {
    case 'safe-no-op':
      return

    case 'clean-owned-stale-artifacts':
      await rm(decision.directory, { recursive: true, force: true }).catch(() => {})
      await rm(MARKER_PATH, { force: true }).catch(() => {})
      return

    case 'terminate-owned-process': {
      try {
        process.kill(decision.pid, 'SIGTERM')
      } catch (error) {
        throw new HarnessError(
          'owned-process-termination-failed',
          `pid ${decision.pid} from a prior run could not be signalled: ${error}`,
        )
      }
      await waitForExit(decision.pid)
      await rm(decision.directory, { recursive: true, force: true }).catch(() => {})
      await rm(MARKER_PATH, { force: true }).catch(() => {})
      return
    }

    case 'refuse-ambiguous':
      throw new HarnessError(
        'ownership-ambiguous',
        `A previous PostgreSQL could not be proven to belong to this harness ` +
          `(${decision.reason}). Nothing was terminated and nothing was deleted. ` +
          `Marker: ${MARKER_PATH}. Inspect it and the cluster it names, then ` +
          `remove them by hand if they are yours.`,
      )
  }
}

async function waitForExit(pid: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!alive(pid)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new HarnessError(
    'owned-process-termination-failed',
    `pid ${pid} was signalled and is still running after ${timeoutMs}ms`,
  )
}

/* ------------------------------------------------------------ the cluster */

interface Running {
  stop: () => Promise<void>
  url: string
}

let running: Running | null = null

export async function setup(project: TestProject): Promise<void> {
  const external = process.env.TEST_DATABASE_URL
  if (external) {
    project.provide('adminUrl', external)
    return
  }

  await reconcilePriorRun()

  const { default: EmbeddedPostgres } = await import('embedded-postgres')
  const attempted: number[] = []
  let lastFailure: unknown = null

  for (let attempt = 1; attempt <= MAX_START_ATTEMPTS; attempt += 1) {
    const port = await selectPort()
    attempted.push(port)

    /*
     * The residual race, stated where it happens: the probe socket has to be
     * released before `embedded-postgres` can bind, because the library takes
     * a port number and not a descriptor. Another process can take it in
     * between. The window is microseconds on loopback, and the answer is a new
     * port rather than the same one again.
     */
    if (await portOccupied(port)) {
      lastFailure = new HarnessError(
        'candidate-port-already-occupied',
        `port ${port} was taken between selection and start`,
      )
      continue
    }

    const directory = await mkdtemp(join(tmpdir(), DIRECTORY_PREFIX))
    const postgres = new EmbeddedPostgres({
      databaseDir: directory,
      user: SUPERUSER,
      password: PASSWORD,
      port,
      persistent: false,
    })

    try {
      await postgres.initialise()
      await postgres.start()
    } catch (error) {
      lastFailure = new HarnessError(
        'bind-race-lost',
        `attempt ${attempt} on port ${port} failed to start: ${error}`,
      )
      /*
       * Ownership was never established, so nothing is killed on a guess. Only
       * the directory this attempt created is removed, and only because this
       * process created it moments ago.
       */
      await postgres.stop().catch(() => {})
      await rm(directory, { recursive: true, force: true }).catch(() => {})
      continue
    }

    // From here ownership IS establishable, so failures clean up properly.
    try {
      const { pid, port: reported } = await awaitPostmaster(directory)
      if (reported !== port) {
        throw new HarnessError(
          'postmaster-pid-malformed',
          `postmaster.pid reports port ${reported}; ${port} was selected`,
        )
      }

      await writeMarker({
        version: MARKER_VERSION,
        runId: randomUUID(),
        directory,
        port,
        pid,
        createdAt: new Date().toISOString(),
        parentPid: process.pid,
      })

      const url = `postgres://${SUPERUSER}:${PASSWORD}@localhost:${port}/postgres`
      await awaitReady(port)

      running = {
        url,
        stop: async () => {
          await postgres.stop()
          await rm(MARKER_PATH, { force: true }).catch(() => {})
          await rm(directory, { recursive: true, force: true }).catch(() => {})
        },
      }
      project.provide('adminUrl', url)
      installSignalHandlers()
      return
    } catch (error) {
      await postgres.stop().catch(() => {})
      await rm(directory, { recursive: true, force: true }).catch(() => {})
      await rm(MARKER_PATH, { force: true }).catch(() => {})
      throw error
    }
  }

  throw new HarnessError(
    'bind-race-lost',
    `no port could be held across ${MAX_START_ATTEMPTS} attempts ` +
      `(tried ${attempted.join(', ')}). Last failure: ${lastFailure}`,
  )
}

/** PostgreSQL writes `postmaster.pid` shortly after start; wait for it. */
async function awaitPostmaster(
  directory: string,
  timeoutMs = 15_000,
): Promise<{ pid: number; port: number }> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const read = parsePostmasterPid(await readOrNull(join(directory, 'postmaster.pid')))
    if (read.kind === 'ok') return read
    if (read.kind === 'malformed') {
      // Mid-write; give it a moment rather than failing on a torn read.
      await new Promise((resolve) => setTimeout(resolve, 100))
      continue
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new HarnessError(
    'postmaster-pid-timeout',
    `no readable postmaster.pid in ${directory} after ${timeoutMs}ms`,
  )
}

/**
 * Accepting connections, not merely started.
 *
 * `start()` resolving means the process launched. A worker connecting a
 * millisecond later would fail for a reason that has nothing to do with the
 * test, so readiness is a real query.
 */
async function awaitReady(port: number): Promise<void> {
  const { Client } = await import('pg')
  const deadline = Date.now() + READY_TIMEOUT_MS
  let lastError: unknown = null

  while (Date.now() < deadline) {
    const client = new Client({
      host: 'localhost',
      port,
      user: SUPERUSER,
      password: PASSWORD,
      database: 'postgres',
    })
    try {
      await client.connect()
      await client.query('SELECT 1')
      await client.end()
      return
    } catch (error) {
      lastError = error
      await client.end().catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }

  throw new HarnessError(
    'readiness-timeout',
    `port ${port} did not accept a query within ${READY_TIMEOUT_MS}ms: ${lastError}`,
  )
}

/** An interrupted run cleans up after itself, where the OS allows it. */
let handlersInstalled = false
function installSignalHandlers(): void {
  if (handlersInstalled) return
  handlersInstalled = true
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void teardown().finally(() => process.exit(1))
    })
  }
}

export async function teardown(): Promise<void> {
  const current = running
  running = null
  if (!current) return

  try {
    await current.stop()
  } catch (error) {
    /*
     * Reported, never swallowed and never allowed to replace whatever the tests
     * were failing for. Enough evidence is left behind for the next run to
     * reconcile safely.
     */
    throw new HarnessError('teardown-incomplete', String(error))
  }
}

declare module 'vitest' {
  interface ProvidedContext {
    /** Superuser connection to the `postgres` maintenance database. */
    adminUrl: string
  }
}

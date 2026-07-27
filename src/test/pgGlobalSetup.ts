/**
 * Starts one real PostgreSQL cluster for the integration suite.
 *
 * ## Why this is not the default test config
 *
 * The unit suite runs 800-odd tests in a couple of seconds against the
 * in-memory adapter, and that speed is worth protecting. Starting a database
 * would add ten seconds to every run of every test, including the ones that
 * have nothing to do with storage. So the integration tests live behind
 * `npm run test:db` and their own config, and `npm test` is unchanged.
 *
 * ## Real PostgreSQL, not a substitute
 *
 * SQLite would run anywhere and prove nothing here: it has no roles, no
 * column-level grants, no `NULLS NOT DISTINCT`, no deferred constraint
 * triggers, and different transactional-DDL behaviour — which is most of what
 * this schema relies on. `embedded-postgres` downloads the actual PostgreSQL
 * binaries and runs them, so these tests exercise the server that production
 * will use.
 *
 * Set `TEST_DATABASE_URL` to run against an existing server instead — a
 * container in CI, or a local install — and the embedded cluster is skipped.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestProject } from 'vitest/node'

const PORT = 54_330
const SUPERUSER = 'postgres'
const PASSWORD = 'integration-test'

let stop: (() => Promise<void>) | null = null

export async function setup(project: TestProject): Promise<void> {
  const external = process.env.TEST_DATABASE_URL
  if (external) {
    project.provide('adminUrl', external)
    return
  }

  // Imported lazily so the module is not required when TEST_DATABASE_URL is set.
  const { default: EmbeddedPostgres } = await import('embedded-postgres')
  const directory = await mkdtemp(join(tmpdir(), 'finos-pg-'))

  const postgres = new EmbeddedPostgres({
    databaseDir: directory,
    user: SUPERUSER,
    password: PASSWORD,
    port: PORT,
    persistent: false,
  })

  await postgres.initialise()
  await postgres.start()

  stop = async () => {
    await postgres.stop()
    // `persistent: false` drops the cluster; the directory itself is ours.
    await rm(directory, { recursive: true, force: true }).catch(() => {})
  }

  project.provide(
    'adminUrl',
    `postgres://${SUPERUSER}:${PASSWORD}@localhost:${PORT}/postgres`,
  )
}

export async function teardown(): Promise<void> {
  await stop?.()
  stop = null
}

declare module 'vitest' {
  interface ProvidedContext {
    /** Superuser connection to the `postgres` maintenance database. */
    adminUrl: string
  }
}

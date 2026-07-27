/**
 * Per-test databases on the shared cluster.
 *
 * Several requirements only mean something against a database nothing else has
 * touched — "a clean database reaches the expected schema", "a failed migration
 * leaves nothing behind", "the seed is repeatable". Sharing one database
 * between them would make each test's starting state depend on which tests ran
 * before it.
 *
 * `CREATE DATABASE` on an already-running cluster costs a few hundred
 * milliseconds, so each test gets its own and drops it afterwards.
 *
 * Test-only. It imports the integration harness and must never be reachable
 * from application code; `src/test/importGraph.test.ts` asserts that.
 */

import { Client } from 'pg'
import { inject } from 'vitest'
import { migrate } from './migrations'

/** The group roles created by migration 0009. */
export const APP_ROLE = 'finos_app'
export const READONLY_ROLE = 'finos_readonly'

let counter = 0

export interface TestDatabase {
  name: string
  /** Connected as the superuser, which also owns the schema. */
  owner: Client
  /**
   * Connects a fresh client as a login user holding `role`.
   *
   * The point of the exercise: the schema owner can do anything, so a
   * permission test that runs as the owner proves nothing at all.
   */
  connectAs(role: string): Promise<Client>
  /** Applies every migration as the schema owner. */
  migrate(): Promise<void>
  drop(): Promise<void>
}

function urlFor(adminUrl: string, database: string): string {
  const url = new URL(adminUrl)
  url.pathname = `/${database}`
  return url.toString()
}

/**
 * Creates an empty database and connects to it as its owner.
 *
 * Deliberately does NOT migrate — the migration tests need to observe an
 * empty database, and everything else calls `migrate()` explicitly.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = inject('adminUrl')
  const name = `finos_test_${process.pid}_${++counter}`

  const admin = new Client({ connectionString: adminUrl })
  await admin.connect()
  await admin.query(`DROP DATABASE IF EXISTS ${name}`)
  await admin.query(`CREATE DATABASE ${name}`)
  await admin.end()

  const owner = new Client({ connectionString: urlFor(adminUrl, name) })
  await owner.connect()

  const clients: Client[] = []

  return {
    name,
    owner,

    async migrate() {
      await migrate(owner)
    },

    async connectAs(role: string) {
      /*
       * A login user granted the group role, which is how deployment works:
       * `finos_app` carries the privileges, a deployment-created user carries
       * the credentials, and no password ever appears in a migration.
       */
      const login = `${role}_login_${counter}`
      await owner.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${login}') THEN
            CREATE ROLE ${login} LOGIN PASSWORD 'test';
          END IF;
        END;
        $$
      `)
      await owner.query(`GRANT ${role} TO ${login}`)
      await owner.query(`GRANT CONNECT ON DATABASE ${name} TO ${login}`)

      const url = new URL(urlFor(adminUrl, name))
      url.username = login
      url.password = 'test'
      const client = new Client({ connectionString: url.toString() })
      await client.connect()
      clients.push(client)
      return client
    },

    async drop() {
      await Promise.all(clients.map((client) => client.end().catch(() => {})))
      await owner.end().catch(() => {})

      const cleanup = new Client({ connectionString: adminUrl })
      await cleanup.connect()
      // Terminate anything still attached, or DROP DATABASE blocks.
      await cleanup.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1',
        [name],
      )
      await cleanup.query(`DROP DATABASE IF EXISTS ${name}`)
      await cleanup.end()
    },
  }
}

/** True when the error is PostgreSQL's "permission denied" (42501). */
export function isPermissionDenied(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42501'
}

/** True when the error is any integrity violation (class 23) or our own raise. */
export function isIntegrityViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return typeof code === 'string' && code.startsWith('23')
}

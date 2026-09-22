/**
 * A persistent local PostgreSQL for development.
 *
 * Development infrastructure, not a new architecture. It reuses the mechanism
 * the repository already has — the `embedded-postgres` package the integration
 * harness drives — so there is no second way to obtain a database, and no
 * system PostgreSQL to install.
 *
 * ## How this differs from the test harness, and why
 *
 * `src/test/pgGlobalSetup.ts` starts a cluster per RUN: a temporary directory,
 * a dynamic port, `persistent: false`, and it destroys the cluster afterwards.
 * That is right for a suite and useless for development, where the point is
 * that the data is still there tomorrow. So this one keeps a fixed directory
 * and a fixed port, and does not delete anything.
 *
 * It deliberately does NOT copy the harness's ownership-marker logic. That
 * exists so an automated suite can decide whether a stray process is safe to
 * kill; this script never kills anything it did not just start, so there is
 * nothing to adjudicate.
 *
 *   node --experimental-strip-types scripts/dev-db.ts start
 *   node --experimental-strip-types scripts/dev-db.ts stop
 *
 * After `start`, apply the schema with the existing runner:
 *
 *   DATABASE_URL=... npm run db:migrate
 *
 * ## Two credentials, on purpose
 *
 * `start` prints the OWNER url, which migrations run under and which can drop
 * tables, and separately provisions a login user holding `finos_app` — the
 * NOLOGIN group role migration 0009 creates. That split is the whole point of
 * the role model: the request path must never hold the privilege that can
 * alter the schema. `ANALYSIS_DATABASE_URL` gets the second one.
 */

import { join } from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'

/** Inside the repo and git-ignored, so it is obvious where the data lives. */
const DATA_DIR = join(process.cwd(), '.pgdata')
const PORT = 54_320
const SUPERUSER = 'postgres'
/** Local development only. This cluster listens on localhost and holds nothing real. */
const SUPERUSER_PASSWORD = 'dev'
const DATABASE = 'finos'

/** The login user the application connects as. Holds `finos_app`, nothing more. */
const APP_LOGIN = 'finos_app_dev'
const APP_PASSWORD = 'dev'

function instance(): EmbeddedPostgres {
  return new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: SUPERUSER,
    password: SUPERUSER_PASSWORD,
    port: PORT,
    persistent: true,
    /*
     * A UTF8 cluster. Without this, initdb takes the operating system's
     * locale — WIN1252 on a Swedish Windows — and every database created from
     * it refuses any character outside that code page in a model's text
     * (SQLSTATE 22P05, measured 2026-09-22). The runtime refuses to start on
     * such a database.
     */
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  })
}

const ownerUrl = (database: string) =>
  `postgres://${SUPERUSER}:${SUPERUSER_PASSWORD}@localhost:${PORT}/${database}`

async function start(): Promise<void> {
  const postgres = instance()

  // `initialise` on an existing cluster throws; a second start is normal.
  try {
    await postgres.initialise()
    console.log('initialised a new cluster')
  } catch {
    console.log('reusing the existing cluster')
  }

  await postgres.start()
  console.log(`postgres listening on ${PORT}`)

  {
    /* Created with an explicit encoding rather than the cluster's default, for the reason above. */
    const { Client } = await import('pg')
    const admin = new Client({ connectionString: ownerUrl('postgres') })
    await admin.connect()
    try {
      const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DATABASE])
      if (exists.rowCount) {
        console.log(`database ${DATABASE} already exists`)
      } else {
        await admin.query(
          `CREATE DATABASE ${DATABASE} ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`,
        )
        console.log(`created database ${DATABASE} (UTF8)`)
      }
    } finally {
      await admin.end()
    }
  }

  console.log('')
  console.log('owner url (migrations only — can drop tables):')
  console.log(`  ${ownerUrl(DATABASE)}`)
  console.log('')
  console.log('next: apply the schema, then provision the application login')
  console.log(`  DATABASE_URL="${ownerUrl(DATABASE)}" npm run db:migrate`)
  console.log('  node --experimental-strip-types scripts/dev-db.ts grant')
}

/**
 * Provisions the application's login user.
 *
 * Run AFTER the migrations, because `finos_app` is created by migration 0009 —
 * granting a role that does not exist yet fails, and the failure would look
 * like a permissions problem rather than an ordering one.
 *
 * The same shape the integration harness uses: a login role that holds the
 * group role and nothing else.
 */
async function grant(): Promise<void> {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: ownerUrl(DATABASE) })
  await client.connect()
  try {
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_LOGIN}') THEN
          CREATE ROLE ${APP_LOGIN} LOGIN PASSWORD '${APP_PASSWORD}';
        END IF;
      END;
      $$
    `)
    await client.query(`GRANT finos_app TO ${APP_LOGIN}`)
    await client.query(`GRANT CONNECT ON DATABASE ${DATABASE} TO ${APP_LOGIN}`)
    console.log(`granted finos_app to ${APP_LOGIN}`)
    console.log('')
    console.log('set this as ANALYSIS_DATABASE_URL:')
    console.log(`  postgres://${APP_LOGIN}:${APP_PASSWORD}@localhost:${PORT}/${DATABASE}`)
  } finally {
    await client.end()
  }
}

async function stop(): Promise<void> {
  await instance().stop()
  console.log('stopped')
}

const command = process.argv[2]
if (command === 'start') await start()
else if (command === 'grant') await grant()
else if (command === 'stop') await stop()
else {
  console.error('usage: dev-db.ts start | grant | stop')
  process.exit(1)
}

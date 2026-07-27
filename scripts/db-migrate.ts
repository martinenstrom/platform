/**
 * Applies pending migrations to the database named by `DATABASE_URL`.
 *
 * Run as the SCHEMA OWNER, which is a different credential from the one the
 * application uses. The runtime role cannot create tables, alter them, or
 * write to the migration history — that is the separation, and running
 * migrations with the application's credentials would quietly remove it.
 *
 *   DATABASE_URL=postgres://owner@host/finos npm run db:migrate
 *
 * The connection string is read from the environment and never logged: it
 * carries a password, and a migration log is exactly the kind of output that
 * gets pasted into an issue.
 */

import { Client } from 'pg'
import { migrate } from '../src/infrastructure/analysis/postgres/migrations.ts'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error(
    'DATABASE_URL is not set. Point it at the database to migrate, using the ' +
      'schema owner’s credentials rather than the application’s.',
  )
  process.exit(1)
}

const client = new Client({ connectionString })
await client.connect()

try {
  const { applied, alreadyApplied } = await migrate(client, {
    log: (message) => console.log(message),
  })
  console.log(
    applied.length === 0
      ? `nothing to do — ${alreadyApplied.length} migration(s) already applied`
      : `applied ${applied.length} migration(s)`,
  )
} catch (error) {
  // The runner's errors already say what to do; re-printing a stack would bury
  // that under frames from inside pg.
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await client.end()
}

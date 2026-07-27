import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * The integration suite: schema, migrations, constraints and permissions
 * against real PostgreSQL.
 *
 * Separate from `vitest.config.ts` for two reasons. The environment must be
 * `node` — the unit suite runs in jsdom, where `pg` cannot open a socket and
 * where the migration runner's browser guard would (correctly) refuse to run.
 * And the cluster is started once in a global setup, which would otherwise add
 * ten seconds to every run of the unit suite.
 *
 * Run with `npm run test:db`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    name: 'postgres',
    environment: 'node',
    include: ['src/**/*.pg.test.ts'],
    globalSetup: ['./src/test/pgGlobalSetup.ts'],
    // Starting the cluster, applying eleven migrations and creating a database
    // per test is comfortably slower than a unit test.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // One database per test is cheap; one cluster is not. Files share the
    // cluster, so they must not fight over the same database names.
    fileParallelism: false,
  },
})

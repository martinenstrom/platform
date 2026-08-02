/**
 * What a schema IS, as a comparable value.
 *
 * A migration that reaches the right shape from an empty database and a
 * different one from the schema before it is the failure nobody sees until a
 * deployment: the tests run against a clean database, production runs against
 * the upgrade, and the two disagree about a default, a deferrability or a
 * grant. Comparing table names would not find it. Comparing everything the
 * database will act on does.
 *
 * Deliberately read from `pg_catalog` and `information_schema` rather than from
 * the migration text: what is being compared is the state the database is in,
 * not the statements believed to produce it.
 *
 * Test-only. `src/test/importGraph.test.ts` keeps the integration harness out
 * of application code.
 */

import type { Client } from 'pg'

export interface SchemaFingerprint {
  tables: unknown
  columns: unknown
  constraints: unknown
  indexes: unknown
  triggers: unknown
  functions: unknown
  tableGrants: unknown
  columnGrants: unknown
  policies: unknown
  seededPolicies: unknown
  migrationHistory: unknown
}

const rows = async (client: Client, sql: string) => (await client.query(sql)).rows

/**
 * Every dimension the database will act on.
 *
 * `pg_get_constraintdef` and `pg_get_indexdef` are used rather than the
 * decomposed catalogue columns because they render the whole thing — including
 * the predicate on a partial index and `DEFERRABLE INITIALLY DEFERRED` on a
 * foreign key, both of which C1D-1A depends on and neither of which shows up in
 * a naive column comparison.
 */
export async function fingerprint(client: Client): Promise<SchemaFingerprint> {
  return {
    tables: await rows(
      client,
      `SELECT table_name, table_type
       FROM information_schema.tables
       WHERE table_schema = 'analysis'
       ORDER BY table_name`,
    ),

    columns: await rows(
      client,
      `SELECT table_name, column_name, data_type, is_nullable, column_default,
              character_maximum_length, numeric_precision, udt_name
       FROM information_schema.columns
       WHERE table_schema = 'analysis'
       ORDER BY table_name, column_name`,
    ),

    /* Rendered in full: deferrability and the check body are both in here. */
    constraints: await rows(
      client,
      `SELECT rel.relname AS table_name, con.conname, con.contype,
              con.condeferrable, con.condeferred,
              pg_get_constraintdef(con.oid) AS definition
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace ns ON ns.oid = rel.relnamespace
       WHERE ns.nspname = 'analysis'
       ORDER BY rel.relname, con.conname`,
    ),

    /* `indexdef` carries the WHERE predicate of a partial index. */
    indexes: await rows(
      client,
      `SELECT tablename, indexname, indexdef
       FROM pg_indexes
       WHERE schemaname = 'analysis'
       ORDER BY tablename, indexname`,
    ),

    triggers: await rows(
      client,
      `SELECT rel.relname AS table_name, tg.tgname,
              tg.tgtype, tg.tgdeferrable, tg.tginitdeferred, tg.tgenabled,
              pg_get_triggerdef(tg.oid) AS definition
       FROM pg_trigger tg
       JOIN pg_class rel ON rel.oid = tg.tgrelid
       JOIN pg_namespace ns ON ns.oid = rel.relnamespace
       WHERE ns.nspname = 'analysis' AND NOT tg.tgisinternal
       ORDER BY rel.relname, tg.tgname`,
    ),

    /*
     * The bodies, not just the names. 0020 REPLACES `refuse_decision_rewrite`
     * rather than editing 0008, so an upgrade that kept the old definition
     * would have the same trigger enforcing a different rule.
     */
    functions: await rows(
      client,
      `SELECT proname, pg_get_functiondef(pr.oid) AS definition
       FROM pg_proc pr
       JOIN pg_namespace ns ON ns.oid = pr.pronamespace
       WHERE ns.nspname = 'analysis'
       ORDER BY proname`,
    ),

    tableGrants: await rows(
      client,
      `SELECT grantee, table_name, privilege_type
       FROM information_schema.role_table_grants
       WHERE table_schema = 'analysis' AND grantee LIKE 'finos%'
       ORDER BY grantee, table_name, privilege_type`,
    ),

    columnGrants: await rows(
      client,
      `SELECT grantee, table_name, column_name, privilege_type
       FROM information_schema.column_privileges
       WHERE table_schema = 'analysis' AND grantee LIKE 'finos%'
       ORDER BY grantee, table_name, column_name, privilege_type`,
    ),

    policies: await rows(
      client,
      `SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
       FROM pg_policies
       WHERE schemaname = 'analysis'
       ORDER BY tablename, policyname`,
    ),

    /* Seed data is part of the schema's meaning: version 1 IS the gate. */
    seededPolicies: await rows(
      client,
      `SELECT * FROM analysis.eligibility_policies ORDER BY version`,
    ),

    /*
     * Version, name and checksum — never `applied_at` or `execution_ms`, which
     * differ by construction and would make every comparison fail for a reason
     * that has nothing to do with the schema.
     */
    migrationHistory: await rows(
      client,
      `SELECT version, name, checksum
       FROM analysis.schema_migrations
       ORDER BY version`,
    ),
  }
}

/**
 * The row types describe the tables that exist.
 *
 * A row interface is a promise about a table, and nothing checks it: TypeScript
 * cannot see the database, and a query that projects a column the interface
 * forgot compiles and returns `undefined` at runtime. `DecisionRow` sat in this
 * directory for a whole phase describing three columns migration 0020 had
 * dropped, and the only reason it caused no damage is that nothing imported it.
 *
 * So the check is mechanical: parse the interfaces out of `rows.ts`, read
 * `information_schema.columns`, and require the two to agree exactly — in both
 * directions, because a missing field and an invented one fail differently and
 * both are wrong.
 *
 * Nullability is asserted too. A column that is `NOT NULL` in the database and
 * `| null` in the interface pushes an impossible case into every mapper; the
 * reverse silently promises the domain something the database will hand back as
 * `null`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestDatabase, type TestDatabase } from './testDatabase'

/** Interface name → the table it claims to describe. */
const MAPPED: Readonly<Record<string, string>> = {
  CioSubmissionRow: 'cio_submissions',
  SubmissionRequiredWorkRow: 'submission_required_work',
  SubmissionDisagreementRow: 'submission_disagreements',
  SubmissionEvidenceRow: 'submission_evidence',
  SubmissionOpenChallengeRow: 'submission_open_challenges',
  CioReturnRow: 'cio_returns',
  CioReturnConcernRow: 'cio_return_concerns',
  CaseDecisionRow: 'case_decisions',
  DecisionSubmissionRow: 'decision_submissions',
  DecisionDissentRow: 'decision_dissent',
  DecisionDissentEvidenceRow: 'decision_dissent_evidence',
  DecisionTriggerRow: 'decision_reconsideration_triggers',
}

interface Field {
  name: string
  nullable: boolean
}

/**
 * The declared members of one interface, parsed rather than matched.
 *
 * A regex over `rows.ts` would treat the word `null` inside a doc comment as a
 * nullable field, and would miss a member whose type spans two lines. Both
 * happen in this file.
 */
function fieldsOf(source: ts.SourceFile, interfaceName: string): Field[] | null {
  let found: ts.InterfaceDeclaration | null = null
  source.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      found = node
    }
  })
  if (found === null) return null

  return (found as ts.InterfaceDeclaration).members.flatMap((member) => {
    if (!ts.isPropertySignature(member) || !member.name || !member.type) return []
    const name = ts.isIdentifier(member.name) ? member.name.text : null
    if (name === null) return []
    /*
     * `null` in a TYPE position is a LiteralTypeNode wrapping a null literal —
     * not a bare NullKeyword, which is the expression form. Checking for the
     * expression kind here reports every field as non-nullable and the whole
     * assertion becomes vacuous in one direction.
     */
    const nullable =
      ts.isUnionTypeNode(member.type) &&
      member.type.types.some(
        (part) =>
          ts.isLiteralTypeNode(part) && part.literal.kind === ts.SyntaxKind.NullKeyword,
      )
    return [{ name, nullable }]
  })
}

let db: TestDatabase
let source: ts.SourceFile

beforeAll(async () => {
  const path = join(process.cwd(), 'src/infrastructure/analysis/postgres/rows.ts')
  source = ts.createSourceFile(
    'rows.ts',
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  db = await createTestDatabase()
  await db.migrate()
}, 300_000)

afterAll(async () => {
  await db?.drop()
})

async function columnsOf(table: string): Promise<Field[]> {
  const result = await db.owner.query<{ column_name: string; is_nullable: string }>(
    `SELECT column_name, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'analysis' AND table_name = $1
     ORDER BY column_name`,
    [table],
  )
  return result.rows.map((row) => ({
    name: row.column_name,
    nullable: row.is_nullable === 'YES',
  }))
}

const byName = (fields: readonly Field[]) =>
  [...fields].sort((a, b) => (a.name < b.name ? -1 : 1))

describe('every row type matches its table', () => {
  for (const [interfaceName, table] of Object.entries(MAPPED)) {
    it(`${interfaceName} ↔ analysis.${table}`, async () => {
      const declared = fieldsOf(source, interfaceName)
      expect(declared, `${interfaceName} is not declared in rows.ts`).not.toBeNull()

      const actual = await columnsOf(table)
      expect(actual, `analysis.${table} has no columns`).not.toHaveLength(0)

      // Both directions in one assertion: a missing field and an invented one
      // are both differences, and the diff names which.
      expect(byName(declared!)).toEqual(byName(actual))
    })
  }

  it('checks something — the mapping is not empty and its tables are real', async () => {
    expect(Object.keys(MAPPED).length).toBeGreaterThanOrEqual(12)
    const tables = await db.owner.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'analysis' AND table_name = ANY($1)`,
      [Object.values(MAPPED)],
    )
    expect(tables.rows).toHaveLength(Object.keys(MAPPED).length)
  })
})

describe('the pre-0020 decision shape is gone from the database', () => {
  /*
   * The rule in `src/test/fitness/rules.ts` stops the shape reappearing in
   * source. This is the other half: that the source is not describing something
   * the database still has.
   */
  it('has no decision_revisions table', async () => {
    const found = await db.owner.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'analysis' AND table_name = 'decision_revisions'`,
    )
    expect(found.rows).toEqual([])
  })

  it('has no governance, unresolved_dissent or reconsideration_triggers column', async () => {
    const found = await db.owner.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'analysis'
         AND column_name IN ('governance', 'unresolved_dissent',
                             'reconsideration_triggers')`,
    )
    expect(found.rows).toEqual([])
  })

  it('keys case_decisions on the decision, not the case', async () => {
    const key = await db.owner.query(
      `SELECT a.attname
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace ns ON ns.oid = rel.relnamespace
       JOIN unnest(con.conkey) AS k(attnum) ON true
       JOIN pg_attribute a ON a.attrelid = rel.oid AND a.attnum = k.attnum
       WHERE ns.nspname = 'analysis' AND rel.relname = 'case_decisions'
         AND con.contype = 'p'`,
    )
    expect(key.rows.map((row) => row.attname)).toEqual(['decision_id'])
  })
})

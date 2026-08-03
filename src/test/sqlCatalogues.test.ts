/**
 * Every statement production can issue is in the hash that claims to describe it.
 *
 * `queryCatalogHash` exists so a provenance row can say "this build could issue
 * exactly these statements". That claim is only worth something if the registry
 * is complete — and it was not: `SUPERSESSION_SQL` and `CONSTRAINT_SQL` were
 * exported, frozen, used in production paths and never registered, while
 * `COMMAND_SQL` was registered twice. Nothing noticed, because membership was
 * remembered rather than enforced.
 *
 * This is the enforcement. The registry is compared against what the directory
 * actually exports, parsed rather than matched, so a new catalogue is registered
 * or the suite fails.
 */

import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PRODUCTION_CATALOGUES } from '~/infrastructure/analysis/postgres/postgresRepositories'
import {
  CatalogueRegistrationError,
  catalogHash,
  registerCatalogues,
} from '~/infrastructure/analysis/postgres/sql'

const ADAPTER = join(process.cwd(), 'src/infrastructure/analysis/postgres')

/**
 * Modules whose SQL is not production SQL.
 *
 * A frozen list rather than a heuristic: a file joining it is a visible edit
 * somebody has to justify, where a pattern like "anything with `test` in the
 * name" quietly absorbs whatever gets named that way. Migrations are excluded
 * by living in `db/`, not here.
 */
const TEST_ONLY = new Set([
  'testDatabase.ts',
  'schemaFingerprint.ts',
  'macroFlowHarness.ts',
])

const isTestFile = (file: string) =>
  file.endsWith('.test.ts') || file.endsWith('.pg.test.ts') || TEST_ONLY.has(file)

/** Every `export const X_SQL = catalog({…})` the adapter declares. */
function declaredCatalogues(): Array<{ file: string; binding: string }> {
  const found: Array<{ file: string; binding: string }> = []

  for (const file of readdirSync(ADAPTER)) {
    if (!file.endsWith('.ts') || isTestFile(file)) continue
    const source = ts.createSourceFile(
      file,
      readFileSync(join(ADAPTER, file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
    source.forEachChild((node) => {
      if (!ts.isVariableStatement(node)) return
      const exported = node.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
      if (!exported) return
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue
        const initialiser = declaration.initializer
        const isCatalogue =
          initialiser !== undefined &&
          ts.isCallExpression(initialiser) &&
          ts.isIdentifier(initialiser.expression) &&
          initialiser.expression.text === 'catalog'
        if (isCatalogue) found.push({ file, binding: declaration.name.text })
      }
    })
  }

  return found
}

describe('the production registry is complete', () => {
  it('registers every catalogue the adapter declares', () => {
    /*
     * Compared statically, by parsing the registry rather than importing every
     * adapter module. Importing twenty modules — several of which pull in `pg`
     * — inside one test is slow enough to time out under load, and a test that
     * is flaky under load is a test people learn to rerun rather than read.
     *
     * Binding names rather than object identity here; identity is covered by
     * `registerCatalogues`, which refuses the same object under two names, and
     * by the duplicate checks below.
     */
    const declared = declaredCatalogues()
    expect(declared.length, 'no catalogues found — the parse is wrong').toBeGreaterThan(20)

    const registry = readFileSync(join(ADAPTER, 'postgresRepositories.ts'), 'utf8')
    const registered = new Set(
      [...registry.matchAll(/statements:\s*([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]!),
    )

    const missing = declared
      .filter(({ binding }) => !registered.has(binding))
      .map(({ file, binding }) => `${file}:${binding}`)

    expect(missing).toEqual([])
  })

  it('registers each catalogue exactly once', () => {
    const names = PRODUCTION_CATALOGUES.map((entry) => entry.name)
    expect(new Set(names).size).toBe(names.length)

    const objects = PRODUCTION_CATALOGUES.map((entry) => entry.statements)
    expect(new Set(objects).size).toBe(objects.length)
  })

  it('holds only frozen catalogues', () => {
    for (const entry of PRODUCTION_CATALOGUES) {
      expect(Object.isFrozen(entry.statements), entry.name).toBe(true)
    }
  })

  it('is itself frozen', () => {
    expect(Object.isFrozen(PRODUCTION_CATALOGUES)).toBe(true)
  })

  it('contains no test-only SQL', () => {
    // `TRUNCATE` is the shape only the test harness needs; a production
    // catalogue containing one would mean the runtime can empty the firm.
    for (const entry of PRODUCTION_CATALOGUES) {
      for (const [name, sql] of Object.entries(entry.statements)) {
        expect(sql, `${entry.name}.${name}`).not.toMatch(/\bTRUNCATE\b/i)
        expect(sql, `${entry.name}.${name}`).not.toMatch(/\bDROP\s+(TABLE|DATABASE)\b/i)
      }
    }
  })
})

describe('registration refuses a malformed registry', () => {
  const frozen = (statements: Record<string, string>) => Object.freeze(statements)

  it('refuses a duplicate name', () => {
    expect(() =>
      registerCatalogues([
        { name: 'a', statements: frozen({ q: 'SELECT 1' }) },
        { name: 'a', statements: frozen({ q: 'SELECT 2' }) },
      ]),
    ).toThrow(CatalogueRegistrationError)
  })

  it('refuses the same catalogue registered twice', () => {
    /*
     * The defect that actually happened. Deduplicating it in the hash would
     * have hidden a registry that says something untrue about the build.
     */
    const shared = frozen({ q: 'SELECT 1' })
    expect(() =>
      registerCatalogues([
        { name: 'a', statements: shared },
        { name: 'b', statements: shared },
      ]),
    ).toThrow(CatalogueRegistrationError)
  })

  it('refuses an unfrozen catalogue', () => {
    expect(() =>
      registerCatalogues([{ name: 'a', statements: { q: 'SELECT 1' } }]),
    ).toThrow(CatalogueRegistrationError)
  })
})

describe('the catalogue hash means what provenance claims it means', () => {
  const entry = (name: string, statements: Record<string, string>) => ({
    name,
    statements: Object.freeze(statements),
  })

  it('changes when a statement is added', () => {
    expect(catalogHash([entry('a', { q: 'SELECT 1' })])).not.toBe(
      catalogHash([entry('a', { q: 'SELECT 1', r: 'SELECT 2' })]),
    )
  })

  it('changes when a statement is removed', () => {
    expect(catalogHash([entry('a', { q: 'SELECT 1', r: 'SELECT 2' })])).not.toBe(
      catalogHash([entry('a', { q: 'SELECT 1' })]),
    )
  })

  it('changes when SQL text changes', () => {
    expect(catalogHash([entry('a', { q: 'SELECT 1' })])).not.toBe(
      catalogHash([entry('a', { q: 'SELECT 2' })]),
    )
  })

  it('does not change when registration order changes', () => {
    const one = entry('a', { q: 'SELECT 1' })
    const two = entry('b', { r: 'SELECT 2' })
    expect(catalogHash([one, two])).toBe(catalogHash([two, one]))
  })

  it('distinguishes the same statement name in two catalogues', () => {
    // `byId` appears in most catalogues. Without the catalogue name in the
    // hashed identity, a second one with the same text would vanish into the
    // first and adding it would not move the hash.
    expect(catalogHash([entry('a', { byId: 'SELECT 1' })])).not.toBe(
      catalogHash([entry('b', { byId: 'SELECT 1' })]),
    )
  })

  it('does not normalise away a material difference', () => {
    expect(catalogHash([entry('a', { q: 'SELECT 1 WHERE x = $1' })])).not.toBe(
      catalogHash([entry('a', { q: 'SELECT 1 WHERE x <> $1' })]),
    )
  })

  it('covers every registered catalogue', () => {
    /*
     * The property that failed before this stage: a catalogue could exist,
     * be used, and contribute nothing to the identity.
     */
    const whole = catalogHash(PRODUCTION_CATALOGUES)
    for (const dropped of PRODUCTION_CATALOGUES) {
      const without = PRODUCTION_CATALOGUES.filter((candidate) => candidate !== dropped)
      expect(catalogHash(without), `${dropped.name} contributes nothing`).not.toBe(whole)
    }
  })
})

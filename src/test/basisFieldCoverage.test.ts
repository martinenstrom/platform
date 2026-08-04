/**
 * Every field of the eligibility basis is either bound by the witness or
 * excluded on the record.
 *
 * The normative specification lists the canonical input field by field. That
 * list is prose, and prose does not notice a field added to `EligibilityBasis`
 * six months from now. An unbound field is the specific failure this whole
 * mechanism exists to prevent: something an editor can change while the digest
 * still verifies.
 *
 * So the type is read out of the source and matched against
 * `BASIS_FIELD_DISPOSITION`. Adding a member without deciding its disposition
 * fails here — which forces the decision to be made deliberately and in
 * writing, rather than by omission.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { BASIS_FIELD_DISPOSITION } from '~/domain/analysis/basisCanonical'

const SOURCE = resolve(process.cwd(), 'src/domain/analysis/decisions.ts')

/** The declared members of an interface, in declaration order. */
function membersOf(interfaceName: string): string[] {
  const text = readFileSync(SOURCE, 'utf8')
  const ast = ts.createSourceFile(SOURCE, text, ts.ScriptTarget.Latest, true)

  let found: string[] | null = null
  ast.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      found = node.members
        .filter(ts.isPropertySignature)
        .map((member) => (ts.isIdentifier(member.name) ? member.name.text : null))
        .filter((name): name is string => name !== null)
    }
  })

  if (found === null) throw new Error(`No interface named ${interfaceName}`)
  return found
}

describe('the canonical input covers the eligibility basis', () => {
  const declared = membersOf('EligibilityBasis')
  const included: readonly string[] = BASIS_FIELD_DISPOSITION.included
  const excluded = Object.keys(BASIS_FIELD_DISPOSITION.excluded)

  it('reads a plausible set of members from the type', () => {
    /*
     * The guard against a vacuous test. If the parse silently returned nothing
     * — a renamed interface, a changed declaration form — every assertion below
     * would pass over an empty set and prove nothing.
     */
    expect(declared.length).toBeGreaterThan(10)
    expect(declared).toContain('requiredWork')
    expect(declared).toContain('manifest')
  })

  it('accounts for every declared field exactly once', () => {
    const accounted = [...included, ...excluded]
    expect([...accounted].sort()).toEqual([...declared].sort())
  })

  it('never both includes and excludes a field', () => {
    expect(included.filter((name) => excluded.includes(name))).toEqual([])
  })

  it('gives every exclusion a stated reason', () => {
    for (const [field, reason] of Object.entries(BASIS_FIELD_DISPOSITION.excluded)) {
      expect(reason.length, `${field} is excluded without a reason`).toBeGreaterThan(40)
    }
  })
})

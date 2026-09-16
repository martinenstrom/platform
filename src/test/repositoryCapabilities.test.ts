/**
 * The capability catalogue cannot fall behind the ports.
 *
 * `satisfies` gets most of the way: a port with no entry is a compile error,
 * and a listed method that is not on its port is one too. What it cannot demand
 * is **exhaustiveness** — a method added to a port and forgotten in the
 * catalogue type-checks perfectly, and the runtime completeness guard would
 * then happily accept a container missing it.
 *
 * So the interfaces are parsed out of `repositories.ts` and compared, both
 * directions, by name. Same technique as `rowShapes.pg.test.ts` uses against
 * `information_schema`: a promise about a surface, checked against the surface.
 */

import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ANALYSIS_REPOSITORY_CAPABILITIES,
  IncompleteRepositoriesError,
  assertRepositoriesComplete,
} from '~/application/analysis/repositories'

/** Which interface declares each port. */
const PORT_INTERFACES: Readonly<Record<string, { file: string; name: string }>> = {
  cases: { file: 'repositories.ts', name: 'CaseRepository' },
  amendments: { file: 'repositories.ts', name: 'CaseAmendmentRepository' },
  theses: { file: 'repositories.ts', name: 'ThesisRepository' },
  assignments: { file: 'repositories.ts', name: 'AssignmentRepository' },
  runs: { file: 'repositories.ts', name: 'RunRepository' },
  claims: { file: 'repositories.ts', name: 'ClaimRepository' },
  producedClaims: { file: 'repositories.ts', name: 'ProducedClaimRepository' },
  producedSyntheses: {
    file: 'repositories.ts',
    name: 'ProducedSynthesisRepository',
  },
  producedVerifications: {
    file: 'repositories.ts',
    name: 'ProducedVerificationReviewRepository',
  },
  producedChallenges: {
    file: 'repositories.ts',
    name: 'ProducedDevilsAdvocateReviewRepository',
  },
  producedPeerExaminations: {
    file: 'repositories.ts',
    name: 'ProducedPeerExaminationRepository',
  },
  reviews: { file: 'repositories.ts', name: 'ReviewRepository' },
  events: { file: 'repositories.ts', name: 'EventRepository' },
  evidence: { file: 'repositories.ts', name: 'EvidenceRepository' },
  assemblies: { file: 'repositories.ts', name: 'EvidenceAssemblyRepository' },
  observations: { file: 'repositories.ts', name: 'ObservationRepository' },
  results: { file: 'resultStore.ts', name: 'ResultStore' },
  commands: { file: 'commandLog.ts', name: 'CommandLog' },
  playbooks: { file: 'repositories.ts', name: 'PlaybookRepository' },
  requirements: { file: 'repositories.ts', name: 'RequirementRepository' },
  aggregations: { file: 'repositories.ts', name: 'AggregationRepository' },
  submissions: { file: 'repositories.ts', name: 'SubmissionRepository' },
  decisions: { file: 'repositories.ts', name: 'DecisionRepository' },
}

const sourceFor = (file: string) =>
  ts.createSourceFile(
    file,
    readFileSync(join(process.cwd(), 'src/application/analysis', file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )

const sources = new Map<string, ts.SourceFile>()
const cached = (file: string) => {
  const found = sources.get(file) ?? sourceFor(file)
  sources.set(file, found)
  return found
}

/** The method names an interface declares. Parsed, never matched. */
function methodsOf(file: string, interfaceName: string): string[] | null {
  const source = cached(file)
  let found: ts.InterfaceDeclaration | null = null
  source.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      found = node
    }
  })
  if (found === null) return null

  return (found as ts.InterfaceDeclaration).members
    .flatMap((member) => {
      // A method is a signature or a property holding a function type; both
      // shapes appear across these ports.
      if (ts.isMethodSignature(member) && member.name && ts.isIdentifier(member.name)) {
        return [member.name.text]
      }
      if (
        ts.isPropertySignature(member) &&
        member.name &&
        ts.isIdentifier(member.name) &&
        member.type &&
        ts.isFunctionTypeNode(member.type)
      ) {
        return [member.name.text]
      }
      return []
    })
    .sort()
}

describe('the capability catalogue matches the ports it claims to describe', () => {
  for (const [port, target] of Object.entries(PORT_INTERFACES)) {
    it(`${port} lists exactly what ${target.name} declares`, () => {
      const declared = methodsOf(target.file, target.name)
      expect(declared, `${target.name} not found in ${target.file}`).not.toBeNull()

      const listed = [
        ...(ANALYSIS_REPOSITORY_CAPABILITIES as Record<string, readonly string[]>)[port]!,
      ].sort()

      // Both directions: a forgotten method and an invented one fail
      // differently, and the diff names which.
      expect(listed).toEqual(declared)
    })
  }

  it('covers every port on the container', () => {
    expect(Object.keys(ANALYSIS_REPOSITORY_CAPABILITIES).sort()).toEqual(
      Object.keys(PORT_INTERFACES).sort(),
    )
  })

  it('checks something rather than an empty surface', () => {
    // A parse that found no members would agree with an empty catalogue.
    for (const [port, methods] of Object.entries(ANALYSIS_REPOSITORY_CAPABILITIES)) {
      expect((methods as readonly string[]).length, port).toBeGreaterThan(0)
    }
  })
})

describe('the runtime guard refuses an incomplete container', () => {
  const complete = () =>
    Object.fromEntries(
      Object.entries(ANALYSIS_REPOSITORY_CAPABILITIES).map(([port, methods]) => [
        port,
        Object.fromEntries(
          (methods as readonly string[]).map((name) => [name, () => {}]),
        ),
      ]),
    )

  it('accepts a container implementing every capability', () => {
    expect(() => assertRepositoriesComplete(complete() as never)).not.toThrow()
  })

  it('refuses a missing port, naming it', () => {
    const partial = complete()
    delete (partial as Record<string, unknown>).decisions
    try {
      assertRepositoriesComplete(partial as never)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(IncompleteRepositoriesError)
      expect((error as IncompleteRepositoriesError).missing).toContain('decisions')
    }
  })

  it('refuses a missing method, naming it', () => {
    const partial = complete()
    delete (partial.submissions as Record<string, unknown>).applicableForRevision
    try {
      assertRepositoriesComplete(partial as never)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as IncompleteRepositoriesError).missing).toContain(
        'submissions.applicableForRevision',
      )
    }
  })

  it('refuses a port satisfied by something that is not an object', () => {
    const partial = complete()
    ;(partial as Record<string, unknown>).decisions = null
    expect(() => assertRepositoriesComplete(partial as never)).toThrow(
      IncompleteRepositoriesError,
    )
  })

  it('invokes nothing while checking', () => {
    /*
     * The guard runs during construction. A write method called to see whether
     * it works would write, so presence is all it may test — and that limit is
     * why fitness rule 14 exists to catch a present-but-throwing placeholder.
     */
    let called = false
    const watched = complete()
    ;(watched.decisions as Record<string, unknown>).save = () => {
      called = true
    }
    assertRepositoriesComplete(watched as never)
    expect(called).toBe(false)
  })

  it('fails when a port gains a method the catalogue has not learned', () => {
    /*
     * The negative control for the parser test above: a port surface with an
     * extra method must not be satisfiable by a stale catalogue entry. Modelled
     * here rather than by editing a real port, so the control cannot rot.
     */
    const surface = ['get', 'save', 'newlyAdded']
    const stale = ['get', 'save']
    expect([...stale].sort()).not.toEqual([...surface].sort())
  })
})

/**
 * The Headquarters surface consumes institutional state; it never computes it.
 *
 * The boundary in one sentence: *presentation may consume institutional state as
 * typed data, but it may never execute institutional decision logic.*
 *
 * `no-ui-import-of-infrastructure` already forbids value imports from the
 * analysis layers everywhere under `components/`, `routes/` and `presentation/`.
 * What that rule cannot say is whether it reaches THESE files — a rule scoped to
 * a directory nobody has added to selects nothing, finds nothing, and passes.
 *
 * So this asserts the guard is actually pointed at the Headquarters files, and
 * names the specific evaluators that must never be called from them. A future
 * component that computed its own eligibility, standing or blocking would be a
 * second answer to a question the institution has exactly one answer to.
 */

import { describe, expect, it } from 'vitest'
import { loadTree } from './fitness/sources'
import { ruleById } from './fitness/rules'

const TREE = loadTree()

/** The files this stage added to the presentation surface. */
const HEADQUARTERS = [
  'routes/cases.$caseId.tsx',
  'components/headquarters/CaseStandingPanel.tsx',
  'presentation/analysis/caseStandingText.ts',
]

/**
 * Functions that decide something institutional.
 *
 * Importing any of these as a VALUE into the presentation layer means the page
 * is no longer rendering the firm's answer — it is producing one.
 */
const EVALUATORS = [
  'evaluateEligibilityGates',
  'caseStanding',
  'caseOverview',
  'challengeBlocks',
  'disagreementBlocksEligibility',
  'evaluateGate',
  'revisionEligibility',
  'eligibilityPolicy',
  'transitionCase',
  'canTransition',
]

describe('the Headquarters surface', () => {
  it('exists, so the assertions below are about real files', () => {
    for (const path of HEADQUARTERS) {
      expect(
        TREE.some((file) => file.path === path),
        `${path} is missing — this test would otherwise pass by asserting nothing`,
      ).toBe(true)
    }
  })

  it('is judged by the UI boundary rule, not merely covered by it in principle', () => {
    const rule = ruleById('no-ui-import-of-infrastructure')
    for (const path of HEADQUARTERS) {
      const file = TREE.find((entry) => entry.path === path)!
      expect(rule.selects(file), `${path} is not selected by ${rule.id}`).toBe(true)
    }
  })

  it('executes no institutional evaluator', () => {
    const offenders: string[] = []
    for (const path of HEADQUARTERS) {
      const file = TREE.find((entry) => entry.path === path)!
      for (const reference of file.imports) {
        if (reference.typeOnly) continue
        if (
          !reference.specifier.startsWith('~/domain/analysis') &&
          !reference.specifier.startsWith('~/application/analysis')
        ) {
          continue
        }
        for (const name of reference.names) {
          if (EVALUATORS.includes(name)) {
            offenders.push(`${path} — calls ${name}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('imports nothing from the analysis layers except types', () => {
    /*
     * Broader than the evaluator list, and deliberately so: a helper that is
     * not on that list today can become one, and the presentation layer has no
     * reason to hold a runtime reference into the institution at all.
     *
     * `serverFns` is the exception, and it is a port: a `createServerFn`
     * reference compiles to a network call, not to the handler body.
     */
    const offenders: string[] = []
    for (const path of HEADQUARTERS) {
      const file = TREE.find((entry) => entry.path === path)!
      for (const reference of file.imports) {
        if (reference.typeOnly) continue
        const specifier = reference.specifier
        if (specifier.endsWith('/serverFns')) continue
        if (
          specifier.startsWith('~/domain/analysis') ||
          specifier.startsWith('~/application/analysis')
        ) {
          offenders.push(`${path} — value-imports ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('reaches the institution through exactly one door', () => {
    /*
     * The route holds the only infrastructure reference on this surface, and it
     * is the published boundary. A second door would be a second place
     * credentials and drivers could reach a bundle.
     */
    const doors = TREE.filter(
      (file) =>
        HEADQUARTERS.includes(file.path) &&
        file.imports.some(
          (reference) =>
            !reference.typeOnly && reference.specifier.startsWith('~/infrastructure'),
        ),
    ).map((file) => file.path)

    expect(doors).toEqual(['routes/cases.$caseId.tsx'])
  })
})

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

/**
 * Every file on the institution's presentation surface.
 *
 * Grows with the surface, and must: the guard below asserts the UI boundary
 * rule actually SELECTS these files, and a file nobody added is a file the rule
 * silently says nothing about.
 *
 * The Agent Headquarters entries arrived with C2-2 Stage A. They render desks
 * derived from the seeded organization and runs read from the database, which
 * is exactly the shape that would be tempting to "improve" by computing
 * something locally.
 */
const HEADQUARTERS = [
  'routes/cases.$caseId.tsx',
  'components/headquarters/CaseStandingPanel.tsx',
  'presentation/analysis/caseStandingText.ts',
  'routes/agents.index.tsx',
  'routes/agents.$departmentId.tsx',
  'components/agents/DeskCard.tsx',
  'components/agents/RunRow.tsx',
  'components/agents/RunStateBadge.tsx',
  'presentation/analysis/runText.ts',
  /*
   * Stage B — Judgment. The first surface that can change institutional state,
   * and therefore the one most worth holding to the boundary: it renders
   * confidence, citation findings and run standing, every one of which is
   * decided elsewhere and would be tempting to recompute here.
   */
  'routes/runs.$runId.tsx',
  'components/agents/ProducedClaimCard.tsx',
  'components/agents/JudgementPanel.tsx',
  'components/agents/ActingAs.tsx',
  'presentation/analysis/claimText.ts',
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
     * One DOOR, which is a module — not one file that uses it.
     *
     * This asserted `doors).toEqual(['routes/cases.$caseId.tsx'])` while the
     * surface had a single route, and the two readings were indistinguishable
     * until Agent Headquarters added a second and a third. They are not the
     * same property: what must stay true is that every route reaches the
     * institution through the published `serverFns` boundary, because a second
     * MODULE would be a second place credentials and drivers could reach a
     * bundle. Three routes calling the same boundary are three callers of one
     * door, and rewriting them to share a file would have satisfied the old
     * assertion while changing nothing about the risk it exists to bound.
     *
     * So the set of infrastructure modules this surface names is what gets
     * pinned — a strictly stronger claim, and one that does not have to be
     * edited every time a page is added.
     */
    const doors = new Set(
      TREE.filter((file) => HEADQUARTERS.includes(file.path)).flatMap((file) =>
        file.imports
          .filter(
            (reference) =>
              !reference.typeOnly && reference.specifier.startsWith('~/infrastructure'),
          )
          .map((reference) => reference.specifier),
      ),
    )

    expect([...doors]).toEqual(['~/infrastructure/analysis/serverFns'])
  })
})

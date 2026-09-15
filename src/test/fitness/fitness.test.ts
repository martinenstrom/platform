/**
 * The load-bearing rules, enforced against the tree as it actually is.
 *
 * The rules themselves live in `rules.ts` as objects, and `ruleIntegrity.test.ts`
 * proves each one fires on a file that breaks it. This file is the other half:
 * it points them at `src/` and requires the answer to be nothing. One
 * implementation, two questions — which is why the duplicates that used to sit
 * in `importGraph.test.ts` were removed rather than left beside these.
 */

import { describe, expect, it } from 'vitest'
import { LOAD_BEARING_RULES } from './rules'
import { loadMigrations, loadTree } from './sources'

/*
 * Migrations live in `db/`, outside `src/`, and one rule judges them. Read as
 * synthetic sources so a rule sees the same shape whatever it selects.
 */
const TREE = [...loadTree(), ...loadMigrations()]

describe('architectural fitness', () => {
  for (const rule of LOAD_BEARING_RULES) {
    it(rule.states, () => {
      const violations = TREE.filter((file) => rule.selects(file)).flatMap((file) =>
        rule.detect(file),
      )
      expect(violations, rule.because).toEqual([])
    })
  }
})

describe('the exceptions the rules grant', () => {
  it('grants the presentation layer a boundary that really is one', () => {
    /*
     * `no-ui-import-of-infrastructure` lets the UI import a serverFns module,
     * on the grounds that a `createServerFn` reference compiles to a network
     * call rather than to the handler body — so the import is a port, not an
     * implementation. That is only true while the module is actually built from
     * server functions, which nothing else checks.
     */
    const boundaries = TREE.filter(
      (file) => file.path.endsWith('/serverFns.ts') && !file.isTest,
    )
    expect(boundaries.length).toBeGreaterThan(0)
    for (const boundary of boundaries) {
      expect(boundary.code, `${boundary.path} is not a server-function module`).toContain(
        'createServerFn',
      )
    }
  })

  it('keeps the two network boundaries the only modules that need the exception', () => {
    // The allowance is two named paths. If either is split or renamed, the
    // rule's own selector stops excluding it and this fails first.
    for (const path of [
      'infrastructure/marketData/providers/httpClient.ts',
      'infrastructure/jarvis/openaiLive.ts',
    ]) {
      expect(
        TREE.find((file) => file.path === path),
        `an approved network boundary has moved: ${path}`,
      ).toBeDefined()
    }
    /*
     * The live-voice provider earns its exception by honouring the same
     * network-disabled guard the http client does, and by bounding its one
     * HTTP call with a timeout. Checked on the source, so the allowance
     * cannot outlive the reason for it.
     */
    const live = TREE.find((file) => file.path === 'infrastructure/jarvis/openaiLive.ts')!
    expect(live.code).toContain('networkDisabled')
    expect(live.code).toContain('AbortSignal.timeout')
  })
})

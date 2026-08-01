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
import { loadTree } from './sources'

const TREE = loadTree()

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

  it('keeps the http client the only module that needs the exception', () => {
    // The allowance is a single path. If the client is ever split or renamed,
    // the rule's own selector stops excluding anything and this fails first.
    const client = TREE.find(
      (file) => file.path === 'infrastructure/marketData/providers/httpClient.ts',
    )
    expect(client, 'the approved http client has moved').toBeDefined()
  })
})

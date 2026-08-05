/**
 * The contract version cannot advance, or fail to advance, by accident.
 *
 * `DOMAIN_CONTRACT_VERSION` sat at `'6'` for two phases while the plans for 7
 * and 8 described it as advanced, and every provenance row written in that time
 * recorded a version that was untrue. Nothing failed, because the only
 * assertion in the suite was that the in-memory and PostgreSQL adapters
 * reported the *same* version — which they did, both reading the same wrong
 * constant.
 *
 * **Agreement between two readers of one value is not correctness.** Parity
 * proves the adapters are consistent with each other; it cannot prove the value
 * they agree on was intended.
 *
 * No test can decide whether a change to the domain was material enough to
 * warrant a bump — that is a judgement, and a rule inferring it from a source
 * diff would be wrong in both directions: silent on a changed rule, noisy on a
 * renamed field. What a test can do is insist the judgement was **written
 * down**. The literal below is the pin: advancing the contract requires editing
 * this file, which is a decision rather than a side effect.
 */

import { describe, expect, it } from 'vitest'
import { DOMAIN_CONTRACT_HISTORY, DOMAIN_CONTRACT_VERSION } from './index'

/**
 * The version this build is expected to record, stated independently of the
 * constant it checks.
 *
 * Update this **only** together with `DOMAIN_CONTRACT_VERSION` and a new
 * `DOMAIN_CONTRACT_HISTORY` entry, and only when a contract change alters what
 * a stored record means.
 */
const EXPECTED_CONTRACT_VERSION = '10'

describe('the domain contract version is pinned', () => {
  it('is the version this build is declared to record', () => {
    expect(DOMAIN_CONTRACT_VERSION).toBe(EXPECTED_CONTRACT_VERSION)
  })

  it('is the newest entry in the declared history', () => {
    const newest = DOMAIN_CONTRACT_HISTORY[DOMAIN_CONTRACT_HISTORY.length - 1]
    expect(newest?.version).toBe(DOMAIN_CONTRACT_VERSION)
  })
})

describe('the declared history is complete', () => {
  it('runs from 1 to the current version with no gaps or repeats', () => {
    /*
     * The gap is what would have exposed the drift: had 7 and 8 been required
     * to exist as entries, advancing to 9 without them would have failed here
     * rather than passing silently.
     */
    expect(DOMAIN_CONTRACT_HISTORY.map((entry) => entry.version)).toEqual(
      Array.from({ length: Number(DOMAIN_CONTRACT_VERSION) }, (_, index) =>
        String(index + 1),
      ),
    )
  })

  it('says what each version changed about stored meaning', () => {
    // An entry that says nothing is an entry nobody can use to interpret a row
    // written under it, which is the entire purpose of recording the version.
    for (const entry of DOMAIN_CONTRACT_HISTORY) {
      expect(
        entry.states.length,
        `version ${entry.version} states nothing`,
      ).toBeGreaterThan(20)
    }
  })

  it('does not claim the versions that were skipped were ever recorded', () => {
    /*
     * 7 and 8 exist as history entries because the contracts did change. They
     * were never *recorded* in provenance, and the history must not be read as
     * evidence that they were. The honest statement lives in the declaration's
     * own documentation; this asserts the two entries are present so that the
     * gap is visible rather than tidied away.
     */
    const versions = DOMAIN_CONTRACT_HISTORY.map((entry) => entry.version)
    expect(versions).toContain('7')
    expect(versions).toContain('8')
  })
})

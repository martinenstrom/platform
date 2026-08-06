/**
 * Identity is a function of the value, not of the machine.
 *
 * Every identity here is derived from canonical bytes, and those bytes must not
 * depend on the host's locale or timezone. TD61-2 tested that by passing a
 * locale *to* the comparator — which proves the comparator ignores a locale it
 * was handed, and says nothing about the process default. Those are different
 * claims and only the second is worth anything, so this spawns real processes
 * under real `LANG`, `LC_ALL` and `TZ`.
 *
 * Runs in the unit suite, not the PostgreSQL one. An earlier version spawned the
 * probe under the pg config, which started a second cluster per child and
 * disturbed the harness ownership marker the pg suite asserts on. Nothing here
 * needs a database.
 *
 * ## The negative controls are the load-bearing part
 *
 * A determinism test that passes because the environment never actually changed
 * proves nothing, and is indistinguishable from one that passes because the code
 * is right. So the probe computes two deliberately environment-sensitive values
 * — one per dimension — and at least one must **differ** across environments.
 *
 * ## What this host can and cannot vary, measured
 *
 * ** is honoured.** Child processes resolve different time zones, and the
 * timezone-sensitive control changes with them.
 *
 * ** and  are not.** On Windows, Node resolves the default ICU
 * locale from the operating system and ignores both variables: the collator
 * reports the system locale whatever the environment says. So the
 * **process-default locale dimension is not exercisable on this host**, and this
 * suite does not claim otherwise. TD-63 carries it.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

interface ProbeOutput {
  [key: string]: unknown
  localeSensitiveControl: string
  timezoneSensitiveControl: string
  environment: {
    LANG: string | null
    LC_ALL: string | null
    TZ: string | null
    resolvedLocale: string
    resolvedTimeZone: string
  }
}

/**
 * Locales measured to disagree with each other, and timezones on both sides of
 * UTC.
 *
 * `tr` and `da` invert case ordering relative to `en` and `sv`.
 * `Pacific/Kiritimati` is UTC+14 and `Pacific/Niue` is UTC-11 — fourteen hours
 * and eleven hours from UTC in opposite directions, so anything deriving a date
 * from the host clock would land on different days.
 *
 * The last entry repeats the first, which is how repeated-execution stability is
 * checked without a separate mechanism.
 */
const ENVIRONMENTS = [
  { label: 'en-US · UTC', LANG: 'en_US.UTF-8', TZ: 'UTC' },
  { label: 'sv-SE · Europe/Stockholm', LANG: 'sv_SE.UTF-8', TZ: 'Europe/Stockholm' },
  { label: 'da-DK · Pacific/Kiritimati', LANG: 'da_DK.UTF-8', TZ: 'Pacific/Kiritimati' },
  { label: 'tr-TR · Pacific/Niue', LANG: 'tr_TR.UTF-8', TZ: 'Pacific/Niue' },
  { label: 'en-US · UTC, repeated', LANG: 'en_US.UTF-8', TZ: 'UTC' },
] as const

const workspace = mkdtempSync(join(tmpdir(), 'fos-determinism-'))
afterAll(() => rmSync(workspace, { recursive: true, force: true }))

function probe(index: number): ProbeOutput {
  const environment = ENVIRONMENTS[index]!
  const out = join(workspace, `probe-${index}.json`)

  execFileSync(
    process.execPath,
    [
      './node_modules/vitest/vitest.mjs',
      'run',
      'src/test/determinismProbe.test.ts',
    ],
    {
      env: {
        ...process.env,
        LANG: environment.LANG,
        LC_ALL: environment.LANG,
        TZ: environment.TZ,
        DETERMINISM_OUT: out,
      },
      encoding: 'utf8',
      stdio: 'pipe',
    },
  )

  return JSON.parse(readFileSync(out, 'utf8')) as ProbeOutput
}

const results = ENVIRONMENTS.map((environment, index) => ({
  label: environment.label,
  output: probe(index),
}))

const IDENTITY_FIELDS = [
  'observationYield',
  'observationQuote',
  'observationPolicy',
  'observationId',
  'evidenceSetId',
  'requirementInput',
  'commandPayload',
  'semanticKeyBytes',
  'localeSensitiveBytes',
  'timestampBytes',
  'canonicalBytes',
]

describe('identity does not depend on the host environment', () => {
  it('actually varied the environment between child processes', () => {
    /*
     * Checked first. If the platform ignored TZ, every assertion below would be
     * comparing a value against itself and would pass for the wrong reason.
     */
    const zones = new Set(results.map((r) => r.output.environment.resolvedTimeZone))
    expect(
      zones.size,
      `the timezone never changed: ${[...zones].join(', ')}`,
    ).toBeGreaterThan(1)
  })

  it('exercises at least one dimension, proven by a negative control', () => {
    /*
     * The assertion that gives the rest meaning. A determinism suite whose
     * environment never actually changed passes for the wrong reason and looks
     * exactly like one that passes for the right reason.
     *
     * One control per dimension, because the two are honoured differently and
     * lumping them together would hide which one is inert.
     */
    const localeVaried =
      new Set(results.map((r) => r.output.localeSensitiveControl)).size > 1
    const timezoneVaried =
      new Set(results.map((r) => r.output.timezoneSensitiveControl)).size > 1

    expect(
      localeVaried || timezoneVaried,
      'neither the locale nor the timezone changed anything between child ' +
        'processes, so this suite proves nothing',
    ).toBe(true)

    // Timezone must vary: TZ is honoured on every platform Node supports, and a
    // failure here is a harness defect rather than a platform limitation.
    expect(timezoneVaried, 'TZ did not change behaviour between processes').toBe(true)
  })

  it('reports which dimensions the host actually varies', () => {
    /*
     * Measured and stated rather than assumed. On Windows, Node resolves the
     * default ICU locale from the OS and ignores LANG and LC_ALL entirely: the
     * collator reports the system locale whatever the environment says. So the
     * process-default LOCALE dimension is not exercisable here, while TZ is.
     *
     * That is exactly the gap TD-63 exists for, and stating it is the honest
     * alternative to a green result that overclaims. This assertion documents
     * the observation; it does not require the platform to behave either way.
     */
    const locales = new Set(results.map((r) => r.output.environment.resolvedLocale))
    const zones = new Set(results.map((r) => r.output.environment.resolvedTimeZone))

    expect(zones.size, 'TZ is expected to be honoured').toBeGreaterThan(1)

    if (locales.size === 1) {
      // Not a failure. A recorded platform limitation, carried by TD-63.
      expect([...locales][0]).toBeTruthy()
    } else {
      expect(
        new Set(results.map((r) => r.output.localeSensitiveControl)).size,
      ).toBeGreaterThan(1)
    }
  })

  for (const field of IDENTITY_FIELDS) {
    it(`gives one ${field} across every environment`, () => {
      const values = new Set(results.map((r) => String(r.output[field])))
      expect(
        values.size,
        `${field} differed — ${results
          .map((r) => `${r.label}: ${String(r.output[field]).slice(0, 20)}`)
          .join(' | ')}`,
      ).toBe(1)
    })
  }

  it('is stable across repeated executions of one environment', () => {
    const first = results[0]!.output
    const repeated = results[results.length - 1]!.output
    for (const field of IDENTITY_FIELDS) {
      expect(repeated[field], field).toEqual(first[field])
    }
  })
})

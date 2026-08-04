/**
 * The tests that test the tests.
 *
 * A fitness rule has two failure modes and the suite only ever exercised one.
 * "Does the tree comply?" is asked on every run. "Would this rule notice if it
 * did not?" was never asked at all — so eleven rules carrying a literal
 * backspace byte where `\b` was meant reported success for months, matching
 * nothing, guarding nothing, and reading correctly the whole time.
 *
 * Everything below asks the second question. Each rule must fail on a file that
 * breaks it, must not fail on a file that merely resembles one, and must apply
 * to at least one file that actually exists. A rule added to the registry
 * without those fixtures fails here rather than joining the suite unexercised,
 * which is the property that has to survive every phase after this one.
 */

import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { LOAD_BEARING_RULES, ruleById } from './rules'
import { PLANTED } from './planted'
import { analyseFixture, loadMigrations, loadTree } from './sources'

const TREE = [...loadTree(), ...loadMigrations()]

describe('fitness rules detect a planted violation', () => {
  it('covers every load-bearing rule the reviewer named', () => {
    /*
     * Named in the C1C-3 approval. Pinned rather than counted: a rule
     * disappearing from the registry would otherwise take its meta-test with
     * it and leave nothing behind to notice.
     */
    expect([...LOAD_BEARING_RULES.map((rule) => rule.id)].sort()).toEqual([
      'eligibility-decided-only-in-the-domain',
      'no-caller-supplied-or-invented-identity',
      'no-eligibility-in-sql',
      'no-in-memory-adapter-in-durable-tests',
      'no-invisible-characters-in-source',
      'no-llm-dependency',
      'no-outbound-network-outside-http-client',
      'no-placeholder-port-implementations',
      'no-pre-0020-decision-shape',
      'no-prose-activity-in-domain',
      'no-second-eligibility-answer',
      'no-ui-import-of-infrastructure',
      'no-unrepresentable-characters-in-migrations',
      'orchestrator-writes-nothing-directly',
      'submission-references-always-validated',
    ])
  })

  it('gives every rule both a violation and a near-miss', () => {
    // The structural guard. A source-scanning rule may not enter the registry
    // without something that proves it fires and something that proves it
    // discriminates.
    const missing: string[] = []
    for (const rule of LOAD_BEARING_RULES) {
      const fixtures = PLANTED.find((entry) => entry.ruleId === rule.id)
      if (!fixtures) {
        missing.push(`${rule.id}: no fixtures at all`)
        continue
      }
      if (fixtures.violations.length === 0)
        missing.push(`${rule.id}: no planted violation`)
      if (fixtures.nearMisses.length === 0) missing.push(`${rule.id}: no near-miss`)
    }
    expect(missing).toEqual([])
  })

  it('names a real rule from every fixture set', () => {
    for (const entry of PLANTED) expect(() => ruleById(entry.ruleId)).not.toThrow()
  })

  for (const entry of PLANTED) {
    const rule = ruleById(entry.ruleId)

    describe(rule.id, () => {
      it('states the property and why it is load-bearing', () => {
        // A rule nobody can explain is a rule nobody can correctly relax.
        expect(rule.states.length).toBeGreaterThan(20)
        expect(rule.because.length).toBeGreaterThan(20)
      })

      for (const fixture of entry.violations) {
        it(`fails on ${fixture.what}`, () => {
          const file = analyseFixture(fixture.path, fixture.source)
          /*
           * TypeScript fixtures must parse; a SQL one is a different subject with
           * no AST to be wrong. Not a hole: the rule that selects migrations
           * reads their text, so a nonsense fixture fails its own assertion.
           */
          if (/[.]tsx?$/.test(fixture.path)) {
            expect(syntaxErrors(file.ast), 'the fixture must be real TypeScript').toEqual(
              [],
            )
          }
          expect(
            rule.selects(file),
            `the rule does not even look at ${fixture.path}`,
          ).toBe(true)
          expect(
            rule.detect(file),
            `${rule.id} did not notice ${fixture.what}`,
          ).not.toEqual([])
        })
      }

      for (const fixture of entry.nearMisses) {
        it(`allows ${fixture.what}`, () => {
          const file = analyseFixture(fixture.path, fixture.source)
          /*
           * TypeScript fixtures must parse; a SQL one is a different subject with
           * no AST to be wrong. Not a hole: the rule that selects migrations
           * reads their text, so a nonsense fixture fails its own assertion.
           */
          if (/[.]tsx?$/.test(fixture.path)) {
            expect(syntaxErrors(file.ast), 'the fixture must be real TypeScript').toEqual(
              [],
            )
          }
          /*
           * Asserted, not assumed. A near-miss the rule never selects proves
           * nothing about the rule — it would pass just as happily against
           * `detect: () => ['everything is broken']`.
           */
          expect(
            rule.selects(file),
            `the rule does not even look at ${fixture.path}`,
          ).toBe(true)
          expect(rule.detect(file), `${rule.id} flagged compliant code`).toEqual([])
        })
      }
    })
  }
})

describe('no rule passes by applying to nothing', () => {
  for (const rule of LOAD_BEARING_RULES) {
    it(`${rule.id} judges at least one file that exists`, () => {
      /*
       * The other way a rule dies quietly. Scoped to a directory that was
       * renamed, or to a file that was deleted, it selects nothing, finds
       * nothing and passes — identical from the outside to a rule holding a
       * property that nobody has tried to break.
       */
      const selected = TREE.filter((file) => rule.selects(file))
      expect(selected.length, `${rule.id} applies to no file under src/`).toBeGreaterThan(
        0,
      )
    })
  }
})

describe('the defect that started this', () => {
  /**
   * Control characters, excluding tab, newline and carriage return.
   *
   * Written as escape sequences on purpose: a literal one here would be the
   * same defect as the one it exists to catch, and would be just as invisible
   * in review.
   */
  const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/

  it('leaves no literal control character in any source file', () => {
    /*
     * `\b` typed as a real backspace is a valid regex that matches a byte no
     * source file contains, so the rule around it passes forever. It renders as
     * nothing in an editor, survives review, and survives a diff. The only
     * defence is mechanical.
     */
    const offenders: string[] = []
    for (const file of TREE) {
      const lines = file.text.split('\n')
      lines.forEach((line, index) => {
        if (CONTROL_CHARACTER.test(line)) {
          offenders.push(
            `${file.path}:${index + 1} — U+${line
              .split('')
              .find((character) => CONTROL_CHARACTER.test(character))!
              .charCodeAt(0)
              .toString(16)
              .padStart(4, '0')
              .toUpperCase()}`,
          )
        }
      })
    }
    expect(offenders).toEqual([])
  })

  it('detects one when it is put back', () => {
    // The rule above, proved live by the same standard as every other.
    const planted = `expect(/${String.fromCharCode(8)}marketTrends/.test(route)).toBe(false)`
    expect(CONTROL_CHARACTER.test(planted)).toBe(true)
    expect(CONTROL_CHARACTER.test(planted.replace(String.fromCharCode(8), '\\b'))).toBe(
      false,
    )
  })
})

describe('the parsed source model', () => {
  it('reads imports the parser recognises, not text that looks like one', () => {
    const file = analyseFixture(
      'application/analysis/example.ts',
      `
        import type { Claim } from '~/domain/analysis'
        import { runCommand } from './commands/runCommand'
        export { deriveEventId } from './commands/eventIdentity'
        const lazy = () => import('~/infrastructure/analysis/postgres/rows')
        // import { secret } from 'axios'
        const documentation = "import { secret } from 'openai'"
      `,
    )
    expect(file.imports.map((reference) => reference.specifier)).toEqual([
      '~/domain/analysis',
      './commands/runCommand',
      './commands/eventIdentity',
      '~/infrastructure/analysis/postgres/rows',
    ])
    expect(file.imports.find((r) => r.specifier === '~/domain/analysis')?.typeOnly).toBe(
      true,
    )
    expect(documentationSurvives(file.code)).toBe(false)
  })

  it('blanks a comment containing an apostrophe without eating the code after it', () => {
    /*
     * The regex `codeOnly` it replaces stripped quoted strings with a pattern
     * that could not tell a comment's apostrophe from an opening quote, so
     * everything after "the manager's" vanished — taking real code with it and
     * making every later rule in the file look satisfied.
     */
    const file = analyseFixture(
      'domain/analysis/example.ts',
      [
        "// the manager's rationale is not activity prose",
        'export interface Record {',
        '  activity: string',
        '}',
      ].join('\n'),
    )
    expect(file.code).toContain('activity: string')
    expect(file.code).not.toContain('rationale')
  })

  it('keeps line numbers aligned after blanking', () => {
    const file = analyseFixture(
      'domain/analysis/example.ts',
      ['/* one', '   two */', 'export const three = 3', ''].join('\n'),
    )
    expect(file.code.split('\n')).toHaveLength(file.text.split('\n').length)
    expect(file.code.split('\n')[2]).toBe('export const three = 3')
  })
})

/** Syntax errors the parser found, so a fixture cannot be nonsense. */
function syntaxErrors(source: ts.SourceFile): string[] {
  // `parseDiagnostics` is internal but stable, and the alternative — a full
  // Program per fixture — would cost seconds per run to learn the same thing.
  const diagnostics =
    (source as unknown as { parseDiagnostics?: ts.DiagnosticWithLocation[] })
      .parseDiagnostics ?? []
  return diagnostics.map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
  )
}

/** True when a string literal's contents survived blanking. */
function documentationSurvives(code: string): boolean {
  return code.includes('secret')
}

/**
 * Which institutional failure a schema-raised error actually is.
 *
 * Every `RAISE` in this schema uses `integrity_constraint_violation`, so the
 * SQLSTATE alone cannot separate "this aggregate is invalid" from "this record
 * is sealed". Those are different failures, the in-memory reference
 * distinguishes them, and mapping all of them to `ImmutableRecordError` made
 * the two stores disagree about the same mistake.
 *
 * The prefixes are schema-owned identifiers written in migration 0020 to be
 * matched on. **This file pins them.** TD-57 replaces the whole mechanism with
 * a structured SQLSTATE per rule; until then, a reword that dropped a prefix
 * would silently reclassify a failure, and this is what fails instead.
 */

import { describe, expect, it } from 'vitest'
import {
  ImmutableRecordError,
  InvariantViolationError,
} from '~/application/analysis/repositories'
import { mapDatabaseError } from './sql'

const raised = (message: string, code = '23000') =>
  mapDatabaseError({ code, message } as never, 'decisions.save')

describe('the machine prefixes migration 0020 raises', () => {
  it('classifies an outcome-guard failure as an invariant violation', () => {
    const error = raised(
      'decision_outcome: selected decision "dec-1" has 0 selected relations',
    )
    expect(error).toBeInstanceOf(InvariantViolationError)
    expect((error as InvariantViolationError).constraint).toBe('decision_outcome')
  })

  it('classifies a supersession cycle as an invariant violation', () => {
    const error = raised(
      'supersession_cycle: decision "dec-3" would close a supersession cycle',
    )
    expect(error).toBeInstanceOf(InvariantViolationError)
    expect((error as InvariantViolationError).constraint).toBe('supersession_cycle')
  })

  it('classifies a committed-decision rewrite as an immutability failure', () => {
    const error = raised(
      'Case decision "case-1" is committed and cannot be update . Append a ' +
        'superseding decision instead.',
    )
    expect(error).toBeInstanceOf(ImmutableRecordError)
  })

  it('does not guess an unknown 23000 into the wrong failure', () => {
    // The conservative direction: a rule nobody taught this mapping about is
    // treated as a sealed record, never as a merely invalid aggregate.
    const error = raised('some rule nobody has written yet')
    expect(error).toBeInstanceOf(ImmutableRecordError)
    expect(error).not.toBeInstanceOf(InvariantViolationError)
  })

  it('never lets the raised id reach the constraint field', () => {
    /*
     * The messages interpolate a decision id and a case id. The constraint
     * field is for schema identifiers, and it is what a log line carries.
     */
    const error = raised('decision_outcome: decision "dec-secret-1" considers nothing')
    expect((error as InvariantViolationError).constraint).not.toContain('dec-secret-1')
  })

  it('leaves plpgsql P0001 on the same path', () => {
    expect(raised('decision_outcome: whatever', 'P0001')).toBeInstanceOf(
      InvariantViolationError,
    )
  })
})

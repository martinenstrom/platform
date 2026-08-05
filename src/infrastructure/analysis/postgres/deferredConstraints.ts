/**
 * The deferred constraints the decision write owns, by name.
 *
 * A decision is written across five tables and its supersession updates a sixth
 * row before the row it points at exists. Every rule that spans those writes is
 * therefore `DEFERRABLE INITIALLY DEFERRED` and fires at COMMIT — which is the
 * wrong moment for a repository to learn it was wrong. `decisions.save` forces
 * exactly these, at the end of its own work, so an invalid decision fails from
 * `save` and the in-memory reference and PostgreSQL refuse it at the same call.
 *
 * ## Why not `SET CONSTRAINTS ALL IMMEDIATE`
 *
 * `ALL` couples this repository to every deferred constraint in the
 * transaction, including ones added later by code that has nothing to do with
 * decisions. A caller with unrelated deferred work would start seeing failures
 * attributed to a decision write, and nested application transactions would
 * stop composing. A repository forces the invariants it owns and no others.
 *
 * ## Why the names are verified rather than trusted
 *
 * `SET CONSTRAINTS` on a name that does not exist raises. On a name that exists
 * and is **not deferrable** it succeeds and does nothing at all — so a
 * constraint renamed, or quietly made immediate, would turn this whole
 * mechanism into a no-op that every other test still passes. `DEFERRED_DECISION_CONSTRAINTS`
 * carries the expected table and mode so a test can check all four properties
 * against `pg_constraint`.
 */

import { catalog } from './sql'

export interface DeferredConstraint {
  /** Unqualified name, as `pg_constraint.conname` holds it. */
  name: string
  table: string
  /** What breaks if it stops being enforced. For the failure message. */
  invariant: string
}

/**
 * The six, read from migration 0020 rather than remembered.
 *
 * The third is `triggers_outcome_guard`, not the longer name its table would
 * suggest — which is exactly the kind of thing the verification test exists to
 * catch.
 */
export const DEFERRED_DECISION_CONSTRAINTS: readonly DeferredConstraint[] = Object.freeze(
  [
    Object.freeze({
      name: 'case_decisions_supersedes_fk',
      table: 'case_decisions',
      invariant: 'the predecessor exists and belongs to the same case',
    }),
    Object.freeze({
      name: 'case_decisions_superseded_by_fk',
      table: 'case_decisions',
      invariant: 'the successor exists and belongs to the same case',
    }),
    Object.freeze({
      name: 'case_decisions_outcome_guard',
      table: 'case_decisions',
      invariant: 'the outcome agrees with the relations',
    }),
    Object.freeze({
      name: 'decision_submissions_outcome_guard',
      table: 'decision_submissions',
      invariant: 'the outcome agrees with the relations, re-checked per relation',
    }),
    Object.freeze({
      name: 'triggers_outcome_guard',
      table: 'decision_reconsideration_triggers',
      invariant: 'a deferral records at least one condition that would end the wait',
    }),
    Object.freeze({
      name: 'case_decisions_no_supersession_cycle',
      table: 'case_decisions',
      invariant: 'supersession forms no ring, at any depth',
    }),
  ],
)

const NAMES = DEFERRED_DECISION_CONSTRAINTS.map(
  (constraint) => `analysis.${constraint.name}`,
).join(', ')

export const CONSTRAINT_SQL = catalog({
  /** Checks the six now, inside the transaction, rather than at COMMIT. */
  forceDecisionConstraints: `SET CONSTRAINTS ${NAMES} IMMEDIATE`,

  /**
   * Hands the transaction back in the mode the caller gave it.
   *
   * Without this a caller who wrote a decision and then did unrelated deferred
   * work would find these six checked eagerly for the rest of the transaction.
   */
  restoreDecisionConstraints: `SET CONSTRAINTS ${NAMES} DEFERRED`,

  /**
   * The four properties each catalogued name must actually have.
   *
   * `contype = 't'` is a constraint trigger; `'f'` a foreign key. Both appear
   * in `pg_constraint`, and both can be deferred.
   */
  describeConstraints: `
    SELECT con.conname, rel.relname AS table_name,
           con.condeferrable, con.condeferred
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'analysis' AND con.conname = ANY($1)`,
})

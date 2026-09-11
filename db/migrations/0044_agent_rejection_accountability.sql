-- Who declined an agent's work, when that "who" is not a person.
--
-- A correctness repair to the P4 principal generalisation, not a new authority.
--
-- ## The inconsistency this closes
--
-- `RejectContribution` was widened in P4 to accept an accountable institutional
-- PRINCIPAL — a person or an authorised desk agent — for the same reason
-- `AcceptContribution` was: the same authority that may adopt work may decline
-- it, and a desk able to admit work but not refuse it has no judgement at all.
--
-- The application then writes that principal into `rejected_by_employee_id`,
-- which has referenced `analysis.employees` since `0027`. An agent declining a
-- contribution therefore fails at the foreign key. The application semantics
-- and the storage contract have disagreed since P4; nothing caught it because
-- P4's live proof exercised acceptance and never rejection.
--
-- ## The same shape `0040` used
--
-- A nullable agent column beside the employee column, and an invariant that
-- names exactly one accountable principal. Every historical rejection satisfies
-- it unchanged: each has an employee and no agent.

ALTER TABLE analysis.runs
    ADD COLUMN rejected_by_agent_principal_id text
        REFERENCES analysis.agent_principals (id),

    /*
     * Code, detail and time still move together — that half is unchanged. The
     * accountable principal moves out of this constraint and into its own,
     * because "exactly one of two columns" is not expressible as an IS NULL
     * conjunction.
     */
    DROP CONSTRAINT runs_rejection_complete,
    ADD CONSTRAINT runs_rejection_complete CHECK (
        (rejection_code IS NULL) = (rejection_detail IS NULL AND rejected_at IS NULL)
    ),

    /*
     * A rejected contribution has exactly one accountable rejecting principal;
     * a contribution nobody declined has none. Both at once is refused: two
     * answers to "who can the firm ask about this" is not a record.
     *
     * Strictly stronger than what it replaces. Previously a rejection needed an
     * employee; now it needs exactly one principal and cannot carry two.
     */
    ADD CONSTRAINT runs_rejected_by_one_principal CHECK (
        num_nonnulls(rejected_by_employee_id, rejected_by_agent_principal_id)
        = (CASE WHEN rejection_code IS NULL THEN 0 ELSE 1 END)
    );

/*
 * `UPDATE` on `analysis.runs` is column-level and has been since `0009`. The
 * rejection columns are written by the upsert that settles the run, so without
 * this grant every rejection by an agent fails with `StoragePermissionError` —
 * the column existing and the constraint allowing it prove nothing about
 * whether the runtime may write it.
 */
GRANT UPDATE (rejected_by_agent_principal_id) ON analysis.runs TO finos_app;

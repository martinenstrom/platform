-- 0053 · a requirement resolution may be the department's own principal's evaluation
--
-- Migration 0014 required every conditional-requirement resolution to name the
-- employee who evaluated it: whether a governance gate applies is an
-- institutional judgement, and someone is accountable for it. G1 (ruled
-- 2026-09-17) seated the Risk desk's own principal for exactly this act, and
-- the first live gold loop after it (2026-09-18) failed the Risk principal's
-- resolution on this table's NOT NULL employee column — the revision then went
-- before the control functions with Risk unresolved.
--
-- The rule stays: exactly one accountable evaluator, never the system. Who may
-- evaluate widens to the department's institutional principal, mutually
-- exclusive with an employee, as 0042 did for transition events and 0049 for
-- reviews.

ALTER TABLE analysis.requirement_resolutions
    ALTER COLUMN evaluated_by_employee_id DROP NOT NULL;

ALTER TABLE analysis.requirement_resolutions
    ADD COLUMN evaluated_by_agent_principal_id text
        REFERENCES analysis.agent_principals (id);

ALTER TABLE analysis.requirement_resolutions
    ADD CONSTRAINT requirement_resolutions_one_evaluator
    CHECK (num_nonnulls(evaluated_by_employee_id, evaluated_by_agent_principal_id) = 1);

COMMENT ON COLUMN analysis.requirement_resolutions.evaluated_by_agent_principal_id IS
    'The institutional agent that evaluated the requirement, where one did. '
    'Mutually exclusive with evaluated_by_employee_id; exactly one is set.';

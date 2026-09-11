-- The department a mandate is ABOUT, which is not always the actor's own.
--
-- The command ledger stored a mandate as its kind plus, for governance verdicts,
-- a discipline. Every department-scoped mandate was rehydrated from
-- `actor_department_id`, and that worked because it was always true: a
-- department manager acting under `department-manager` is, by definition, acting
-- on their own department.
--
-- `investment-committee-convenor` breaks that assumption on purpose. The
-- Chairman sits in `executive` and convenes a committee for a case owned by
-- `research-office`, so the actor's department and the mandate's department are
-- different facts. Reconstructing the second from the first would make the
-- ledger report that the Chairman convened a committee for their own desk —
-- a quiet falsehood in the one record that exists to say what authority was
-- exercised over what.
--
-- ## Nullable, and backfilled only where it is knowable
--
-- Existing rows are left alone. For `department-manager`, `department-contribution`
-- and `thesis-owner` the actor's department IS the mandate's department, so
-- rehydration keeps falling back to `actor_department_id` and historical rows
-- read exactly as they did before. Backfilling a column with a value that was
-- never recorded would invent precision the old rows do not have.
--
-- New rows carrying a department-scoped mandate write it explicitly.

ALTER TABLE analysis.commands
    ADD COLUMN mandate_department_id text;

-- A convening command must say which department's case it convened for. There is
-- no fallback for this mandate, because the fallback would be wrong.
ALTER TABLE analysis.commands
    ADD CONSTRAINT commands_convening_names_owning_department CHECK (
        mandate_kind <> 'investment-committee-convenor'
        OR mandate_department_id IS NOT NULL
    );

COMMENT ON COLUMN analysis.commands.mandate_department_id IS
    'The department the mandate is about. Distinct from actor_department_id: a '
    'convenor acts on a case owned by another desk. Null on rows written before '
    'this column existed, where the actor department was the mandate department.';

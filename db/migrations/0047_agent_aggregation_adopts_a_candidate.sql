-- An agent's synthesis names the candidate it adopted.
--
-- The command already refuses the alternatives: an institutional agent may not
-- state a synthesis directly, and an employee may not adopt a candidate. This
-- is the same rule where nothing can route around it — a migration, a repair
-- script, a future adapter or a hand-written statement.
--
-- Stated as a biconditional because both halves matter:
--
--   * an agent aggregation with no candidate would mean model output reached
--     `thesis_revisions` without passing the boundary this whole slice exists
--     to build;
--   * an employee aggregation WITH one would mean a person's directly authored
--     position carried a candidate reference that did not produce it, and the
--     back-link would stop being proof of anything.
--
-- Every historical aggregation satisfies it unchanged: each has an employee and
-- no candidate.
--
-- Written forward rather than into `0045`, for the reason `0041` and `0043`
-- were: an applied migration is history.

ALTER TABLE analysis.aggregations
    ADD CONSTRAINT aggregations_agent_adopts_a_candidate CHECK (
        (manager_agent_principal_id IS NULL) = (synthesis_run_id IS NULL)
    );

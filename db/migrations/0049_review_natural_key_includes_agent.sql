-- The review natural key must name the principal that filed the verdict.
--
-- ## What is wrong today
--
-- `reviews_natural_key_unique` covers
-- `(kind, case_id, thesis_id, revision_id, by_department_id, by_employee_id, at)`
-- with `NULLS NOT DISTINCT`. That was exactly right while every review was
-- filed by a person: `by_employee_id` WAS the principal.
--
-- Migration `0040` added `by_agent_principal_id` so a control function's own
-- agent can be accountable for a verdict, and left this index alone — nothing
-- wrote the column yet. The moment something does, every agent-filed review
-- carries `by_employee_id = NULL`, and under `NULLS NOT DISTINCT` those NULLs
-- are equal: two verdicts filed by DIFFERENT agents of the same department, on
-- the same revision, at the same instant would collide and the second would be
-- silently swallowed as a replay.
--
-- One principal per governance department makes that unreachable today. It is
-- being fixed now anyway, because the index is the mirror of `reviewIdentity`
-- in the domain, and an index that dedupes on a column the domain no longer
-- treats as the principal is a mirror that has stopped reflecting.
--
-- ## Why this is safe for every existing row
--
-- Every historical review has an employee and no agent, so adding the agent
-- column to the key changes no existing row's key: `(…, 'macro-head', NULL, at)`
-- is as unique as `(…, 'macro-head', at)` was. No row can become a duplicate
-- and none can stop being one.
--
-- The column ORDER puts the agent beside the employee rather than at the end,
-- so the two accountable-principal columns read together — and so a reader
-- comparing this index against `reviewIdentity` sees the same shape in the same
-- place.

DROP INDEX analysis.reviews_natural_key_unique;

CREATE UNIQUE INDEX reviews_natural_key_unique
    ON analysis.reviews (
        kind,
        case_id,
        thesis_id,
        revision_id,
        by_department_id,
        by_employee_id,
        by_agent_principal_id,
        at
    )
    NULLS NOT DISTINCT;

-- The runtime writes the agent column on the filing path. `analysis.reviews`
-- holds SELECT and INSERT and no UPDATE — a verdict is a judgement at a moment,
-- and a changed verdict is a new review that supersedes the old one — so the
-- write path is the insert and no GRANT UPDATE is added here. That is the
-- lesson `0041` and `0043` taught twice, applied in the direction that does not
-- hand out a privilege nothing needs.

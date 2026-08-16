-- The human acceptance boundary.
--
-- One institutional change in three parts: a store for work that has been
-- produced and not yet judged, the two run states that judgement moves through,
-- and the record of why a person declined.
--
-- ============================================================ produced work ==
--
-- Work an agent produced that no human has accepted.
--
-- Generated work is **operational** until a person accepts it. Accepted work
-- becomes institutional. Rejected work remains durable operational history and
-- never becomes institutional evidence.
--
-- This table is what makes the last of those structural rather than
-- remembered. Every citation in the institution — a counterclaim's
-- `contests_claim_id`, an aggregation disposition, a challenge subject, an
-- evidence reference — is a foreign key into `analysis.claims`. Nothing
-- produced is in that table, so **citing unaccepted or rejected work fails at
-- the database**, not at a filter every consumer has to remember.
--
-- Deliberately NOT a copy of `analysis.claims` with a flag. A flag would put
-- rejected work inside the table citations resolve against and turn a database
-- property into a convention.
--
-- Claims are stored as canonical JSON, exactly as `analysis.agent_results`
-- already stores them. That is the point: acceptance moves the same claim, with
-- the same id and the same content, into institutional storage. There is no
-- second canonicalisation and no second content hash — a claim that hashed
-- differently depending on which side of acceptance it was read from would not
-- be content-addressed at all.

CREATE TABLE analysis.produced_claims (
    -- One run produces one set of claims. Write-once, like everything else the
    -- firm records about work that happened.
    run_id      text PRIMARY KEY REFERENCES analysis.runs (id),
    case_id     text NOT NULL,
    tenant_id   text NOT NULL,
    claims      jsonb NOT NULL,
    produced_at timestamptz NOT NULL,

    FOREIGN KEY (case_id, tenant_id) REFERENCES analysis.cases (id, tenant_id),

    CONSTRAINT produced_claims_is_array CHECK (jsonb_typeof(claims) = 'array'),
    -- A run that produced nothing has nothing to accept, and recording an
    -- empty set would make "the agent returned nothing" and "the agent was
    -- never asked" the same row.
    CONSTRAINT produced_claims_not_empty CHECK (jsonb_array_length(claims) > 0)
);

-- Read by run, and only by run — the primary key already serves that, so there
-- is no index here at all.
--
-- Specifically there is no index by case. `case_id` is carried for the foreign
-- key that keeps produced work inside a real case, not to be listed on: produced
-- work is not case evidence, and a convenient case-wide listing is the first
-- step towards treating it as though it were. The repository port offers
-- `listForRun` and nothing else for the same reason.

-- The runtime records what an agent produced and reads it back for a human to
-- judge. It never updates or deletes: a rejected run's work stays exactly as
-- it was produced, which is what makes it evidence about the agent.
GRANT SELECT, INSERT ON analysis.produced_claims TO finos_app;

-- ============================================================== run states ==

/*
 * Two states the run machine did not have.
 *
 * `awaiting-acceptance` is where a run now lands when its provider answered.
 * A run no longer reaches `completed` directly: the only path into the
 * institutional record runs through a person.
 *
 * `rejected` is that person declining. It is **never a kind of `failed`** — a
 * failed run produced nothing, a rejected run produced work the firm judged
 * inadequate and every call succeeded. Collapsing them would make "how often
 * does this agent fail" and "how often is its work not good enough" one number,
 * and those are the two different questions worth asking about an employee.
 */
ALTER TABLE analysis.runs
    DROP CONSTRAINT runs_state_known,
    ADD CONSTRAINT runs_state_known CHECK (
        state IN ('queued', 'waiting-for-dependencies', 'ready', 'running',
                  'awaiting-acceptance', 'completed', 'rejected', 'failed',
                  'timed-out', 'cancelled', 'superseded', 'blocked')
    ),

    /*
     * Neither new state may carry a failure record.
     *
     * `runs_stalled_with_category` already requires one for the states that
     * genuinely stopped. This is the other half: a run holding both a rejection
     * and a failure would be two answers about the same work, which is the
     * confusion the two states were separated to prevent.
     */
    DROP CONSTRAINT runs_progress_without_failure,
    ADD CONSTRAINT runs_progress_without_failure CHECK (
        state NOT IN ('queued', 'waiting-for-dependencies', 'ready', 'running',
                      'awaiting-acceptance', 'completed', 'rejected')
        OR failure_category IS NULL
    );

/*
 * `rejected` is terminal, so it releases the assignment's active-run slot.
 *
 * The index means "at most one run per assignment that has not settled", and a
 * rejected run has settled. Leaving it out of the exclusion list would make the
 * first rejection permanent — the desk could never be asked again, because the
 * database would refuse to start the second run.
 *
 * `awaiting-acceptance` is deliberately NOT excluded. It has not settled: a
 * person still has to act, and a second run must not be started against work
 * that is still awaiting judgement.
 */
DROP INDEX analysis.runs_one_active_per_assignment;
CREATE UNIQUE INDEX runs_one_active_per_assignment
    ON analysis.runs (assignment_id)
    WHERE state NOT IN ('completed', 'rejected', 'failed', 'timed-out',
                        'cancelled', 'superseded');

-- =============================================================== rejection ==

/*
 * Why a person declined an agent's work.
 *
 * A **code**, not a sentence, for the reason `failure_category` is one: this
 * vocabulary is counted over years — which agents are rejected most, why,
 * whether it clusters by capability, prompt, task or market regime, and whether
 * an agent improves. None of that is answerable over prose.
 *
 * And prose beside it rather than instead of it, because a code alone teaches
 * nobody anything. A rejection nobody can learn from is the discarded history
 * this record exists to prevent — so `rejection_detail` is required whenever a
 * code is present, and required to be non-empty.
 *
 * Each code names **what was wrong**, never how it scored. A code naming a
 * deficiency can be improved against; one naming a verdict cannot — which is
 * why `insufficient-analysis` is here and `below-quality-bar` is not.
 */
ALTER TABLE analysis.runs
    ADD COLUMN rejection_code        text,
    ADD COLUMN rejection_detail      text,
    -- Never an agent. The person who declined it is who the firm can ask.
    ADD COLUMN rejected_by_employee_id text REFERENCES analysis.employees (id),
    ADD COLUMN rejected_at           timestamptz,

    ADD CONSTRAINT runs_rejection_code_known CHECK (
        rejection_code IS NULL OR rejection_code IN (
            'unsupported-by-evidence', 'misread-the-brief',
            'internally-inconsistent', 'duplicates-existing-work',
            'insufficient-analysis', 'out-of-scope'
        )
    ),

    -- A rejection record is all of its parts or none of them.
    ADD CONSTRAINT runs_rejection_complete CHECK (
        (rejection_code IS NULL)
        = (rejection_detail IS NULL AND rejected_by_employee_id IS NULL
           AND rejected_at IS NULL)
    ),

    -- A code with no explanation records that the firm declined the work
    -- without recording what would make the next attempt better.
    ADD CONSTRAINT runs_rejection_detail_stated CHECK (
        rejection_detail IS NULL OR btrim(rejection_detail) <> ''
    ),

    /*
     * The state and the record agree, in both directions: a rejected run says
     * why, and a run that is not rejected does not carry a rejection it did not
     * receive.
     */
    ADD CONSTRAINT runs_rejected_has_reason CHECK (
        (state = 'rejected') = (rejection_code IS NOT NULL)
    );

/*
 * The runtime records a rejection when a person declines the work.
 *
 * `UPDATE` is column-level on this table, as it has been since 0009: the
 * runtime may move a run's outcome fields and may not rewrite what produced the
 * work. A run is inserted while it is running and settled later, so the
 * rejection columns are written by the same upsert that settles the state —
 * without this grant every `runs.save` is refused, including the ones that have
 * nothing to do with rejection.
 */
GRANT UPDATE (rejection_code, rejection_detail, rejected_by_employee_id,
              rejected_at)
    ON analysis.runs TO finos_app;

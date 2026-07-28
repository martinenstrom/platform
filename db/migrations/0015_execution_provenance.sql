-- Phase C1C-1: execution provenance, bounded run failures, one active run.
--
-- Storage provenance answers "which code read and wrote this row". It cannot
-- answer "what decided the content", which is the question an analysis has to
-- survive. TD-28 existed because only the first was answerable, and the gap
-- shows up the moment a recorded fixture and a live agent produce rows that
-- look identical.
--
-- `runs` is empty in every environment — nothing has ever started one, because
-- there was no command that could. The NOT NULL columns below are therefore
-- honest rather than back-filled, and the guard verifies that rather than
-- assuming it.

DO $$
DECLARE existing bigint;
BEGIN
    SELECT count(*) INTO existing FROM analysis.runs;
    IF existing > 0 THEN
        RAISE EXCEPTION
            'analysis.runs holds % rows. 0015 assumes none, because execution '
            'provenance cannot be reconstructed for work that has already '
            'happened — inventing a provider for it would fabricate the '
            'record this migration exists to make trustworthy.',
            existing;
    END IF;
END $$;

-- ------------------------------------------------------ execution provenance

ALTER TABLE analysis.runs
    -- Which workflow, at which exact version, and which step of it.
    ADD COLUMN playbook_id        text NOT NULL,
    ADD COLUMN playbook_version   text NOT NULL,
    ADD COLUMN playbook_entry_key text NOT NULL,

    -- What produced the contribution.
    ADD COLUMN provider_id      text NOT NULL,
    ADD COLUMN provider_version text NOT NULL,
    /*
     * The field this whole migration is for.
     *
     * NOT NULL with no default, so a run cannot exist without saying what
     * produced it. Recorded fixtures and deterministic stubs must stay
     * distinguishable from live institutional work everywhere downstream — the
     * same rule that forbids presenting fixture market data as live.
     */
    ADD COLUMN provider_kind text NOT NULL,

    -- The code that read and wrote the row, as commands carry.
    ADD COLUMN provenance_id text NOT NULL
        REFERENCES analysis.storage_provenance (id),

    /*
     * Declared optional inputs that had not completed when the run started.
     *
     * Recorded rather than derived: derived at read time it would change as
     * late contributions arrived, and the record would stop describing the
     * conditions the desk actually worked under.
     */
    ADD COLUMN missing_optional_inputs text[] NOT NULL DEFAULT '{}',

    ADD CONSTRAINT runs_provider_kind_known CHECK (
        provider_kind IN ('recorded', 'stub', 'live')
    ),

    -- The entry must belong to the version the run claims to be executing.
    ADD CONSTRAINT runs_playbook_entry_fkey
        FOREIGN KEY (playbook_id, playbook_version, playbook_entry_key)
        REFERENCES analysis.playbook_entries (playbook_id, version, entry_key);

ALTER TABLE analysis.runs ALTER COLUMN missing_optional_inputs DROP DEFAULT;

CREATE INDEX runs_provider_kind_idx ON analysis.runs (provider_kind);

-- Agent results carry the same two, so a stored result is traceable to its
-- producer without joining back through the run that may have been superseded.
ALTER TABLE analysis.agent_results
    ADD COLUMN provider_kind text,
    ADD COLUMN provenance_id text REFERENCES analysis.storage_provenance (id),
    ADD CONSTRAINT agent_results_provider_kind_known CHECK (
        provider_kind IS NULL OR provider_kind IN ('recorded', 'stub', 'live')
    );

-- ------------------------------------------------------- bounded failures --

/*
 * `failure_reason` was free text, and the orchestrator wrote sentences into it.
 *
 * A free-text field on a failure path is where a provider's response body, a
 * prompt or an excerpt of evidence eventually lands — none of which may sit on
 * a record that flows into logs, metrics and read models. A closed category
 * cannot carry any of that, and the specific detail belongs in the provider's
 * own telemetry, correlated by run id.
 */
ALTER TABLE analysis.runs
    DROP CONSTRAINT runs_stalled_with_reason,
    DROP COLUMN failure_reason,
    ADD COLUMN failure_category  text,
    ADD COLUMN failure_retryable boolean,
    ADD COLUMN failure_attempt   integer,
    ADD COLUMN failed_at         timestamptz,

    ADD CONSTRAINT runs_failure_category_known CHECK (
        failure_category IS NULL OR failure_category IN (
            'provider-unavailable', 'provider-timeout', 'provider-error',
            'malformed-output', 'schema-violation', 'budget-exhausted',
            'evidence-unavailable', 'upstream-failed',
            'cancelled-by-organization', 'revision-superseded', 'internal-error'
        )
    ),

    -- A failure record is all of its parts or none of them.
    ADD CONSTRAINT runs_failure_complete CHECK (
        (failure_category IS NULL)
        = (failure_retryable IS NULL AND failure_attempt IS NULL
           AND failed_at IS NULL)
    ),
    ADD CONSTRAINT runs_failure_attempt_positive CHECK (
        failure_attempt IS NULL OR failure_attempt >= 1
    ),

    -- A stopped run says why it stopped.
    ADD CONSTRAINT runs_stalled_with_category CHECK (
        state NOT IN ('failed', 'timed-out', 'blocked', 'cancelled')
        OR failure_category IS NOT NULL
    ),

    /*
     * And a run that is still going, or that finished, may not also carry one.
     * Two answers about the same run is worse than none.
     */
    ADD CONSTRAINT runs_progress_without_failure CHECK (
        state NOT IN ('queued', 'waiting-for-dependencies', 'ready', 'running',
                      'completed')
        OR failure_category IS NULL
    );

-- -------------------------------------------------------- one active run --

/*
 * At most one non-terminal run per assignment.
 *
 * A partial unique index rather than a read-then-write in the command: two
 * concurrent starts would both read "no active run" and both insert. The
 * database is the only place this can be decided without a race.
 */
CREATE UNIQUE INDEX runs_one_active_per_assignment
    ON analysis.runs (assignment_id)
    WHERE state NOT IN ('completed', 'failed', 'timed-out', 'cancelled',
                        'superseded');

-- ------------------------------------------------- assignments may fail --

/*
 * A desk that tried and could not finish is not a desk that was told to stop.
 * Collapsing `failed` into `cancelled` would attribute a managerial decision
 * to a provider outage.
 */
ALTER TABLE analysis.assignments
    DROP CONSTRAINT assignments_status_known,
    ADD CONSTRAINT assignments_status_known CHECK (
        status IN ('queued', 'active', 'waiting', 'submitted', 'returned',
                   'completed', 'failed', 'cancelled')
    );

-- ---------------------------------------------------------------- grants --

-- The runtime writes execution provenance on insert and moves the failure
-- fields when a run stops. It may not rewrite what produced the work.
GRANT UPDATE (failure_category, failure_retryable, failure_attempt, failed_at)
    ON analysis.runs TO finos_app;

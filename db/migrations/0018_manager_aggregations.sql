-- Phase C1C-3: how a manager reached a conclusion, kept apart from the
-- conclusion itself.
--
-- A thesis revision says what the firm's position IS. Nothing said how a
-- manager got there — which contributions were in scope, what happened to every
-- claim inside them, which perspectives were missing, and who is accountable.
-- Without that, a manager who quietly drops the desk that disagreed leaves a
-- record identical to a manager who reconciled four desks that agreed.
--
-- Four tables rather than one document. Every field a headquarters or
-- governance query needs is a COLUMN: claim ids, run ids, revision ids,
-- disposition, materiality, scope and the eligibility flag are all filterable
-- and joinable. "Which claims did the manager set aside, and why" is the
-- question the CIO asks before selecting a thesis, and behind a jsonb blob it
-- is a scan and a parse. The only prose here is the manager's rationale, which
-- nothing filters on.

-- --------------------------------------------------------- the aggregation

CREATE TABLE analysis.aggregations (
    id                   text PRIMARY KEY,
    case_id              text NOT NULL,
    tenant_id            text NOT NULL REFERENCES analysis.tenants (id),

    thesis_id            text NOT NULL,
    -- The revision synthesised from, and the one this produced.
    source_revision_id   text NOT NULL
        REFERENCES analysis.thesis_revisions (revision_id),
    produced_revision_id text NOT NULL
        REFERENCES analysis.thesis_revisions (revision_id),

    /*
     * Accountable, and deliberately not the run's employee or provider. The
     * Research Office's contribution is a desk producing claims; this is the
     * manager taking responsibility for the firm's position. Collapsing them
     * would make "who stands behind this" unanswerable.
     */
    manager_employee_id  text NOT NULL REFERENCES analysis.employees (id),
    department_id        text NOT NULL REFERENCES analysis.departments (id),

    -- The one document-shaped field: why the synthesis reads as it does.
    rationale            text NOT NULL,
    aggregated_at        timestamptz NOT NULL,
    provenance_id        text NOT NULL
        REFERENCES analysis.storage_provenance (id),

    FOREIGN KEY (case_id, tenant_id) REFERENCES analysis.cases (id, tenant_id),

    -- One aggregation produced one revision, and one revision came from at
    -- most one aggregation. Two accounts of how one position was reached is
    -- not a record, it is a disagreement.
    CONSTRAINT aggregations_one_per_revision UNIQUE (produced_revision_id),

    CONSTRAINT aggregations_rationale_stated CHECK (btrim(rationale) <> ''),
    -- A revision cannot be synthesised from itself.
    CONSTRAINT aggregations_source_is_not_result
        CHECK (source_revision_id <> produced_revision_id)
);

CREATE INDEX aggregations_case_idx ON analysis.aggregations (case_id, aggregated_at);
CREATE INDEX aggregations_thesis_idx ON analysis.aggregations (thesis_id);

-- ------------------------------------------------------- the declared scope

/*
 * The exact contributions the manager considered.
 *
 * Stored rather than derived: which desks were in scope is a fact about the
 * synthesis, and re-deriving it from the runs later would let a contribution
 * that landed afterwards change what the manager is recorded as having read.
 */
CREATE TABLE analysis.aggregation_inputs (
    aggregation_id     text NOT NULL REFERENCES analysis.aggregations (id),
    run_id             text NOT NULL REFERENCES analysis.runs (id),
    playbook_entry_key text NOT NULL,
    requirement_level  text NOT NULL,

    PRIMARY KEY (aggregation_id, run_id),
    CONSTRAINT aggregation_inputs_level_known CHECK (
        requirement_level IN ('required', 'optional', 'conditional')
    )
);

-- ---------------------------------------------------------- what became of --
--                                                            every claim

CREATE TABLE analysis.aggregation_claim_dispositions (
    aggregation_id         text NOT NULL REFERENCES analysis.aggregations (id),
    claim_id               text NOT NULL REFERENCES analysis.claims (id),
    run_id                 text NOT NULL REFERENCES analysis.runs (id),

    disposition            text NOT NULL,
    -- Required wherever the manager exercised judgement.
    explanation            text,
    superseded_by_claim_id text REFERENCES analysis.claims (id),

    /*
     * Unresolved disagreement only. Three levels, because they do not behave
     * alike: a footnote-level quibble must not block a case, and a
     * disagreement that decides the answer must not travel to the CIO as a
     * footnote.
     */
    materiality            text,
    escalation_required    boolean,
    blocks_eligibility     boolean,
    /*
     * The level this claim was previously recorded at, when this aggregation
     * records a lower one. A manager may change their mind; a manager may not
     * change their mind invisibly to clear a gate.
     */
    downgraded_from        text,

    -- Exactly one disposition per claim per aggregation.
    PRIMARY KEY (aggregation_id, claim_id),

    CONSTRAINT aggregation_disposition_known CHECK (
        disposition IN (
            'adopted-supporting', 'adopted-opposing', 'retained-unresolved',
            'superseded-by-stronger-evidence', 'excluded-duplicate',
            'excluded-out-of-scope', 'excluded-methodologically-incompatible',
            'excluded-insufficiently-supported'
        )
    ),

    -- Work the manager set aside owes a reason the CIO can read.
    CONSTRAINT aggregation_disposition_explained CHECK (
        disposition NOT IN (
            'superseded-by-stronger-evidence', 'retained-unresolved',
            'excluded-duplicate', 'excluded-out-of-scope',
            'excluded-methodologically-incompatible',
            'excluded-insufficiently-supported'
        )
        OR btrim(coalesce(explanation, '')) <> ''
    ),

    -- "Something better exists" is not a finding: name it.
    CONSTRAINT aggregation_supersession_names_evidence CHECK (
        (disposition = 'superseded-by-stronger-evidence')
        = (superseded_by_claim_id IS NOT NULL)
    ),

    -- Materiality belongs to unresolved disagreement and to nothing else.
    CONSTRAINT aggregation_materiality_where_unresolved CHECK (
        (disposition = 'retained-unresolved') = (materiality IS NOT NULL)
    ),
    CONSTRAINT aggregation_materiality_known CHECK (
        materiality IS NULL
        OR materiality IN ('non-material', 'material', 'decision-critical')
    ),
    CONSTRAINT aggregation_materiality_consequences CHECK (
        (materiality IS NULL)
        = (escalation_required IS NULL AND blocks_eligibility IS NULL)
    ),
    CONSTRAINT aggregation_downgrade_known CHECK (
        downgraded_from IS NULL
        OR downgraded_from IN ('non-material', 'material', 'decision-critical')
    ),
    CONSTRAINT aggregation_downgrade_explained CHECK (
        downgraded_from IS NULL OR btrim(coalesce(explanation, '')) <> ''
    )
);

-- The two queries C1D will actually issue.
CREATE INDEX aggregation_dispositions_by_kind
    ON analysis.aggregation_claim_dispositions (aggregation_id, disposition);
CREATE INDEX aggregation_dispositions_blocking
    ON analysis.aggregation_claim_dispositions (claim_id)
    WHERE blocks_eligibility;

-- -------------------------------------------------- optional perspectives --

/*
 * What was available when the manager acted — snapshotted, never recomputed.
 *
 * Read from the runs later this would change as late contributions arrived,
 * and the record would stop describing what the manager actually had. Late
 * optional work that turns out to be material produces a NEW aggregation and a
 * new revision; it does not rewrite this one.
 */
CREATE TABLE analysis.aggregation_optional_inputs (
    aggregation_id      text NOT NULL REFERENCES analysis.aggregations (id),
    playbook_entry_key  text NOT NULL,
    availability        text NOT NULL,
    run_id              text REFERENCES analysis.runs (id),
    -- What became of an available contribution.
    scope               text,
    materially_relevant boolean NOT NULL,
    explanation         text,

    PRIMARY KEY (aggregation_id, playbook_entry_key),

    CONSTRAINT aggregation_optional_availability_known CHECK (
        availability IN (
            'received-and-used', 'received-not-adopted', 'failed', 'timed-out',
            'cancelled', 'superseded', 'unavailable-at-aggregation'
        )
    ),
    CONSTRAINT aggregation_optional_scope_known CHECK (
        scope IS NULL OR scope IN (
            'in-scope', 'excluded-out-of-scope', 'excluded-duplicate',
            'excluded-methodologically-incompatible', 'excluded-other'
        )
    ),
    -- An available contribution says what became of it; an absent one cannot.
    CONSTRAINT aggregation_optional_scope_where_available CHECK (
        (run_id IS NULL) = (scope IS NULL)
    ),
    /*
     * Excluding an available contribution requires a reason — and a materially
     * relevant one may not be excluded at all. Scope selection is not a way to
     * set aside work that bears on the thesis.
     */
    CONSTRAINT aggregation_optional_exclusion_justified CHECK (
        scope IS NULL
        OR scope = 'in-scope'
        OR (btrim(coalesce(explanation, '')) <> '' AND NOT materially_relevant)
    )
);

-- ------------------------------------------- the revision points at it --

/*
 * The two records reference each other and commit together, so one direction
 * has to be deferrable: the revision is written first, naming an aggregation
 * whose row lands microseconds later in the same transaction. Deferring the
 * check to COMMIT is what lets both be true at once without either being
 * written twice.
 */
ALTER TABLE analysis.thesis_revisions
    -- Nullable: revision 1 is proposed, not aggregated.
    ADD COLUMN aggregation_id text
        REFERENCES analysis.aggregations (id) DEFERRABLE INITIALLY DEFERRED,

    /*
     * Why the revision exists, as a bounded category beside the free-text
     * reason. The prose says what happened; the cause makes "how often does
     * governance send a thesis back" answerable without reading paragraphs.
     *
     * `thesis_revisions` is empty in every environment — nothing could write
     * one before C1B's ProposeThesis, and no case has run — so NOT NULL is
     * honest. The guard below verifies it.
     */
    ADD COLUMN revision_cause text NOT NULL,

    ADD CONSTRAINT thesis_revision_cause_known CHECK (
        revision_cause IN (
            'initial-proposal', 'manager-aggregation', 'new-evidence',
            'correction', 'governance-finding', 'changed-assumption',
            'resolved-challenge', 'changed-implications',
            'revised-invalidation-criteria'
        )
    ),

    -- Only revision 1 is an initial proposal, and revision 1 is nothing else.
    ADD CONSTRAINT thesis_revision_cause_matches_number CHECK (
        (revision_cause = 'initial-proposal') = (revision_number = 1)
    ),

    -- A managerial synthesis names the aggregation that produced it.
    ADD CONSTRAINT thesis_revision_aggregation_where_synthesised CHECK (
        (revision_cause = 'manager-aggregation') = (aggregation_id IS NOT NULL)
    );

-- ---------------------------------------- the requirement input hash --

/*
 * The exact, normalized input a conditional rule ran on.
 *
 * Makes a stored resolution independently checkable: re-hash the revision's
 * declared implications and compare, without re-running a rule version that
 * may since have been superseded. Without it, "was this computed from the
 * revision it names" is answerable only by trusting the row.
 *
 * `requirement_resolutions` is empty in every environment — the command that
 * writes one is this stage's — so NOT NULL is honest rather than back-filled.
 */
DO $$
DECLARE existing bigint;
BEGIN
    SELECT count(*) INTO existing FROM analysis.thesis_revisions;
    IF existing > 0 THEN
        RAISE EXCEPTION
            'analysis.thesis_revisions holds % rows. 0018 assumes none: why an '
            'existing revision was created cannot be reconstructed, and guessing '
            'would put a category on a judgement nobody made.',
            existing;
    END IF;

    SELECT count(*) INTO existing FROM analysis.requirement_resolutions;
    IF existing > 0 THEN
        RAISE EXCEPTION
            'analysis.requirement_resolutions holds % rows. 0018 assumes none: '
            'the input a past evaluation ran on cannot be reconstructed, and '
            'inventing one would defeat the column.',
            existing;
    END IF;
END $$;

ALTER TABLE analysis.requirement_resolutions
    ADD COLUMN input_hash text NOT NULL;

-- ------------------------------------------------ a new kind of event --

/*
 * Deciding whether a gate applies is not a review: nobody reviewed anything.
 * The firm decided whether a review is owed at all, which is a different
 * institutional act and the one the floor shows when Risk says "not required".
 */
ALTER TABLE analysis.transition_events
    DROP CONSTRAINT transition_events_subject_known,
    ADD CONSTRAINT transition_events_subject_known CHECK (
        subject IN ('case', 'thesis', 'assignment', 'run', 'review', 'requirement')
    );

-- ---------------------------------------------------------------- grants --

/*
 * Insert and read, and nothing else, on all four tables. An aggregation is a
 * judgement at a moment; a changed judgement is a new aggregation producing a
 * new revision, for the same reason a changed thesis is a new revision.
 */
GRANT SELECT, INSERT ON
    analysis.aggregations,
    analysis.aggregation_inputs,
    analysis.aggregation_claim_dispositions,
    analysis.aggregation_optional_inputs
TO finos_app;

-- The revision gains its back-reference when the aggregation that produced it
-- is written, and never again.
GRANT UPDATE (aggregation_id) ON analysis.thesis_revisions TO finos_app;

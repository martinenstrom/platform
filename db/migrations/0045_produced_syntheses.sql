-- The Research Office's synthesis, before the institution stands behind it.
--
-- ## The gap this closes
--
-- The firm has one epistemic rule about generated work: a model's output is
-- operational until an accountable principal explicitly adopts it. Migration
-- `0027` made that structural for CLAIMS — produced work lands in
-- `produced_claims`, outside the table every citation resolves against, and
-- `AcceptContribution` is the only path across.
--
-- The Research Office already crosses that boundary for its claims. It did not
-- for its SYNTHESIS: `statement`, `position`, `rationale`, `implications` and
-- `invalidation_criteria` arrived as command input and were written straight
-- into `thesis_revisions`. That was harmless while a human manager typed them —
-- a person can author a position and stand behind it in one act. It stops being
-- harmless the moment a model writes them, because then model output reaches
-- the institutional thesis in a single write, and the hierarchy would preserve
-- the boundary for a specialist while losing it for the manager above.
--
-- ## Not a generic artifact store
--
-- One narrow second artifact, for one department's one act. `produced_claims`
-- is deliberately not relaxed to hold it: its `jsonb_typeof(claims) = 'array'`
-- and non-empty checks are the guarantees it exists for, and a table that holds
-- anything guarantees nothing.
--
-- One run, one synthesis — the same relationship `produced_claims` has, and for
-- the same reason. The primary key says so.

CREATE TABLE analysis.produced_syntheses (
    run_id    text PRIMARY KEY REFERENCES analysis.runs (id),
    case_id   text NOT NULL,
    tenant_id text NOT NULL,

    -- ------------------------------------------------------ the artifact --
    --
    -- Exactly the existing synthesis contract, and nothing the contract does
    -- not earn. What produced it — model, provider, prompt, agent principal,
    -- evidence set — is reachable through the immutable run by this key, and
    -- copying it here would create a second place for provenance to be wrong.
    statement             text NOT NULL,
    position              text NOT NULL,
    rationale             text NOT NULL,
    invalidation_criteria text NOT NULL,
    -- Absent is absent. A synthesis with no stated horizon has none.
    horizon               text,
    implications          jsonb NOT NULL,
    dispositions          jsonb NOT NULL,
    optional_inputs       jsonb NOT NULL,
    input_run_ids         jsonb NOT NULL,

    -- ------------------------------------------- the institutional basis --
    --
    -- A synthesis is a product of the inputs it was allowed to synthesize, so
    -- the candidate carries them. `observed_completed_run_ids` is the exact
    -- universe the adoption command itself reasons over — every completed run
    -- on the case — captured at production. Adoption recomputes it and refuses
    -- on inequality, which is what makes a candidate produced against a
    -- superseded state unable to become the institution's conclusion for a
    -- newer one.
    source_revision_id         text NOT NULL
        REFERENCES analysis.thesis_revisions (revision_id),
    playbook_id                text NOT NULL,
    playbook_version           text NOT NULL,
    observed_completed_run_ids jsonb NOT NULL,

    -- ------------------------------------------------------- identity --
    --
    -- The digest covers the artifact AND the basis together. Two identical
    -- paragraphs produced against different institutional inputs are different
    -- candidates, and a content identity that could not tell them apart would
    -- be a hash of prose rather than of a synthesis.
    content_hash             text NOT NULL,
    canonicalization_version text NOT NULL,
    produced_at              timestamptz NOT NULL,

    FOREIGN KEY (case_id, tenant_id) REFERENCES analysis.cases (id, tenant_id),

    CONSTRAINT produced_syntheses_statement_stated
        CHECK (btrim(statement) <> ''),
    CONSTRAINT produced_syntheses_position_stated
        CHECK (btrim(position) <> ''),
    CONSTRAINT produced_syntheses_rationale_stated
        CHECK (btrim(rationale) <> ''),
    CONSTRAINT produced_syntheses_invalidation_stated
        CHECK (btrim(invalidation_criteria) <> ''),
    -- A stated horizon is stated. An empty string is neither a horizon nor an
    -- absence, and storing one would make the two indistinguishable.
    CONSTRAINT produced_syntheses_horizon_stated
        CHECK (horizon IS NULL OR btrim(horizon) <> ''),

    CONSTRAINT produced_syntheses_implications_array
        CHECK (jsonb_typeof(implications) = 'array'),
    CONSTRAINT produced_syntheses_dispositions_array
        CHECK (jsonb_typeof(dispositions) = 'array'),
    CONSTRAINT produced_syntheses_optional_inputs_array
        CHECK (jsonb_typeof(optional_inputs) = 'array'),
    CONSTRAINT produced_syntheses_input_runs_array
        CHECK (jsonb_typeof(input_run_ids) = 'array'),
    CONSTRAINT produced_syntheses_observed_runs_array
        CHECK (jsonb_typeof(observed_completed_run_ids) = 'array'),

    -- Lowercase hex, so a digest computed by a different encoding is refused
    -- rather than stored beside the ones that were not.
    CONSTRAINT produced_syntheses_content_hash_shape
        CHECK (content_hash ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE analysis.produced_syntheses IS
    'A Research Office synthesis a model produced and no principal has yet '
    'adopted. Operational, not institutional: nothing in the institution has a '
    'foreign key into it except the aggregation that adopted it.';

-- Read by run, and only by run. The primary key serves that, so there is no
-- further index — and specifically no listing by case, for the reason
-- `produced_claims` has none: a convenient case-wide listing is the first step
-- towards treating unadopted work as though it were the firm's position.

-- The runtime records what a desk produced and reads it back to adopt it. It
-- never updates and never deletes: an unadopted candidate stays exactly as it
-- was produced, which is what makes it evidence about the agent.
GRANT SELECT, INSERT ON analysis.produced_syntheses TO finos_app;
GRANT SELECT ON analysis.produced_syntheses TO finos_readonly;

-- ================================================== the adoption back-link ==

/*
 * Which candidate became this synthesis.
 *
 * Nullable, because a human manager may still author and stand behind a
 * synthesis directly — that path is unchanged and generates no candidate. No
 * historical aggregation is given a synthetic one.
 *
 * UNIQUE, because a candidate is adopted once. Two aggregations claiming the
 * same produced synthesis would be two institutional positions asserting the
 * same origin, which is not a record.
 *
 * The point of the column is that the institution can prove
 * `model artifact` to `this exact persisted candidate` to `this exact
 * institutional synthesis` by join. Matching prose is not proof; it is a coincidence that
 * usually holds.
 */
ALTER TABLE analysis.aggregations
    ADD COLUMN synthesis_run_id text
        REFERENCES analysis.produced_syntheses (run_id),
    ADD CONSTRAINT aggregations_one_per_synthesis UNIQUE (synthesis_run_id);

/*
 * No `GRANT UPDATE` here, and deliberately. `analysis.aggregations` has held
 * `SELECT, INSERT` and nothing else since `0018`: an aggregation is a judgement
 * at a moment, and a changed judgement is a new aggregation. The back-link is
 * written by the insert that creates the aggregation.
 */

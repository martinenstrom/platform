-- Durable observations: the facts the institution has acquired.
--
-- Until now an observation existed only INSIDE an evidence set. The same ECB
-- print used by two sets was stored twice under two set ids, and no table was
-- keyed by the observation itself — so a time series, a revision history, and
-- "what did the firm know in March" were all unanswerable.
--
-- This table is the observation standing on its own. It is NOT an evidence set
-- and not a step toward becoming one: acquiring an observation and declaring a
-- body of evidence fit for analysis are two different institutional acts
-- (docs/phase-c3-evidence-gate.md §0.3). `analysis.evidence_items` is untouched
-- by this migration; linking the two belongs to Stage B.
--
-- ## Three times, none of which is the others
--
--   reference_period  what the figure DESCRIBES  — identity
--   observed_at       when the SOURCE published  — provenance
--   recorded_at       when the FIRM learned it   — institutional knowledge time
--
-- The third is why this table is bitemporal. Without it the firm can say what
-- it believes now and never what it believed when a decision was taken.

CREATE TABLE analysis.observations (
    -- Hash of the natural key. Stable across re-retrieval, forever.
    observation_id   text NOT NULL,
    -- Hash of the normalized value. Differs iff the observation was revised.
    -- Part of the PRIMARY KEY, which is what makes a revision an additional
    -- record rather than a replacement: same observation_id, second row.
    content_hash     text NOT NULL,

    -- Which key rule minted `observation_id`. Verification recomputes under the
    -- row's OWN generation; see migration 0030.
    key_generation   smallint NOT NULL,

    -- The natural key, relationally, because the series query reads it.
    subject_kind     text NOT NULL,
    subject          text NOT NULL,
    kind             text NOT NULL,
    source_id        text NOT NULL,
    series_id        text,
    -- `par-yield` and `zero-coupon-fitted` are two different things.
    methodology      text,
    -- v2 identity coordinate. NULL exactly when the row is v1, as in 0030.
    reference_period text,

    -- When the source published this version. Provenance under v2, and NOT
    -- identity — which is precisely what lets a revision published later keep
    -- the same observation_id.
    observed_at      timestamptz NOT NULL,

    -- When the institution first learned this version.
    --
    -- Never identity: two firms ingesting the same print on different days hold
    -- one observation learned at two moments. This is the knowledge-time
    -- coordinate the bitemporal query reads, and the one coordinate that cannot
    -- be reconstructed after the fact.
    recorded_at      timestamptz NOT NULL,

    -- The ingestion run that FIRST recorded it. Traceability, never identity —
    -- the same rule evidence_sets.correlation_id follows. A later run that
    -- re-retrieves an unchanged figure does not replace it.
    correlation_id   text NOT NULL,

    -- The normalized domain value and the source's own provenance. Read whole,
    -- never queried into, so jsonb — the same choice evidence_items makes.
    value            jsonb NOT NULL,
    provenance       jsonb NOT NULL,

    -- The code that wrote the row, as every other institutional record carries.
    provenance_id    text NOT NULL REFERENCES analysis.storage_provenance (id),

    -- A revision is a SECOND row for one observation, never an overwrite.
    PRIMARY KEY (observation_id, content_hash),

    CONSTRAINT observations_provenance_is_object CHECK (
        jsonb_typeof(provenance) = 'object'
    ),
    -- The same generation shape migration 0030 binds on evidence_items. A v2
    -- row without a reference period could not be verified at all, because the
    -- key it claims to hash would not exist.
    CONSTRAINT observations_key_generation_shape CHECK (
        (key_generation = 1 AND reference_period IS NULL)
        OR (key_generation = 2 AND reference_period IS NOT NULL)
    )
);

-- The series query: everything one source published about one subject across a
-- range of reference periods. Ordered by reference period because that is what
-- a series is ordered by — publication order and reference order diverge
-- exactly when a revision arrives, which is the case worth getting right.
--
-- `recorded_at` is in the index because the bitemporal filter reads it on the
-- same scan: "as the firm knew it on this date" must not become a sort of the
-- whole table.
CREATE INDEX observations_series_idx
    ON analysis.observations
       (subject, kind, source_id, reference_period, recorded_at);

-- The revision history of one fact, oldest first.
CREATE INDEX observations_revisions_idx
    ON analysis.observations (observation_id, recorded_at);

-- -------------------------------------------------------------------- grants

-- SELECT and INSERT only. **No GRANT UPDATE and no GRANT DELETE**, and that is
-- the enforcement rather than a convention: a revision is a new row, so nothing
-- the application can issue is able to overwrite or remove a published value.
-- The privilege the store does not hold is the one it cannot misuse.
GRANT SELECT, INSERT ON analysis.observations TO finos_app;

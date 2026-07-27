-- Evidence sets: what a department was given to reason over.
--
-- Immutable and content-addressed. The set's id is a hash of its contents, so
-- "which evidence was this claim made against" has an exact answer and a
-- cached agent result can be keyed on it. Two cases assembled from the same
-- observations share one row — deduplication is the primary key doing its job.
--
-- Because a set is immutable, writes never conflict and never need a
-- transaction with the case: a set written by an abandoned command is harmless
-- garbage rather than a partial write.

CREATE TABLE analysis.evidence_sets (
    -- Content hash of the whole set.
    id             text PRIMARY KEY,
    -- When the set was assembled — not when anything was observed.
    assembled_at   timestamptz NOT NULL,
    -- The resolution run that produced it. Traceability, never identity.
    correlation_id text NOT NULL,

    -- Observations rarely share a timestamp. A Friday equity close beside a
    -- Sunday ECB carry-forward is a 48-hour spread, and an agent comparing
    -- them must be told rather than left to assume. Read whole, never queried
    -- into, so jsonb.
    co_temporality jsonb NOT NULL,
    -- Where two sources cover the same subject and disagree, both are kept and
    -- the conflict recorded. Never averaged away.
    disagreements  jsonb NOT NULL DEFAULT '[]'::jsonb,

    CONSTRAINT evidence_sets_co_temporality_is_object CHECK (
        jsonb_typeof(co_temporality) = 'object'
    ),
    CONSTRAINT evidence_sets_disagreements_is_array CHECK (
        jsonb_typeof(disagreements) = 'array'
    )
);

CREATE TABLE analysis.evidence_items (
    evidence_set_id text NOT NULL REFERENCES analysis.evidence_sets (id),
    -- Hash of the observation's natural key. Stable across re-retrieval.
    observation_id  text NOT NULL,

    -- The natural key, relationally, because the Fact Checker queries it:
    -- "what else did we hold about this subject at this moment".
    subject_kind    text NOT NULL,
    subject         text NOT NULL,
    kind            text NOT NULL,
    -- The SOURCE's observation time, never our retrieval time.
    observed_at     timestamptz NOT NULL,
    source_id       text NOT NULL,
    series_id       text,
    -- `par-yield` and `zero-coupon-fitted` are two different things, and a
    -- comparison across them is a methodology error the verifier looks for.
    methodology     text,

    -- Hash of the normalized value. Differs iff the observation was revised.
    content_hash    text NOT NULL,

    -- The normalized domain value — a MarketQuote, a GovernmentYield, a policy
    -- state. Its shape differs per observation kind, and nothing queries into
    -- it, so modelling it relationally would mean a table per domain type for
    -- data only ever read whole.
    value           jsonb NOT NULL,
    provenance      jsonb NOT NULL,

    PRIMARY KEY (evidence_set_id, observation_id),
    CONSTRAINT evidence_items_provenance_is_object CHECK (
        jsonb_typeof(provenance) = 'object'
    )
);

CREATE INDEX evidence_items_set_idx ON analysis.evidence_items (evidence_set_id);
-- The revision detector: same identity, different content.
CREATE INDEX evidence_items_observation_idx
    ON analysis.evidence_items (observation_id, content_hash);

-- The v2 observation key: what an observation DESCRIBES, and which rule minted it.
--
-- C3 replaced `observedAt` in the observation natural key with
-- `reference_period` — the period the source published ABOUT, rather than when
-- it published. Two things forced it, both measured before the change:
--
--   A revision publishes LATER. With observedAt in the key, a revised release
--   minted a fresh id and read as an unrelated observation, so a claim citing
--   the original resolved cleanly to a figure that had since moved.
--
--   Two authoritative sources publish the same reference-period figure hours
--   apart. Disagreement was grouped on observedAt, so it found nothing.
--
-- See docs/phase-c3-evidence-gate.md §0.6 and its amendment.
--
-- ## Nothing here rewrites history
--
-- Existing rows are v1 and are LABELLED as v1, not converted. Their ids stay
-- byte-identical, their citations keep resolving, and `observationRefV1`
-- reproduces them exactly — the identity corpus pins that. An id whose meaning
-- changed without its generation changing is precisely the ambiguity
-- versioning exists to prevent, so the default below is a statement of fact
-- about what those rows already are.

ALTER TABLE analysis.evidence_items
    -- Which key rule minted this observation's id. Read by verification, which
    -- recomputes under the row's OWN generation: a v1 row checked against the
    -- v2 rule would fail every time and read as tampering.
    ADD COLUMN key_generation smallint NOT NULL DEFAULT 1,

    -- The period the observation describes, as the source states it —
    -- '2026-08-14' for a daily figure, '2026-Q2' for a quarterly one. Text
    -- rather than a date: a reference PERIOD is not always a day, and coercing
    -- a quarter into one of its dates would invent precision the source never
    -- published.
    --
    -- NULL exactly when the row is v1. A v2 row without one could not be
    -- verified at all, because the key it claims to hash would not exist.
    ADD COLUMN reference_period text;

-- The generations are closed and each has its own shape. Without this a v2 row
-- could be written with no reference period and would fail verification on
-- read — a write that succeeds and a read that cannot is the worst pairing.
ALTER TABLE analysis.evidence_items
    ADD CONSTRAINT evidence_items_key_generation_shape CHECK (
        (key_generation = 1 AND reference_period IS NULL)
        OR (key_generation = 2 AND reference_period IS NOT NULL)
    );

-- The series query C3 exists to make possible: "what did this source publish
-- about this subject, across these periods". Ordered by reference period
-- because that is what a series is ordered by — publication order and
-- reference order differ exactly when a revision arrives, which is the case
-- worth getting right.
CREATE INDEX evidence_items_series_idx
    ON analysis.evidence_items (subject, kind, source_id, reference_period)
    WHERE key_generation = 2;

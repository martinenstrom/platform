-- Evidence items link to observations rather than copying them.
--
-- Ruled in docs/phase-c3-evidence-gate.md §0.3b: **forward only, no backfill.**
--
-- Until now an evidence item carried its own `value` and `provenance`. With
-- `analysis.observations` in place that would be two records of one fact — and
-- the requirement is that there be one institutional truth for what an
-- observation said.
--
-- ## Why the columns are made nullable rather than dropped
--
-- Rows that predate the observation store have no observation to link to, and
-- one cannot be manufactured for them. The only knowledge time available for
-- such a row is its set's `assembled_at`, which is an UPPER BOUND on when the
-- firm learned the figure rather than the fact — and storing a bound as though
-- it were exact is what this codebase refuses everywhere else.
--
-- So two shapes coexist:
--
--   linked   value IS NULL      -> the payload lives in analysis.observations
--   legacy   value IS NOT NULL  -> a pre-C3 row, kept exactly as written
--
-- The branch is bounded, not permanent debt: the legacy shape is a CLOSED set
-- that can never grow, because every new assembly links.

ALTER TABLE analysis.evidence_items
    ALTER COLUMN value DROP NOT NULL,
    ALTER COLUMN provenance DROP NOT NULL;

-- Which shape a row is, stated rather than inferred from a NULL.
--
-- A reader could test `value IS NULL`, and that is exactly the fragile check
-- this column removes: it makes "the payload is elsewhere" indistinguishable
-- from "the payload went missing", and the two need different responses.
ALTER TABLE analysis.evidence_items
    ADD COLUMN links_observation boolean NOT NULL DEFAULT false;

-- The two shapes, each complete in its own terms. A linked row carries no
-- payload; a legacy row carries one. Neither may be half-formed.
ALTER TABLE analysis.evidence_items
    ADD CONSTRAINT evidence_items_shape CHECK (
        (links_observation AND value IS NULL AND provenance IS NULL)
        OR (NOT links_observation AND value IS NOT NULL AND provenance IS NOT NULL)
    );

/*
 * The linkage itself.
 *
 * `(observation_id, content_hash)` is already the primary key of
 * analysis.observations, and it is already what an evidence item carries — so
 * the link needs no new column, only the guarantee that it resolves.
 *
 * NOT a table-level FOREIGN KEY, deliberately. A foreign key would apply to
 * every row including the legacy ones, which have no observation to point at,
 * and making it nullable-by-shape is not something a table constraint can
 * express. The guarantee is enforced where it can be complete: the assembly
 * command resolves every observation before it writes, and the read path
 * refuses a linked row whose observation is missing rather than returning an
 * item with no payload.
 */
CREATE INDEX evidence_items_observation_link_idx
    ON analysis.evidence_items (observation_id, content_hash)
    WHERE links_observation;

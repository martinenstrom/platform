-- The assembly act: who declared a body of evidence fit for analysis, and why
-- those observations and not others.
--
-- Ruled in docs/phase-c3-evidence-gate.md §0.3: `AssembleEvidenceSet` takes a
-- QUERY, never a caller-selected list of observation ids, and **the selection
-- rule itself is durably recorded and versioned**. Membership answers what the
-- firm reasoned over; only the rule answers whether anything was left out. A
-- set whose membership can be seen and whose selection cannot be reproduced is
-- a set nobody can defend.
--
-- ## Why this is keyed by the ACT and not by the evidence set
--
-- An evidence set id is a content hash of its membership. Two selections that
-- happen to select the same observations are therefore ONE artifact reached by
-- TWO acts — possibly by two people, possibly under two rules. Keying this
-- table on evidence_set_id would force one act to overwrite the other or to be
-- silently dropped, and neither is what happened.
--
-- So: one row per act, pointing at the set. A set may be reached by several
-- rows, and a pre-C3 set is reached by none — which is the honest answer for a
-- set nobody assembled through this act. Nothing here is backfilled, for the
-- reason migration 0032 states about knowledge time.
--
-- ## Why the columns are relational rather than one jsonb blob
--
-- The selection is READ as a record — "which rule produced this set", "what
-- window", "as the firm knew it when" — and a reviewer asking those questions
-- should not have to know a payload shape. jsonb here would also make the rule
-- id unqueryable, which is exactly what a versioned rule needs to be when its
-- successor arrives.

CREATE TABLE analysis.evidence_assemblies (
    -- Derived from the command id, so a retry addresses this record rather
    -- than filing a second act nobody performed.
    assembly_id                text PRIMARY KEY,

    -- The set this act produced. A real foreign key: an assembly pointing at a
    -- set the firm does not hold would be a record of nothing.
    evidence_set_id            text NOT NULL
                               REFERENCES analysis.evidence_sets (id),

    -- The versioned selection rule. The version is INSIDE the id, exactly as
    -- `spread-2s10s@1` carries its own — a change to what the rule selects is a
    -- new rule, never a silent restatement of sets already assembled.
    rule_id                    text NOT NULL,
    -- The family the rule expanded. A family, never a list of observation ids.
    subject_family             text NOT NULL,
    -- Inclusive reference-period window, compared as text exactly as the
    -- observation store compares it.
    window_from                text NOT NULL,
    window_to                  text NOT NULL,
    -- What the institution knew when it selected. Resolved and stored even when
    -- the caller named none: "latest known" is only reproducible if the moment
    -- that phrase referred to is written down.
    known_at                   timestamptz NOT NULL,

    -- What the family expanded to as it ran, so a later reader can tell an
    -- empty tenor from a tenor the rule never asked for.
    selected_subjects          text[] NOT NULL,
    -- What the query returned, and what the act derived from it. Counts rather
    -- than a second membership list: analysis.evidence_items already holds
    -- membership, and two records of one fact is what C3 exists to remove.
    observation_count          integer NOT NULL,
    derived_count              integer NOT NULL,

    assembled_at               timestamptz NOT NULL,
    -- The person who declared this body of evidence fit for analysis, and the
    -- authority they held. Ingestion records; assembly judges, and a judgement
    -- without a name on it is the thing this table exists to prevent.
    actor_employee_id          text NOT NULL,
    on_behalf_of_department_id text NOT NULL,
    correlation_id             text NOT NULL,
    -- The code that wrote the row, as every other institutional record carries.
    provenance_id              text NOT NULL
                               REFERENCES analysis.storage_provenance (id),

    CONSTRAINT evidence_assemblies_window_ordered CHECK (window_from <= window_to),
    -- A set nobody could have reasoned over is not a body of evidence. The
    -- command refuses an empty selection; this is the store saying the same
    -- thing, so a future writer cannot reach past it.
    CONSTRAINT evidence_assemblies_not_empty CHECK (observation_count > 0),
    CONSTRAINT evidence_assemblies_derived_counted CHECK (derived_count >= 0)
);

-- "Which acts produced this set", newest first. The reviewer's question.
CREATE INDEX evidence_assemblies_set_idx
    ON analysis.evidence_assemblies (evidence_set_id, assembled_at DESC);

-- "What has the firm assembled lately", for the surface that offers them.
CREATE INDEX evidence_assemblies_recent_idx
    ON analysis.evidence_assemblies (assembled_at DESC);

-- SELECT and INSERT only, as analysis.observations is granted. An act that
-- could be edited after the fact is not a record of an act. The privilege the
-- application does not hold is the one it cannot misuse.
GRANT SELECT, INSERT ON analysis.evidence_assemblies TO finos_app;

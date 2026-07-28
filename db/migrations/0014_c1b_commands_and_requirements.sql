-- Phase C1B: command reason and category, two kinds of playbook edge, and the
-- resolution of conditional requirements.
--
-- ## Why the ledger columns land now rather than later
--
-- `analysis.commands` is immutable and append-only. A column added after
-- commands exist gives every earlier record a permanent hole — "why was this
-- issued" would be unanswerable for exactly the period before someone thought
-- to ask. The ledger is empty in every environment today, so this costs one
-- migration and nothing else. It will never be this cheap again.
--
-- Both columns are nullable in the schema. Whether a reason is required is a
-- property of the COMMAND, not of the table: `BlockCase` owes one and
-- `OpenInvestmentCase` does not, and a NOT NULL here could only be satisfied
-- by writing an empty string, which is worse than an honest null. The command
-- layer enforces the policy in all three directions.

-- ------------------------------------------------- command reason & category

ALTER TABLE analysis.commands
    ADD COLUMN reason   text,
    ADD COLUMN category text;

-- Backfill: none possible and none needed. Verified rather than assumed —
-- if a row exists, this migration is running somewhere its author did not
-- expect and the assumption above is false.
DO $$
DECLARE existing bigint;
BEGIN
    SELECT count(*) INTO existing FROM analysis.commands;
    IF existing > 0 THEN
        RAISE EXCEPTION
            'analysis.commands holds % rows. 0014 assumes an empty ledger '
            'because contract-version 1 records carry neither reason nor '
            'category, and inventing values for them would fabricate history.',
            existing;
    END IF;
END $$;

ALTER TABLE analysis.commands
    -- A stated reason is a real one. Blank is not a reason, and permitting it
    -- would let a required explanation be satisfied by a space bar.
    ADD CONSTRAINT commands_reason_not_blank CHECK (
        reason IS NULL OR btrim(reason) <> ''
    ),
    ADD CONSTRAINT commands_category_known CHECK (
        category IS NULL OR
        category IN ('analysis', 'workflow', 'governance', 'decision', 'system')
    ),
    /*
     * The taxonomy cannot contradict the authority.
     *
     * The command layer checks this before writing; the database checks it
     * again because a mislabelled act in an immutable ledger cannot be
     * corrected, only annotated. Both directions: a governance verdict is
     * filed as governance, and nothing else may be.
     */
    ADD CONSTRAINT commands_category_matches_mandate CHECK (
        category IS NULL OR (
            (mandate_kind = 'governance-verdict') = (category = 'governance')
            AND (mandate_kind = 'chief-decision') = (category = 'decision')
            AND (mandate_kind = 'system-operation') = (category = 'system')
        )
    );

-- "Every governance action on this case" is one predicate rather than a list
-- of command types that grows.
CREATE INDEX commands_category_idx ON analysis.commands (category, occurred_at DESC);

-- ------------------------------------------------------ playbook versioning

-- Content address of the entries and their edges. Registering "v1" twice with
-- different content is a conflict rather than a silently divergent workflow.
ALTER TABLE analysis.playbook_versions
    ADD COLUMN content_hash text;

DO $$
DECLARE existing bigint;
BEGIN
    SELECT count(*) INTO existing FROM analysis.playbook_versions;
    IF existing > 0 THEN
        RAISE EXCEPTION
            'analysis.playbook_versions holds % rows. Their content hash '
            'cannot be derived from the schema, and computing one from the '
            'current entries would assert that they were never edited.',
            existing;
    END IF;
END $$;

ALTER TABLE analysis.playbook_versions
    ALTER COLUMN content_hash SET NOT NULL;

-- ---------------------------------------------------- three requirement levels

-- `required boolean` cannot express the approved Macro workflow, in which Risk
-- Review is conditionally required. Dropped rather than translated: a boolean
-- column left beside the new one is a second source of truth waiting to
-- disagree.
ALTER TABLE analysis.playbook_entries
    DROP COLUMN required,
    ADD COLUMN requirement text NOT NULL,
    -- The rule that decides a conditional entry, at an exact version. Rule
    -- versions are never removed, so a resolution recorded under one stays
    -- explainable.
    ADD COLUMN conditional_rule_id      text,
    ADD COLUMN conditional_rule_version text,

    ADD CONSTRAINT playbook_entries_requirement_known CHECK (
        requirement IN ('required', 'optional', 'conditional')
    ),
    /*
     * A conditional entry names its rule; nothing else may. An entry that is
     * plainly required but carries a rule reference would read as a gate that
     * never runs.
     */
    ADD CONSTRAINT playbook_entries_conditional_names_rule CHECK (
        (requirement = 'conditional') =
        (conditional_rule_id IS NOT NULL AND conditional_rule_version IS NOT NULL)
    );

-- ------------------------------------------------------ blocking vs optional

/*
 * An edge is a hard dependency or an optional input, never both.
 *
 * One `dependsOn` list forced a choice between two bad outcomes: either
 * Research Office blocks on Quant and the case stalls forever when Quant has
 * nothing to add, or Quant is not a dependency at all and its absence
 * disappears from the record. The primary key already spans (entry, depends_on),
 * so one pair cannot be declared twice with different kinds.
 */
ALTER TABLE analysis.playbook_entry_dependencies
    ADD COLUMN kind text NOT NULL DEFAULT 'blocking',
    ADD CONSTRAINT playbook_entry_dependency_kind_known CHECK (
        kind IN ('blocking', 'optional-input')
    );

-- The default existed only to add the column to a table whose rows predate the
-- distinction. New rows state their kind.
ALTER TABLE analysis.playbook_entry_dependencies
    ALTER COLUMN kind DROP DEFAULT;

-- --------------------------------------------- conditional requirement results

/*
 * Whether a conditional entry applied to one exact thesis revision.
 *
 * Stored rather than recomputed, and that is the whole point of the table.
 * Recomputing from the current thesis whenever the headquarters loads would
 * let historical eligibility drift: a revision that later adds position sizing
 * would retroactively make Risk "always required", including for the period
 * when it demonstrably was not. Changing the rule would rewrite the past the
 * same way.
 *
 * ABSENCE means not yet evaluated. An explicit 'not-required' row means the
 * firm looked and decided. Collapsing those would make "Risk was skipped"
 * indistinguishable from "Risk was forgotten".
 *
 * Scoped to `revision_id`, never to the lineage — so a new revision has no row
 * and the gate reopens without anyone having to remember to reopen it.
 */
CREATE TABLE analysis.requirement_resolutions (
    case_id            text NOT NULL,
    tenant_id          text NOT NULL REFERENCES analysis.tenants (id),
    playbook_entry_key text NOT NULL,
    revision_id        text NOT NULL REFERENCES analysis.thesis_revisions (revision_id),

    state              text NOT NULL,
    -- The rule that decided it, at the version that actually ran. Preserved so
    -- that improving the rule next year does not rewrite why Risk was or was
    -- not required last year.
    rule_id            text NOT NULL,
    rule_version       text NOT NULL,
    reason             text NOT NULL,
    evaluated_at       timestamptz NOT NULL,

    /*
     * The evaluator, snapshotted, for the same reason command actors are: if
     * they later change department, this must still show the authority the
     * evaluation ran under.
     */
    evaluated_by_employee_id   text NOT NULL REFERENCES analysis.employees (id),
    evaluated_by_role_id       text NOT NULL,
    evaluated_by_role_function text NOT NULL,
    evaluated_by_department_id text NOT NULL,
    evaluated_by_department_is_governance boolean NOT NULL,
    evaluated_by_department_handles text[] NOT NULL,
    evaluated_by_authentication text NOT NULL,
    organization_seed_version  text NOT NULL,

    provenance_id      text NOT NULL REFERENCES analysis.storage_provenance (id),

    -- One resolution per entry per exact revision.
    PRIMARY KEY (case_id, playbook_entry_key, revision_id),

    -- The tenant is provably the case's own, not a denormalized copy that can
    -- drift.
    FOREIGN KEY (case_id, tenant_id) REFERENCES analysis.cases (id, tenant_id),

    CONSTRAINT requirement_resolutions_state_known CHECK (
        state IN ('required', 'not-required')
    ),
    CONSTRAINT requirement_resolutions_reason_not_blank CHECK (
        btrim(reason) <> ''
    ),
    -- Nothing is ever described as an authenticated user while TD-8 is open.
    CONSTRAINT requirement_resolutions_authentication_known CHECK (
        evaluated_by_authentication = 'system-asserted'
    )
);

CREATE INDEX requirement_resolutions_revision_idx
    ON analysis.requirement_resolutions (revision_id);
CREATE INDEX requirement_resolutions_case_idx
    ON analysis.requirement_resolutions (case_id, playbook_entry_key);

/*
 * Write-once. A deterministic rule cannot legitimately produce two answers for
 * one (entry, revision, rule version), so a second write with different
 * content is a real disagreement and must fail rather than overwrite. An
 * institutional gate that can be re-decided in place is not a gate.
 */
CREATE FUNCTION analysis.refuse_resolution_rewrite()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'analysis.requirement_resolutions is write-once. Whether a governance '
        'gate applied to a specific revision is a recorded judgement; a later '
        'revision gets its own resolution rather than editing this one.'
        USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE TRIGGER requirement_resolutions_immutable
    BEFORE UPDATE OR DELETE ON analysis.requirement_resolutions
    FOR EACH ROW EXECUTE FUNCTION analysis.refuse_resolution_rewrite();

-- ------------------------------------------------------------ thesis fields

/*
 * What acting on the revision would imply, declared rather than inferred.
 *
 * The conditional Risk rule reads this. A rule that scanned the statement for
 * words like "hedge" would depend on how a sentence happened to be phrased —
 * non-deterministic in practice and impossible to audit. An empty array is a
 * declaration ("descriptive analysis, nothing to act on"), which is why the
 * column is NOT NULL: the absence of thought must not look like the presence
 * of a decision.
 */
ALTER TABLE analysis.thesis_revisions
    ADD COLUMN implications text[] NOT NULL DEFAULT '{}';

ALTER TABLE analysis.thesis_revisions
    ALTER COLUMN implications DROP DEFAULT;

ALTER TABLE analysis.thesis_revisions
    ADD CONSTRAINT thesis_revisions_implications_known CHECK (
        implications <@ ARRAY[
            'actionable-recommendation', 'asset-allocation', 'position-sizing',
            'hedging', 'leverage', 'liquidity-impact', 'portfolio-risk',
            'implementation-path'
        ]::text[]
    );

-- --------------------------------------------------------- pinning a playbook

/*
 * A case pins its playbook AFTER it exists.
 *
 * 0009 granted UPDATE only on (stage, version, closed_at), on the reasoning
 * that "subject, question, owner and playbook are what the case IS" — which
 * assumed the playbook was chosen when the case was created. It is not:
 * `intake` is a legal resting state meaning received but not yet assigned, and
 * a manager may legitimately defer the playbook choice. Without this grant,
 * InstantiatePlaybook would be refused by the database.
 *
 * The original intent is preserved by the trigger below rather than by the
 * missing grant: a case may be pinned once, and a pinned case can never be
 * re-pinned. Editing the version a case is running under is exactly the thing
 * playbook versioning exists to prevent.
 */
GRANT UPDATE (playbook_id, playbook_version) ON analysis.cases TO finos_app;

CREATE FUNCTION analysis.refuse_playbook_repin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.playbook_id IS NOT NULL
       AND (NEW.playbook_id, NEW.playbook_version)
           IS DISTINCT FROM (OLD.playbook_id, OLD.playbook_version) THEN
        RAISE EXCEPTION
            'Case % is already running under playbook %@%. A case runs to '
            'completion on the version it was instantiated from; moving it '
            'would rewrite which workflow its existing assignments came from.',
            OLD.id, OLD.playbook_id, OLD.playbook_version
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER cases_playbook_pinned_once
    BEFORE UPDATE ON analysis.cases
    FOR EACH ROW EXECUTE FUNCTION analysis.refuse_playbook_repin();

-- ---------------------------------------------------------------- grants --

-- Insert and read only, like every other institutional record. Nothing may
-- edit a resolution and nothing may delete one.
GRANT SELECT, INSERT ON analysis.requirement_resolutions TO finos_app;
GRANT SELECT ON analysis.requirement_resolutions TO finos_readonly;

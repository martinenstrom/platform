/*
 * 0020 -- the CIO submission, the decision, and what justified it.
 *
 * Three shapes the previous schema could not express.
 *
 * **The outcome.** `selected_revision_id` was nullable, and null meant three
 * different things: every alternative declined, a deliberate wait, or a field
 * nobody filled in. Those are three institutional acts with three different
 * follow-ups, and a record that cannot tell them apart cannot be audited.
 * `outcome_kind` is explicit, and the per-kind rules are enforced here rather
 * than only in the command -- several of them span rows, so they are deferred
 * constraint triggers that fire at COMMIT.
 *
 * **Why it was eligible.** The basis lives on the SUBMISSION and nowhere else.
 * A decision reaches its eligibility evidence through the submissions it
 * references, one per considered revision, which is what lets the record answer
 * whether the ALTERNATIVES were eligible when they were passed over.
 *
 * **Dissent and reconsideration.** Both were `jsonb` arrays of prose. "Which
 * objections did the CIO decide past, and did they answer them" is the question
 * an institution is asked years later; behind a document it is a scan and a
 * parse. Both are relational now, and the `governance` document -- whose
 * compliance field had to be invented -- is dropped.
 *
 * Forward-only. No earlier migration is edited.
 */

-- ------------------------------------------------------- eligibility policy --

/*
 * Which gates were in force. A decision cites a version; this is what the
 * version resolves to, and the foreign keys below mean the database refuses one
 * that does not exist.
 *
 * `compliance = 'outside-policy-scope'` is the honest record and the reason
 * there is no compliance column anywhere in this migration. `not-required` is a
 * VERDICT -- it says a control function looked and decided review was
 * unnecessary. Nobody decided that.
 */
CREATE TABLE analysis.eligibility_policies (
    version              text PRIMARY KEY,
    gate                 text NOT NULL,
    verification         text NOT NULL,
    devils_advocate      text NOT NULL,
    risk                 text NOT NULL,
    compliance           text NOT NULL,
    challenge_blocks_at_or_above    text NOT NULL,
    disagreement_blocks_at_or_above text NOT NULL,
    unresolved_conditional_blocks   boolean NOT NULL,
    domain_contract_version text NOT NULL,

    CONSTRAINT eligibility_policies_participation_known CHECK (
        verification IN ('required', 'conditional-by-resolution', 'outside-policy-scope')
        AND devils_advocate IN ('required', 'conditional-by-resolution', 'outside-policy-scope')
        AND risk IN ('required', 'conditional-by-resolution', 'outside-policy-scope')
        AND compliance IN ('required', 'conditional-by-resolution', 'outside-policy-scope')
    ),
    CONSTRAINT eligibility_policies_materiality_known CHECK (
        challenge_blocks_at_or_above IN ('non-material', 'material', 'decision-critical')
        AND disagreement_blocks_at_or_above IN ('non-material', 'material', 'decision-critical')
    )
);

INSERT INTO analysis.eligibility_policies VALUES (
    '1', 'internal CIO decision',
    'required', 'required', 'conditional-by-resolution', 'outside-policy-scope',
    'material', 'decision-critical', true, '8'
);

-- --------------------------------------------------- canonical actor arrays --

/*
 * Organization insertion order is not institutional meaning.
 *
 * `departmentHandles` is a set: two snapshots listing the same disciplines in
 * different orders describe the same authority, and a restart comparison or a
 * payload hash that disagreed about them would be reporting a difference that
 * does not exist. Canonicalized before persistence, and checked here so the
 * database is the place it cannot be got round.
 *
 * A function rather than an inline CHECK because a CHECK may not contain a
 * subquery, and byte order needs one.
 */
CREATE FUNCTION analysis.is_canonically_sorted(handles text[])
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $fn$
    SELECT handles = (
        SELECT coalesce(array_agg(h ORDER BY h COLLATE "C"), '{}')
        FROM unnest(handles) AS h
    )
$fn$;

-- ------------------------------------------------------------ submissions --

/*
 * A revision put in front of the CIO. Separate from the decision because the
 * two are separate acts: submission says the work is ready to be decided, and
 * nothing about it decides anything.
 */
CREATE TABLE analysis.cio_submissions (
    id                         text PRIMARY KEY,
    case_id                    text NOT NULL,
    tenant_id                  text NOT NULL,
    thesis_id                  text NOT NULL,
    revision_id                text NOT NULL REFERENCES analysis.thesis_revisions (revision_id),
    submitted_by_department_id text NOT NULL REFERENCES analysis.departments (id),
    submitted_by_employee_id   text NOT NULL REFERENCES analysis.employees (id),
    submitted_at               timestamptz NOT NULL,
    case_version               integer NOT NULL,
    state                      text NOT NULL DEFAULT 'pending',

    /* ------------------------------------------------- eligibility basis */

    eligibility_policy_version text NOT NULL
        REFERENCES analysis.eligibility_policies (version),
    aggregation_id             text REFERENCES analysis.aggregations (id),
    verification_review_id     text REFERENCES analysis.reviews (id),
    verification_sequence      integer,
    verification_status        text,
    devils_advocate_review_id  text REFERENCES analysis.reviews (id),
    devils_advocate_sequence   integer,
    risk_review_id             text REFERENCES analysis.reviews (id),
    risk_sequence              integer,
    risk_status                text,
    risk_requirement           text NOT NULL,
    risk_rule_id               text,
    risk_rule_version          text,
    storage_provenance_id      text NOT NULL REFERENCES analysis.storage_provenance (id),
    -- Projection time. NOT when the revision became eligible, which nothing
    -- observes and which this column must never be read as.
    evaluated_at               timestamptz NOT NULL,

    FOREIGN KEY (case_id, tenant_id) REFERENCES analysis.cases (id, tenant_id),

    -- The composite keys `decision_submissions` uses to prove a submission
    -- belongs to the case and targets the revision the relation names.
    UNIQUE (id, case_id),
    UNIQUE (id, revision_id),

    CONSTRAINT cio_submissions_state_known CHECK (
        state IN ('pending', 'decided', 'returned')
    ),
    CONSTRAINT cio_submissions_risk_requirement_known CHECK (
        risk_requirement IN ('unresolved', 'not-required', 'required')
    ),
    /*
     * A submission exists only where eligibility held, and eligibility requires
     * a resolved Risk requirement. `unresolved` here would mean the gate was
     * skipped -- the exact failure the three-state Risk model exists to prevent.
     */
    CONSTRAINT cio_submissions_risk_resolved CHECK (risk_requirement <> 'unresolved'),
    -- Per-kind implications, so an unknown value trips exactly one constraint.
    CONSTRAINT cio_submissions_risk_required_names_review CHECK (
        risk_requirement <> 'required' OR risk_review_id IS NOT NULL
    ),
    CONSTRAINT cio_submissions_verification_complete CHECK (
        (verification_review_id IS NULL) = (verification_sequence IS NULL)
    )
);

CREATE INDEX cio_submissions_case_idx
    ON analysis.cio_submissions (case_id, submitted_at DESC, id COLLATE "C");
-- The CIO queue: everything waiting on a decision, cheaply.
CREATE INDEX cio_submissions_pending_idx
    ON analysis.cio_submissions (tenant_id, submitted_at)
    WHERE state = 'pending';

CREATE TABLE analysis.submission_required_work (
    submission_id      text NOT NULL REFERENCES analysis.cio_submissions (id),
    playbook_entry_key text NOT NULL,
    run_id             text NOT NULL REFERENCES analysis.runs (id),

    PRIMARY KEY (submission_id, playbook_entry_key)
);

CREATE TABLE analysis.submission_disagreements (
    submission_id text NOT NULL REFERENCES analysis.cio_submissions (id),
    claim_id      text NOT NULL REFERENCES analysis.claims (id),
    materiality   text NOT NULL,

    PRIMARY KEY (submission_id, claim_id),
    CONSTRAINT submission_disagreements_materiality_known CHECK (
        materiality IN ('non-material', 'material', 'decision-critical')
    ),
    /*
     * A decision-critical disagreement blocks eligibility, so it cannot be on a
     * submission. Storable only if the gate was bypassed.
     */
    CONSTRAINT submission_disagreements_not_decision_critical CHECK (
        materiality <> 'decision-critical'
    )
);

CREATE TABLE analysis.submission_evidence (
    submission_id   text NOT NULL REFERENCES analysis.cio_submissions (id),
    evidence_set_id text NOT NULL REFERENCES analysis.evidence_sets (id),

    PRIMARY KEY (submission_id, evidence_set_id)
);

CREATE TABLE analysis.submission_open_challenges (
    submission_id text NOT NULL REFERENCES analysis.cio_submissions (id),
    challenge_id  text NOT NULL REFERENCES analysis.challenges (id),

    PRIMARY KEY (submission_id, challenge_id)
);

-- --------------------------------------------------------------- returns --

/*
 * The CIO sending work back. Not a decision: the material was not ready to be
 * decided, which is a different statement from deciding to wait.
 *
 * **It creates no assignment and carries no addressed flag.** Whether a return
 * has been answered is derived from a later submission. A stored flag would be
 * a lifecycle no command owns, and a `requested_department_id` column would be
 * worse than nothing -- it would look like routing that does not happen. TD-43
 * is the capability that turns a return into assigned work.
 */
CREATE TABLE analysis.cio_returns (
    id                  text PRIMARY KEY,
    submission_id       text NOT NULL REFERENCES analysis.cio_submissions (id),
    case_id             text NOT NULL,
    tenant_id           text NOT NULL,
    revision_id         text NOT NULL REFERENCES analysis.thesis_revisions (revision_id),
    returned_at         timestamptz NOT NULL,

    -- The CIO as the organization described them, mirroring ActorSnapshot.
    returned_by_employee_id  text NOT NULL REFERENCES analysis.employees (id),
    returned_by_role_id      text,
    returned_by_role_function text,
    returned_by_department_id text REFERENCES analysis.departments (id),
    returned_by_department_is_governance boolean,
    -- Canonically sorted before persistence: organization insertion order is
    -- not institutional meaning.
    returned_by_department_handles text[] NOT NULL DEFAULT '{}',
    organization_seed_version text NOT NULL,
    -- Never 'authenticated' while TD-8 is open, and stored verbatim so the
    -- record cannot imply a check the runtime did not perform.
    authentication      text NOT NULL,
    authorization_basis text NOT NULL,

    returned_for        text NOT NULL,
    reason              text NOT NULL,
    case_version        integer NOT NULL,

    FOREIGN KEY (case_id, tenant_id) REFERENCES analysis.cases (id, tenant_id),

    CONSTRAINT cio_returns_reason_present CHECK (btrim(reason) <> ''),
    CONSTRAINT cio_returns_for_known CHECK (
        returned_for IN ('insufficient-evidence', 'unaddressed-dissent',
                         'scope-too-narrow', 'alternative-not-considered',
                         'timing', 'aggregation-incomplete')
    ),
    CONSTRAINT cio_returns_handles_sorted CHECK (
        analysis.is_canonically_sorted(returned_by_department_handles)
    )
);

CREATE INDEX cio_returns_case_idx ON analysis.cio_returns (case_id, returned_at DESC);

CREATE TABLE analysis.cio_return_concerns (
    return_id    text NOT NULL REFERENCES analysis.cio_returns (id),
    ordinal      integer NOT NULL,
    concern_kind text NOT NULL,
    subject_kind text NOT NULL,
    subject_id   text NOT NULL,
    detail       text NOT NULL,

    PRIMARY KEY (return_id, ordinal),
    CONSTRAINT cio_return_concerns_subject_known CHECK (
        subject_kind IN ('review', 'finding', 'challenge', 'claim', 'revision',
                         'aggregation', 'evidence')
    )
);

-- -------------------------------------------------------------- decisions --

/*
 * The primary key moves from `case_id` to a derived `decision_id`.
 *
 * A case may hold several decisions over its life: a decision, then a
 * correction that supersedes it, then a later reconsideration. Keying on the
 * case forced the second to overwrite the first, which is the opposite of what
 * an institutional record is for. The partial unique index keeps the property
 * that actually matters -- at most one LIVE decision per case.
 */
ALTER TABLE analysis.case_decisions
    ADD COLUMN decision_id text,
    ADD COLUMN outcome_kind text,
    ADD COLUMN supersedes_decision_id text,
    ADD COLUMN superseded_by_decision_id text,
    -- The CIO, mirroring ActorSnapshot exactly. No `seniority`: the contract
    -- does not carry one, and a column for it would be a field nothing fills.
    ADD COLUMN decided_by_role_id text,
    ADD COLUMN decided_by_role_function text,
    ADD COLUMN decided_by_department_id text REFERENCES analysis.departments (id),
    ADD COLUMN decided_by_department_is_governance boolean,
    ADD COLUMN decided_by_department_handles text[] NOT NULL DEFAULT '{}',
    ADD COLUMN organization_seed_version text,
    ADD COLUMN authentication text,
    ADD COLUMN authorization_basis text;

/*
 * No production rows; the guard proves it rather than assuming it. A decision
 * written under the old model has no outcome kind and no submissions, and
 * inventing either would fabricate what the CIO did.
 */
DO $$
DECLARE
    existing integer;
BEGIN
    SELECT count(*) INTO existing FROM analysis.case_decisions;
    IF existing > 0 THEN
        RAISE EXCEPTION
            'migration 0020 restructures analysis.case_decisions and found % '
            'existing row(s); migrate them to the explicit outcome model first',
            existing;
    END IF;
END $$;

/*
 * `decision_revisions` points at the case-keyed primary key, so it has to let
 * go before the key can move. Emptied first -- the guard above has just proved
 * there is nothing to keep -- and dropped below, replaced by
 * `decision_submissions`, which says strictly more.
 */
DELETE FROM analysis.decision_revisions;
DROP TABLE analysis.decision_revisions;

ALTER TABLE analysis.case_decisions
    DROP CONSTRAINT case_decisions_pkey,
    ALTER COLUMN decision_id SET NOT NULL,
    ADD PRIMARY KEY (decision_id),
    ALTER COLUMN outcome_kind SET NOT NULL,
    ALTER COLUMN organization_seed_version SET NOT NULL,
    ALTER COLUMN authentication SET NOT NULL,
    ALTER COLUMN authorization_basis SET NOT NULL,
    -- Supersession must stay inside one case, proved by a composite key rather
    -- than by a trigger that could be got round.
    ADD CONSTRAINT case_decisions_id_case_unique UNIQUE (decision_id, case_id),
    ADD CONSTRAINT case_decisions_outcome_known CHECK (
        outcome_kind IN ('selected', 'deferred', 'declined')
    ),
    /*
     * The point of the migration, as three implications. Only a selected
     * outcome may name a selected revision, and it must; the other two cannot.
     */
    ADD CONSTRAINT case_decisions_selected_names_revision CHECK (
        outcome_kind <> 'selected' OR selected_revision_id IS NOT NULL
    ),
    ADD CONSTRAINT case_decisions_deferred_names_no_revision CHECK (
        outcome_kind <> 'deferred' OR selected_revision_id IS NULL
    ),
    ADD CONSTRAINT case_decisions_declined_names_no_revision CHECK (
        outcome_kind <> 'declined' OR selected_revision_id IS NULL
    ),
    ADD CONSTRAINT case_decisions_supersedes_not_self CHECK (
        supersedes_decision_id IS DISTINCT FROM decision_id
    ),
    ADD CONSTRAINT case_decisions_superseded_by_not_self CHECK (
        superseded_by_decision_id IS DISTINCT FROM decision_id
    ),
    ADD CONSTRAINT case_decisions_handles_sorted CHECK (
        analysis.is_canonically_sorted(decided_by_department_handles)
    );

/*
 * Both deferred, which is what lets a supersession be atomic: the prior
 * decision is updated to point at its successor BEFORE the successor exists, so
 * the old row leaves the partial index below before the new one enters it and
 * no instant has two live decisions.
 */
ALTER TABLE analysis.case_decisions
    ADD CONSTRAINT case_decisions_supersedes_fk
        FOREIGN KEY (supersedes_decision_id, case_id)
        REFERENCES analysis.case_decisions (decision_id, case_id)
        DEFERRABLE INITIALLY DEFERRED,
    ADD CONSTRAINT case_decisions_superseded_by_fk
        FOREIGN KEY (superseded_by_decision_id, case_id)
        REFERENCES analysis.case_decisions (decision_id, case_id)
        DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX case_decisions_one_live_per_case
    ON analysis.case_decisions (case_id)
    WHERE superseded_by_decision_id IS NULL;

CREATE INDEX case_decisions_recent_idx
    ON analysis.case_decisions (tenant_id, decided_at DESC, decision_id COLLATE "C");

/* The document whose compliance field had to be invented. */
ALTER TABLE analysis.case_decisions
    DROP COLUMN governance,
    DROP COLUMN unresolved_dissent,
    DROP COLUMN reconsideration_triggers;

-- ------------------------------------------------- decision <-> submission --

/*
 * The authoritative relation. Every revision the CIO considered, the submission
 * it was considered on, and how it stood.
 *
 * The composite foreign keys make the two rules structural rather than checked
 * in code: the submission belongs to this case, and it targets exactly the
 * revision this row names. `PRIMARY KEY (decision_id, revision_id)` makes a
 * contradictory second relation for one revision unrepresentable.
 */
CREATE TABLE analysis.decision_submissions (
    decision_id   text NOT NULL REFERENCES analysis.case_decisions (decision_id),
    submission_id text NOT NULL REFERENCES analysis.cio_submissions (id),
    case_id       text NOT NULL,
    revision_id   text NOT NULL,
    relation      text NOT NULL,

    PRIMARY KEY (decision_id, revision_id),

    FOREIGN KEY (submission_id, case_id)
        REFERENCES analysis.cio_submissions (id, case_id),
    FOREIGN KEY (submission_id, revision_id)
        REFERENCES analysis.cio_submissions (id, revision_id),
    FOREIGN KEY (decision_id, case_id)
        REFERENCES analysis.case_decisions (decision_id, case_id),

    CONSTRAINT decision_submissions_relation_known CHECK (
        relation IN ('selected', 'not-selected', 'declined', 'considered')
    )
);

CREATE UNIQUE INDEX decision_submissions_one_selected
    ON analysis.decision_submissions (decision_id)
    WHERE relation = 'selected';

CREATE INDEX decision_submissions_submission_idx
    ON analysis.decision_submissions (submission_id);

-- ---------------------------------------------------------------- dissent --

CREATE TABLE analysis.decision_dissent (
    decision_id     text NOT NULL REFERENCES analysis.case_decisions (decision_id),
    ordinal         integer NOT NULL,
    source          text NOT NULL,
    source_id       text NOT NULL,
    revision_id     text NOT NULL REFERENCES analysis.thesis_revisions (revision_id),
    claim_id        text REFERENCES analysis.claims (id),
    materiality     text NOT NULL,
    raised_by_employee_id   text REFERENCES analysis.employees (id),
    raised_by_department_id text REFERENCES analysis.departments (id),
    rationale        text NOT NULL,
    why_not_blocking text NOT NULL,
    acknowledgement  text,
    disposition      text NOT NULL,

    PRIMARY KEY (decision_id, ordinal),
    CONSTRAINT decision_dissent_source_known CHECK (
        source IN ('opposing-claim', 'devils-advocate-challenge',
                   'manager-disagreement', 'governance-qualification')
    ),
    CONSTRAINT decision_dissent_materiality_known CHECK (
        materiality IN ('non-material', 'material', 'decision-critical')
    ),
    CONSTRAINT decision_dissent_why_known CHECK (
        why_not_blocking IN ('below-threshold', 'resolved-before-decision',
                             'accepted-as-risk')
    ),
    CONSTRAINT decision_dissent_disposition_known CHECK (
        disposition IN ('acknowledged', 'accepted-as-risk', 'to-be-monitored')
    ),
    CONSTRAINT decision_dissent_rationale_present CHECK (btrim(rationale) <> ''),
    /*
     * Material and above must be answered. Deciding past a material objection
     * is legitimate; doing so without saying why is what this refuses.
     */
    CONSTRAINT decision_dissent_material_acknowledged CHECK (
        materiality = 'non-material'
        OR (acknowledgement IS NOT NULL AND btrim(acknowledgement) <> '')
    )
);

CREATE TABLE analysis.decision_dissent_evidence (
    decision_id     text NOT NULL,
    ordinal         integer NOT NULL,
    evidence_set_id text NOT NULL,
    observation_id  text NOT NULL,
    content_hash    text NOT NULL,

    PRIMARY KEY (decision_id, ordinal, evidence_set_id, observation_id),
    FOREIGN KEY (decision_id, ordinal)
        REFERENCES analysis.decision_dissent (decision_id, ordinal),
    FOREIGN KEY (evidence_set_id, observation_id)
        REFERENCES analysis.evidence_items (evidence_set_id, observation_id)
);

-- -------------------------------------------------------- reconsideration --

/*
 * What should make the firm look at this again.
 *
 * **No `active` column.** A trigger is active when it belongs to the live
 * decision, which is derived; a stored flag would be a lifecycle no command
 * owns. Each row carries its OWN policy version -- taking one from a sibling
 * would be an accidental homogeneity assumption that is wrong exactly once.
 *
 * Nothing evaluates these in C1D. Recording a condition and watching for one
 * are different capabilities, and the second needs a scheduler this runtime
 * does not have.
 */
CREATE TABLE analysis.decision_reconsideration_triggers (
    id              text PRIMARY KEY,
    decision_id     text NOT NULL REFERENCES analysis.case_decisions (decision_id),
    ordinal         integer NOT NULL,
    condition_type  text NOT NULL,
    subject_kind    text NOT NULL,
    subject_ref     text NOT NULL,
    comparator      text,
    threshold_amount   text,
    threshold_unit     text,
    threshold_currency text,
    qualitative_condition text,
    expected_source text,
    rationale       text NOT NULL,
    created_by_employee_id text NOT NULL REFERENCES analysis.employees (id),
    created_at      timestamptz NOT NULL,
    policy_version  text NOT NULL,

    UNIQUE (decision_id, ordinal),
    CONSTRAINT triggers_condition_type_known CHECK (
        condition_type IN ('quantitative-threshold', 'date-or-event',
                           'evidence-revised', 'policy-change',
                           'fundamental-change', 'valuation-condition',
                           'risk-condition', 'dissent-validated')
    ),
    CONSTRAINT triggers_subject_kind_known CHECK (
        subject_kind IN ('series', 'instrument', 'claim', 'evidence',
                         'policy-rate', 'date', 'thesis')
    ),
    CONSTRAINT triggers_comparator_known CHECK (
        comparator IS NULL
        OR comparator IN ('above', 'below', 'crosses', 'changes', 'restated')
    ),
    CONSTRAINT triggers_rationale_present CHECK (btrim(rationale) <> ''),
    /*
     * A comparator or a stated condition. Neither means nothing could ever
     * determine whether it fired, which is a trigger that exists only as
     * reassurance.
     */
    CONSTRAINT triggers_evaluable CHECK (
        comparator IS NOT NULL
        OR (qualitative_condition IS NOT NULL AND btrim(qualitative_condition) <> '')
    ),
    CONSTRAINT triggers_comparator_has_threshold CHECK (
        comparator IS NULL OR comparator = 'changes' OR threshold_amount IS NOT NULL
    ),
    /*
     * "Inflation above 3" is not a condition anybody can evaluate: three
     * percent, three index points and three basis points are different
     * conditions. A quantitative trigger without a unit reads as precise and
     * is not.
     */
    CONSTRAINT triggers_quantitative_complete CHECK (
        condition_type <> 'quantitative-threshold'
        OR (comparator IS NOT NULL
            AND threshold_amount IS NOT NULL
            AND threshold_unit IS NOT NULL
            AND btrim(threshold_unit) <> '')
    )
);

CREATE INDEX triggers_subject_idx
    ON analysis.decision_reconsideration_triggers (subject_kind, subject_ref);

-- ------------------------------------------------- outcome, across rows --

/*
 * The rules a row-level CHECK cannot reach.
 *
 * Whether a decision's relations agree with its outcome depends on rows in
 * another table, and on rows that may not exist yet when the decision is
 * inserted. So it is a DEFERRABLE INITIALLY DEFERRED constraint trigger: the
 * check runs at COMMIT, by which time the whole decision -- relations, triggers
 * and all -- is present or none of it is.
 *
 * Enforced here as well as in the command deliberately. The command is one code
 * path; this is the last one.
 */
CREATE FUNCTION analysis.assert_decision_outcome(target text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    kind        text;
    selected_id text;
    considered  integer;
    selected_n  integer;
    declined_n  integer;
    notsel_n    integer;
    triggers_n  integer;
    submitted   integer;
BEGIN
    SELECT outcome_kind, selected_revision_id INTO kind, selected_id
    FROM analysis.case_decisions WHERE decision_id = target;

    -- Deleted within the same transaction: nothing left to assert.
    IF kind IS NULL THEN RETURN; END IF;

    SELECT count(*),
           count(*) FILTER (WHERE relation = 'selected'),
           count(*) FILTER (WHERE relation = 'declined'),
           count(*) FILTER (WHERE relation = 'not-selected')
      INTO considered, selected_n, declined_n, notsel_n
    FROM analysis.decision_submissions WHERE decision_id = target;

    IF considered = 0 THEN
        RAISE EXCEPTION 'decision_outcome: decision "%" considers nothing', target
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    IF kind = 'selected' THEN
        IF selected_n <> 1 THEN
            RAISE EXCEPTION
                'decision_outcome: selected decision "%" has % selected relations',
                target, selected_n
                USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        IF declined_n > 0 THEN
            RAISE EXCEPTION
                'decision_outcome: selected decision "%" also declines revisions',
                target USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        IF notsel_n <> considered - 1 THEN
            RAISE EXCEPTION
                'decision_outcome: selected decision "%" leaves a considered '
                'revision without a disposition', target
                USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        SELECT count(*) INTO submitted FROM analysis.decision_submissions
        WHERE decision_id = target AND relation = 'selected'
          AND revision_id = selected_id;
        IF submitted <> 1 THEN
            RAISE EXCEPTION
                'decision_outcome: decision "%" selects a revision with no '
                'matching submission relation', target
                USING ERRCODE = 'integrity_constraint_violation';
        END IF;

    ELSIF kind = 'deferred' THEN
        IF selected_n > 0 OR declined_n > 0 THEN
            RAISE EXCEPTION
                'decision_outcome: deferred decision "%" selects or declines',
                target USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        SELECT count(*) INTO triggers_n
        FROM analysis.decision_reconsideration_triggers WHERE decision_id = target;
        IF triggers_n = 0 THEN
            RAISE EXCEPTION
                'decision_outcome: deferred decision "%" records no condition '
                'that would end the wait', target
                USING ERRCODE = 'integrity_constraint_violation';
        END IF;

    ELSIF kind = 'declined' THEN
        IF selected_n > 0 THEN
            RAISE EXCEPTION
                'decision_outcome: declined decision "%" selects a revision',
                target USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        IF declined_n <> considered THEN
            RAISE EXCEPTION
                'decision_outcome: declined decision "%" leaves % considered '
                'revision(s) without a disposition',
                target, considered - declined_n
                USING ERRCODE = 'integrity_constraint_violation';
        END IF;
    END IF;
END $$;

CREATE FUNCTION analysis.decision_outcome_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM analysis.assert_decision_outcome(
        CASE TG_TABLE_NAME
            WHEN 'case_decisions' THEN NEW.decision_id
            ELSE NEW.decision_id
        END);
    RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER case_decisions_outcome_guard
    AFTER INSERT OR UPDATE ON analysis.case_decisions
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION analysis.decision_outcome_guard();

CREATE CONSTRAINT TRIGGER decision_submissions_outcome_guard
    AFTER INSERT OR UPDATE ON analysis.decision_submissions
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION analysis.decision_outcome_guard();

CREATE CONSTRAINT TRIGGER triggers_outcome_guard
    AFTER INSERT OR UPDATE ON analysis.decision_reconsideration_triggers
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION analysis.decision_outcome_guard();

/*
 * Supersession must not form a cycle.
 *
 * A recursive walk rather than a two-node check: A superseding B superseding A
 * is the obvious case, but a longer ring would be just as unreadable and just
 * as capable of hiding which decision the firm actually holds. Deferred, so the
 * update-then-insert order a supersession needs still works.
 */
CREATE FUNCTION analysis.assert_no_supersession_cycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    found boolean;
BEGIN
    IF NEW.supersedes_decision_id IS NULL THEN RETURN NULL; END IF;

    WITH RECURSIVE chain(decision_id, depth) AS (
        SELECT NEW.supersedes_decision_id, 1
        UNION ALL
        SELECT d.supersedes_decision_id, chain.depth + 1
        FROM analysis.case_decisions d
        JOIN chain ON d.decision_id = chain.decision_id
        WHERE d.supersedes_decision_id IS NOT NULL AND chain.depth < 1000
    )
    SELECT EXISTS (SELECT 1 FROM chain WHERE decision_id = NEW.decision_id)
      INTO found;

    IF found THEN
        RAISE EXCEPTION
            'supersession_cycle: decision "%" would close a supersession cycle',
            NEW.decision_id USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER case_decisions_no_supersession_cycle
    AFTER INSERT OR UPDATE ON analysis.case_decisions
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION analysis.assert_no_supersession_cycle();

-- ------------------------------------------- narrowing the immutability guard --

/*
 * 0008 refused every UPDATE and DELETE on a decision, which was right when a
 * case held exactly one. Supersession needs one column to change, and a blanket
 * refusal would mean the only way to record a correction is to edit the
 * decision being corrected -- the opposite of what the guard exists for.
 *
 * Replaced rather than dropped: the function is redefined here, so the rule
 * moves forward with the schema and 0008 is not edited. What it now permits is
 * exactly one transition, on one column, in one direction. Everything else
 * about a committed decision is still unwritable, including by the owner.
 */
CREATE OR REPLACE FUNCTION analysis.refuse_decision_rewrite()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
    IF TG_OP = 'UPDATE'
       AND OLD.superseded_by_decision_id IS NULL
       AND NEW.superseded_by_decision_id IS NOT NULL
       -- Nothing else may move with it.
       AND NEW.decision_id = OLD.decision_id
       AND NEW.case_id = OLD.case_id
       AND NEW.outcome_kind = OLD.outcome_kind
       AND NEW.rationale = OLD.rationale
       AND NEW.decided_at = OLD.decided_at
       AND NEW.decided_by_employee_id = OLD.decided_by_employee_id
       AND NEW.selected_revision_id IS NOT DISTINCT FROM OLD.selected_revision_id
       AND NEW.supersedes_decision_id IS NOT DISTINCT FROM OLD.supersedes_decision_id
    THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION
        'Case decision "%" is committed and cannot be % . Append a superseding '
        'decision instead.',
        COALESCE(OLD.case_id, NEW.case_id),
        lower(TG_OP)
        USING ERRCODE = 'integrity_constraint_violation';
END;
$fn$;

-- ------------------------------------------------------------- the events --

ALTER TABLE analysis.transition_events
    ADD COLUMN decision_id text REFERENCES analysis.case_decisions (decision_id),
    ADD COLUMN submission_id text REFERENCES analysis.cio_submissions (id);

-- ---------------------------------------------------------------- grants --

/*
 * Read and insert. No DELETE anywhere, and no table-wide UPDATE on anything
 * this migration creates: a decision, its relations, its dissent and its
 * triggers are the record, and a runtime able to edit them could undo every
 * other guarantee here from a code path that looks like ordinary data access.
 */
GRANT SELECT, INSERT ON
    analysis.cio_submissions,
    analysis.submission_required_work,
    analysis.submission_disagreements,
    analysis.submission_evidence,
    analysis.submission_open_challenges,
    analysis.cio_returns,
    analysis.cio_return_concerns,
    analysis.decision_submissions,
    analysis.decision_dissent,
    analysis.decision_dissent_evidence,
    analysis.decision_reconsideration_triggers
TO finos_app;

/* The registry is read, never written by the runtime: a policy the runtime
 * could add is a gate the runtime could define for itself. */
GRANT SELECT ON analysis.eligibility_policies TO finos_app;

/*
 * The two mutable facts, each granted alone at column level. A submission
 * settles once, and a decision gains its back-reference when the decision that
 * replaces it is written -- nothing else about either can change.
 */
GRANT UPDATE (state) ON analysis.cio_submissions TO finos_app;
GRANT UPDATE (superseded_by_decision_id) ON analysis.case_decisions TO finos_app;

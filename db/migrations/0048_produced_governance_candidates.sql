-- Governance control acts before the institution stands behind them.
--
-- ## The gap this closes
--
-- The firm has one epistemic rule about generated work: a model's output is
-- operational until an accountable principal explicitly adopts it. `0027` made
-- that structural for CLAIMS and `0045` for the Research Office's SYNTHESIS.
--
-- Governance was the remaining exception. `RecordVerificationReview`,
-- `RecordDevilsAdvocateReview` and `RecordPeerExamination` take a verdict, a
-- finding and an objection as command input and write them straight into
-- `reviews`, `verification_findings` and `challenges` — and, for verification,
-- straight into a `thesis_revisions` lifecycle transition. That was harmless
-- while a human control officer typed them: a person can author a verdict and
-- stand behind it in one act. It stops being harmless the moment a model writes
-- them, because then model output reaches the institution's own scrutiny record
-- in a single write, and the firm would preserve the boundary for the desk and
-- for the manager while losing it for the control functions that check both.
--
-- Measured before it was built: at the time of writing no provider could produce
-- a verdict or an objection at all, so nothing was leaking. This closes the
-- boundary BEFORE the producer exists.
--
-- ## Three tables, not one
--
-- A verification verdict, a Devil's Advocate objection and a peer examination
-- are not analytical claims — they are not put into `produced_claims`, whose
-- non-empty array check is a guarantee it exists for — and they are not each
-- other. One table with a `kind` column and nullable everything would have to
-- drop the constraints that make each act what it is: a verification verdict
-- always has a status, a Devil's Advocate filing is never empty, and a peer
-- examination legitimately is. Three tables keep all three as NOT NULL and
-- CHECK rather than as convention.
--
-- There is deliberately no generic produced-artifact store. A table that holds
-- anything guarantees nothing.
--
-- One run, one candidate — the same relationship `produced_claims` and
-- `produced_syntheses` have, and for the same reason. The primary key says so.
--
-- ## What they do NOT do
--
-- Nothing here is institutional. A row in these tables satisfies no governance
-- requirement, closes no gate and moves no lifecycle. Eligibility reads
-- `reviews` and `challenges`; it has no foreign key into any of these tables
-- and must not acquire one. Producing a Verification candidate is not
-- Verification.

-- ============================================ a proposed verification verdict ==

CREATE TABLE analysis.produced_verification_reviews (
    run_id    text PRIMARY KEY REFERENCES analysis.runs (id),
    case_id   text NOT NULL,
    tenant_id text NOT NULL,

    -- ------------------------------------------------------ the artifact --
    --
    -- What produced it — model, provider, prompt, agent principal, evidence
    -- set — is reachable through the immutable run by this key. Copying it here
    -- would create a second place for provenance to be wrong.
    --
    -- `status` is a PROPOSAL. The model may propose 'verified'; only the
    -- Verification function may institutionalise it, and only the filing
    -- command moves the revision's lifecycle.
    status          text NOT NULL,
    findings        jsonb NOT NULL,
    claims_reviewed jsonb NOT NULL,

    -- ------------------------------------------- the institutional basis --
    --
    -- `observed_claim_ids` is the load-bearing member and the direct analogue
    -- of `produced_syntheses.observed_completed_run_ids`: the exact universe of
    -- claims the control function could see when it worked. Filing recomputes
    -- it and refuses on inequality, which is what stops a verdict produced
    -- against one state being filed against the state that followed it.
    --
    -- A timestamp would not do this. Prose produced an hour ago against
    -- unchanged work is fine; prose produced a second ago against changed work
    -- is not.
    --
    -- `thesis_id` carries no foreign key because the firm has no `theses`
    -- table — a lineage exists as the shared `thesis_id` of its revisions. The
    -- revision reference below pins the lineage transitively.
    thesis_id          text NOT NULL,
    source_revision_id text NOT NULL
        REFERENCES analysis.thesis_revisions (revision_id),
    playbook_id        text NOT NULL,
    playbook_version   text NOT NULL,
    playbook_entry_key text NOT NULL,
    observed_claim_ids jsonb NOT NULL,

    -- ------------------------------------------------------------ identity --
    --
    -- The digest covers the artifact AND the basis together, under a domain
    -- separation of its own: an identical verdict produced against a different
    -- revision is a different candidate, and a Verification candidate and a
    -- Devil's Advocate candidate carrying the same bytes are different acts.
    content_hash             text NOT NULL,
    canonicalization_version text NOT NULL,
    produced_at              timestamptz NOT NULL,

    FOREIGN KEY (case_id, tenant_id) REFERENCES analysis.cases (id, tenant_id),

    CONSTRAINT produced_verification_status_known
        CHECK (status IN (
            'verified',
            'verified-with-qualifications',
            'correction-required',
            'unresolved-discrepancy',
            'insufficient-evidence',
            'blocked'
        )),
    CONSTRAINT produced_verification_findings_array
        CHECK (jsonb_typeof(findings) = 'array'),
    CONSTRAINT produced_verification_claims_reviewed_array
        CHECK (jsonb_typeof(claims_reviewed) = 'array'),
    -- A verdict on nothing is a verdict the firm cannot read as having checked
    -- anything. Findings MAY be empty: that is a clean verification.
    CONSTRAINT produced_verification_reviewed_not_empty
        CHECK (jsonb_array_length(claims_reviewed) > 0),
    CONSTRAINT produced_verification_observed_claims_array
        CHECK (jsonb_typeof(observed_claim_ids) = 'array'),
    CONSTRAINT produced_verification_entry_stated
        CHECK (btrim(playbook_entry_key) <> ''),
    CONSTRAINT produced_verification_content_hash_shape
        CHECK (content_hash ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE analysis.produced_verification_reviews IS
    'A verification verdict a model produced and no principal has yet filed. '
    'Operational, not institutional: it satisfies no verification requirement '
    'and moves no thesis lifecycle.';

-- ====================================== a proposed devil''s advocate filing ==

CREATE TABLE analysis.produced_devils_advocate_reviews (
    run_id    text PRIMARY KEY REFERENCES analysis.runs (id),
    case_id   text NOT NULL,
    tenant_id text NOT NULL,

    -- The objections, and nothing else. A Devil's Advocate review carries no
    -- status and no detail of its own — `0036` records a NULL status for it,
    -- because its output IS its challenges.
    --
    -- Each proposed objection carries what it contests, its kind, the argument,
    -- its counter-evidence, what would resolve it and its proposed materiality.
    -- It does NOT carry an id, a challenger kind or a filing department: those
    -- come from the principal who files it, which is what stops a model filing
    -- an objection under a mandate it does not hold.
    challenges jsonb NOT NULL,

    thesis_id          text NOT NULL,
    source_revision_id text NOT NULL
        REFERENCES analysis.thesis_revisions (revision_id),
    playbook_id        text NOT NULL,
    playbook_version   text NOT NULL,
    playbook_entry_key text NOT NULL,
    observed_claim_ids jsonb NOT NULL,

    content_hash             text NOT NULL,
    canonicalization_version text NOT NULL,
    produced_at              timestamptz NOT NULL,

    FOREIGN KEY (case_id, tenant_id) REFERENCES analysis.cases (id, tenant_id),

    CONSTRAINT produced_devils_advocate_challenges_array
        CHECK (jsonb_typeof(challenges) = 'array'),
    -- The Devil's Advocate must object. The institutional command already
    -- refuses an empty submission, and a candidate that could not be filed is
    -- not a candidate. This is the one constraint that separates this table
    -- from the peer one below, and it is the whole difference between the two
    -- control functions.
    CONSTRAINT produced_devils_advocate_challenges_not_empty
        CHECK (jsonb_array_length(challenges) > 0),
    CONSTRAINT produced_devils_advocate_observed_claims_array
        CHECK (jsonb_typeof(observed_claim_ids) = 'array'),
    CONSTRAINT produced_devils_advocate_entry_stated
        CHECK (btrim(playbook_entry_key) <> ''),
    CONSTRAINT produced_devils_advocate_content_hash_shape
        CHECK (content_hash ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE analysis.produced_devils_advocate_reviews IS
    'A Devil''s Advocate filing a model produced and no principal has yet '
    'filed. Operational, not institutional: it satisfies no challenge mandate.';

-- ========================================= a proposed peer examination ==

CREATE TABLE analysis.produced_peer_examinations (
    run_id    text PRIMARY KEY REFERENCES analysis.runs (id),
    case_id   text NOT NULL,
    tenant_id text NOT NULL,

    challenges jsonb NOT NULL,

    -- Whose work was read. Institutional fact, not producer judgement: which
    -- desk is under examination follows from the playbook and the assignment,
    -- and a producer that could name it could quietly examine a desk nobody
    -- asked it to. It sits in the basis for the same reason the revision does.
    examined_department_id text NOT NULL
        REFERENCES analysis.departments (id),

    thesis_id          text NOT NULL,
    source_revision_id text NOT NULL
        REFERENCES analysis.thesis_revisions (revision_id),
    playbook_id        text NOT NULL,
    playbook_version   text NOT NULL,
    playbook_entry_key text NOT NULL,
    observed_claim_ids jsonb NOT NULL,

    content_hash             text NOT NULL,
    canonicalization_version text NOT NULL,
    produced_at              timestamptz NOT NULL,

    FOREIGN KEY (case_id, tenant_id) REFERENCES analysis.cases (id, tenant_id),

    CONSTRAINT produced_peer_examination_challenges_array
        CHECK (jsonb_typeof(challenges) = 'array'),
    -- Deliberately NO non-empty check. A peer that looked and agreed performed
    -- the scrutiny, and that is not the same fact as an examination that never
    -- happened — which is precisely why the eligibility gate reads the
    -- existence of an examination rather than its emptiness. Requiring an
    -- objection here would turn peer review into a machine that must find
    -- fault.
    CONSTRAINT produced_peer_examination_observed_claims_array
        CHECK (jsonb_typeof(observed_claim_ids) = 'array'),
    CONSTRAINT produced_peer_examination_entry_stated
        CHECK (btrim(playbook_entry_key) <> ''),
    CONSTRAINT produced_peer_examination_content_hash_shape
        CHECK (content_hash ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE analysis.produced_peer_examinations IS
    'A peer examination a model produced and no principal has yet filed. '
    'Operational, not institutional: it satisfies no peer-scrutiny requirement. '
    'May legitimately carry zero objections.';

-- Read by run, and only by run. The primary keys serve that, so there are no
-- further indexes — and specifically no listing by case, for the reason
-- `produced_claims` has none: a convenient case-wide listing of unfiled
-- scrutiny is the first step towards treating it as though the firm had
-- performed it.

-- The runtime records what a control function produced and reads it back to
-- file it. It never updates and never deletes: an unfiled candidate stays
-- exactly as it was produced, which is what makes it evidence about the agent.
GRANT SELECT, INSERT ON analysis.produced_verification_reviews TO finos_app;
GRANT SELECT, INSERT ON analysis.produced_devils_advocate_reviews TO finos_app;
GRANT SELECT, INSERT ON analysis.produced_peer_examinations TO finos_app;
GRANT SELECT ON analysis.produced_verification_reviews TO finos_readonly;
GRANT SELECT ON analysis.produced_devils_advocate_reviews TO finos_readonly;
GRANT SELECT ON analysis.produced_peer_examinations TO finos_readonly;

-- ============================================== the adoption back-links ==

/*
 * Which candidate became this review.
 *
 * Three columns rather than one, because a column carries one foreign key and
 * the institution must be able to prove `model artifact -> this exact persisted
 * candidate -> this exact institutional review` BY JOIN. Matching prose is not
 * proof; it is a coincidence that usually holds.
 *
 * All three nullable, because a human control officer may still author a verdict
 * or an objection directly — that path is unchanged and generates no candidate.
 * No historical review is given a synthetic one.
 *
 * UNIQUE, because a candidate is filed once. Two reviews claiming the same
 * produced candidate would be two institutional acts asserting the same origin,
 * which is not a record.
 */
ALTER TABLE analysis.reviews
    ADD COLUMN verification_candidate_run_id text
        REFERENCES analysis.produced_verification_reviews (run_id),
    ADD COLUMN devils_advocate_candidate_run_id text
        REFERENCES analysis.produced_devils_advocate_reviews (run_id),
    ADD COLUMN peer_examination_candidate_run_id text
        REFERENCES analysis.produced_peer_examinations (run_id),
    ADD CONSTRAINT reviews_one_candidate UNIQUE (verification_candidate_run_id),
    ADD CONSTRAINT reviews_one_devils_advocate_candidate
        UNIQUE (devils_advocate_candidate_run_id),
    ADD CONSTRAINT reviews_one_peer_examination_candidate
        UNIQUE (peer_examination_candidate_run_id),
    /*
     * A review cites at most one candidate, and only one of its own kind. The
     * database refuses a verification review that cites a Devil's Advocate
     * candidate rather than trusting the command not to write one — which is
     * the distinction the three separate tables exist to make enforceable.
     */
    ADD CONSTRAINT reviews_candidate_matches_kind CHECK (
        num_nonnulls(
            verification_candidate_run_id,
            devils_advocate_candidate_run_id,
            peer_examination_candidate_run_id
        ) <= 1
        AND (verification_candidate_run_id IS NULL OR kind = 'verification')
        AND (devils_advocate_candidate_run_id IS NULL OR kind = 'devils-advocate')
        AND (peer_examination_candidate_run_id IS NULL OR kind = 'peer-examination')
    );

/*
 * Written by the insert that creates the review. `analysis.reviews` holds
 * SELECT, INSERT and no UPDATE — a review is a verdict at a moment, and a
 * changed verdict is a new review that supersedes the old one. So there is no
 * GRANT UPDATE here, deliberately: the lesson `0041` and `0043` taught twice is
 * that a column needs the grant its write path actually uses, and this one's
 * write path is the insert.
 */

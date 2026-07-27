-- Governance: verification, challenge, compliance, risk.
--
-- Four independent control functions, each a real department with its own
-- queue, each able to stop work. They check different things and are not
-- interchangeable — a perfectly compliant report can contain a wrong number,
-- and a correct report can be unpublishable.
--
-- ## One table with a discriminator, not four parallel tables
--
-- The headquarters needs "what governance has touched this case" as ONE
-- question. Four tables make that four queries and four unions, and every new
-- control function would add a fifth. The kind-specific detail that is queried
-- lives in typed child tables; the rest is scalar or jsonb on the review.
--
-- ## Which thesis a review concerns
--
-- `thesis_id` is the LINEAGE, which is what `VerificationReview.thesisId`
-- carries today. `revision_id` is the exact revision, which is what makes a
-- review meaningful once a thesis has been revised — a review reviewed a
-- specific argument. The domain does not populate it yet; see TD-21.

CREATE TABLE analysis.reviews (
    id                text PRIMARY KEY,
    kind              text NOT NULL,
    case_id           text NOT NULL,
    tenant_id         text NOT NULL,
    -- The lineage this verdict concerns. Null for a case-wide review, which
    -- early-stage work legitimately is: there are no theses yet.
    thesis_id         text,
    -- The exact revision reviewed.
    revision_id       text REFERENCES analysis.thesis_revisions (revision_id),

    by_employee_id    text NOT NULL REFERENCES analysis.employees (id),
    by_department_id  text NOT NULL REFERENCES analysis.departments (id),
    at                timestamptz NOT NULL,
    -- Kind-specific: a VerificationStatus, a ComplianceStatus, a risk verdict.
    -- Null for a Devil's Advocate review, whose verdict is its challenges.
    status            text,
    -- Kind-specific scalars with no cross-kind meaning: compliance findings,
    -- risk concerns and limits, the claims a verification actually checked.
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,

    FOREIGN KEY (case_id, tenant_id) REFERENCES analysis.cases (id, tenant_id),

    CONSTRAINT reviews_kind_known CHECK (
        kind IN ('verification', 'devils-advocate', 'compliance', 'risk')
    ),
    -- Each kind's verdict vocabulary, kept apart so a compliance status can
    -- never appear on a risk review.
    CONSTRAINT reviews_status_matches_kind CHECK (
        (kind = 'verification' AND status IN (
            'verified', 'verified-with-qualifications', 'correction-required',
            'unresolved-discrepancy', 'insufficient-evidence', 'blocked'))
        OR (kind = 'compliance' AND status IN (
            'approved', 'changes-required', 'rejected'))
        OR (kind = 'risk' AND status IN (
            'accepted', 'accepted-with-limits', 'rejected'))
        OR (kind = 'devils-advocate' AND status IS NULL)
    ),
    -- A review of a specific revision must agree with itself about which
    -- lineage that revision belongs to.
    CONSTRAINT reviews_revision_implies_thesis CHECK (
        revision_id IS NULL OR thesis_id IS NOT NULL
    )
);

-- Recording the same verdict twice would double-count it in the gate. The
-- natural key is the one the in-memory adapter dedupes on, so both stores
-- reject a replayed submission identically.
--
-- NULLS NOT DISTINCT because a case-wide review has no thesis, and two
-- case-wide verdicts from the same reviewer at the same instant are a replay
-- rather than two opinions.
CREATE UNIQUE INDEX reviews_natural_key_unique
    ON analysis.reviews (kind, case_id, thesis_id, by_employee_id, at)
    NULLS NOT DISTINCT;

-- `reviews.*ForCase()` return at, then by_employee_id.
CREATE INDEX reviews_case_idx ON analysis.reviews (case_id, kind, at, by_employee_id);
CREATE INDEX reviews_revision_idx ON analysis.reviews (revision_id);
-- Governance queues: what is in front of each control function.
CREATE INDEX reviews_department_idx ON analysis.reviews (by_department_id, at DESC);

-- --------------------------------------------------- verification findings --

-- Each kind is a distinct way a number can be wrong. `unit-mismatch` and
-- `basis-point-confusion` are separate because they are separate mistakes:
-- percent versus percentage point is a unit error, 0.25% versus 25bp is a
-- scale error, and each has bitten real institutions.
CREATE TABLE analysis.verification_findings (
    id              text PRIMARY KEY,
    review_id       text NOT NULL REFERENCES analysis.reviews (id),
    kind            text NOT NULL,
    claim_id        text NOT NULL REFERENCES analysis.claims (id),
    detail          text NOT NULL,
    -- Must be resolved before the case may progress.
    blocking        boolean NOT NULL,
    -- The evidence the finding concerns, where one is identifiable.
    evidence_set_id text,
    observation_id  text,

    FOREIGN KEY (evidence_set_id, observation_id)
        REFERENCES analysis.evidence_items (evidence_set_id, observation_id),
    CONSTRAINT verification_findings_evidence_complete CHECK (
        (evidence_set_id IS NULL) = (observation_id IS NULL)
    ),
    CONSTRAINT verification_findings_kind_known CHECK (
        kind IN ('value-mismatch', 'unit-mismatch', 'currency-mismatch',
                 'basis-point-confusion', 'percentage-point-confusion',
                 'calculation-error', 'unresolved-citation', 'revised-evidence',
                 'stale-evidence', 'fixture-evidence', 'methodology-incompatible',
                 'assumption-unstated', 'conclusion-exceeds-evidence',
                 'meaning-altered-in-summary', 'source-unreachable')
    )
);

CREATE INDEX verification_findings_review_idx
    ON analysis.verification_findings (review_id, id);
CREATE INDEX verification_findings_claim_idx
    ON analysis.verification_findings (claim_id);

-- ------------------------------------------------------------- challenges --

-- The Devil's Advocate argues from evidence like anyone else. An objection
-- with nothing behind it is theatre — which is what keeps the role from
-- degrading into reflexive disagreement.
--
-- `fragile-assumption` and `overconfidence` are the two kinds that legitimately
-- cite nothing: they contest the reasoning rather than the facts.
CREATE TABLE analysis.challenges (
    id                   text PRIMARY KEY,
    review_id            text NOT NULL REFERENCES analysis.reviews (id),
    contests_claim_id    text NOT NULL REFERENCES analysis.claims (id),
    -- Where the objection is to the whole argument rather than one claim.
    contests_thesis_id   text,
    kind                 text NOT NULL,
    argument             text NOT NULL,
    -- What would have to be true for the original claim to survive.
    would_be_resolved_by text,
    -- How the organization answered it. An open challenge blocks the gate.
    outcome              text NOT NULL DEFAULT 'open',

    CONSTRAINT challenges_kind_known CHECK (
        kind IN ('alternative-explanation', 'fragile-assumption',
                 'contradicting-evidence', 'confirmation-bias', 'groupthink',
                 'overconfidence', 'adverse-scenario',
                 'correlation-not-causation')
    ),
    CONSTRAINT challenges_outcome_known CHECK (
        outcome IN ('open', 'accepted', 'rejected', 'resolved')
    )
);

CREATE INDEX challenges_review_idx ON analysis.challenges (review_id, id);
CREATE INDEX challenges_claim_idx ON analysis.challenges (contests_claim_id);
-- Unresolved challenges are read on every gate evaluation.
CREATE INDEX challenges_open_idx ON analysis.challenges (review_id)
    WHERE outcome = 'open';

CREATE TABLE analysis.challenge_evidence (
    challenge_id    text NOT NULL REFERENCES analysis.challenges (id),
    evidence_set_id text NOT NULL,
    observation_id  text NOT NULL,
    -- Captured at citation time, for the same reason as `claim_evidence`.
    content_hash    text NOT NULL,

    PRIMARY KEY (challenge_id, evidence_set_id, observation_id),
    FOREIGN KEY (evidence_set_id, observation_id)
        REFERENCES analysis.evidence_items (evidence_set_id, observation_id)
);

-- Enforced here rather than in the application because a challenge without
-- counter-evidence, of a kind that requires it, is the failure mode the role
-- exists to avoid. Deferred: the challenge row and its evidence rows are
-- inserted in one transaction.
CREATE FUNCTION analysis.assert_challenge_cites_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.kind NOT IN ('fragile-assumption', 'overconfidence')
       AND NOT EXISTS (
           SELECT 1 FROM analysis.challenge_evidence
           WHERE challenge_id = NEW.id
       )
    THEN
        RAISE EXCEPTION
            'Challenge "%" of kind "%" cites no counter-evidence',
            NEW.id, NEW.kind
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER challenges_cite_evidence
    AFTER INSERT OR UPDATE ON analysis.challenges
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION analysis.assert_challenge_cites_evidence();

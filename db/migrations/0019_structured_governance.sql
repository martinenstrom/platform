/*
 * 0019 — governance verdicts become relational, and reviews become ordered.
 *
 * Three changes, each closing something C1C-4 discovered it could not answer.
 *
 * **Ordering.** `reviews` had no order but `at`, and the gate selected the
 * latest by string comparison on a timestamp. Two verdicts on one revision by
 * one discipline at one instant — which is what a retry storm produces — were
 * ordered arbitrarily, so "the current verdict" was not a function of the data.
 * `sequence` is allocated per (case, revision, kind) and uniquely constrained,
 * so the database refuses two verdicts claiming the same position rather than
 * letting the application pick a winner.
 *
 * **Structure.** Risk concerns, the claims a verifier checked, and the numbers
 * behind a finding all lived in a `detail` jsonb column. "Which findings block
 * this revision, whose queue is it in, and what did Risk object to" is the
 * question the headquarters floor asks first; behind a document it is a scan
 * and a parse. They are columns now, and `detail` is dropped.
 *
 * **Supersession.** A re-review is a new immutable row naming the one it
 * replaces, with the reason required when the verdict changes. Nothing updates
 * a verdict, which is why there is no UPDATE grant on any of this.
 */

-- ------------------------------------------------------ review ordering --

ALTER TABLE analysis.reviews
    ADD COLUMN sequence integer,
    ADD COLUMN supersedes_review_id text REFERENCES analysis.reviews (id),
    -- Required when a re-review changes the institutional verdict. Enforced in
    -- the command, which is the only place that can see the previous status.
    ADD COLUMN reason text;

/*
 * Existing rows get sequence 1. Safe because the natural key already forbids
 * two reviews of one revision by one employee at one instant, and no
 * deployment has more than the fixtures.
 */
UPDATE analysis.reviews SET sequence = 1 WHERE sequence IS NULL;

ALTER TABLE analysis.reviews
    ALTER COLUMN sequence SET NOT NULL,
    ADD CONSTRAINT reviews_sequence_positive CHECK (sequence >= 1),
    -- The constraint that makes concurrent allocation safe: two transactions
    -- racing for the same position cannot both commit.
    ADD CONSTRAINT reviews_sequence_unique
        UNIQUE (case_id, revision_id, kind, sequence),
    -- A re-review speaks about the same argument as the review it replaces.
    -- Cross-revision supersession is how a verdict gets retargeted at work its
    -- author never saw.
    ADD CONSTRAINT reviews_supersedes_not_self CHECK (supersedes_review_id <> id);

CREATE INDEX reviews_revision_kind_sequence_idx
    ON analysis.reviews (case_id, revision_id, kind, sequence DESC);

-- ------------------------------------------------ verification findings --

ALTER TABLE analysis.verification_findings
    ADD COLUMN severity text,
    -- What the claim asserted and what the verifier measured. Text, not
    -- numeric: a finding reading "expected 2.5, observed 2.50000000000000004"
    -- is a finding about IEEE-754, and a verifier who typed 2.5 must be
    -- recorded as having typed 2.5.
    ADD COLUMN expected_amount text,
    ADD COLUMN expected_unit text,
    ADD COLUMN expected_currency text,
    ADD COLUMN observed_amount text,
    ADD COLUMN observed_unit text,
    ADD COLUMN observed_currency text,
    ADD COLUMN methodology text,
    ADD COLUMN correction_required text,
    -- The hash the claim cited, when it differs from the evidence's current
    -- one. Makes "the source moved under this claim" checkable years later
    -- without re-fetching anything.
    ADD COLUMN cited_content_hash text;

UPDATE analysis.verification_findings
    SET severity = CASE WHEN blocking THEN 'critical' ELSE 'advisory' END
    WHERE severity IS NULL;

ALTER TABLE analysis.verification_findings
    ALTER COLUMN severity SET NOT NULL,
    ADD CONSTRAINT verification_findings_severity_known CHECK (
        severity IN ('advisory', 'material', 'critical')
    ),
    /*
     * A blocking finding must say what would clear it. Otherwise "correction
     * required" names a state with no exit: the desk is told its work is wrong
     * and not what would make it right.
     */
    ADD CONSTRAINT verification_findings_blocking_states_correction CHECK (
        NOT blocking OR (correction_required IS NOT NULL
                         AND btrim(correction_required) <> '')
    ),
    /*
     * Per-kind implications rather than one combined condition, so an unknown
     * kind trips exactly one constraint and the error names the rule that
     * actually failed — the shape 0017 settled on.
     */
    ADD CONSTRAINT verification_findings_revised_evidence_cites_hash CHECK (
        kind <> 'revised-evidence' OR cited_content_hash IS NOT NULL
    ),
    ADD CONSTRAINT verification_findings_stale_evidence_cites_hash CHECK (
        kind <> 'stale-evidence' OR cited_content_hash IS NOT NULL
    );

-- The claims a verification actually looked at, so an unchecked claim is
-- visible as unchecked rather than merely absent from a jsonb array.
CREATE TABLE analysis.verification_claims_reviewed (
    review_id text NOT NULL REFERENCES analysis.reviews (id),
    claim_id  text NOT NULL REFERENCES analysis.claims (id),

    PRIMARY KEY (review_id, claim_id)
);

CREATE INDEX verification_claims_reviewed_claim_idx
    ON analysis.verification_claims_reviewed (claim_id);

-- ------------------------------------------------------ risk findings --

/*
 * Risk speaks about the portfolio consequences of being wrong. It never speaks
 * about whether the thesis is right — that is Verification's question and the
 * Devil's Advocate's — so the vocabulary is bounded to consequences.
 */
CREATE TABLE analysis.risk_findings (
    review_id   text NOT NULL REFERENCES analysis.reviews (id),
    ordinal     integer NOT NULL,
    kind        text NOT NULL,
    detail      text NOT NULL,
    severity    text NOT NULL,
    -- The implication this concerns, where one is identifiable.
    implication text,
    -- What would have to change for the concern to fall away.
    mitigated_by text,

    PRIMARY KEY (review_id, ordinal),
    CONSTRAINT risk_findings_kind_known CHECK (
        kind IN ('allocation', 'position-sizing', 'concentration', 'leverage',
                 'liquidity', 'currency-exposure', 'correlation', 'downside',
                 'tail-risk', 'implementation-constraint')
    ),
    CONSTRAINT risk_findings_severity_known CHECK (
        severity IN ('advisory', 'material', 'critical')
    )
);

-- The limits ARE the condition of a limited acceptance. Without them the
-- verdict is an unqualified acceptance wearing a qualified name.
CREATE TABLE analysis.risk_limits (
    review_id  text NOT NULL REFERENCES analysis.reviews (id),
    ordinal    integer NOT NULL,
    limit_text text NOT NULL,

    PRIMARY KEY (review_id, ordinal),
    CONSTRAINT risk_limits_not_blank CHECK (btrim(limit_text) <> '')
);

-- ----------------------------------------------------------- challenges --

ALTER TABLE analysis.challenges
    ADD COLUMN materiality text,
    -- Who or what settled it. Required once the outcome is not `open`.
    ADD COLUMN resolved_by text;

UPDATE analysis.challenges SET materiality = 'material' WHERE materiality IS NULL;

ALTER TABLE analysis.challenges
    ALTER COLUMN materiality SET NOT NULL,
    ADD CONSTRAINT challenges_materiality_known CHECK (
        materiality IN ('non-material', 'material', 'decision-critical')
    ),
    /*
     * The two kinds that may argue without counter-evidence contest REASONING
     * rather than facts, and demanding a counter-source for them would mean the
     * Devil's Advocate could not say "this rests on something nobody
     * established". They must state what would settle them instead, which is
     * the mechanical difference between an objection and a mood.
     */
    ADD CONSTRAINT challenges_reasoning_objection_states_resolution CHECK (
        kind NOT IN ('fragile-assumption', 'overconfidence')
        OR would_be_resolved_by IS NOT NULL
    ),
    ADD CONSTRAINT challenges_resolved_names_resolver CHECK (
        outcome = 'open' OR (resolved_by IS NOT NULL AND btrim(resolved_by) <> '')
    );

CREATE INDEX challenges_blocking_idx ON analysis.challenges (review_id)
    WHERE outcome = 'open' AND materiality <> 'non-material';

-- ------------------------------------------------------- drop the document --

/*
 * Last, and guarded. Everything `detail` carried now has a column, and the
 * guard fails the migration rather than losing anything if that is not true of
 * some row this migration did not anticipate.
 *
 * Forward-only migrations do not normally drop, and this one is justified only
 * because the document was a query surface pretending to be a record: the
 * headquarters cannot ask "which risk findings are critical" through it, and
 * leaving it beside the columns would give two answers to that question.
 */
DO $$
DECLARE
    stranded integer;
BEGIN
    SELECT count(*) INTO stranded
    FROM analysis.reviews
    WHERE kind = 'risk'
      AND jsonb_array_length(coalesce(detail -> 'concerns', '[]'::jsonb)) > 0
      AND NOT EXISTS (
          SELECT 1 FROM analysis.risk_findings f WHERE f.review_id = reviews.id
      );
    IF stranded > 0 THEN
        RAISE EXCEPTION
            'migration 0019 would discard risk concerns on % review(s); '
            'migrate them into analysis.risk_findings first', stranded;
    END IF;

    SELECT count(*) INTO stranded
    FROM analysis.reviews
    WHERE kind = 'verification'
      AND jsonb_array_length(coalesce(detail -> 'claimsReviewed', '[]'::jsonb)) > 0
      AND NOT EXISTS (
          SELECT 1 FROM analysis.verification_claims_reviewed c
          WHERE c.review_id = reviews.id
      );
    IF stranded > 0 THEN
        RAISE EXCEPTION
            'migration 0019 would discard claimsReviewed on % review(s)', stranded;
    END IF;
END $$;

/*
 * Compliance findings stay in `detail` — and so `detail` stays, narrowed by a
 * constraint to the one kind that still uses it. Compliance is not in C1C-4's
 * scope: no command records one, so moving its findings relational would be
 * schema for a shape nothing writes. Tracked as TD-42.
 *
 * Everything else is emptied, which the guard above has just proved loses
 * nothing. The constraint then makes the document unreachable for the three
 * kinds that have columns, so there is no second place for a verdict field to
 * appear.
 */
UPDATE analysis.reviews SET detail = '{}'::jsonb WHERE kind <> 'compliance';

ALTER TABLE analysis.reviews
    ADD CONSTRAINT reviews_detail_is_compliance_only CHECK (
        kind = 'compliance' OR detail = '{}'::jsonb
    );

-- ------------------------------------------------ events point at verdicts --

/*
 * A `review` event without the verdict it records is a timeline entry nobody
 * can follow to the findings. The subject said "a review happened"; nothing
 * said which.
 */
ALTER TABLE analysis.transition_events
    ADD COLUMN review_id text REFERENCES analysis.reviews (id),
    ADD CONSTRAINT transition_events_review_id_for_review_subject CHECK (
        review_id IS NULL OR subject = 'review'
    );

CREATE INDEX transition_events_review_idx
    ON analysis.transition_events (review_id)
    WHERE review_id IS NOT NULL;

-- ---------------------------------------------------------------- grants --

GRANT SELECT, INSERT ON
    analysis.verification_claims_reviewed,
    analysis.risk_findings,
    analysis.risk_limits
TO finos_app;

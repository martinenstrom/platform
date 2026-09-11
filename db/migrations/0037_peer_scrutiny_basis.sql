-- Peer scrutiny becomes a fact the CIO gate reads, and the basis format goes to v3.
--
-- Until now every objection an eligibility basis could carry came from the
-- Devil's Advocate. The gate could therefore answer "were the objections
-- settled" and could not answer "did anyone qualified look" — and a revision
-- nobody read passes the first question trivially, for the same reason an
-- unopened letter has no reply.
--
-- `EligibilityBasis.peerScrutiny` records which analytical desks examined the
-- revision, whom each examined, and what each still contests. An entry with no
-- open challenges is a desk that read the argument and found nothing to raise;
-- NO entry is nobody having read it. `PEER_SCRUTINY_ABSENT` reads exactly that
-- difference, which is why the examination is stored as a list of acts rather
-- than as a flag.
--
-- Changing the canonical encoding changes every basis digest, so this is
-- canonicalization version 3, never an edit to version 2.

-- The guard that makes the version cutover honest.
--
-- Required by §10.1 of the canonicalization specification, and not decoration:
-- it is the EVIDENCE for the premise the cutover rests on. The v3 reader does
-- not verify v2 manifests, which is only acceptable because no v2 record
-- exists. If one does, the premise is false, this migration must refuse, and no
-- cutover may occur until a compatibility strategy is designed.
DO $$
DECLARE
    legacy bigint;
BEGIN
    SELECT count(*) INTO legacy FROM analysis.cio_submissions;
    IF legacy > 0 THEN
        RAISE EXCEPTION
            'Refusing to cut over to basis canonicalization v3: % submission(s) '
            'already carry a version-2 manifest. The v3 reader does not verify '
            'version 2, so these records would become unverifiable. Design a '
            'compatibility strategy before applying this migration.', legacy;
    END IF;
END $$;

-- ------------------------------------------------------------- the policy --

-- Peer scrutiny becomes a gate the registry describes.
--
-- The runtime reads its rules from this table, so a participation the registry
-- cannot express is a rule the record cannot explain. Added with no default:
-- every existing policy must state its position explicitly rather than inherit
-- one nobody chose.
ALTER TABLE analysis.eligibility_policies
    ADD COLUMN peer_scrutiny text;

-- Version 1 placed the question outside its scope, and that is a fact rather
-- than a convenience. When version 1 was in force the firm had ONE analytical
-- desk able to speak about rates — `rates` did not exist and `global-macro`
-- held the handle — so there was nobody who could have examined a macro
-- conclusion as a peer. `outside-policy-scope` is precisely "the question was
-- not in scope"; recording it is not an edit to what version 1 required.
UPDATE analysis.eligibility_policies
   SET peer_scrutiny = 'outside-policy-scope'
 WHERE version = '1';

ALTER TABLE analysis.eligibility_policies
    ALTER COLUMN peer_scrutiny SET NOT NULL;

-- Whose unresolved challenges CHALLENGE_UNRESOLVED weighs.
--
-- Separate from `devils_advocate` and `peer_scrutiny`, which say whether a
-- review of that kind must EXIST. This says whose OBJECTIONS count once they
-- do, and it is the reason the gate can gain peer challenges without changing
-- what a version-1 decision meant: the evaluator reads the mandates the policy
-- declares and never branches on a version number.
ALTER TABLE analysis.eligibility_policies
    ADD COLUMN challenge_mandates text[];

-- Version 1 weighed the Devil's Advocate alone, which is what it has always
-- meant. Written down rather than left implicit in the absence of any other
-- challenger: without this row an evaluator taught about peers would start
-- weighing peer objections against decisions taken under version 1.
UPDATE analysis.eligibility_policies
   SET challenge_mandates = ARRAY['devils-advocate']
 WHERE version = '1';

ALTER TABLE analysis.eligibility_policies
    ALTER COLUMN challenge_mandates SET NOT NULL;

/*
 * Membership and canonical order.
 *
 * Order matters because the schema fingerprint compares this table row by row:
 * two policies weighing the same mandates in different array orders would read
 * as a schema difference that does not exist. `is_canonically_sorted` is the
 * same function `department_handles` uses, for the same reason.
 *
 * Coherence between the mandates and the participation columns is NOT checked
 * here. Whether "a review must exist but its objections never count" is a
 * sensible policy is a domain question, and a CHECK that answered it would put
 * a governance rule in SQL where no test or version covers it.
 */
ALTER TABLE analysis.eligibility_policies
    ADD CONSTRAINT eligibility_policies_challenge_mandates_known CHECK (
        challenge_mandates <@ ARRAY['devils-advocate', 'peer']::text[]
        AND analysis.is_canonically_sorted(challenge_mandates)
    );

ALTER TABLE analysis.eligibility_policies
    DROP CONSTRAINT eligibility_policies_participation_known;

ALTER TABLE analysis.eligibility_policies
    ADD CONSTRAINT eligibility_policies_participation_known CHECK (
        verification IN ('required', 'conditional-by-resolution', 'outside-policy-scope')
        AND devils_advocate IN ('required', 'conditional-by-resolution', 'outside-policy-scope')
        AND peer_scrutiny IN ('required', 'conditional-by-resolution', 'outside-policy-scope')
        AND risk IN ('required', 'conditional-by-resolution', 'outside-policy-scope')
        AND compliance IN ('required', 'conditional-by-resolution', 'outside-policy-scope')
    );

-- Version 2: a second analytical desk must have read the argument.
--
-- A NEW ROW, never an edit to version 1. Decisions already taken were taken by
-- a firm that had one desk capable of the reading; re-resolving them under a
-- rule requiring two would convict the record of failing a test that did not
-- exist when it was written.
--
-- Every other threshold is copied from version 1 unchanged, deliberately: this
-- version adds one requirement and adjusts nothing else, so any difference in
-- outcome between the two is attributable to peer scrutiny and to nothing else.
INSERT INTO analysis.eligibility_policies
    (version, gate, verification, devils_advocate, peer_scrutiny, risk, compliance,
     challenge_mandates,
     challenge_blocks_at_or_above, disagreement_blocks_at_or_above,
     unresolved_conditional_blocks, domain_contract_version)
VALUES (
    '2', 'internal CIO decision',
    'required', 'required', 'required', 'conditional-by-resolution',
    'outside-policy-scope',
    /*
     * Both mandates, one gate, one threshold. A peer's unresolved objection
     * blocks exactly as the Devil's Advocate's does, because it is the same
     * institutional object — only its provenance differs, and provenance is
     * carried on the challenge rather than expressed by inventing a second
     * gate for the CIO to reconcile.
     */
    ARRAY['devils-advocate', 'peer'],
    'material', 'decision-critical', true, '8'
);

-- ------------------------------------------------- the examinations stored --

/*
 * Which desks examined the revision this submission attests.
 *
 * A TABLE rather than a pair of columns on `cio_submissions`, because several
 * desks may examine one argument and that is the capability, not an edge case.
 * Two columns would hold the last examiner and silently discard the rest —
 * reporting one desk's reading as the firm's whole second opinion.
 *
 * `sequence` travels with the review for the same reason it does on the basis:
 * the record says which examination stood, and a reader comparing two
 * examinations by the same desk needs the order the firm allocated.
 */
CREATE TABLE analysis.submission_peer_examinations (
    submission_id          text NOT NULL REFERENCES analysis.cio_submissions (id),
    review_id              text NOT NULL REFERENCES analysis.reviews (id),
    sequence               integer NOT NULL,
    by_department_id       text NOT NULL REFERENCES analysis.departments (id),
    examined_department_id text NOT NULL REFERENCES analysis.departments (id),

    PRIMARY KEY (submission_id, review_id),

    /* A desk examining itself is the thing peer scrutiny is an alternative to.
     * Already refused by `reviews_peer_examines_another_department`; repeated
     * here because this table is what the gate reads, and a basis is not
     * allowed to assert something the review record cannot support. */
    CONSTRAINT submission_peer_examinations_distinct_desks
        CHECK (by_department_id <> examined_department_id),

    /* One examination per desk per submission. Two rows for one desk would mean
     * the basis could not say which of them stood. */
    CONSTRAINT submission_peer_examinations_one_per_desk
        UNIQUE (submission_id, by_department_id)
);

/*
 * The composite key the peer-challenge table needs.
 *
 * `id` is already the primary key, so this adds no fact — it makes
 * `(challenge_id, review_id)` referenceable, which is what turns "this
 * objection belongs to that examination" from a claim the writer makes into a
 * claim the database enforces.
 */
ALTER TABLE analysis.challenges
    ADD CONSTRAINT challenges_id_review_unique UNIQUE (id, review_id);

/*
 * A peer's objections that were still open when the submission was made.
 *
 * Kept apart from `submission_open_challenges`, which holds the Devil's
 * Advocate's. Merging them would put two mandates in one list, and the CIO
 * would read "three open objections" without being able to tell scrutiny by a
 * desk that knows the subject from the control function's standing duty to
 * object — the distinction migration 0034 exists to preserve.
 *
 * Materiality is stored on every row and filtered on none: which of these BLOCK
 * is the gate's answer under the policy in force, and storing only the blocking
 * ones would be a policy conclusion a later policy could make wrong.
 */
CREATE TABLE analysis.submission_peer_challenges (
    submission_id text NOT NULL,
    review_id     text NOT NULL,
    challenge_id  text NOT NULL,
    materiality   text NOT NULL,

    PRIMARY KEY (submission_id, challenge_id),

    /* The objection belongs to an examination this submission actually
     * records. Without it a basis could cite a peer challenge from a review it
     * never claimed to have read. */
    FOREIGN KEY (submission_id, review_id)
        REFERENCES analysis.submission_peer_examinations (submission_id, review_id),

    /* And the challenge really is that review's. The composite reference is
     * what makes the attribution unforgeable rather than merely asserted. */
    FOREIGN KEY (challenge_id, review_id)
        REFERENCES analysis.challenges (id, review_id),

    CONSTRAINT submission_peer_challenges_materiality_known
        CHECK (materiality IN ('non-material', 'material', 'decision-critical'))
);

-- --------------------------------------------------------- the manifest --

-- The manifest version the schema will accept from here.
--
-- Version 2 is dropped rather than kept alongside 3. The guard above proved no
-- v2 record exists, and accepting a version the reader cannot verify would be
-- the "third option" §10.1 says there is none of.
ALTER TABLE analysis.cio_submissions
    DROP CONSTRAINT cio_submissions_manifest_canon_version_known;

ALTER TABLE analysis.cio_submissions
    ADD CONSTRAINT cio_submissions_manifest_canon_version_known
        CHECK (manifest_canon_version IN ('3'));

-- ------------------------------------------------------------------ grants --

/*
 * SELECT and INSERT only, like every other submission relation. A basis is
 * written once with the act it attests; a runtime able to edit it could add an
 * examination that never happened to a submission already made.
 */
GRANT SELECT, INSERT ON
    analysis.submission_peer_examinations,
    analysis.submission_peer_challenges
TO finos_app;

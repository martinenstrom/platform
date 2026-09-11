-- Challenge provenance: under whose mandate, and by which desk.
--
-- Until now a challenge could only be authored one way. `recordDevilsAdvocateReview`
-- rejected every department except 'devils-advocate', so the firm had exactly one
-- kind of objection and no field was needed to say which kind it was.
--
-- Peer cross-examination changes that. Rates contesting Macro's attribution of a
-- Treasury move and the Devil's Advocate discharging its standing mandate are two
-- different institutional acts sharing one structure, and a firm that cannot tell
-- them apart cannot answer "was this conclusion challenged by someone who knows the
-- subject?" — which is a different question from "was it challenged?".
--
-- ## The backfill is derived from stored data, not assumed
--
-- Both facts already exist in the database for every legacy challenge:
--
--   analysis.reviews.kind              was constrained to a known set including
--                                      'devils-advocate'
--   analysis.reviews.by_department_id  the desk that filed the verdict
--
-- and every challenge is FK'd to exactly one review. So this migration reads the
-- provenance off the parent review rather than writing a constant, and the domain
-- claim it rests on is the one the old command enforced rather than a guess about
-- history.
--
-- ## It fails loudly if that claim is wrong
--
-- `challenger_kind` is derived through a CASE that produces NULL for any challenge
-- whose review is not a Devil's Advocate review. The NOT NULL constraint applied
-- afterwards then aborts the migration rather than inventing provenance for a row
-- whose origin we cannot establish. If this migration fails on that constraint, the
-- historical claim above was false and the failure is the correct outcome.
--
-- ## No hash moves
--
-- Verified against all four surfaces before this was written:
--
--   challenge identity     `deriveChallengeId(commandId, ordinal)` — reads no
--                          challenge field, so no id changes
--   command/event hash     `RecordDevilsAdvocateReview`'s payload is an explicit
--                          projection of {contests, kind, argument, materiality,
--                          outcome}; it does not spread the challenge
--   eligibility digest     `canonicalBasisInput` reads
--                          EligibilityBasis.devilsAdvocate.openChallenges as
--                          {challengeId, materiality} only — never the Challenge
--   content hash           challenges have none; content addressing applies to
--                          observations
--
-- So this migration extends the representation of a challenge without restating any
-- already-persisted act.

ALTER TABLE analysis.challenges
    ADD COLUMN challenger_kind  text,
    ADD COLUMN by_department_id text;

-- Derived from the parent review. A challenge on a non-Devil's-Advocate review
-- yields NULL here and is caught by the NOT NULL below.
UPDATE analysis.challenges AS c
   SET challenger_kind = CASE
           WHEN r.kind = 'devils-advocate' THEN 'devils-advocate'
           ELSE NULL
       END,
       by_department_id = r.by_department_id
  FROM analysis.reviews AS r
 WHERE r.id = c.review_id;

-- The UPDATE above queues this table's DEFERRED constraint trigger (the rule
-- that a challenge must cite counter-evidence, checked at COMMIT rather than at
-- INSERT). PostgreSQL refuses to ALTER a table with pending trigger events, so
-- without this the migration fails with 55006 on any database that already
-- holds a challenge — which is every database except a fresh one.
--
-- Found by running the migration against a database seeded to 0033 with a real
-- legacy challenge. It typechecks, the SQL is valid in isolation, and it only
-- fails against the production-shaped case.
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE analysis.challenges
    ALTER COLUMN challenger_kind  SET NOT NULL,
    ALTER COLUMN by_department_id SET NOT NULL;

-- The two mandates, named. A third would be a new institutional act and belongs in
-- its own migration, so that adding one is a decision rather than a typo.
ALTER TABLE analysis.challenges
    ADD CONSTRAINT challenges_challenger_kind_known CHECK (
        challenger_kind IN ('peer', 'devils-advocate')
    );

-- The challenger must be a department the firm actually has. Without this a
-- misspelled desk id would persist as a valid-looking institutional act, and the
-- mapper would faithfully reconstruct an objection from a desk that does not exist.
ALTER TABLE analysis.challenges
    ADD CONSTRAINT challenges_by_department_fk
        FOREIGN KEY (by_department_id) REFERENCES analysis.departments (id);

-- Reading "which desks challenged this claim, under which mandate" is the access
-- pattern the peer-scrutiny question will need.
CREATE INDEX challenges_challenger_idx
    ON analysis.challenges (contests_claim_id, challenger_kind, by_department_id);

-- 0022 · The eligibility-basis witness, stored beside the submission it attests.
--
-- A CIO submission keeps its basis as child rows and nothing else. Delete one
-- and the submission hydrates as a smaller but internally valid record: the
-- store cannot tell corruption from a legitimately smaller basis, and the
-- failure runs in the dangerous direction -- less work appears to have been
-- required, so the submission looks MORE eligible than it was. TD-58.
--
-- Three columns rather than one JSON document, for the reason 0020 removed the
-- last blob: a field inside a document is a field nothing can constrain. The
-- CHECKs below can only exist because these are columns.
--
-- WHAT THIS IS NOT. Corruption-evident, never tamper-proof. It catches a writer
-- that changed the data without recomputing the witness -- an accidental
-- DELETE, a partial restore, a broken migration, an import that did not know
-- about the child tables. It cannot survive an actor who edits a child row AND
-- rewrites the digest. Nothing stored beside the data can; that needs
-- out-of-band evidence, which is TD-60.
--
-- NO DATABASE BACKSTOP IS POSSIBLE. The digest is a domain canonicalisation and
-- PostgreSQL cannot recompute it. A trigger that tried would be a second
-- implementation of the rule, free to disagree with the first -- which is the
-- defect class this codebase has already found twice. Recorded honestly rather
-- than approximated.

-- The runner wraps each migration in its own transaction (`migration.transactional`),
-- so this file must not open one. An explicit BEGIN here nests inside that and
-- PostgreSQL warns "there is already a transaction in progress" -- the COMMIT
-- then closes the RUNNER's transaction early, leaving the rest of the migration
-- outside it. No other migration in this tree opens one either.

-- ---------------------------------------------------------------- the guard
--
-- No retained non-test submission exists, so the witness is NOT NULL from the
-- first row and there is no backfill. Manufacturing a manifest from present-day
-- child rows would invent a point-in-time fact: it would attest what the table
-- says today, not what was written, and it would verify forever after.
--
-- If that assumption ever stops holding, this fails the migration instead.
DO $$
DECLARE
    existing bigint;
BEGIN
    SELECT count(*) INTO existing FROM analysis.cio_submissions;
    IF existing > 0 THEN
        RAISE EXCEPTION
            'migration 0022 expects no retained CIO submissions, found %. '
            'A witness cannot be manufactured from current state without '
            'inventing a point-in-time fact; add a deliberate backfill '
            'decision instead of relaxing this guard.', existing;
    END IF;
END $$;

-- --------------------------------------------------------------- the columns

ALTER TABLE analysis.cio_submissions
    -- The digest algorithm, stored so a later change cannot be mistaken for
    -- corruption: a row whose algorithm this build does not implement is
    -- refused rather than recomputed under a different one.
    ADD COLUMN manifest_algorithm text NOT NULL,
    -- The canonicalisation shape in force when the digest was taken. Same
    -- reason, and the more likely of the two to move.
    ADD COLUMN manifest_canon_version text NOT NULL,
    -- Lowercase hex, 64 characters. Never re-derived on read except to compare.
    ADD COLUMN manifest_digest text NOT NULL;

-- ---------------------------------------------------------------- the checks
--
-- Bounded at the schema, not merely at the boundary that wrote the row. A
-- constraint the database holds is one a broken import cannot talk past.

ALTER TABLE analysis.cio_submissions
    ADD CONSTRAINT cio_submissions_manifest_algorithm_known
        CHECK (manifest_algorithm IN ('sha256')),
    ADD CONSTRAINT cio_submissions_manifest_canon_version_known
        CHECK (manifest_canon_version IN ('1')),
    -- Shape only. The database cannot judge whether the digest is CORRECT --
    -- see the header -- but it can insist it is the right size and alphabet,
    -- which refuses a truncated or upper-cased value at the point of write.
    ADD CONSTRAINT cio_submissions_manifest_digest_well_formed
        CHECK (manifest_digest ~ '^[0-9a-f]{64}$');

-- ---------------------------------------------------------------- the grants
--
-- SELECT and INSERT only. The manifest is part of a write-once record, and
-- withholding UPDATE means the runtime cannot rewrite a witness even if the
-- code tried to. The role already holds these on the table from 0020; restating
-- them here keeps the intent visible beside the columns they cover.

GRANT SELECT, INSERT ON analysis.cio_submissions TO finos_app;

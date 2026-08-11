-- Challenge materiality becomes a stored fact, and the basis format goes to v2.
--
-- `evaluateEligibilityGates` failed on ANY open challenge, while
-- `challengeBlocks` and `EligibilityPolicy.challengeBlocksAtOrAbove` say a
-- non-material one does not block. The gate had silently raised the firm's
-- threshold. It could not do otherwise: the basis carried challenge ids with no
-- materiality, so there was nothing for a threshold to compare against.
--
-- Materiality now travels with each open challenge, exactly as it already does
-- for `materialDisagreements`. Which challenges BLOCK is the gate's answer under
-- the policy in force -- never a stored subset, which would be a policy
-- conclusion that a later policy could make wrong, and would also lose the
-- non-material objections the CIO is entitled to read beside the thesis.
--
-- Changing the canonical encoding changes every basis digest, so this is
-- canonicalization version 2, never an edit to version 1.

-- The guard that makes the version cutover honest.
--
-- Not decoration: it is the EVIDENCE for the premise the cutover rests on. The
-- v2 reader does not verify v1 manifests, which is only acceptable because no
-- v1 record exists. If one does, the premise is false, this migration must
-- refuse, and no cutover may occur until a compatibility strategy is designed.
DO $$
DECLARE
    legacy bigint;
BEGIN
    SELECT count(*) INTO legacy FROM analysis.cio_submissions;
    IF legacy > 0 THEN
        RAISE EXCEPTION
            'Refusing to cut over to basis canonicalization v2: % submission(s) '
            'already carry a version-1 manifest. The v2 reader does not verify '
            'version 1, so these records would become unverifiable. Design a '
            'compatibility strategy before applying this migration.', legacy;
    END IF;
END $$;

-- The weight the Devil's Advocate gave each open challenge.
--
-- NOT NULL with no default and no backfill. The guard has established the table
-- is empty, so there is nothing to default -- and a default would manufacture an
-- assessment nobody made.
ALTER TABLE analysis.submission_open_challenges
    ADD COLUMN materiality text NOT NULL;

ALTER TABLE analysis.submission_open_challenges
    ADD CONSTRAINT submission_open_challenges_materiality_known
        CHECK (materiality IN ('non-material', 'material', 'decision-critical'));

-- The manifest version the schema will accept from here.
ALTER TABLE analysis.cio_submissions
    DROP CONSTRAINT cio_submissions_manifest_canon_version_known;

ALTER TABLE analysis.cio_submissions
    ADD CONSTRAINT cio_submissions_manifest_canon_version_known
        CHECK (manifest_canon_version IN ('2'));

-- Grants are unchanged: the column joins a table `finos_app` already holds
-- SELECT and INSERT on, and a column-level grant would be a second place the
-- permission is described.

-- 0023 · A claim disposition records materiality, not whether it blocks.
--
-- `blocks_eligibility` was derived at AGGREGATION time from materiality alone.
-- But whether a materiality blocks CIO eligibility is a **policy judgement**,
-- and the eligibility policy is chosen later, at submission, by a different
-- actor -- possibly a different version with a different threshold.
--
-- So the stored boolean was a future judgement written prematurely. It could
-- only stay correct while every policy agreed with the one hardcoded rule, and
-- `EligibilityPolicy.disagreementBlocksAtOrAbove` exists precisely so they need
-- not agree. The first policy setting a different threshold would have left
-- every stored row quietly wrong.
--
-- WHAT REPLACES IT: nothing stored. The judgement is derived when it is
-- actually needed, through `disagreementBlocksEligibility(materiality,
-- threshold)`, with the threshold taken from the versioned policy the
-- submission selected.
--
-- That is STRONGER than the boolean, not weaker. Historical reconstruction
-- needs only the recorded materiality, the policy version the submission used,
-- and the policy registry -- and it can then name the governing policy, which a
-- bare boolean never could.
--
--     materiality (fact, recorded here)
--       + policy version (chosen at submission)
--       + policy registry
--       = whether it blocked, and under which rule
--
-- No replacement "currently blocking" column is added. Adding one would
-- recreate the same defect with a newer name.

-- ------------------------------------------------------------------ the guard
--
-- The column is dropped rather than reinterpreted, so this refuses if any row
-- exists. With retained rows the removal would be a semantic change to stored
-- records and would need a deliberate decision about what those rows meant --
-- not a silent drop.
DO $$
DECLARE
    existing bigint;
BEGIN
    SELECT count(*) INTO existing FROM analysis.aggregation_claim_dispositions;
    IF existing > 0 THEN
        RAISE EXCEPTION
            'migration 0023 expects no retained claim dispositions, found %. '
            'Dropping blocks_eligibility from populated rows changes what those '
            'records mean; make that decision explicitly rather than relaxing '
            'this guard.', existing;
    END IF;
END $$;

-- ------------------------------------------------------------- the index
--
-- Partial on the column, so it goes first: an index over a dropped column
-- cannot survive, and dropping it explicitly says so rather than letting the
-- cascade decide.
DROP INDEX IF EXISTS analysis.aggregation_dispositions_blocking;

-- --------------------------------------------------------- the constraint
--
-- `aggregation_materiality_consequences` tied three columns together: a
-- materiality had to arrive with both consequences, or none of them. With one
-- consequence gone the rule is restated over what remains, rather than dropped
-- -- the pairing is still the point.
ALTER TABLE analysis.aggregation_claim_dispositions
    DROP CONSTRAINT aggregation_materiality_consequences;

ALTER TABLE analysis.aggregation_claim_dispositions
    DROP COLUMN blocks_eligibility;

ALTER TABLE analysis.aggregation_claim_dispositions
    ADD CONSTRAINT aggregation_materiality_consequences CHECK (
        (materiality IS NULL) = (escalation_required IS NULL)
    );

-- The stages a decided case actually occupies.
--
-- `CaseStage` has declared `decided` and `deferred` since the decision model
-- was written, and `TERMINAL_STAGES` has listed `decided` alongside `published`
-- and `withdrawn`. The schema never learned either. Two constraints from 0003
-- have been refusing them ever since:
--
--   * the stage CHECK lists nine stages and neither of these is among them
--   * `cases_closed_iff_terminal` ties `closed_at` to `published`/`withdrawn`
--     only, while `transitionCase` sets `closedAt` for every terminal stage --
--     so a case reaching `decided` violated the constraint from both sides at
--     once
--
-- Nothing caught it because nothing had ever moved a case to `decided`. The
-- end-to-end CIO flow is the first code that does, and it failed here.
--
-- The domain is the contract and the schema is behind it, so this restates the
-- constraints over what `CaseStage` and `TERMINAL_STAGES` already declare. No
-- judgement is being made here about which stages should be terminal; that
-- decision is in `cases.ts` and this migration follows it.

-- A guard, not decoration. If a case somehow already sits outside the stages
-- this migration is about to permit, the constraint below would fail with a
-- message about the constraint rather than about the row, and the row is what
-- someone would need to see.
DO $$
DECLARE
    stray text;
BEGIN
    SELECT string_agg(DISTINCT stage, ', ') INTO stray
    FROM analysis.cases
    WHERE stage NOT IN ('intake', 'research', 'aggregation', 'review', 'returned',
                        'blocked', 'decision', 'decided', 'deferred', 'published',
                        'withdrawn');
    IF stray IS NOT NULL THEN
        RAISE EXCEPTION
            'Cases hold stages this migration does not permit: %. Reconcile them '
            'before widening the constraint.', stray;
    END IF;
END $$;

ALTER TABLE analysis.cases
    DROP CONSTRAINT cases_stage_known;

ALTER TABLE analysis.cases
    ADD CONSTRAINT cases_stage_known CHECK (
        stage IN ('intake', 'research', 'aggregation', 'review', 'returned',
                  'blocked', 'decision', 'decided', 'deferred', 'published',
                  'withdrawn')
    );

-- `deferred` is deliberately NOT closed. The CIO looked and chose to wait,
-- which is a live case with an answer pending -- the opposite of a finished
-- one. `decided` is closed: the firm committed, and `decided -> published` is
-- the only way out of it.
ALTER TABLE analysis.cases
    DROP CONSTRAINT cases_closed_iff_terminal;

ALTER TABLE analysis.cases
    ADD CONSTRAINT cases_closed_iff_terminal CHECK (
        (stage IN ('decided', 'published', 'withdrawn')) = (closed_at IS NOT NULL)
    );

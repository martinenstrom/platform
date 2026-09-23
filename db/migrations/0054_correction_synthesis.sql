-- 0054 · a synthesis may be a correction
--
-- Migration 0018 tied a revision's aggregation to one cause: a revision names
-- the aggregation that produced it exactly when its cause is
-- `manager-aggregation`. The bounded correction round (TD-99, ruled
-- 2026-09-22) mints the successor of a revision Verification sent back with
-- cause `correction` — the lineage must say WHY revision 3 exists — and that
-- successor is a synthesis like any other: the Research Office produced it
-- from the corrected contributions, and it names its aggregation.
--
-- Measured live on 2026-09-23 (run 16 of the gold case,
-- `docs/jarvis-voice-live-proof.md` §16): the whole round ran to the office's
-- door and the successor was refused here, by this constraint, at the store.
-- The in-memory repositories enforce no such rule, which is why every stub
-- proof of the round passed.
--
-- The rule stays as strict as it was, one cause wider. `correction` was
-- already a cause a PERSON revises under (`ReviseThesis`), with no
-- aggregation; it is now also the cause of the office's corrected synthesis,
-- with one. So: a managerial synthesis names its aggregation; a correction
-- may or may not, depending on who made it; nothing else names one.

ALTER TABLE analysis.thesis_revisions
    DROP CONSTRAINT thesis_revision_aggregation_where_synthesised;

ALTER TABLE analysis.thesis_revisions
    ADD CONSTRAINT thesis_revision_aggregation_where_synthesised CHECK (
        CASE revision_cause
            WHEN 'manager-aggregation' THEN aggregation_id IS NOT NULL
            WHEN 'correction' THEN true
            ELSE aggregation_id IS NULL
        END
    );

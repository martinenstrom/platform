-- Corrections from the Stage 2 architecture review.
--
-- Four schema-level defects, each one found because the two adapters were
-- compared against each other rather than each judged on its own terms.
--
-- Forward migration. 0006, 0007 and 0011 are applied and are never edited.

-- ------------------------------------------------- B3 · run events are append-only

-- `runs.save` appended events guarded only by `WHERE NOT EXISTS`. Two
-- concurrent saves can both pass that check and both insert: an existence test
-- without a unique index behind it is a race, not a constraint.
--
-- The key is (run_id, at, state). A run cannot enter the same state at the same
-- instant twice — if it appears to, one of the two writes is a replay.
ALTER TABLE analysis.run_events
    ADD CONSTRAINT run_events_identity_unique UNIQUE (run_id, at, state);

-- ------------------------------------- H2 · verification findings keep their hash

-- A finding citing evidence stored the set and observation but not the content
-- hash, so the adapter reconstructed it as `''`. That is fabricated data, and
-- it disables the one thing the hash exists for: detecting that the evidence
-- moved after somebody verified against it.
ALTER TABLE analysis.verification_findings ADD COLUMN content_hash text;

-- All three parts of a citation, or none of them. A partial citation cannot be
-- resolved and cannot be checked for revision.
ALTER TABLE analysis.verification_findings
    ADD CONSTRAINT verification_findings_citation_complete CHECK (
        (evidence_set_id IS NULL AND observation_id IS NULL AND content_hash IS NULL)
        OR (evidence_set_id IS NOT NULL AND observation_id IS NOT NULL
            AND content_hash IS NOT NULL)
    );

-- 0006's weaker pairwise rule is implied by the three-way one above.
ALTER TABLE analysis.verification_findings
    DROP CONSTRAINT verification_findings_evidence_complete;

-- ------------------------------------------------ H3 · every case movement has an actor

-- `InvestmentCase.transitions` is projected from these events, and
-- `CaseTransition` requires an employee and a department: a department acts
-- through a person. The adapter was filling a missing actor with `''`, which
-- reads as an employee and is not one.
--
-- Scoped to `subject = 'case'` deliberately. A run event legitimately has no
-- human actor — the run is the actor — and forcing one there would invite
-- exactly the invented identity this removes.
ALTER TABLE analysis.transition_events
    ADD CONSTRAINT transition_events_case_movement_has_actor CHECK (
        subject <> 'case'
        OR from_state IS NULL
        OR (actor_employee_id IS NOT NULL AND actor_department_id IS NOT NULL)
    );

-- ---------------------------------------- H6 · one truth for the selected revision

-- The selected revision was stored twice: `case_decisions.selected_revision_id`
-- and a `decision_revisions` row with `relation = 'selected'`. Nothing enforced
-- that they agreed, and the mapper silently preferred the column.
--
-- Redundancy removed rather than reconciled. The column is authoritative — it
-- is the one a foreign key already protects — and the relation table now
-- records only what the column cannot: the alternatives that were considered
-- and what happened to them.
DELETE FROM analysis.decision_revisions WHERE relation = 'selected';

DROP INDEX analysis.decision_revisions_one_selected;

ALTER TABLE analysis.decision_revisions
    DROP CONSTRAINT decision_revisions_relation_known,
    ADD CONSTRAINT decision_revisions_relation_known
        CHECK (relation IN ('not-selected', 'rejected'));

-- The selected revision cannot also be listed as an alternative to itself.
CREATE FUNCTION analysis.assert_revision_not_both_selected_and_not()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM analysis.case_decisions
        WHERE case_id = NEW.case_id AND selected_revision_id = NEW.revision_id
    ) THEN
        RAISE EXCEPTION
            'Revision "%" is the selected revision of case "%" and cannot also be '
            'recorded as %.', NEW.revision_id, NEW.case_id, NEW.relation
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER decision_revisions_exclude_selected
    AFTER INSERT OR UPDATE ON analysis.decision_revisions
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION analysis.assert_revision_not_both_selected_and_not();

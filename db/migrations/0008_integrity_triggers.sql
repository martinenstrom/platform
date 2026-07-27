-- The three rules a constraint cannot express.
--
-- Everything expressible as a CHECK, a UNIQUE or a FOREIGN KEY is one, in the
-- migration that creates the table. What remains are rules about how a row may
-- CHANGE, which a constraint cannot see because it only ever examines the new
-- row.
--
-- These are corruption prevention, not business logic. None of them decides
-- anything: they refuse writes that would make the record untrue. The
-- governance rules — who may block, what makes a thesis eligible, whether a
-- gate passes — stay in the domain, evaluated in one place.
--
-- Permissions do most of the work (0009). A trigger is used only where the
-- rule is finer than a table-level grant: "this column may change and the
-- others may not" is not expressible as a GRANT.

-- ------------------------------------------- thesis revisions are immutable --

-- A sealed revision is never edited. Marking one superseded IS a legitimate
-- write to an old row — it is how a lineage records that a newer version
-- exists — so the lifecycle may move and nothing else may.
--
-- Without this the design collapses: a review reviewed a specific argument,
-- and an argument that can be edited afterwards makes its reviews meaningless.
CREATE FUNCTION analysis.assert_revision_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF ROW(NEW.revision_id, NEW.thesis_id, NEW.revision_number,
           NEW.supersedes_revision_id, NEW.case_id, NEW.statement, NEW.position,
           NEW.invalidation_criteria, NEW.horizon,
           NEW.proposed_by_department_id, NEW.proposed_by_employee_id,
           NEW.proposed_at, NEW.revised_at, NEW.revision_reason)
       IS DISTINCT FROM
       ROW(OLD.revision_id, OLD.thesis_id, OLD.revision_number,
           OLD.supersedes_revision_id, OLD.case_id, OLD.statement, OLD.position,
           OLD.invalidation_criteria, OLD.horizon,
           OLD.proposed_by_department_id, OLD.proposed_by_employee_id,
           OLD.proposed_at, OLD.revised_at, OLD.revision_reason)
    THEN
        RAISE EXCEPTION
            'Thesis revision "%" is sealed. Only its lifecycle may change; '
            'mint a new revision instead.', OLD.revision_id
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER thesis_revisions_immutable
    BEFORE UPDATE ON analysis.thesis_revisions
    FOR EACH ROW EXECUTE FUNCTION analysis.assert_revision_immutable();

-- --------------------------------------------- decisions are immutable --

-- The runtime role is not granted UPDATE or DELETE on this table, so for the
-- application this is already impossible. The trigger covers the rest: a
-- migration, an operator session, or any future role that acquires the grant.
--
-- This is the record that says what the institution decided and why. Of
-- everything in the schema it is the one where a quiet edit would be least
-- detectable and most damaging.
CREATE FUNCTION analysis.refuse_decision_rewrite()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'Case decision "%" is committed and cannot be % . Append a superseding '
        'decision instead.',
        COALESCE(OLD.case_id, NEW.case_id),
        lower(TG_OP)
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER case_decisions_immutable
    BEFORE UPDATE OR DELETE ON analysis.case_decisions
    FOR EACH ROW EXECUTE FUNCTION analysis.refuse_decision_rewrite();

-- ------------------------------------------------ case versions only advance --

-- Optimistic concurrency compares the version the caller read and rejects a
-- stale write. That protects against a lost update; it does not protect
-- against a caller writing a LOWER version, which would make every subsequent
-- comparison wrong and silently reopen the race.
--
-- Strictly increasing rather than exactly +1: a command that records several
-- transitions atomically advances the version by more than one, and refusing
-- that would force it to split into non-atomic parts.
CREATE FUNCTION analysis.assert_case_version_advances()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.version <= OLD.version THEN
        RAISE EXCEPTION
            'Case "%" cannot move from version % to % — versions only advance',
            OLD.id, OLD.version, NEW.version
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER cases_version_advances
    BEFORE UPDATE ON analysis.cases
    FOR EACH ROW EXECUTE FUNCTION analysis.assert_case_version_advances();

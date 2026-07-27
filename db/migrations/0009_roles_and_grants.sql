-- Schema owner, application runtime, read-only operator.
--
-- ## Why the runtime is a different role
--
-- The application's job is to write cases, not to change what a case IS. A
-- runtime that can ALTER TABLE, drop a trigger or edit the migration history
-- can undo every other guarantee in this schema — quietly, and from a code
-- path that looks like ordinary data access. Separating the roles makes the
-- destructive operations unavailable rather than merely unused.
--
-- ## No passwords here
--
-- `finos_app` and `finos_readonly` are NOLOGIN group roles carrying grants.
-- Deployment creates a login user and does `GRANT finos_app TO that_user`, so
-- no credential ever appears in a migration, in version control, or in a
-- connection string that a migration could log.
--
-- ## Column-level grants
--
-- Several rules are of the shape "this column may change and the others may
-- not" — a thesis revision's lifecycle, a challenge's outcome, a case's stage.
-- A column-level GRANT expresses that exactly, without a trigger and without
-- the application being trusted to honour it. Triggers in 0008 cover the same
-- ground for roles that are not `finos_app`.

DO $$
BEGIN
    -- Roles are cluster-wide, so this migration may run against a cluster
    -- where a sibling database already created them.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finos_app') THEN
        CREATE ROLE finos_app NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finos_readonly') THEN
        CREATE ROLE finos_readonly NOLOGIN;
    END IF;
END;
$$;

-- Nothing is granted by default, to anyone.
REVOKE ALL ON SCHEMA analysis FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA analysis FROM PUBLIC;

-- USAGE lets a role see the schema's objects. CREATE — which would let it add
-- its own tables and functions — is deliberately not granted.
GRANT USAGE ON SCHEMA analysis TO finos_app, finos_readonly;

-- ------------------------------------------------------------- read-only --

GRANT SELECT ON ALL TABLES IN SCHEMA analysis TO finos_readonly;

-- ----------------------------------------------- the organization is read --

-- The runtime reads the firm and never edits it. Changing a department is a
-- migration: deliberate, reviewed, and recorded in the migration history —
-- never a side effect of a command.
GRANT SELECT ON
    analysis.tenants,
    analysis.roles,
    analysis.responsibilities,
    analysis.departments,
    analysis.department_handles,
    analysis.employees,
    analysis.teams,
    analysis.organizations,
    analysis.organization_seed_versions
TO finos_app;

-- ---------------------------------------------------------- playbooks --

-- Registering a playbook version is append-only: the runtime may record the
-- version it is compiled with, and may never change one a case has pinned.
GRANT SELECT, INSERT ON
    analysis.playbooks,
    analysis.playbook_versions,
    analysis.playbook_entries,
    analysis.playbook_entry_dependencies
TO finos_app;

-- ------------------------------------------------------ cases and theses --

-- A case moves and its version advances; nothing else about it changes. Its
-- subject, question, owner and playbook are what the case IS.
GRANT SELECT, INSERT ON analysis.cases TO finos_app;
GRANT UPDATE (stage, version, closed_at) ON analysis.cases TO finos_app;

-- Participation grows as the case moves; a department that contributed is
-- never removed from the record.
GRANT SELECT, INSERT ON analysis.case_participants TO finos_app;

-- Only the lifecycle. Everything else about a sealed revision is fixed, which
-- is what keeps its reviews meaningful.
GRANT SELECT, INSERT ON analysis.thesis_revisions TO finos_app;
GRANT UPDATE (lifecycle) ON analysis.thesis_revisions TO finos_app;

GRANT SELECT, INSERT ON analysis.thesis_claim_links TO finos_app;

-- ----------------------------------------------------------- evidence --

-- Content-addressed and immutable. An id already holds exactly this content,
-- so there is nothing an UPDATE could legitimately do.
GRANT SELECT, INSERT ON analysis.evidence_sets, analysis.evidence_items TO finos_app;

-- ------------------------------------------------ work, runs and claims --

GRANT SELECT, INSERT ON analysis.assignments TO finos_app;
GRANT UPDATE (status, assignee_employee_id, priority, started_at, completed_at,
              waiting_on_kind, waiting_on_assignment_id, waiting_on_description,
              returned_reason)
    ON analysis.assignments TO finos_app;

GRANT SELECT, INSERT ON analysis.runs TO finos_app;
GRANT UPDATE (state, obsolete, completed_at, failure_reason,
              input_tokens, output_tokens, cost_minor_units, currency)
    ON analysis.runs TO finos_app;

-- Append-only: a run's history of states is a record, not a current value.
GRANT SELECT, INSERT ON analysis.run_events TO finos_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA analysis TO finos_app;

-- Write-once. A claim that has been cited must not change underneath the
-- citation.
GRANT SELECT, INSERT ON analysis.claims, analysis.claim_evidence TO finos_app;

-- ------------------------------------------------------------ governance --

-- A review is a verdict at a moment. A changed opinion is a new review, so the
-- gate can see that the verdict changed and when.
GRANT SELECT, INSERT ON
    analysis.reviews,
    analysis.verification_findings,
    analysis.challenge_evidence
TO finos_app;

-- The one governance field that legitimately moves: how the organization
-- answered a challenge. The argument itself is fixed.
GRANT SELECT, INSERT ON analysis.challenges TO finos_app;
GRANT UPDATE (outcome) ON analysis.challenges TO finos_app;

-- ----------------------------------------- decisions, events and results --

-- No UPDATE and no DELETE. A correction appends a superseding decision.
GRANT SELECT, INSERT ON
    analysis.case_decisions,
    analysis.decision_revisions
TO finos_app;

-- The append-only property becomes a permission rather than a convention the
-- application is trusted to honour.
GRANT SELECT, INSERT ON analysis.transition_events TO finos_app;

-- Write-once: the key covers every semantic input, so a differing result under
-- the same key means something is wrong and overwriting would hide it.
GRANT SELECT, INSERT ON analysis.agent_results TO finos_app;

-- The only table anything is ever permitted to delete from. Idempotency keys
-- are operational rather than institutional and expire at 30 days; everything
-- else in this schema is kept indefinitely, which is the point of the record.
GRANT SELECT, INSERT, DELETE ON analysis.idempotency_keys TO finos_app;

-- ------------------------------------------------------ migration history --

-- Readable so the runtime can report the schema version it is running against;
-- never writable. A runtime that can edit migration history can make a
-- database claim to be a version it is not.
GRANT SELECT ON analysis.schema_migrations TO finos_app, finos_readonly;

-- ------------------------------------------------------------- defaults --

-- A table added by a later migration grants nothing to the runtime until that
-- migration says so. The failure this avoids is a new table silently
-- inheriting write access — including one that should have been append-only.
ALTER DEFAULT PRIVILEGES IN SCHEMA analysis REVOKE ALL ON TABLES FROM PUBLIC;

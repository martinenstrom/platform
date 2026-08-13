-- The CIO bringing a deferred case back.
--
-- `deferred -> decision` has been legal since the stage table was written and
-- nothing took it, so a deferral was an obligation the firm recorded and could
-- not fulfil: it refuses a deferral naming no condition for ending the wait,
-- stores those conditions, and had no way to act on them. This closes TD-50.
--
-- Stored as a record in its own right, exactly as `cio_returns` is. Moving a
-- case across the decision boundary is an institutional act, and an act the
-- record cannot explain is an act nobody can review.
--
-- Reconsideration inherits history, never judgement. The reopening creates a
-- NEW submission carrying a freshly assembled basis under the policy in force
-- at reopening; the deferral stays readable and grants no approval to what
-- follows. Governance verdicts do carry over, because they are facts about an
-- exact revision and the revision has not changed — a changed argument is a new
-- revision, which reopens every gate through the ordinary path.

-- A trigger belongs to exactly one decision, and this makes that a fact the
-- DATABASE holds rather than a rule the application remembers. Without it a
-- reopening could cite a trigger from a different case's deferral and every
-- layer above would have to be trusted to notice.
ALTER TABLE analysis.decision_reconsideration_triggers
    ADD CONSTRAINT decision_reconsideration_triggers_id_decision_unique
        UNIQUE (id, decision_id);

CREATE TABLE analysis.case_reconsiderations (
    id                  text PRIMARY KEY,
    case_id             text NOT NULL,
    tenant_id           text NOT NULL,
    revision_id         text NOT NULL REFERENCES analysis.thesis_revisions (revision_id),
    -- The deferral being reconsidered. It is never deleted and never rewritten;
    -- the decision that follows supersedes it.
    reconsiders_decision_id text NOT NULL REFERENCES analysis.case_decisions (decision_id),
    -- The new submission this reopening created for the CIO to decide.
    submission_id       text NOT NULL REFERENCES analysis.cio_submissions (id),
    reopened_at         timestamptz NOT NULL,

    -- The CIO as the organization described them, mirroring ActorSnapshot and
    -- `cio_returns` field for field.
    reopened_by_employee_id  text NOT NULL REFERENCES analysis.employees (id),
    reopened_by_role_id      text,
    reopened_by_role_function text,
    reopened_by_department_id text REFERENCES analysis.departments (id),
    reopened_by_department_is_governance boolean,
    -- Canonically sorted before persistence: organization insertion order is
    -- not institutional meaning.
    reopened_by_department_handles text[] NOT NULL DEFAULT '{}',
    organization_seed_version text NOT NULL,
    -- Never 'authenticated' while TD-8 is open, and stored verbatim so the
    -- record cannot imply a check the runtime did not perform.
    authentication      text NOT NULL,
    authorization_basis text NOT NULL,

    case_version        integer NOT NULL,

    FOREIGN KEY (case_id, tenant_id) REFERENCES analysis.cases (id, tenant_id),

    CONSTRAINT case_reconsiderations_authorization_present
        CHECK (btrim(authorization_basis) <> ''),
    CONSTRAINT case_reconsiderations_version_positive CHECK (case_version >= 0),
    -- One reopening per submission. A second would mean two acts claiming to
    -- have created the same request for a decision.
    CONSTRAINT case_reconsiderations_submission_unique UNIQUE (submission_id)
);

-- Which conditions fired, and what was observed.
CREATE TABLE analysis.case_reconsideration_fired_triggers (
    reconsideration_id text NOT NULL
        REFERENCES analysis.case_reconsiderations (id) ON DELETE CASCADE,
    ordinal            integer NOT NULL,
    trigger_id         text NOT NULL,
    -- The decision the trigger must belong to, carried so the composite key
    -- below can be checked. Redundant with the parent row by design: the
    -- redundancy is what lets the database enforce the relationship.
    reconsiders_decision_id text NOT NULL,
    -- What was seen. Required: a fired trigger with no observation records
    -- that the firm believed a condition was met without recording why anybody
    -- thought so, and the trigger exists so that belief stays checkable.
    observation        text NOT NULL,

    PRIMARY KEY (reconsideration_id, ordinal),

    -- THE constraint this table exists for. A cited trigger must belong to the
    -- decision being reconsidered — not merely be a trigger that exists
    -- somewhere. Enforced by the composite unique added above.
    FOREIGN KEY (trigger_id, reconsiders_decision_id)
        REFERENCES analysis.decision_reconsideration_triggers (id, decision_id),

    CONSTRAINT case_reconsideration_fired_observation_present
        CHECK (btrim(observation) <> '')
);

-- `reconsiderationsForCase` returns reopenedAt ascending, then id, so the
-- history reads in the order it happened. Stated on the port and indexed here
-- so both adapters produce the same order.
CREATE INDEX case_reconsiderations_case_idx
    ON analysis.case_reconsiderations (case_id, reopened_at, id);
CREATE INDEX case_reconsiderations_decision_idx
    ON analysis.case_reconsiderations (reconsiders_decision_id);

-- The runtime reads and appends; it never rewrites a reopening. Same shape as
-- every other institutional record: no UPDATE, no DELETE.
GRANT SELECT, INSERT ON analysis.case_reconsiderations TO finos_app;
GRANT SELECT, INSERT ON analysis.case_reconsideration_fired_triggers TO finos_app;

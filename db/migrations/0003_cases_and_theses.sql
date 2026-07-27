-- Investment cases and the theses that answer them.
--
-- The case is the aggregate root. A case is a QUESTION; a thesis is a proposed
-- ANSWER, and a case can hold several competing ones — Buy, Hold and Sell are
-- three arguments, each evidenced, verified and challenged independently.
--
-- ## Where `InvestmentCase.transitions` lives
--
-- Not here. The aggregate carries a movement history, and `transition_events`
-- (0007) already records every state change with its actor, reason and
-- timestamp. Storing both would create two histories that can disagree, and
-- the events table is the one with the append-only permission behind it. The
-- adapter projects `transitions` from `transition_events WHERE subject = 'case'`.
--
-- ## Tenancy
--
-- `cases` carries `tenant_id` and a UNIQUE (id, tenant_id), which lets the
-- child tables carry a tenant that is provably the same one via a composite
-- foreign key. Denormalizing a tenant key is usually how tenants start
-- disagreeing across tables; here the database will not permit it, and
-- row-level security gets a local column instead of a join.

CREATE TABLE analysis.cases (
    id                   text PRIMARY KEY,
    tenant_id            text    NOT NULL REFERENCES analysis.tenants (id),
    -- Monotonic aggregate version for optimistic concurrency. A command
    -- computed against version 12 must not overwrite work committed as 13.
    version              integer NOT NULL,
    -- No anonymous ownerless work: a system-created case has an explicit
    -- system owner, which is the manager accountable for it.
    owner_employee_id    text    NOT NULL REFERENCES analysis.employees (id),

    -- Open-ended on purpose: an instrument, an asset class, a portfolio, a
    -- theme or a macro regime.
    subject_kind         text    NOT NULL,
    subject_ref          text    NOT NULL,
    subject_display_name text    NOT NULL,
    -- Why the firm is looking at this. A mandate, not a prompt.
    question             text    NOT NULL,

    stage                text    NOT NULL,
    playbook_id          text,
    playbook_version     text,
    opened_at            timestamptz NOT NULL,
    closed_at            timestamptz,

    CONSTRAINT cases_id_tenant_unique UNIQUE (id, tenant_id),
    CONSTRAINT cases_version_positive CHECK (version >= 0),
    CONSTRAINT cases_stage_known CHECK (
        stage IN ('intake', 'research', 'aggregation', 'review', 'returned',
                  'blocked', 'decision', 'published', 'withdrawn')
    ),
    -- A case is closed exactly when it is terminal. Neither an open case with
    -- a closing time nor a published case without one is a legible record.
    CONSTRAINT cases_closed_iff_terminal CHECK (
        (stage IN ('published', 'withdrawn')) = (closed_at IS NOT NULL)
    ),
    FOREIGN KEY (playbook_id, playbook_version)
        REFERENCES analysis.playbook_versions (playbook_id, version)
);

-- `cases.list()` returns opened_at DESC, then id. Stated on the port and
-- indexed here so both adapters produce the same order.
CREATE INDEX cases_opened_at_idx ON analysis.cases (opened_at DESC, id);
CREATE INDEX cases_tenant_idx ON analysis.cases (tenant_id);
-- Partial: the headquarters asks for active cases constantly and for closed
-- ones rarely, and terminal cases are the ones that accumulate forever.
CREATE INDEX cases_active_idx ON analysis.cases (stage)
    WHERE stage NOT IN ('published', 'withdrawn');

-- Departments asked to contribute. Grows as the case moves.
CREATE TABLE analysis.case_participants (
    case_id       text NOT NULL REFERENCES analysis.cases (id),
    department_id text NOT NULL REFERENCES analysis.departments (id),
    PRIMARY KEY (case_id, department_id)
);

-- ------------------------------------------------------- thesis revisions --

-- The concrete entity is a REVISION. `thesis_id` is the lineage key shared by
-- every version; `revision_id` identifies one version.
--
--   competing thesis  ->  a different thesis_id
--   revised thesis    ->  the same thesis_id, a new revision_id
--
-- A sealed revision is never edited. Revision n+1 supersedes n, leaving n
-- permanently auditable with the reviews and claims that were attached to it,
-- exactly as they were. That is the whole design: a review reviewed a specific
-- argument, and if the argument can be edited afterwards the review no longer
-- means anything.
CREATE TABLE analysis.thesis_revisions (
    revision_id            text PRIMARY KEY,
    thesis_id              text    NOT NULL,
    revision_number        integer NOT NULL,
    supersedes_revision_id text REFERENCES analysis.thesis_revisions (revision_id),
    case_id                text    NOT NULL REFERENCES analysis.cases (id),

    statement              text    NOT NULL,
    position               text    NOT NULL,
    lifecycle              text    NOT NULL,
    -- What would have to happen for this thesis to be wrong. Required: a
    -- thesis that cannot be falsified is a preference.
    invalidation_criteria  text    NOT NULL,
    horizon                text,

    proposed_by_department_id text NOT NULL REFERENCES analysis.departments (id),
    proposed_by_employee_id   text NOT NULL REFERENCES analysis.employees (id),
    proposed_at            timestamptz NOT NULL,
    revised_at             timestamptz,
    revision_reason        text,

    CONSTRAINT thesis_revisions_number_unique UNIQUE (thesis_id, revision_number),
    CONSTRAINT thesis_revisions_number_starts_at_one CHECK (revision_number >= 1),
    -- A lineage with a hole cannot be audited: every revision after the first
    -- says what it superseded, and the first cannot supersede anything.
    CONSTRAINT thesis_revisions_lineage_links CHECK (
        (revision_number = 1) = (supersedes_revision_id IS NULL)
    ),
    -- A revision without a reason is an unexplained change of position.
    CONSTRAINT thesis_revisions_reason_after_first CHECK (
        revision_number = 1 OR btrim(coalesce(revision_reason, '')) <> ''
    ),
    CONSTRAINT thesis_revisions_invalidation_not_blank CHECK (
        btrim(invalidation_criteria) <> ''
    ),
    CONSTRAINT thesis_revisions_lifecycle_known CHECK (
        lifecycle IN ('proposed', 'under-analysis', 'awaiting-verification',
                      'verified', 'rejected', 'withdrawn', 'superseded',
                      'selected', 'not-selected')
    )
);

-- `theses.listForCase()` returns thesis_id, then revision_number.
CREATE INDEX thesis_revisions_case_idx
    ON analysis.thesis_revisions (case_id, thesis_id, revision_number);

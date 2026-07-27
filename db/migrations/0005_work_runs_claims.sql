-- Assignments, contributions and claims.
--
-- An assignment is a piece of a case given to a department; a run is one
-- department doing one piece of that work. Neither is the aggregate root —
-- making the run central would model an agent system rather than a firm, and
-- would make a case something you reconstruct by joining runs.
--
-- `waiting_on` earns its place: real analysis stalls because one desk needs
-- something from another, and without it a blocked assignment looks identical
-- to a slow one.

CREATE TABLE analysis.assignments (
    id                      text PRIMARY KEY,
    case_id                 text    NOT NULL,
    tenant_id               text    NOT NULL,
    -- The department that owes the work. Never null: work is owed by a
    -- department, and only then picked up by one of its employees.
    department_id           text    NOT NULL REFERENCES analysis.departments (id),
    assignee_employee_id    text REFERENCES analysis.employees (id),
    -- Which playbook entry produced this. Null for an ad-hoc assignment.
    playbook_entry_key      text,
    brief                   text    NOT NULL,
    status                  text    NOT NULL,
    -- Higher runs first within a department's queue.
    priority                integer NOT NULL,

    created_at              timestamptz NOT NULL,
    started_at              timestamptz,
    completed_at            timestamptz,

    waiting_on_kind         text,
    waiting_on_assignment_id text REFERENCES analysis.assignments (id),
    waiting_on_description  text,
    returned_reason         text,

    -- The composite reference: an assignment's tenant is the tenant of its
    -- case, and the database will not let the two drift apart.
    FOREIGN KEY (case_id, tenant_id) REFERENCES analysis.cases (id, tenant_id),

    CONSTRAINT assignments_status_known CHECK (
        status IN ('queued', 'active', 'waiting', 'submitted', 'returned',
                   'completed', 'cancelled')
    ),
    CONSTRAINT assignments_waiting_on_kind_known CHECK (
        waiting_on_kind IS NULL OR waiting_on_kind IN ('assignment', 'evidence')
    ),
    -- An unexplained wait is indistinguishable from a stall.
    CONSTRAINT assignments_waiting_says_on_what CHECK (
        (status = 'waiting') = (waiting_on_kind IS NOT NULL)
    ),
    -- Each kind of wait carries its own detail, and only its own.
    CONSTRAINT assignments_waiting_detail_matches_kind CHECK (
        waiting_on_kind IS NULL
        OR (waiting_on_kind = 'assignment'
            AND waiting_on_assignment_id IS NOT NULL
            AND waiting_on_description IS NULL)
        OR (waiting_on_kind = 'evidence'
            AND waiting_on_description IS NOT NULL
            AND waiting_on_assignment_id IS NULL)
    ),
    CONSTRAINT assignments_returned_with_reason CHECK (
        status <> 'returned' OR btrim(coalesce(returned_reason, '')) <> ''
    ),
    CONSTRAINT assignments_not_waiting_on_itself CHECK (
        waiting_on_assignment_id IS NULL OR waiting_on_assignment_id <> id
    )
);

-- One assignment per case per playbook entry. A retried "open case" command
-- must not give a department the same work twice.
--
-- Partial rather than a plain UNIQUE, because ad-hoc assignments carry no
-- entry key and several of them on one case are legitimate.
CREATE UNIQUE INDEX assignments_case_playbook_entry_unique
    ON analysis.assignments (case_id, playbook_entry_key)
    WHERE playbook_entry_key IS NOT NULL;

-- `assignments.listForCase` / `listForDepartment` return priority DESC, then
-- created_at, then id.
CREATE INDEX assignments_case_queue_idx
    ON analysis.assignments (case_id, priority DESC, created_at, id);
CREATE INDEX assignments_department_queue_idx
    ON analysis.assignments (department_id, priority DESC, created_at, id);
-- Department workload tiles: GROUP BY department, status over open work.
CREATE INDEX assignments_department_status_idx
    ON analysis.assignments (department_id, status);

-- ------------------------------------------------------------------- runs --

-- Four version axes are recorded because any one of them changing invalidates
-- a cached result and has to be visible in an audit. "The macro team said X
-- last Tuesday" means nothing without them.
CREATE TABLE analysis.runs (
    id                      text PRIMARY KEY,
    case_id                 text NOT NULL,
    tenant_id               text NOT NULL,
    assignment_id           text NOT NULL REFERENCES analysis.assignments (id),
    department_id           text NOT NULL REFERENCES analysis.departments (id),
    employee_id             text NOT NULL REFERENCES analysis.employees (id),
    -- The thesis revision this contributes to, when the work is thesis-scoped.
    revision_id             text REFERENCES analysis.thesis_revisions (revision_id),

    state                   text NOT NULL,
    -- True when the result arrived after the revision it targeted was
    -- superseded. Retained against the OLD revision rather than reattached:
    -- the work reasoned over different assumptions.
    obsolete                boolean NOT NULL DEFAULT false,

    agent_contract_version  text NOT NULL,
    output_schema_version   text NOT NULL,
    prompt_id               text NOT NULL,
    prompt_version          text NOT NULL,
    -- A version number is a promise and a hash is a fact: an edited prompt
    -- that kept its version is detectable.
    prompt_content_hash     text NOT NULL,
    model_id                text NOT NULL,
    model_provider          text NOT NULL,
    -- Covers temperature, top-p, seed. Two runs of the same prompt at
    -- different temperatures are not the same run.
    model_parameters_hash   text NOT NULL,
    model_parameters        jsonb NOT NULL DEFAULT '{}'::jsonb,

    -- What it reasoned over. Content-addressed, so replay is exact.
    evidence_set_id         text NOT NULL REFERENCES analysis.evidence_sets (id),

    started_at              timestamptz NOT NULL,
    completed_at            timestamptz,
    failure_reason          text,

    -- Null means NOT MEASURED, never unlimited.
    input_tokens            integer,
    output_tokens           integer,
    -- Minor units, to avoid float drift on money.
    cost_minor_units        bigint,
    currency                text,

    FOREIGN KEY (case_id, tenant_id) REFERENCES analysis.cases (id, tenant_id),

    CONSTRAINT runs_state_known CHECK (
        state IN ('queued', 'waiting-for-dependencies', 'ready', 'running',
                  'completed', 'failed', 'timed-out', 'cancelled',
                  'superseded', 'blocked')
    ),
    CONSTRAINT runs_stalled_with_reason CHECK (
        state NOT IN ('failed', 'timed-out', 'blocked', 'cancelled')
        OR btrim(coalesce(failure_reason, '')) <> ''
    ),
    CONSTRAINT runs_completed_has_time CHECK (
        state <> 'completed' OR completed_at IS NOT NULL
    ),
    -- Cost is all-or-nothing: a currency without an amount, or an amount
    -- without a currency, is not a measurement.
    CONSTRAINT runs_cost_complete CHECK (
        (cost_minor_units IS NULL) = (currency IS NULL)
    )
);

-- `runs.listForCase()` returns started_at, then id.
CREATE INDEX runs_case_idx ON analysis.runs (case_id, started_at, id);
CREATE INDEX runs_assignment_idx ON analysis.runs (assignment_id);
CREATE INDEX runs_revision_idx ON analysis.runs (revision_id);

-- Append-only. Carries no prose: the floor's wording is generated in the
-- presentation layer from these structured facts, so nothing can write
-- "Macro Team is studying the Fed" without a run having entered a state.
CREATE TABLE analysis.run_events (
    id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id  text NOT NULL REFERENCES analysis.runs (id),
    at      timestamptz NOT NULL,
    state   text NOT NULL,
    reason  text
);

CREATE INDEX run_events_run_idx ON analysis.run_events (run_id, at, id);

-- ----------------------------------------------------------------- claims --

-- Stored beside the run rather than inside it: a claim is cited by theses,
-- contested by challenges and verified individually, so it needs its own
-- identity and its own lookups.
CREATE TABLE analysis.claims (
    id                    text PRIMARY KEY,
    case_id               text NOT NULL,
    tenant_id             text NOT NULL,
    run_id                text NOT NULL REFERENCES analysis.runs (id),

    type                  text NOT NULL,
    statement             text NOT NULL,
    status                text NOT NULL,

    confidence_level      text NOT NULL,
    confidence_capped_by  text,
    -- Why the confidence is what it is, in order. Read whole.
    confidence_basis      jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- What moment the claim speaks to, and over what period.
    temporal_as_of        timestamptz NOT NULL,
    temporal_horizon      text,

    -- For a counterclaim: the claim being contested.
    contests_claim_id     text REFERENCES analysis.claims (id),
    -- Without these, Equity Research supporting Buy and Quant supporting Hold
    -- are indistinguishable in the record.
    supports_thesis_id    text,
    opposes_thesis_id     text,

    -- Mandatory for a causal claim. An agent may quote an official statement,
    -- cite a named external analysis, or label the causation as its own
    -- inference — but it may not assert a mechanism as established fact.
    causal_attribution    jsonb,

    FOREIGN KEY (case_id, tenant_id) REFERENCES analysis.cases (id, tenant_id),

    CONSTRAINT claims_type_known CHECK (
        type IN ('observation', 'comparison', 'causal', 'forecast',
                 'recommendation', 'counterclaim')
    ),
    CONSTRAINT claims_status_known CHECK (
        status IN ('supported', 'contested', 'insufficient-evidence',
                   'refuted', 'withdrawn')
    ),
    CONSTRAINT claims_confidence_level_known CHECK (
        confidence_level IN ('high', 'moderate', 'low', 'insufficient')
    ),
    CONSTRAINT claims_causal_has_attribution CHECK (
        (type = 'causal') = (causal_attribution IS NOT NULL)
    ),
    -- A forecast or recommendation without a horizon is unfalsifiable.
    CONSTRAINT claims_horizon_where_required CHECK (
        type NOT IN ('forecast', 'recommendation') OR temporal_horizon IS NOT NULL
    ),
    CONSTRAINT claims_counterclaim_contests CHECK (
        (type = 'counterclaim') <= (contests_claim_id IS NOT NULL)
    ),
    CONSTRAINT claims_not_contesting_itself CHECK (
        contests_claim_id IS NULL OR contests_claim_id <> id
    )
);

-- `claims.listForRun` / `listForCase` return id order.
CREATE INDEX claims_run_idx ON analysis.claims (run_id, id);
CREATE INDEX claims_case_idx ON analysis.claims (case_id, id);

-- A citation INTO a specific evidence set — not merely at an observation in
-- the world. Only this makes an unresolved citation detectable: a claim
-- pointing at something the set never contained.
--
-- `content_hash` is captured AT CITATION TIME, so a later revision of the
-- evidence does not silently change what the claim was made against. That
-- divergence is exactly what the Fact Checker reports.
CREATE TABLE analysis.claim_evidence (
    claim_id        text NOT NULL REFERENCES analysis.claims (id),
    evidence_set_id text NOT NULL,
    observation_id  text NOT NULL,
    content_hash    text NOT NULL,
    -- Evidence that cuts against a claim is kept, never quietly dropped.
    stance          text NOT NULL,

    PRIMARY KEY (claim_id, evidence_set_id, observation_id, stance),
    FOREIGN KEY (evidence_set_id, observation_id)
        REFERENCES analysis.evidence_items (evidence_set_id, observation_id),
    CONSTRAINT claim_evidence_stance_known CHECK (
        stance IN ('supporting', 'contradicting')
    )
);

CREATE INDEX claim_evidence_claim_idx ON analysis.claim_evidence (claim_id);
CREATE INDEX claim_evidence_observation_idx
    ON analysis.claim_evidence (evidence_set_id, observation_id);

-- Which claims argue for or against a specific REVISION.
--
-- A thesis listing only supporting evidence is a pitch; keeping the opposing
-- claims attached lets the CIO judge the strength of a position rather than
-- the enthusiasm of the desk proposing it.
CREATE TABLE analysis.thesis_claim_links (
    revision_id text NOT NULL REFERENCES analysis.thesis_revisions (revision_id),
    claim_id    text NOT NULL REFERENCES analysis.claims (id),
    relation    text NOT NULL,

    PRIMARY KEY (revision_id, claim_id, relation),
    CONSTRAINT thesis_claim_links_relation_known CHECK (
        relation IN ('supporting', 'opposing', 'cites')
    )
);

CREATE INDEX thesis_claim_links_claim_idx ON analysis.thesis_claim_links (claim_id);

-- Decisions, the append-only event log, immutable results, idempotency keys.

-- ------------------------------------------------------------- decisions --

-- What the organization chose, what it rejected, why, and what remained
-- unresolved when it decided.
--
-- The losing arguments are part of the record: an institution that forgets
-- which theses it rejected cannot later discover that a rejected one was right.
--
-- This is an ANALYTICAL record. It states a position; it does not place a
-- trade, size a position or instruct execution.
CREATE TABLE analysis.case_decisions (
    -- One decision per case. A correction appends a superseding decision
    -- rather than rewriting one that has already been communicated.
    case_id                  text PRIMARY KEY,
    tenant_id                text NOT NULL,
    -- The case version this was decided against. Pins the decision in time.
    aggregate_version        integer NOT NULL,
    decided_at               timestamptz NOT NULL,
    decided_by_employee_id   text NOT NULL REFERENCES analysis.employees (id),

    -- The exact revision selected — never a bare thesis id. With several
    -- revisions in a lineage, "we chose the Buy thesis" is ambiguous: revision
    -- 1 and revision 3 may rest on different assumptions. Null when the CIO
    -- declined to take a position.
    selected_revision_id     text REFERENCES analysis.thesis_revisions (revision_id),
    -- The evidence the decision was made against.
    evidence_set_id          text NOT NULL REFERENCES analysis.evidence_sets (id),

    rationale                text NOT NULL,
    -- Governance state as it stood at the moment of decision, pinned so a
    -- later change to a review cannot alter what the record says was true.
    governance               jsonb NOT NULL,
    -- Objections acknowledged and decided against. Never dropped.
    unresolved_dissent       jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- What would cause the firm to look at this again. The field that makes
    -- the record useful months later.
    reconsideration_triggers jsonb NOT NULL DEFAULT '[]'::jsonb,

    FOREIGN KEY (case_id, tenant_id) REFERENCES analysis.cases (id, tenant_id),

    CONSTRAINT case_decisions_rationale_not_blank CHECK (btrim(rationale) <> ''),
    CONSTRAINT case_decisions_governance_is_object CHECK (
        jsonb_typeof(governance) = 'object'
    ),
    CONSTRAINT case_decisions_dissent_is_array CHECK (
        jsonb_typeof(unresolved_dissent) = 'array'
    ),
    CONSTRAINT case_decisions_triggers_is_array CHECK (
        jsonb_typeof(reconsideration_triggers) = 'array'
    )
);

-- `decisions.list()` returns decided_at DESC, then case_id.
CREATE INDEX case_decisions_decided_at_idx
    ON analysis.case_decisions (decided_at DESC, case_id);

-- Every revision that was in play, and what happened to it. The selected one
-- is here too, so "what did the CIO consider" is one query rather than a
-- column plus two arrays.
CREATE TABLE analysis.decision_revisions (
    case_id     text NOT NULL REFERENCES analysis.case_decisions (case_id),
    revision_id text NOT NULL REFERENCES analysis.thesis_revisions (revision_id),
    relation    text NOT NULL,

    PRIMARY KEY (case_id, revision_id),
    CONSTRAINT decision_revisions_relation_known CHECK (
        relation IN ('selected', 'not-selected', 'rejected')
    )
);

-- Exactly one selected revision per decision, and only when the decision names
-- one. Enforced as an index rather than a trigger.
CREATE UNIQUE INDEX decision_revisions_one_selected
    ON analysis.decision_revisions (case_id)
    WHERE relation = 'selected';

-- ------------------------------------------------------ transition events --

-- Every state change in the organization, recorded as a fact. Current state on
-- an entity is a convenience; THE EVENTS ARE THE RECORD, and the headquarters
-- activity feed is a projection of them.
--
-- History is never rewritten. A mistake is corrected by appending a correcting
-- event, not by editing the original — a log that can be tidied is not an
-- audit trail. The runtime role is granted SELECT and INSERT only (0009), so
-- that is a permission rather than a convention.
--
-- Events carry no prose. If activity text were a field, anything could write
-- "Macro Team is studying the Fed" with no work behind it.
CREATE TABLE analysis.transition_events (
    event_id            text PRIMARY KEY,
    subject             text NOT NULL,
    case_id             text NOT NULL,
    tenant_id           text NOT NULL,

    thesis_id           text,
    revision_id         text REFERENCES analysis.thesis_revisions (revision_id),
    assignment_id       text REFERENCES analysis.assignments (id),
    run_id              text REFERENCES analysis.runs (id),

    -- Null on creation events, where there was no previous state.
    from_state          text,
    to_state            text NOT NULL,
    actor_employee_id   text REFERENCES analysis.employees (id),
    actor_department_id text REFERENCES analysis.departments (id),
    reason              text,

    occurred_at         timestamptz NOT NULL,
    -- Correlation groups everything belonging to one inbound request;
    -- causation names the single event that directly triggered this one.
    -- Together they let a chain be replayed, which flat timestamp ordering
    -- cannot express.
    correlation_id      text NOT NULL,
    causation_id        text REFERENCES analysis.transition_events (event_id),
    -- The case aggregate version this event advanced the case to.
    aggregate_version   integer NOT NULL,
    -- The only sanctioned way to fix the record: append, never rewrite.
    corrects            text REFERENCES analysis.transition_events (event_id),

    FOREIGN KEY (case_id, tenant_id) REFERENCES analysis.cases (id, tenant_id),

    CONSTRAINT transition_events_subject_known CHECK (
        subject IN ('case', 'thesis', 'assignment', 'run', 'review')
    ),
    CONSTRAINT transition_events_version_not_negative CHECK (aggregate_version >= 0),
    -- Work does not stall anonymously.
    CONSTRAINT transition_events_stall_has_reason CHECK (
        to_state NOT IN ('blocked', 'returned', 'rejected', 'failed', 'cancelled')
        OR btrim(coalesce(reason, '')) <> ''
    ),
    CONSTRAINT transition_events_not_correcting_itself CHECK (
        corrects IS NULL OR corrects <> event_id
    ),
    CONSTRAINT transition_events_not_causing_itself CHECK (
        causation_id IS NULL OR causation_id <> event_id
    )
);

-- `events.listForCase()` returns occurred_at, then event_id.
CREATE INDEX transition_events_case_idx
    ON analysis.transition_events (case_id, occurred_at, event_id);
-- `events.recent()` returns occurred_at DESC, then event_id DESC — the
-- activity feed, read on every headquarters render.
CREATE INDEX transition_events_recent_idx
    ON analysis.transition_events (occurred_at DESC, event_id DESC);
CREATE INDEX transition_events_correlation_idx
    ON analysis.transition_events (correlation_id);

-- ---------------------------------------------------------------- results --

-- Immutable, content-addressed agent output. Write-once: the key covers every
-- semantic input, so a differing result under the same key means something is
-- wrong and overwriting would hide it.
--
-- Deliberately not the market-data cache. Stale market data is useful — a
-- Friday close on Monday is still the Friday close. Stale agent output is
-- dangerous: last week's reasoning reads as current analysis, and nothing on
-- the page says otherwise. Exact key match only, no fallback of any kind.
CREATE TABLE analysis.agent_results (
    key       text PRIMARY KEY,
    claims    jsonb NOT NULL,
    stored_at timestamptz NOT NULL,
    -- Kept so a stored result can be explained without recomputing the key.
    inputs    jsonb NOT NULL,

    CONSTRAINT agent_results_claims_is_array CHECK (jsonb_typeof(claims) = 'array'),
    CONSTRAINT agent_results_inputs_is_object CHECK (jsonb_typeof(inputs) = 'object')
);

-- ------------------------------------------------------------ idempotency --

-- For the commands whose identity is not derivable from their inputs: opening
-- a case, starting a run, recording a review, and the decision — where a
-- duplicate would be a second valid-looking institutional record.
--
-- The record and its effect MUST commit in the same transaction, or there is a
-- window in which the key exists without the effect it guards.
CREATE TABLE analysis.idempotency_keys (
    key          text PRIMARY KEY,
    command_type text NOT NULL,
    -- The id of whatever the command produced, so a replay can return it.
    result_ref   text NOT NULL,
    created_at   timestamptz NOT NULL
);

-- Operational rather than institutional: expired by the retention job at 30
-- days, which is the one thing in this schema that is ever deleted.
CREATE INDEX idempotency_keys_created_at_idx
    ON analysis.idempotency_keys (created_at);

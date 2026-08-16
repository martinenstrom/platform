-- What a run was authorized to spend.
--
-- The counterpart to `usage_state` and its columns, which record what a run
-- actually consumed. Together they answer the whole accounting question: what
-- the firm permitted, and what was spent against it.
--
-- ================================================== three states, not a null ==
--
-- Each dimension is a small union rather than a nullable number, for the same
-- reason `usage_state` is:
--
--   limit           bounded. Exceeding it fails the run
--   not-applicable  the producer cannot consume this at all
--   not-measured    nobody decided, and a live run therefore refuses to start
--
-- A nullable column collapses the last two, and the collapse falls on the side
-- that costs money. `not-measured` preserves the meaning the application type
-- was documented with from the beginning — "not measured, never unlimited" —
-- which existed so a live runtime could refuse to begin work it had no
-- authorization for. What it could never express is the other half: a stub or a
-- replay **cannot** incur a monetary cost, and refusing it for lacking a limit
-- on something it is incapable of spending would be refusing a fact.
--
-- The same distinction the eligibility gates draw between `not-applicable` and
-- `passed`: a limit that does not apply and a limit nobody set are different
-- facts about the firm.
--
-- ==================================================== the effective limit only ==
--
-- These columns hold what the three policy sources RESOLVED TO — a playbook
-- proposes, a case may constrain, firm-wide policy is the hard ceiling — never
-- the sources themselves. A historical run must read back its own limits after
-- all three have changed. Storing the sources would make an old run's
-- authorization re-derivable only from documents that have since moved, and a
-- run whose limits could not be read without reconstructing three policies
-- would be a reference to what the firm permitted rather than a record of it.
--
-- The same rule the eligibility basis already follows: the record carries what
-- was in force, not a pointer to wherever it currently lives.

ALTER TABLE analysis.runs
    -- Existing rows are all stub or recorded work: neither can spend tokens or
    -- money, so `not-applicable` is the accurate backfill rather than a
    -- convenient one. Their deadline is genuinely unknown — it was never
    -- recorded — and `not-measured` says exactly that.
    ADD COLUMN budget_tokens_kind      text NOT NULL DEFAULT 'not-applicable',
    ADD COLUMN budget_tokens           integer,
    ADD COLUMN budget_cost_kind        text NOT NULL DEFAULT 'not-applicable',
    ADD COLUMN budget_cost_minor_units integer,
    ADD COLUMN budget_currency         text,
    ADD COLUMN budget_deadline_kind    text NOT NULL DEFAULT 'not-measured',
    ADD COLUMN budget_deadline_ms      integer,

    ADD CONSTRAINT runs_budget_kinds_known CHECK (
        budget_tokens_kind   IN ('limit', 'not-applicable', 'not-measured')
    AND budget_cost_kind     IN ('limit', 'not-applicable', 'not-measured')
    AND budget_deadline_kind IN ('limit', 'not-applicable', 'not-measured')
    ),

    -- A limit is its state and its value together, in both directions: a value
    -- without the state would be invisible to every reader, and the state
    -- without a value would be a limit nobody set.
    ADD CONSTRAINT runs_budget_limits_complete CHECK (
        (budget_tokens_kind = 'limit') = (budget_tokens IS NOT NULL)
    AND (budget_cost_kind = 'limit') = (
            budget_cost_minor_units IS NOT NULL AND budget_currency IS NOT NULL
        )
    AND (budget_deadline_kind = 'limit') = (budget_deadline_ms IS NOT NULL)
    ),

    -- An amount without a currency is not a cost. The same rule the usage
    -- columns hold for what was spent.
    ADD CONSTRAINT runs_budget_amounts_are_not_negative CHECK (
        (budget_tokens IS NULL OR budget_tokens >= 0)
    AND (budget_cost_minor_units IS NULL OR budget_cost_minor_units >= 0)
    AND (budget_deadline_ms IS NULL OR budget_deadline_ms > 0)
    ),

    /*
     * Capability is a fact about the producer, not a policy choice.
     *
     * A stub or a replay consumes nothing external, so a token or cost budget
     * on one would authorize spend that cannot occur. A live run is the mirror
     * image: `not-measured` on any dimension is an unbounded live call, which
     * is the exact combination the whole three-state design exists to refuse.
     * `buildRunRecord` refuses it too — this is the copy that holds when
     * something writes around the domain.
     */
    ADD CONSTRAINT runs_budget_matches_provider CHECK (
        (provider_kind = 'live' OR (
            budget_tokens_kind = 'not-applicable'
        AND budget_cost_kind = 'not-applicable'
        ))
    AND (provider_kind <> 'live' OR (
            budget_tokens_kind   <> 'not-measured'
        AND budget_cost_kind     <> 'not-measured'
        AND budget_deadline_kind <> 'not-measured'
        ))
    );

ALTER TABLE analysis.runs ALTER COLUMN budget_tokens_kind   DROP DEFAULT;
ALTER TABLE analysis.runs ALTER COLUMN budget_cost_kind     DROP DEFAULT;
ALTER TABLE analysis.runs ALTER COLUMN budget_deadline_kind DROP DEFAULT;

-- ------------------------------------------------------------------ grants --
--
-- Deliberately no `GRANT UPDATE`. What a run was authorized to spend is
-- decided once, before it starts, and is not a current value that later work
-- revises — the same treatment the identity and provider columns get, and for
-- the same reason. The upsert in `workRepositories` leaves these out of its
-- `DO UPDATE SET` list, so the absent grant and the statement agree.
--
-- `INSERT` is granted at table level by 0009 and therefore already covers
-- these columns.


-- ================================= what this migration deliberately does NOT ==
--
-- There is no case-level budget column here, and that is a scope decision
-- rather than an oversight.
--
-- `resolveExecutionBudget` already takes all three sources — the playbook's
-- proposal, a case constraint, and the firm ceiling — and the run stores what
-- they resolved to. What is not yet built is durable storage for the middle
-- one: today a case constraint reaches the resolver from the orchestrator's
-- caller rather than from a column.
--
-- Storing it is a case-table column, its create and save statements, the row
-- type, the mapping, a domain field and a command authorised to revise it.
-- That is its own piece of work, and adding the column here without the rest
-- would ship storage nothing reads — which is worse than an honest absence,
-- because a column that is always NULL reads as a policy the firm declined to
-- set rather than one it cannot yet record.
--
-- The run-level record is unaffected either way: it holds the resolved number,
-- never a pointer to the sources, so persisting the case constraint later
-- changes what resolution consumes and nothing about what a historical run
-- reads back.

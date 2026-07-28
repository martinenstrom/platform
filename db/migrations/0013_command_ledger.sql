-- The command ledger, and runtime provenance.
--
-- ## What this replaces, and why
--
-- `idempotency_keys` held four columns, was granted DELETE, expired at thirty
-- days, and the schema described it as "operational rather than institutional".
-- What Phase C needs is none of those things: a permanent record of what was
-- asked, by whom, under what authority, against what version, and what came of
-- it.
--
-- That is a command ledger. It is dropped and replaced rather than extended,
-- because the table is empty in every environment — no adapter has ever
-- written to it, and the port that could is being replaced in the same change.
--
-- ## Intent and outcome are separate tables
--
-- `commands` records what was ASKED and is immutable. `command_outcomes`
-- records what HAPPENED and is append-only. A command that is unresolved and
-- later confirmed gains a second outcome row; the first is not overwritten,
-- because "we did not know for six minutes" is itself an institutional fact.
--
-- Collapsing them into one mutable row would mean the ledger's own history
-- could be rewritten by the thing it exists to make un-rewritable.
--
-- ## What this table cannot do
--
-- It cannot record its own unavailability. If PostgreSQL is unreachable before
-- a command reaches the durable boundary, there is no institutional command —
-- only an operational delivery failure, which belongs in logs and metrics.
-- Pretending otherwise would be inventing a guarantee.

-- ------------------------------------------------------ runtime provenance --

-- Which code and which SQL produced a record.
--
-- One row per distinct combination rather than five columns on every command:
-- the coordinates change on deploy, not per command, and repeating them would
-- be a large fraction of the ledger.
CREATE TABLE analysis.storage_provenance (
    -- Hash of every coordinate below. Deriving the key from the content means
    -- two runtimes with identical coordinates share a row by construction.
    id                       text PRIMARY KEY,
    adapter_id               text NOT NULL,
    -- Derived, not hand-maintained: see `deriveAdapterVersion`.
    adapter_version          text NOT NULL,
    -- Git commit, injected at build. 'dev' locally.
    build_id                 text NOT NULL,
    query_catalog_hash       text NOT NULL,
    schema_version           text NOT NULL,
    domain_contract_version  text NOT NULL,
    command_contract_version text NOT NULL,
    first_seen_at            timestamptz NOT NULL
);

-- --------------------------------------------------------- command intent --

CREATE TABLE analysis.commands (
    command_id               text NOT NULL,
    tenant_id                text NOT NULL REFERENCES analysis.tenants (id),
    command_type             text NOT NULL,
    command_contract_version text NOT NULL,

    /*
     * Deterministic hash of the semantic input. Reusing a command id with a
     * different payload is a different command wearing the same name, and must
     * fail rather than return the earlier result.
     */
    payload_hash             text NOT NULL,

    -- What it targeted.
    case_id                  text REFERENCES analysis.cases (id),
    thesis_revision_id       text REFERENCES analysis.thesis_revisions (revision_id),
    expected_version         integer,

    /*
     * The accountable actor, snapshotted.
     *
     * Not a bare foreign key: if the employee later moves department or changes
     * role, this command must still show the authority it ran under. A join to
     * the current organization would silently rewrite history.
     */
    actor_kind               text NOT NULL,
    actor_employee_id        text REFERENCES analysis.employees (id),
    actor_role_id            text,
    actor_role_function      text,
    actor_department_id      text,
    actor_department_is_governance boolean,
    actor_department_handles text[],
    actor_authentication     text NOT NULL,
    organization_seed_version text NOT NULL,

    -- Why it was allowed, decided at execution time.
    mandate_kind             text NOT NULL,
    mandate_discipline       text,
    authorization_basis      text NOT NULL,

    /*
     * Who set it in motion, which is not who is accountable for it. The
     * orchestrator may decide the next step is due; it is not the verifier.
     */
    initiator_kind           text NOT NULL,
    initiator_id             text NOT NULL,

    correlation_id           text NOT NULL,
    occurred_at              timestamptz NOT NULL,
    received_at              timestamptz NOT NULL,
    provenance_id            text NOT NULL REFERENCES analysis.storage_provenance (id),

    -- Unique within a tenant, as required.
    PRIMARY KEY (command_id, tenant_id),

    CONSTRAINT commands_actor_kind_known CHECK (actor_kind IN ('employee', 'system')),
    CONSTRAINT commands_initiator_kind_known CHECK (
        initiator_kind IN ('employee', 'orchestrator', 'system', 'recorded-provider')
    ),
    -- Nothing is ever described as an authenticated user while TD-8 is open.
    CONSTRAINT commands_authentication_known CHECK (
        actor_authentication = 'system-asserted'
    ),

    /*
     * An employee actor carries an employee, a role and a department; a system
     * actor carries none of them. An ownerless command is not representable,
     * and neither is a system actor wearing a department.
     */
    CONSTRAINT commands_actor_shape CHECK (
        (actor_kind = 'employee'
         AND actor_employee_id IS NOT NULL
         AND actor_role_id IS NOT NULL
         AND actor_department_id IS NOT NULL)
        OR
        (actor_kind = 'system'
         AND actor_employee_id IS NULL
         AND actor_role_id IS NULL
         AND actor_department_id IS NULL)
    ),

    -- A governance verdict names the discipline it was issued under.
    CONSTRAINT commands_governance_names_discipline CHECK (
        mandate_kind <> 'governance-verdict' OR mandate_discipline IS NOT NULL
    )
);

CREATE INDEX commands_case_idx
    ON analysis.commands (case_id, occurred_at DESC)
    WHERE case_id IS NOT NULL;
CREATE INDEX commands_received_idx ON analysis.commands (received_at DESC);
CREATE INDEX commands_actor_idx ON analysis.commands (actor_employee_id, occurred_at DESC);

-- -------------------------------------------------------- command outcomes --

-- Append-only. A command that was unresolved and is later confirmed gains a
-- second row; the first stays, because how long the answer was unknown is part
-- of the record.
CREATE TABLE analysis.command_outcomes (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    command_id    text NOT NULL,
    tenant_id     text NOT NULL,
    -- Monotonic within one command.
    seq           integer NOT NULL,

    state         text NOT NULL,
    -- Present when committed: what the command produced.
    result_kind   text,
    result_ref    text,
    -- Present when rejected: a bounded code, never free text.
    reason_code   text,
    -- Present when failed: the error category, never the message.
    error_category text,
    -- Present when unresolved: how to settle it.
    resolution_reference text,

    recorded_at   timestamptz NOT NULL,
    provenance_id text NOT NULL REFERENCES analysis.storage_provenance (id),

    FOREIGN KEY (command_id, tenant_id)
        REFERENCES analysis.commands (command_id, tenant_id),
    CONSTRAINT command_outcomes_seq_unique UNIQUE (command_id, tenant_id, seq),

    CONSTRAINT command_outcomes_state_known CHECK (
        state IN ('committed', 'rejected', 'failed', 'unresolved')
    ),
    -- Each state carries exactly what it means and nothing it does not.
    CONSTRAINT command_outcomes_shape CHECK (
        (state = 'committed' AND result_kind IS NOT NULL AND result_ref IS NOT NULL
         AND reason_code IS NULL AND error_category IS NULL)
        OR (state = 'rejected' AND reason_code IS NOT NULL
            AND result_ref IS NULL AND error_category IS NULL)
        OR (state = 'failed' AND error_category IS NOT NULL
            AND result_ref IS NULL AND reason_code IS NULL)
        OR (state = 'unresolved' AND result_ref IS NULL
            AND reason_code IS NULL AND error_category IS NULL)
    )
);

CREATE INDEX command_outcomes_command_idx
    ON analysis.command_outcomes (command_id, tenant_id, seq);

-- At most one committed outcome per command. A second would mean the same
-- command produced two institutional results.
CREATE UNIQUE INDEX command_outcomes_one_committed
    ON analysis.command_outcomes (command_id, tenant_id)
    WHERE state = 'committed';

-- ------------------------------------------------------------- immutability --

-- Intent is never rewritten. The runtime holds no UPDATE grant, so for the
-- application this is already impossible; the trigger covers migrations,
-- operator sessions, and any future role that acquires one.
CREATE FUNCTION analysis.refuse_command_rewrite()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'Command "%" is a record of what was asked and cannot be % . Append a '
        'new outcome instead.',
        COALESCE(OLD.command_id, NEW.command_id), lower(TG_OP)
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER commands_immutable
    BEFORE UPDATE OR DELETE ON analysis.commands
    FOR EACH ROW EXECUTE FUNCTION analysis.refuse_command_rewrite();

CREATE FUNCTION analysis.refuse_outcome_rewrite()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'Command outcomes are append-only and cannot be % .', lower(TG_OP)
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER command_outcomes_immutable
    BEFORE UPDATE OR DELETE ON analysis.command_outcomes
    FOR EACH ROW EXECUTE FUNCTION analysis.refuse_outcome_rewrite();

/*
 * Only `unresolved` may be followed by anything.
 *
 * `committed`, `rejected` and `failed` are terminal: a rejected command did not
 * happen, a failed one wrote nothing, and a committed one has its result. An
 * outcome appended after any of them would be a second answer to a settled
 * question.
 */
CREATE FUNCTION analysis.assert_outcome_not_settled()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    settled text;
BEGIN
    SELECT state INTO settled
    FROM analysis.command_outcomes
    WHERE command_id = NEW.command_id
      AND tenant_id = NEW.tenant_id
      AND state <> 'unresolved'
    LIMIT 1;

    IF settled IS NOT NULL THEN
        RAISE EXCEPTION
            'Command "%" is already %, which is terminal. A later outcome would '
            'be a second answer to a settled question.',
            NEW.command_id, settled
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER command_outcomes_terminal
    BEFORE INSERT ON analysis.command_outcomes
    FOR EACH ROW EXECUTE FUNCTION analysis.assert_outcome_not_settled();

-- ---------------------------------------------------- the old table goes --

-- Empty in every environment: no adapter ever wrote to it, and the port that
-- could is replaced in this change.
DROP TABLE analysis.idempotency_keys;

-- ---------------------------------------------------------------- grants --

-- Insert and read only. Nothing may edit a command, and nothing may delete
-- one — which leaves the schema with no deletable table at all, consistent
-- with everything else in it.
GRANT SELECT, INSERT ON
    analysis.commands,
    analysis.command_outcomes,
    analysis.storage_provenance
TO finos_app;

GRANT SELECT ON
    analysis.commands,
    analysis.command_outcomes,
    analysis.storage_provenance
TO finos_readonly;

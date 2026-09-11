-- Financial OS specialists as accountable institutional principals.
--
-- An agent principal is neither a human employee nor a generic system process.
-- It is a named desk actor with a narrow mandate: `global-macro-agent` is
-- accountable for Global Macro's institutional acts, and it remains the same
-- principal when the model behind it changes from one provider or version to
-- the next.
--
-- ## Why not employees
--
-- Putting agents into `analysis.employees` was considered and refused. That
-- table is the human organisation — seniority, reporting lines, a person's
-- name — and an agent row in it would give the firm fake staff that appear in
-- every roster, directory and seat. The human/agent boundary is load-bearing
-- and stays.
--
-- ## Why not a generic principal rewrite
--
-- A universal `(principal_kind, principal_id)` across all twenty
-- employee-shaped columns was also refused, as broader than this slice earns.
-- Only the six tables an automatic committee actually writes gain an agent
-- column, and only where an accountable institutional act is recorded.
--
-- ## Department and role are the whole design
--
-- `authorize()` reads `departmentId`, `roleFunction` and
-- `departmentIsGovernance` from the actor. Sourcing those from the real
-- organisation means the EXISTING mandate rules evaluate an agent unchanged:
-- `department-contribution` already confines an actor to its own department,
-- and `governance-verdict` already demands a governance department and role. No
-- new mandate kind is introduced, and Rates cannot perform Verification because
-- the rule that already prevented it still applies.
--
-- ## Convening is deliberately NOT inherited
--
-- `roles.can_convene_committee` may be true on a role an agent references.
-- Committee convening remains a human operator authority in v1, enforced in
-- `authorize()` by actor kind rather than by seed discipline — a seed that
-- happened to be careful is not a rule.

CREATE TABLE analysis.agent_principals (
    id            text PRIMARY KEY,
    department_id text        NOT NULL REFERENCES analysis.departments (id),
    role_id       text        NOT NULL REFERENCES analysis.roles (id),
    display_name  text        NOT NULL,
    -- A principal is retired, never deleted: its past acts must keep resolving.
    active        boolean     NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE analysis.agent_principals IS
    'Named Financial OS specialists that may perform institutional acts for '
    'their own desk. Not employees, not system processes. The id is stable '
    'across model and provider changes.';

-- The principals the first automatic Macro committee needs, and no others.
-- Seeding the whole future firm would create authority nothing has exercised.
INSERT INTO analysis.agent_principals (id, department_id, role_id, display_name)
VALUES
    ('global-macro-agent', 'global-macro', 'head-of-macro', 'Global Macro'),
    ('rates-agent',        'rates',        'head-of-rates', 'Rates');

-- ------------------------------------------------ accountable act surfaces --
--
-- Each table gains a nullable agent column beside its employee column and an
-- exactly-one invariant. The CHECK is strictly STRONGER than the NOT NULL it
-- replaces: previously a row needed an employee, now it needs exactly one
-- accountable principal and cannot carry two.
--
-- Every historical row satisfies it unchanged, because every historical row has
-- an employee and no agent.

ALTER TABLE analysis.runs
    ALTER COLUMN employee_id DROP NOT NULL,
    ADD COLUMN agent_principal_id text REFERENCES analysis.agent_principals (id),
    ADD CONSTRAINT runs_one_accountable_principal
        CHECK (num_nonnulls(employee_id, agent_principal_id) = 1);

ALTER TABLE analysis.reviews
    ALTER COLUMN by_employee_id DROP NOT NULL,
    ADD COLUMN by_agent_principal_id text REFERENCES analysis.agent_principals (id),
    ADD CONSTRAINT reviews_one_accountable_principal
        CHECK (num_nonnulls(by_employee_id, by_agent_principal_id) = 1);

ALTER TABLE analysis.thesis_revisions
    ALTER COLUMN proposed_by_employee_id DROP NOT NULL,
    ADD COLUMN proposed_by_agent_principal_id text
        REFERENCES analysis.agent_principals (id),
    ADD CONSTRAINT thesis_revisions_one_accountable_principal
        CHECK (num_nonnulls(proposed_by_employee_id, proposed_by_agent_principal_id) = 1);

ALTER TABLE analysis.aggregations
    ALTER COLUMN manager_employee_id DROP NOT NULL,
    ADD COLUMN manager_agent_principal_id text
        REFERENCES analysis.agent_principals (id),
    ADD CONSTRAINT aggregations_one_accountable_principal
        CHECK (num_nonnulls(manager_employee_id, manager_agent_principal_id) = 1);

-- `assignments.assignee_employee_id` is already nullable: unassigned work is a
-- real state. So the invariant here is AT MOST one, not exactly one — an
-- assignment with neither is queued work nobody has picked up, which is
-- different from an act with no accountable principal.
ALTER TABLE analysis.assignments
    ADD COLUMN assignee_agent_principal_id text
        REFERENCES analysis.agent_principals (id),
    ADD CONSTRAINT assignments_at_most_one_assignee
        CHECK (num_nonnulls(assignee_employee_id, assignee_agent_principal_id) <= 1);

-- ------------------------------------------------------- the command ledger --
--
-- `commands.actor_employee_id` carries no foreign key and is not given one: the
-- ledger records the actor as it stood at execution time, and a constraint
-- against the live organisation would let a later reorganisation invalidate
-- history.

ALTER TABLE analysis.commands
    ADD COLUMN actor_agent_principal_id text;

ALTER TABLE analysis.commands
    DROP CONSTRAINT commands_actor_kind_known,
    ADD CONSTRAINT commands_actor_kind_known CHECK (
        actor_kind = ANY (ARRAY['employee', 'institutional-agent', 'system'])
    );

-- An agent act carries its principal, its role and its department — the same
-- organisational snapshot an employee act carries, because the mandate engine
-- reads the same fields from both. What it must not carry is an employee id.
ALTER TABLE analysis.commands
    DROP CONSTRAINT commands_actor_shape,
    ADD CONSTRAINT commands_actor_shape CHECK (
        (actor_kind = 'employee'
            AND actor_employee_id IS NOT NULL
            AND actor_agent_principal_id IS NULL
            AND actor_role_id IS NOT NULL
            AND actor_department_id IS NOT NULL)
        OR (actor_kind = 'institutional-agent'
            AND actor_employee_id IS NULL
            AND actor_agent_principal_id IS NOT NULL
            AND actor_role_id IS NOT NULL
            AND actor_department_id IS NOT NULL)
        OR (actor_kind = 'system'
            AND actor_employee_id IS NULL
            AND actor_agent_principal_id IS NULL
            AND actor_role_id IS NULL
            AND actor_department_id IS NULL)
    );

-- ## Rollback boundary — stated, not scripted
--
-- This migration is structurally reversible **only while no agent principal has
-- acted**. Once a real autonomous act exists, restoring `NOT NULL` would
-- require giving that act a human, and there is no honest human to give it: the
-- act was performed by an agent and the record says so.
--
-- A down migration that reattributed agent acts to an employee would fabricate
-- human accountability in the firm's own ledger, which is worse than any
-- schema being irreversible. If a reverse path is ever written it must REFUSE
-- while `agent_principals` rows are referenced, rather than reassign them.
--
-- The inability to dishonestly erase a real institutional act is not a defect.

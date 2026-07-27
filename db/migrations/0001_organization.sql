-- The firm itself: tenants, roles, departments, teams, employees.
--
-- Everything here is DATA. Adding ESG Research, Credit or FX is an INSERT, and
-- the domain proves it by constructing a department the codebase has never
-- heard of. Nothing in this schema enumerates which departments exist.
--
-- ## Why these tables are insert-only for the runtime
--
-- The organization is referenced by every historical work record: an assignment
-- names the department that owed the work, a review names the employee who
-- performed it. If a later seed could rewrite or remove those rows, the record
-- of what the firm did would change retroactively.
--
-- So the runtime role never receives UPDATE or DELETE here (0009), and the seed
-- (0010) only inserts. Changing an existing department is a new migration that
-- states exactly what it changes and is recorded in the migration history —
-- deliberate and reviewable, rather than a silent consequence of editing a
-- seed file.

CREATE SCHEMA IF NOT EXISTS analysis;

-- ---------------------------------------------------------------- tenancy --

-- Exists before authentication does.
--
-- Authentication later adds users and row-level security policies keyed on
-- `tenant_id`; it does not add the column, because retrofitting a tenant key
-- onto populated institutional tables is the migration this avoids. Until then
-- there is exactly one row, the system tenant, and no record is tenantless.
CREATE TABLE analysis.tenants (
    id          text PRIMARY KEY,
    name        text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tenants_id_not_blank CHECK (btrim(id) <> '')
);

-- ------------------------------------------------------------------ roles --

-- What a role is FOR, in organizational terms — authority and reporting, not
-- subject matter. A new asset class adds departments, never a new function.
CREATE TABLE analysis.roles (
    id                    text PRIMARY KEY,
    title                 text    NOT NULL,
    function              text    NOT NULL,
    can_block_publication boolean NOT NULL,

    CONSTRAINT roles_function_known CHECK (
        function IN ('specialist', 'manager', 'governance', 'executive', 'editorial')
    ),

    -- The domain rule from `buildRole`, restated where it cannot be bypassed.
    -- A specialist cannot grant itself a veto, and a governance function that
    -- cannot block is advisory rather than a control.
    CONSTRAINT roles_only_governance_blocks CHECK (
        (function = 'governance') = can_block_publication
    )
);

CREATE TABLE analysis.responsibilities (
    id           text PRIMARY KEY,
    role_id      text    NOT NULL REFERENCES analysis.roles (id),
    summary      text    NOT NULL,
    -- True where the discipline yields a reading rather than a measurement.
    -- Elliott Wave is the standing example, and it must be labelled wherever
    -- it appears.
    interpretive boolean NOT NULL
);

CREATE INDEX responsibilities_role_idx ON analysis.responsibilities (role_id);

-- ------------------------------------------------ departments and employees --

-- A department and its manager reference each other, so one direction must be
-- deferrable or neither row could ever be inserted. The manager reference is
-- the deferred one; an employee's department is not, because an employee
-- without a department is never legitimate.
CREATE TABLE analysis.departments (
    id                  text PRIMARY KEY,
    tenant_id           text    NOT NULL REFERENCES analysis.tenants (id),
    name                text    NOT NULL,
    manager_employee_id text    NOT NULL,
    -- Devil's Advocate, Verification, Compliance, Risk. A first-class
    -- department with its own queue — not a stage bolted onto someone else's
    -- pipeline, which is what makes "who is reviewing what" answerable.
    is_governance       boolean NOT NULL
);

CREATE INDEX departments_tenant_idx ON analysis.departments (tenant_id);

-- Routing tags. Deliberately a table of open strings rather than an enum: this
-- is the reason a new asset-class department needs no code change.
CREATE TABLE analysis.department_handles (
    department_id text NOT NULL REFERENCES analysis.departments (id),
    discipline    text NOT NULL,
    PRIMARY KEY (department_id, discipline)
);

CREATE INDEX department_handles_discipline_idx
    ON analysis.department_handles (discipline);

CREATE TABLE analysis.employees (
    id            text PRIMARY KEY,
    display_name  text NOT NULL,
    role_id       text NOT NULL REFERENCES analysis.roles (id),
    department_id text NOT NULL REFERENCES analysis.departments (id),
    team_id       text,
    reports_to    text REFERENCES analysis.employees (id),
    seniority     text NOT NULL,

    CONSTRAINT employees_seniority_known CHECK (
        seniority IN ('analyst', 'senior', 'lead', 'head', 'chief')
    ),
    -- The one reporting cycle a constraint can see. Longer cycles are caught
    -- by `validateOrganization`, which walks every line to the chief; a
    -- recursive check here would duplicate that logic in a second place and
    -- run it on every insert.
    CONSTRAINT employees_no_self_report CHECK (reports_to <> id)
);

CREATE INDEX employees_department_idx ON analysis.employees (department_id);
CREATE INDEX employees_reports_to_idx ON analysis.employees (reports_to);

CREATE TABLE analysis.teams (
    id              text PRIMARY KEY,
    name            text NOT NULL,
    department_id   text NOT NULL REFERENCES analysis.departments (id),
    lead_employee_id text NOT NULL REFERENCES analysis.employees (id)
);

CREATE INDEX teams_department_idx ON analysis.teams (department_id);

ALTER TABLE analysis.employees
    ADD CONSTRAINT employees_team_fk
    FOREIGN KEY (team_id) REFERENCES analysis.teams (id);

ALTER TABLE analysis.departments
    ADD CONSTRAINT departments_manager_fk
    FOREIGN KEY (manager_employee_id) REFERENCES analysis.employees (id)
    DEFERRABLE INITIALLY DEFERRED;

-- A department managed by someone who works elsewhere is not a department.
--
-- A trigger rather than a CHECK because the rule spans two tables, and
-- deferred because the manager row and the department row are inserted in the
-- same transaction and each needs the other.
CREATE FUNCTION analysis.assert_manager_belongs_to_department()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    manager_department text;
BEGIN
    SELECT department_id INTO manager_department
    FROM analysis.employees
    WHERE id = NEW.manager_employee_id;

    IF manager_department IS DISTINCT FROM NEW.id THEN
        RAISE EXCEPTION
            'Department "%" is managed by "%", who belongs to department "%"',
            NEW.id, NEW.manager_employee_id, manager_department
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER departments_manager_belongs
    AFTER INSERT OR UPDATE ON analysis.departments
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION analysis.assert_manager_belongs_to_department();

-- ---------------------------------------------------------- organizations --

-- The firm. One row per tenant today; the table exists because the chief is a
-- property of the organization rather than of any department, and because
-- `validateOrganization` needs somewhere to read it from.
CREATE TABLE analysis.organizations (
    id                text PRIMARY KEY,
    tenant_id         text NOT NULL REFERENCES analysis.tenants (id),
    name              text NOT NULL,
    chief_employee_id text NOT NULL REFERENCES analysis.employees (id)
        DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT organizations_one_per_tenant UNIQUE (tenant_id)
);

-- Which seed produced the organization now in the database.
--
-- Not a temporal versioning of the org graph — see `docs/durable-storage-plan.md`
-- for why that is deferred. This answers the narrower question an auditor
-- actually asks: when did the structure last change, and was the seed file
-- edited after it was applied.
CREATE TABLE analysis.organization_seed_versions (
    version    text PRIMARY KEY,
    checksum   text        NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
);

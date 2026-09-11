-- Which role may back an autonomous department-analysis principal.
--
-- ## Why role function is not enough
--
-- `department-manager` authorises three department-level analytical and
-- workflow acts: assembling evidence, the managerial synthesis, and submitting
-- the resulting revision to Verification. Its qualification has always been a
-- person: `department.manager_employee_id = actor.employee_id`. An agent has no
-- employee id and could never satisfy it.
--
-- The obvious generalisation — an agent whose ROLE FUNCTION is `manager`, in
-- the right department — was measured and refused. The seed already gives
-- `global-macro-agent` the `head-of-macro` role and `rates-agent` the
-- `head-of-rates` role, both of function `manager`. Shipping that rule would
-- have handed both agents department-manager authority over their own desks the
-- moment it landed: authority nobody granted, arriving through a field chosen
-- for an entirely different reason.
--
-- So the capability is explicit, exactly as `can_convene_committee` is.
--
-- ## What it does NOT mean
--
-- Personnel management, organisation administration, committee convening or CIO
-- authority. It names the three department-level analytical/workflow acts and
-- nothing else. Convening in particular stays refused for every agent in v1,
-- enforced in `authorize()` by actor kind rather than by seed discipline — a
-- role that happens to hold both capabilities still cannot convene.
--
-- Management roles only. A specialist granting itself department authority
-- would collapse the desk's act into the manager's judgement, which the
-- institution keeps apart on purpose. The chief is excluded too: the CIO
-- consumes department analysis and performs none.

ALTER TABLE analysis.roles
    ADD COLUMN can_manage_department_analysis boolean NOT NULL DEFAULT false;

-- The same invariant `buildRole` enforces, so a row cannot enter the database
-- in a shape the domain would refuse to construct.
ALTER TABLE analysis.roles
    ADD CONSTRAINT roles_department_analysis_is_management
    CHECK (NOT can_manage_department_analysis OR function = 'manager');

-- The one role intended to back an autonomous department-analysis principal.
--
-- Granted by id, never by function. Every other management role — Macro, Rates,
-- Equity, Quant and the rest — keeps exactly the powers it had, which is the
-- whole point of an explicit capability: a capability nobody granted is a
-- capability nobody holds.
--
-- This does not change what the human Research Director may do. The employee
-- branch of `department-manager` still asks whether the actor is the person the
-- org chart records as managing the department, and the capability is consulted
-- only on the agent branch.
UPDATE analysis.roles
SET can_manage_department_analysis = true
WHERE id = 'research-director';

COMMENT ON COLUMN analysis.roles.can_manage_department_analysis IS
    'Authority to perform the department-level analytical and workflow acts '
    'the department-manager mandate covers: evidence assembly, managerial '
    'synthesis, and submission to Verification. Not personnel authority, not '
    'organisation administration, not committee convening, not CIO authority.';

-- ------------------------------------------------ the Research Office agent --
--
-- The principal the first autonomous synthesis needs, and no others. Seeding
-- the whole future firm would create authority nothing has exercised.
--
-- It holds `research-director` — the same pattern `global-macro-agent` follows
-- with `head-of-macro`. The role is the institutional position the mandate
-- engine reads; it is not a claim that the agent IS the Research Director, who
-- is a person with a reporting line and a seat.
INSERT INTO analysis.agent_principals (id, department_id, role_id, display_name)
VALUES ('research-office-agent', 'research-office', 'research-director',
        'Research Office');

-- ## Deliberately NOT a new organisation seed version
--
-- The same reason migration 0038 added none. `organization_seed_versions`
-- hashes roles as `id|function|can_block_publication` (migration 0011), so this
-- capability is outside the checksum — TD-83. A new version row would carry a
-- checksum identical to its predecessor's, and `organizationReader` invalidates
-- its cache on checksum equality alone: every running process would keep
-- serving the pre-grant organisation until restart, with the bump doing
-- nothing. Recording a version indistinguishable from its predecessor is worse
-- than recording none.
--
-- Agent principals are outside the checksum for the same reason and were when
-- `0040` seeded the first two.

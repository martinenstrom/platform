-- Authority to convene an investment committee.
--
-- The Chairman asks the firm a question and calls the committee that answers it.
-- Until now the institution could not represent that: `InstantiatePlaybook`
-- required `department-manager` over the department owning the case, so the only
-- person who could convene a Research Office case was the Research Director.
--
-- The product premise is that the Chairman convenes. The choice was therefore
-- between recording something untrue — the Research Director as the actor of an
-- act they did not perform — and giving the firm an explicit authority for what
-- actually happens. This is the second.
--
-- ## Convening is not ownership
--
-- The capability authorises CALLING a committee. It confers nothing over the
-- work that follows. `InstantiatePlaybook` still verifies that the department
-- named is the department that owns the case, so a convenor cannot acquire a
-- case, reassign it, or make their own desk accountable for it. After convening,
-- Research Office owns the work exactly as before.
--
-- ## Not an executive exemption
--
-- One named capability, resolved by `authorize` like every other mandate. It is
-- held because it was granted, never because of seniority: withdrawing the flag
-- refuses the same person immediately, and the domain has a test that does
-- exactly that. The existing `department-manager` rule is delegated to
-- unchanged, so every authority that worked before this migration still works.
--
-- ## Who may hold it
--
-- Executive and management roles only, enforced here and in `buildRole`.
-- Commissioning the firm's work is a management act: a specialist holding it
-- could set the whole firm working, and a control function holding it would be
-- commissioning the work it exists to check.

ALTER TABLE analysis.roles
    ADD COLUMN can_convene_committee boolean NOT NULL DEFAULT false;

-- The same invariant `buildRole` enforces, so a row cannot enter the database in
-- a shape the domain would refuse to construct.
ALTER TABLE analysis.roles
    ADD CONSTRAINT roles_convening_is_executive_or_management
    CHECK (NOT can_convene_committee OR function IN ('executive', 'manager'));

-- The chair of the investment committee.
--
-- `chief-investment-officer` is the firm's only executive role, and chairing is
-- what it does. Granted by id rather than by function so that a future executive
-- role does not silently inherit the authority to commission the firm's work.
UPDATE analysis.roles
SET can_convene_committee = true
WHERE id = 'chief-investment-officer';

COMMENT ON COLUMN analysis.roles.can_convene_committee IS
    'Authority to convene an investment committee. Not authority over the work '
    'the committee produces, which stays with the department owning the case.';

-- ## Deliberately NOT a new organisation seed version
--
-- `organization_seed_versions` hashes roles as `id|function|can_block_publication`
-- (migration 0011), so this capability is outside the checksum — TD-83. A new
-- version row would therefore carry a checksum IDENTICAL to version 2's, and
-- `organizationReader` invalidates its cache on checksum equality alone: every
-- running process would keep serving the pre-grant organisation until restart,
-- with the version bump doing nothing.
--
-- Recording a version that cannot be distinguished from its predecessor is worse
-- than recording none, so no row is added. The authority is still auditable — it
-- is a column with a constraint and this migration. Closing this properly is
-- TD-83's canonicalisation change, which is not this migration's subject.

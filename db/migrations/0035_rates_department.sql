-- The Rates desk: a second analytical voice with a mandate that overlaps Macro's.
--
-- Until now the firm had one analytical department capable of speaking about the
-- rates market, and `global-macro` held the `rates` routing handle. One desk cannot
-- disagree with itself, so the institution could record objections from its control
-- functions but never a substantive disagreement between two desks that both know
-- the subject. That is the capability this seeds.
--
-- ## Why a real seat rather than a label
--
-- Migration 0034 added a foreign key from `challenges.by_department_id` to
-- `analysis.departments`, and it immediately rejected `'rates'` — because the
-- department did not exist. That rejection is the reason this migration is here
-- rather than a string being threaded through a test: a department is a seat the
-- firm holds, with a manager, an employee who can act, and a routing handle. A
-- challenge filed by a desk that does not exist is not an institutional act.
--
-- ## The mandate, and its boundary
--
-- Rates analyses monetary-policy expectations, nominal and real yield curves,
-- inflation compensation, curve structure and rate-move attribution, and challenges
-- causal interpretations of rates where its expertise overlaps another desk's.
--
-- It is NOT given valuation, equity-fundamental or general macro ownership. Global
-- Macro keeps the macroeconomic regime — growth, inflation, labour, policy regime,
-- liquidity — and may still make claims about rates as part of a macro thesis.
--
-- **The overlap is deliberate.** It is precisely what makes genuine peer
-- disagreement possible: Rates contesting Macro's attribution of a Treasury move is
-- two qualified desks reading the same evidence differently. What is not deliberate
-- is ambiguous ownership, which is why the routing handle moves rather than being
-- shared.
--
-- ## Not a governance department
--
-- `is_governance` is false. Rates is an analytical desk that happens to be able to
-- challenge; the Devil's Advocate, Verification, Risk and Compliance are control
-- functions whose whole purpose is review. Marking Rates as governance would let a
-- peer examination be mistaken for a control-function review, which is the
-- distinction the peer/Devil's-Advocate split exists to preserve.

INSERT INTO analysis.roles (id, title, function, can_block_publication) VALUES
    ('head-of-rates', 'Head of Rates', 'manager', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO analysis.departments (id, tenant_id, name, manager_employee_id, is_governance) VALUES
    ('rates', 'system', 'Rates', 'rates-head', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO analysis.employees
    (id, display_name, role_id, department_id, reports_to, seniority) VALUES
    ('rates-head', 'Head of Rates', 'head-of-rates', 'rates', 'research-director', 'head')
ON CONFLICT (id) DO NOTHING;

-- The routing handle moves EXCLUSIVELY. Held jointly, a case tagged `rates` would
-- reach two desks with no rule saying which owns the work, and "who is responsible
-- for the rates read" would stop having an answer.
--
-- Global Macro keeps its `macro` handle and loses only the specialist one.
DELETE FROM analysis.department_handles
 WHERE department_id = 'global-macro' AND discipline = 'rates';

INSERT INTO analysis.department_handles (department_id, discipline) VALUES
    ('rates', 'rates')
ON CONFLICT (department_id, discipline) DO NOTHING;

-- ------------------------------------------------- the organisation changed --

/*
 * A new ORGANISATION SEED VERSION, because the firm is not the firm it was.
 *
 * `organization_seed_versions` is a versioned historical record, not a running
 * total: `organizationReader` reads the highest version and caches the
 * organisation on its checksum, and every actor snapshot stamps the version it
 * acted under. Seating a department without appending a version would have
 * three consequences, all silent:
 *
 *   1. The cache would never invalidate. Its contract is "a changed checksum
 *      means a migration changed the firm"; this migration changes the firm, so
 *      a live process would go on serving an organisation with no Rates desk.
 *   2. Acts before and after this migration would stamp the same version, and
 *      two materially different firms would be indistinguishable in the record.
 *   3. Version 1's checksum would describe an organisation that no longer
 *      exists, which is precisely the drift it was written to detect.
 *
 * ## What each version MEANS
 *
 *   v1  Global Macro owns the `rates` handle. There is no Rates department, and
 *       therefore no desk that could examine a macro rates conclusion as a peer.
 *   v2  Rates exists as a first-class analytical department and owns the
 *       `rates` handle exclusively.
 *
 * Version 1 is left exactly as it was. A historical actor snapshot resolves to
 * the firm that actually authorised it, and must never be reinterpreted as
 * though Rates had always existed.
 *
 * ## A limit of this checksum, recorded rather than assumed away
 *
 * The payload covers departments, employees and roles. It does NOT cover
 * `department_handles`, so the handle moving from `global-macro` to `rates` —
 * half of what version 2 means — is invisible to it. The version bump is
 * therefore carried by the new department, role and employee rows. Widening the
 * payload would change how every version is computed and is a separate change.
 *
 * SHA-256, matching migration 0011 and the migration runner.
 */
INSERT INTO analysis.organization_seed_versions (version, checksum)
SELECT
    '2',
    encode(
        sha256(
            (
                (SELECT coalesce(string_agg(id || '|' || name || '|' || is_governance::text, ',' ORDER BY id), '')
                 FROM analysis.departments)
                || '#' ||
                (SELECT coalesce(string_agg(id || '|' || role_id || '|' || department_id || '|' ||
                                            coalesce(reports_to, ''), ',' ORDER BY id), '')
                 FROM analysis.employees)
                || '#' ||
                (SELECT coalesce(string_agg(id || '|' || function || '|' || can_block_publication::text, ',' ORDER BY id), '')
                 FROM analysis.roles)
            )::bytea
        ),
        'hex')
ON CONFLICT (version) DO NOTHING;

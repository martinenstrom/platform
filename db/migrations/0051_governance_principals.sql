-- The control functions get principals of their own.
--
-- P5C made governance an instance of the firm's candidate/adoption doctrine:
-- a control function's model produces a candidate, and the institutional act
-- is FILING it under the function's own mandate. P5C seated the principals
-- in the test organisation only. The ruling of 2026-09-17 (third) made
-- internal governance an autonomous responsibility within its mandate — an
-- internal governance act is not a human decision — and asked for the
-- minimum principals the macro-regime workflow needs, on the roles the firm
-- already has.
--
-- Three rows, no new role, no new mandate. Each principal holds a role whose
-- function is `governance` in a department that is a control function and
-- handles the discipline; that is exactly what the `governance-verdict`
-- mandate reads, so authorisation is unchanged — a Research Office principal
-- still cannot file a verdict, and nothing here lets one. The Rates desk's
-- peer examination is performed by `rates-agent` (0040) under
-- `department-contribution`; the Research Office submits for verification as
-- `research-office-agent` (0046) under `department-manager`.
--
-- Deliberately NOT a new organisation seed version, for the reason 0046 gave:
-- the organisation's people, departments and roles are unchanged; a principal
-- is a specialist that may perform its own desk's acts.
--
-- The CIO is not seated. `chief-decision` requires the chief's employee id,
-- which no agent has; that gate stays human by construction.

INSERT INTO analysis.agent_principals (id, department_id, role_id, display_name)
VALUES
    ('verification-agent',    'verification',    'head-of-verification',    'Verification'),
    ('devils-advocate-agent', 'devils-advocate', 'head-of-devils-advocate', 'Devil''s Advocate'),
    ('risk-agent',            'risk',            'chief-risk-officer',      'Risk')
ON CONFLICT (id) DO NOTHING;

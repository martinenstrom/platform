-- 0052 · a case movement may be an institutional principal's act
--
-- Migration 0012 (H3) required every case movement to name an employee: a
-- department acts through a person. Migration 0042 gave transition events an
-- `actor_agent_principal_id` for the acts an autonomous desk performs, but
-- left H3's check as written, so a case could still only be MOVED by a person.
--
-- G1 (ruled 2026-09-17) seats the Research Office's own principal to submit
-- its aggregated revision for verification — the act that moves a case from
-- research through aggregation into review. The rule stays what it was: work
-- does not move by itself. Who may move it widens to the department's own
-- principal, which 0042 already made mutually exclusive with an employee.
--
-- Read half: `toInvestmentCase` and the in-memory projection accept either
-- actor and refuse neither. Write half: this check.

ALTER TABLE analysis.transition_events
    DROP CONSTRAINT transition_events_case_movement_has_actor;

ALTER TABLE analysis.transition_events
    ADD CONSTRAINT transition_events_case_movement_has_actor CHECK (
        subject <> 'case'
        OR from_state IS NULL
        OR (
            (actor_employee_id IS NOT NULL OR actor_agent_principal_id IS NOT NULL)
            AND actor_department_id IS NOT NULL
        )
    );

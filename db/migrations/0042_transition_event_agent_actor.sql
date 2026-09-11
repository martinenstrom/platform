-- Truthful actor provenance on an event an institutional agent performed.
--
-- Without this, a run event performed by `global-macro-agent` would be written
-- with no actor at all, because the only actor column names an employee and
-- there is no honest employee to name. A blank actor on a real institutional
-- act is a falsification by omission: the record would say nobody did it.
--
-- ## At most one principal, never exactly one
--
-- The transition-event domain deliberately permits events with no accountable
-- person. `buildTransitionEvent` requires an actor only for CASE MOVEMENTS —
-- "a department acts through a person, and work does not move by itself" — and
-- exempts creation events and run events, because "a creation is not a
-- movement, and a run is its own actor."
--
-- Every one of the 289 events this database currently holds happens to carry an
-- actor. That is an observation about the work done so far, not a rule, and
-- promoting it to `= 1` would invent an invariant the domain does not have. The
-- constraint therefore forbids DOUBLE attribution and nothing more.
--
-- ## No backfill, no rehash
--
-- Historical rows keep their employee and gain a null agent, satisfying the
-- constraint unchanged. Event identity is derived from
-- `{commandId, recordType, entityId, ordinal}` and does not include the actor,
-- so no stored event id moves.
--
-- ## What this does NOT enable
--
-- Institutional agents still cannot perform CASE MOVEMENTS. That path is
-- employee-shaped in three further places left untouched here: migration 0012's
-- write invariant, the read invariant in `mapping.ts`, and
-- `CaseTransition.byEmployeeId` with everything projecting from it. The
-- autonomous contribution chain writes run events and needs none of them.
-- Deferred deliberately, and recorded as its own capability boundary.

ALTER TABLE analysis.transition_events
    ADD COLUMN actor_agent_principal_id text
        REFERENCES analysis.agent_principals (id);

ALTER TABLE analysis.transition_events
    ADD CONSTRAINT transition_events_at_most_one_actor
    CHECK (num_nonnulls(actor_employee_id, actor_agent_principal_id) <= 1);

COMMENT ON COLUMN analysis.transition_events.actor_agent_principal_id IS
    'The institutional agent that performed the act, where one did. Mutually '
    'exclusive with actor_employee_id. Null on employee acts and on the event '
    'classes the domain permits to carry no actor.';

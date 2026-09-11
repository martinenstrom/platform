-- Grants for `analysis.agent_principals`.
--
-- Migration 0040 created the table and omitted them, so the application login
-- could not read the principals it is meant to act as. Corrected forward in its
-- own migration rather than by editing 0040: an applied migration is history,
-- and rewriting one would mean two databases could disagree about what 0040
-- did while both reporting it applied.
--
-- The organisation is reference data the runtime reads and never writes, so the
-- grants match `analysis.employees`, `analysis.departments` and
-- `analysis.roles`: SELECT to the application and to the read-only role, and
-- nothing more. A principal is created by migration, exactly as an employee is
-- — the firm's own roster is not something application code edits at runtime.

GRANT SELECT ON analysis.agent_principals TO finos_app;
GRANT SELECT ON analysis.agent_principals TO finos_readonly;

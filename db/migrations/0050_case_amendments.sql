-- What the person added to a case after it was opened.
--
-- "Ta hänsyn till dollarn också." A case's question is the one column
-- `finos_app` may never update — 0009 withheld the grant on purpose, because
-- the question is what the case IS. So an addition cannot be an edit of the
-- question; it is its own record, appended beside it, with the person who
-- added it, the moment, and the version of the case at that moment — so a
-- reader can tell which work was done before the addition and which after.
--
-- Append-only, like the events: `finos_app` may SELECT and INSERT, never
-- UPDATE or DELETE. An addition is never reworded and never removed; if the
-- person changes their mind, that is another addition.
--
-- It changes no stage. Whether the firm's desks must look again because of
-- it is a later act, recorded on its own; this table records that the person
-- said it, and nothing more.

CREATE TABLE analysis.case_amendments (
    id                text        PRIMARY KEY,
    tenant_id         text        NOT NULL,
    case_id           text        NOT NULL REFERENCES analysis.cases (id),
    text              text        NOT NULL,
    by_employee_id    text        NOT NULL,
    by_department_id  text        NOT NULL,
    case_version      integer     NOT NULL,
    recorded_at       timestamptz NOT NULL,

    CONSTRAINT case_amendments_text_present CHECK (btrim(text) <> ''),
    CONSTRAINT case_amendments_version_positive CHECK (case_version >= 1)
);

CREATE INDEX case_amendments_case_idx
    ON analysis.case_amendments (case_id, recorded_at, id);

GRANT SELECT, INSERT ON analysis.case_amendments TO finos_app;
GRANT SELECT ON analysis.case_amendments TO finos_readonly;

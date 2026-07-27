-- Case playbooks: the standard workflow for a kind of case, as data.
--
-- A case pins the playbook version that created its workflow. Editing a
-- playbook must not reach back and change cases already in flight — a case
-- opened under v1 keeps the assignments v1 gave it, even after v2 exists.
--
-- That is why `playbook_versions` is keyed on (id, version) and never updated:
-- the pinned row a case points at cannot be edited out from under it.

CREATE TABLE analysis.playbooks (
    id        text PRIMARY KEY,
    -- Matches `CaseSubject.kind`. Which kind of case this applies to.
    case_kind text NOT NULL,
    name      text NOT NULL
);

CREATE TABLE analysis.playbook_versions (
    playbook_id text        NOT NULL REFERENCES analysis.playbooks (id),
    version     text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (playbook_id, version)
);

CREATE TABLE analysis.playbook_entries (
    playbook_id    text    NOT NULL,
    version        text    NOT NULL,
    -- Stable within the playbook, and part of the assignment's natural key.
    entry_key      text    NOT NULL,
    department_id  text    NOT NULL REFERENCES analysis.departments (id),
    brief          text    NOT NULL,
    -- A required entry blocks downstream work and the decision when it fails.
    -- An optional one degrades coverage — visibly, in the decision record.
    required       boolean NOT NULL,
    priority       integer NOT NULL,
    -- Checked against the department's `handles`. Omitted where the assignment
    -- is plainly within the department's remit and the check would be ceremony.
    discipline_tag text,

    PRIMARY KEY (playbook_id, version, entry_key),
    FOREIGN KEY (playbook_id, version)
        REFERENCES analysis.playbook_versions (playbook_id, version)
);

-- Entry dependencies, as edges rather than an array, so a dependency on an
-- entry that does not exist is a foreign-key error rather than a case that
-- deadlocks silently hours later.
CREATE TABLE analysis.playbook_entry_dependencies (
    playbook_id  text NOT NULL,
    version      text NOT NULL,
    entry_key    text NOT NULL,
    depends_on   text NOT NULL,

    PRIMARY KEY (playbook_id, version, entry_key, depends_on),
    FOREIGN KEY (playbook_id, version, entry_key)
        REFERENCES analysis.playbook_entries (playbook_id, version, entry_key),
    FOREIGN KEY (playbook_id, version, depends_on)
        REFERENCES analysis.playbook_entries (playbook_id, version, entry_key),
    CONSTRAINT playbook_entry_no_self_dependency CHECK (entry_key <> depends_on)
);

CREATE INDEX playbook_entries_department_idx
    ON analysis.playbook_entries (department_id);

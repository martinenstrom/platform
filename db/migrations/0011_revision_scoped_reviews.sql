-- Governance reviews attach to an exact revision, or to the case. Nothing else.
--
-- ## The defect being closed
--
-- 0006 let a review name a thesis LINEAGE with no revision. So revision 1
-- could be verified, revision 2 could supersede it, and "verification approved
-- thesis-1" would read as approval of an argument the verifier never saw. The
-- schema guarantees a sealed revision cannot be edited, and that guarantee
-- buys nothing if the review does not say which revision it read.
--
-- ## Scope as a discriminator, not an optional column
--
-- `scope` is `'case'` or `'thesis-revision'`, and the CHECK constraints make
-- the two shapes exclusive: a case-wide review carries no thesis and no
-- revision, and a thesis-revision review carries both. A nullable
-- `revision_id` alone would have made the wrong state rarer without making it
-- impossible, and "rarer" is not a property an audit trail can rely on.
--
-- ## Ownership by composite key
--
-- A single composite foreign key to `(revision_id, thesis_id, case_id)`
-- enforces both ownership rules at once — the revision belongs to the thesis,
-- and the lineage belongs to the case. Two separate FKs could each be
-- satisfied by rows that disagree with each other.
--
-- Forward migration. 0006 is applied and is never edited.

-- ------------------------------------------------------- refuse to guess --

-- Rows carrying a thesis but no revision are exactly the ambiguity this
-- migration removes, and there is no correct value to backfill: only the
-- reviewer knows which revision they read.
--
-- No adapter has ever written to this table, so this cannot fire today. It is
-- here so that if it ever could, the migration stops rather than inventing an
-- attachment that would look like due process.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM analysis.reviews
        WHERE thesis_id IS NOT NULL AND revision_id IS NULL
    ) THEN
        RAISE EXCEPTION
            'Some reviews name a thesis lineage with no revision. Which revision '
            'each one reviewed cannot be derived — only the reviewer knows. '
            'Resolve them explicitly before applying this migration.'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
END;
$$;

-- ------------------------------------------------------------- the column --

ALTER TABLE analysis.reviews ADD COLUMN scope text;

-- Everything that survives the check above is case-wide by definition.
UPDATE analysis.reviews SET scope = 'case' WHERE scope IS NULL;

ALTER TABLE analysis.reviews ALTER COLUMN scope SET NOT NULL;

ALTER TABLE analysis.reviews
    ADD CONSTRAINT reviews_scope_known
        CHECK (scope IN ('case', 'thesis-revision')),

    -- The two shapes, stated as equivalences so neither can drift into the
    -- other: a case-wide review has neither, a revision review has both.
    ADD CONSTRAINT reviews_case_scope_is_bare
        CHECK ((scope = 'case') = (thesis_id IS NULL AND revision_id IS NULL)),
    ADD CONSTRAINT reviews_revision_scope_is_complete
        CHECK ((scope = 'thesis-revision') = (revision_id IS NOT NULL));

-- 0006's weaker rule is now implied by the pair above.
ALTER TABLE analysis.reviews DROP CONSTRAINT reviews_revision_implies_thesis;

-- ----------------------------------------------------------- ownership --

-- The FK target. `revision_id` is already the primary key, so this unique
-- constraint adds no restriction — it exists to make the triple referenceable.
ALTER TABLE analysis.thesis_revisions
    ADD CONSTRAINT thesis_revisions_identity_unique
    UNIQUE (revision_id, thesis_id, case_id);

-- One key, both ownership rules: the revision belongs to the thesis, and the
-- thesis belongs to the case the review is filed against.
ALTER TABLE analysis.reviews
    ADD CONSTRAINT reviews_revision_ownership_fk
    FOREIGN KEY (revision_id, thesis_id, case_id)
    REFERENCES analysis.thesis_revisions (revision_id, thesis_id, case_id);

-- 0006's plain revision FK is now subsumed by the composite one, which is
-- strictly stronger.
ALTER TABLE analysis.reviews DROP CONSTRAINT reviews_revision_id_fkey;

-- --------------------------------------------------- scope is permanent --

-- A review that could be retargeted is a review that can be made to say it
-- examined something it never saw. The runtime holds no UPDATE grant on this
-- table at all, so for the application this is already impossible; the trigger
-- covers migrations, operator sessions, and any future role that acquires one.
--
-- The verdict fields are deliberately NOT frozen here. Nothing may update them
-- today either, but if a correction mechanism is ever added it will be about
-- the verdict — never about what was reviewed.
CREATE FUNCTION analysis.assert_review_scope_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF ROW(NEW.scope, NEW.case_id, NEW.thesis_id, NEW.revision_id, NEW.kind)
       IS DISTINCT FROM
       ROW(OLD.scope, OLD.case_id, OLD.thesis_id, OLD.revision_id, OLD.kind)
    THEN
        RAISE EXCEPTION
            'Review "%" cannot be reattached. It was recorded against %, and a '
            'review that can be retargeted is not evidence that anything was '
            'reviewed.',
            OLD.id, COALESCE(OLD.revision_id, OLD.case_id || ' (case-wide)')
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER reviews_scope_immutable
    BEFORE UPDATE ON analysis.reviews
    FOR EACH ROW EXECUTE FUNCTION analysis.assert_review_scope_immutable();

-- ------------------------------------------------------- idempotency key --

-- The natural key must include the exact scope, or a retried submission
-- against revision 2 could collide with the verdict already recorded for
-- revision 1 and be silently treated as a duplicate.
--
-- Mirrors `reviewIdentity` in the domain, which is what the in-memory adapter
-- dedupes on, so the two stores agree exactly rather than approximately.
DROP INDEX analysis.reviews_natural_key_unique;

CREATE UNIQUE INDEX reviews_natural_key_unique
    ON analysis.reviews (
        kind, case_id, thesis_id, revision_id, by_department_id, by_employee_id, at
    )
    NULLS NOT DISTINCT;

-- ---------------------------------------------------------------- reading --

-- `reviews.*ForCase()` returns at, then by_employee_id, then revision_id. The
-- revision is part of the tie-break because one reviewer can record verdicts
-- on two competing revisions at the same instant.
DROP INDEX analysis.reviews_case_idx;

CREATE INDEX reviews_case_idx
    ON analysis.reviews (case_id, kind, at, by_employee_id, revision_id);

-- "What has governance said about this exact argument" — read on every gate
-- evaluation once a case holds competing revisions.
CREATE INDEX reviews_revision_scope_idx
    ON analysis.reviews (revision_id, kind, at)
    WHERE scope = 'thesis-revision';

-- ---------------------------------------------------------------- grants --

-- The column was added after 0009 ran, and a column-level grant covers only
-- the columns named at the time. `reviews` is insert-and-select for the
-- runtime, so this is INSERT only — there is deliberately no UPDATE.
GRANT SELECT, INSERT ON analysis.reviews TO finos_app;
GRANT SELECT ON analysis.reviews TO finos_readonly;

-- ------------------------------------------------- seed checksum algorithm --

-- The organization seed's drift checksum moves from MD5 to SHA-256, matching
-- the migration runner. The seeded organization has not changed; only the hash
-- function has, so the version stays '1' and the row is recomputed in place.
--
-- This is a drift detector rather than a security control either way, but two
-- integrity mechanisms in one system should not use two different hashes —
-- the difference invites the question of which one is authoritative.
UPDATE analysis.organization_seed_versions
SET checksum = encode(
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
WHERE version = '1';

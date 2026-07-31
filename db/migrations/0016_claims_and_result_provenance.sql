-- Phase C1C-2: the claim vocabulary the domain actually has, and a stored
-- result that says what produced it.
--
-- `RecordContribution` is the first code that writes a claim. Until now the
-- claim table's CHECK constraints were written from an earlier draft of the
-- domain and nothing had exercised the difference: `trend` and `risk` are
-- claim types the domain has had since Phase A and the database would refuse,
-- and `partially-supported` is a status it produces and the database would
-- refuse. In the other direction the database allowed `refuted` and
-- `withdrawn`, which the domain cannot express — a status no code can write is
-- a promise to a reader that something else might.
--
-- Both tables are empty in every environment. Nothing could write a claim
-- before this phase, and nothing wrote a result outside a test database that
-- is created from these migrations, so the constraints below are honest rather
-- than back-filled. The guards verify that rather than assuming it.

DO $$
DECLARE claim_count bigint; result_count bigint;
BEGIN
    SELECT count(*) INTO claim_count FROM analysis.claims;
    SELECT count(*) INTO result_count FROM analysis.agent_results;
    IF claim_count > 0 OR result_count > 0 THEN
        RAISE EXCEPTION
            'analysis.claims holds % rows and analysis.agent_results holds %. '
            '0016 assumes none: a stored claim written under the old '
            'vocabulary would have to be reclassified, and reclassifying an '
            'assertion the firm has already made is not a migration.',
            claim_count, result_count;
    END IF;
END $$;

-- ------------------------------------------------------ the claim vocabulary

ALTER TABLE analysis.claims
    DROP CONSTRAINT claims_type_known,
    DROP CONSTRAINT claims_status_known,

    /*
     * The eight the domain defines. `trend` and `risk` were missing, which
     * would have refused a macro desk's most ordinary output.
     */
    ADD CONSTRAINT claims_type_known CHECK (
        type IN ('observation', 'comparison', 'trend', 'risk', 'forecast',
                 'causal', 'recommendation', 'counterclaim')
    ),

    /*
     * The four the domain defines.
     *
     * `partially-supported` is the one that matters: evidence that supports
     * part of an assertion is the common case, and without it a desk had to
     * round to `supported` or to `insufficient-evidence` — one overstates and
     * the other discards work. `refuted` and `withdrawn` go, because a claim is
     * write-once: contradiction is recorded by a counterclaim and by
     * `contradicting evidence`, not by editing the original into submission.
     */
    ADD CONSTRAINT claims_status_known CHECK (
        status IN ('supported', 'partially-supported', 'contested',
                   'insufficient-evidence')
    );

-- --------------------------------------------- what produced a stored result

/*
 * 0015 added these to `agent_results` as nullable, because they were being
 * added to an existing table with no writer. `RecordContribution` is that
 * writer, so they become required now.
 *
 * A stored result is REUSED analysis: the whole point of the key is that a
 * matching one is served instead of running the work again. If a result cannot
 * say whether a fixture replay or a live provider produced it, reuse launders
 * the distinction that `runs.provider_kind` exists to preserve.
 */
ALTER TABLE analysis.agent_results
    ALTER COLUMN provider_kind SET NOT NULL,
    ALTER COLUMN provenance_id SET NOT NULL;

-- (The execution identity a run presents is 0017's subject.)

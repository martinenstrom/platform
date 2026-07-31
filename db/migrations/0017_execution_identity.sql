-- Phase C1C-2: what ran, and what it cost, in shapes that cannot lie.
--
-- Two fields on `runs` were nullable-or-placeholder where they should have been
-- a closed set of shapes, and both defaulted to the reading that flatters the
-- record.
--
-- `prompt_*` and `model_*` were NOT NULL, from a design in which every run came
-- from a model. A deterministic stub has neither, so it filled them in — and a
-- placeholder in a column named `model_provider` IS a real model identity to
-- every reader downstream, however honest the intent was. TD-32.
--
-- `input_tokens`, `cost_minor_units` and their neighbours were nullable, and
-- null had to mean three different things: nothing to measure, nothing
-- reported, or nobody looked. The ambiguity falls on the expensive side —
-- null reads as free. TD-33.
--
-- `runs` is empty in every environment: 0015 established that and nothing has
-- started one since, because the command that could was written in this stage.
-- The NOT NULL columns below are therefore honest rather than back-filled, and
-- the guard verifies it rather than assuming it.

DO $$
DECLARE existing bigint;
BEGIN
    SELECT count(*) INTO existing FROM analysis.runs;
    IF existing > 0 THEN
        RAISE EXCEPTION
            'analysis.runs holds % rows. 0017 assumes none: deciding after the '
            'fact whether an existing row''s model reference was real or a '
            'placeholder is exactly the question this migration exists to stop '
            'anyone having to ask.',
            existing;
    END IF;
END $$;

-- --------------------------------------------------------- execution identity

/*
 * Three shapes, and the provider kind decides which are legal:
 *
 *   model         a model produced this, and here is exactly which
 *   unavailable   a replay whose artifact did not capture what produced it
 *   scenario      synthetic output: a stub scenario and the stub's build
 *
 * `recorded` may present either of the first two, because a recording either
 * captured the model that produced it or did not — and where it did, that
 * model is the true one and must be preserved. A stub may present only the
 * third: it has no model, and after this migration there is nowhere to put one.
 */
ALTER TABLE analysis.runs
    ADD COLUMN identity_kind text NOT NULL,

    -- Only a scenario has these.
    ADD COLUMN scenario_id  text,
    ADD COLUMN stub_version text,

    -- Only an unavailable identity has these. The reason is closed: "we do not
    -- know" is a fact with exactly one cause here, and a free-text field would
    -- collect provider prose.
    ADD COLUMN identity_unavailable_reason text,
    ADD COLUMN recording_id text,

    ADD CONSTRAINT runs_identity_kind_known CHECK (
        identity_kind IN ('model', 'unavailable', 'scenario')
    ),

    /*
     * One implication per kind rather than a disjunction over all three.
     * A disjunction would also be violated by an UNKNOWN provider kind, so an
     * unrecognised value would trip two constraints and the error a caller
     * sees would depend on the order PostgreSQL happened to evaluate them in.
     * Each rule polices its own kind; `runs_provider_kind_known` polices the
     * vocabulary, and it stays the only constraint that does.
     */
    ADD CONSTRAINT runs_identity_matches_provider CHECK (
        (provider_kind <> 'live'     OR identity_kind = 'model')
        AND (provider_kind <> 'recorded' OR identity_kind IN ('model', 'unavailable'))
        AND (provider_kind <> 'stub'     OR identity_kind = 'scenario')
    ),

    -- A model identity is all of its parts, and nothing else may carry them.
    ADD CONSTRAINT runs_model_identity_complete CHECK (
        (identity_kind = 'model') = (
            prompt_id IS NOT NULL AND prompt_version IS NOT NULL
            AND prompt_content_hash IS NOT NULL AND model_id IS NOT NULL
            AND model_provider IS NOT NULL AND model_parameters_hash IS NOT NULL
        )
    ),

    ADD CONSTRAINT runs_scenario_identity_complete CHECK (
        (identity_kind = 'scenario') = (
            scenario_id IS NOT NULL AND stub_version IS NOT NULL
        )
    ),

    ADD CONSTRAINT runs_unavailable_identity_complete CHECK (
        (identity_kind = 'unavailable')
        = (identity_unavailable_reason IS NOT NULL)
    ),

    ADD CONSTRAINT runs_unavailable_reason_known CHECK (
        identity_unavailable_reason IS NULL
        OR identity_unavailable_reason = 'not-captured-by-recording'
    );

-- The columns that used to be mandatory for everyone.
ALTER TABLE analysis.runs
    ALTER COLUMN prompt_id             DROP NOT NULL,
    ALTER COLUMN prompt_version        DROP NOT NULL,
    ALTER COLUMN prompt_content_hash   DROP NOT NULL,
    ALTER COLUMN model_id              DROP NOT NULL,
    ALTER COLUMN model_provider        DROP NOT NULL,
    ALTER COLUMN model_parameters_hash DROP NOT NULL,
    ALTER COLUMN model_parameters      DROP NOT NULL,
    ALTER COLUMN model_parameters      DROP DEFAULT;

-- ------------------------------------------------------------------- usage --

/*
 * Three states rather than a nullable number:
 *
 *   not-applicable  there was nothing to spend — a replay, a stub
 *   not-reported    real work whose provider did not say what it cost
 *   measured        a measurement, and zero is a measurement
 *
 * The last line is the one that needs enforcing. Once the state carries the
 * meaning, `cost_minor_units = 0` is a provider reporting a free call, which
 * is a different fact from a provider that said nothing — and budget
 * enforcement in C2 has to treat them differently or it will authorize spend
 * against unknowns.
 */
ALTER TABLE analysis.runs
    ADD COLUMN usage_state text NOT NULL DEFAULT 'not-applicable',

    ADD CONSTRAINT runs_usage_state_known CHECK (
        usage_state IN ('not-applicable', 'not-reported', 'measured')
    ),

    -- A measurement is all of its parts or none of them, in both directions:
    -- values without the state would be invisible, and the state without
    -- values would be a measurement nobody took.
    ADD CONSTRAINT runs_usage_measurement_complete CHECK (
        (usage_state = 'measured') = (
            input_tokens IS NOT NULL AND output_tokens IS NOT NULL
            AND cost_minor_units IS NOT NULL AND currency IS NOT NULL
        )
    ),

    /*
     * A replay and a stub consume nothing NOW. A recorded artifact that
     * captured what the original cost may keep that measurement; a stub may
     * not, because there was never anything to measure. A live call always
     * consumed something, so `not-applicable` would be a claim that it was
     * free.
     */
    ADD CONSTRAINT runs_usage_matches_provider CHECK (
        (provider_kind <> 'live'
         OR usage_state IN ('measured', 'not-reported'))
        AND (provider_kind <> 'recorded'
             OR usage_state IN ('not-applicable', 'measured'))
        AND (provider_kind <> 'stub' OR usage_state = 'not-applicable')
    );

ALTER TABLE analysis.runs ALTER COLUMN usage_state DROP DEFAULT;

-- The old all-or-nothing cost rule is subsumed by the measurement constraint,
-- which says the same thing about four columns instead of two.
ALTER TABLE analysis.runs DROP CONSTRAINT runs_cost_complete;

-- ---------------------------------------------------------------- grants --

-- The runtime records what a run consumed when it completes. It may not
-- rewrite what produced the work: no grant on identity or provider columns.
GRANT UPDATE (usage_state) ON analysis.runs TO finos_app;

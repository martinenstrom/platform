-- Token measurement and monetary cost are separate facts.
--
-- ============================================== what the live path proved ==
--
-- `usage_state = 'measured'` required all four numbers together —
-- `input_tokens`, `output_tokens`, `cost_minor_units`, `currency` — enforced by
-- `runs_usage_measurement_complete` in 0017.
--
-- The Anthropic Messages API reports `input_tokens` and `output_tokens` and no
-- price at all. So the one combination a live run actually produces —
-- **tokens measured, monetary cost unknown** — was the one combination the
-- schema could not express.
--
-- Both available workarounds were falsehoods:
--
--   cost_minor_units = 0    states the provider reported a FREE call, which is
--                           a measurement, and 0017 says so in those words
--   usage_state =           throws away token counts the provider did report,
--     'not-reported'        and makes a token budget unenforceable, because
--                           `budgetOverruns` reads measured usage only
--
-- This is an earned correction: the type assumed the two measurements arrive
-- together, and the first real provider disproved it.
--
-- ================================================== zero is still not unknown ==
--
-- The distinction 0017 exists to protect is untouched. `usage_cost_state =
-- 'measured'` with `cost_minor_units = 0` is a provider reporting a free call.
-- `usage_cost_state = 'not-reported'` is a provider saying nothing. They stay
-- different rows, and monetary budget enforcement treats them differently.

ALTER TABLE analysis.runs
    -- NULL exactly when there are no tokens to have priced. Not a third
    -- meaning: it is the absence of the question, and the CHECK below ties it
    -- to `usage_state` so it can never drift into one.
    ADD COLUMN usage_cost_state text,

    ADD CONSTRAINT runs_usage_cost_state_known CHECK (
        usage_cost_state IS NULL
     OR usage_cost_state IN ('measured', 'not-reported')
    ),

    -- Money is asked about exactly when tokens were counted.
    ADD CONSTRAINT runs_usage_cost_state_present CHECK (
        (usage_state = 'measured') = (usage_cost_state IS NOT NULL)
    ),

    -- An amount and its currency arrive together or not at all. Unchanged in
    -- spirit from 0017; it now hangs off the cost state rather than the usage
    -- state, which is the whole correction.
    -- `IS NOT DISTINCT FROM` rather than `=`, and the difference is load
    -- bearing. Under `=`, a NULL cost state makes the left side NULL, a CHECK
    -- comparing NULL yields NULL, and NULL passes — so a row carrying an
    -- amount with no state that gives it meaning would have been accepted by
    -- the very constraint written to refuse it.
    ADD CONSTRAINT runs_usage_cost_complete CHECK (
        (usage_cost_state IS NOT DISTINCT FROM 'measured')
        = (cost_minor_units IS NOT NULL AND currency IS NOT NULL)
    );

-- ------------------------------------------------------------- backfill --
--
-- Unambiguous by construction. `runs_usage_measurement_complete` guaranteed
-- that every existing `measured` row already carries a cost and a currency, so
-- each one maps to `usage_cost_state = 'measured'` and nothing has to be
-- guessed. No historical row becomes `not-reported`, because no historical row
-- was ever stored without a price.
UPDATE analysis.runs SET usage_cost_state = 'measured' WHERE usage_state = 'measured';

-- The old rule bundled tokens and money into one condition. It is replaced by
-- the pair above: tokens tied to `usage_state`, money tied to
-- `usage_cost_state`.
ALTER TABLE analysis.runs DROP CONSTRAINT runs_usage_measurement_complete;

ALTER TABLE analysis.runs
    ADD CONSTRAINT runs_usage_tokens_complete CHECK (
        (usage_state = 'measured')
        = (input_tokens IS NOT NULL AND output_tokens IS NOT NULL)
    );

-- ---------------------------------------------------------------- grants --
--
-- The runtime records what a run consumed when it completes, so this column
-- joins the updatable set beside `usage_state` from 0017.
GRANT UPDATE (usage_cost_state) ON analysis.runs TO finos_app;

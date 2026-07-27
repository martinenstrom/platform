-- The firm, as data.
--
-- ## Insert-only, deliberately
--
-- Every statement here is `ON CONFLICT DO NOTHING`. The seed can be re-applied
-- any number of times and will never change a row that already exists.
--
-- That is what keeps a later seed from silently rewriting history. Assignments,
-- reviews and decisions name the department and employee involved; if editing
-- this file could update those rows, the record of what the firm did would
-- change retroactively, and nothing would say so. Changing an existing
-- department is therefore a NEW migration that states exactly what it changes,
-- is checksummed, and appears in the migration history.
--
-- ## Roles are per department head, not generic
--
-- "Head of Macro" and "Head of Compliance" are different roles with different
-- responsibilities and different authority. A shared `department-head` role
-- would have nowhere to record that technical analysis is interpretive and
-- verification is not.
--
-- ## Governance reports to the CIO directly
--
-- Verification, Devil's Advocate, Compliance and Risk report to the chief, not
-- to the managers whose work they review. A control function inside the
-- reporting line of what it reviews is not independent, and independence is
-- the entire reason those four departments exist.

-- ----------------------------------------------------------------- tenant --

-- The system tenant. Every institutional record has an explicit tenant from
-- the first row written, so authentication later adds policies rather than a
-- migration of every populated table.
INSERT INTO analysis.tenants (id, name) VALUES
    ('system', 'System')
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------ roles --

INSERT INTO analysis.roles (id, title, function, can_block_publication) VALUES
    ('chief-investment-officer',    'Chief Investment Officer',           'executive',  false),
    ('research-director',           'Research Director',                  'manager',    false),
    ('head-of-macro',               'Head of Macro',                      'manager',    false),
    ('head-of-equity-research',     'Head of Equity Research',            'manager',    false),
    ('head-of-quant-technical',     'Head of Quant & Technical Analysis', 'manager',    false),
    ('market-intelligence-manager', 'Market Intelligence Manager',        'manager',    false),
    ('head-of-news-intelligence',   'Head of News Intelligence',          'manager',    false),
    ('head-of-flow-positioning',    'Head of Flow & Positioning',         'manager',    false),
    ('head-of-behavioural-finance', 'Head of Behavioural Finance',        'manager',    false),
    ('portfolio-strategy-manager',  'Portfolio Strategy Manager',         'manager',    false),
    -- The four control functions. `governance` and `can_block_publication`
    -- move together: the schema refuses a governance role that cannot block,
    -- because one that cannot block is advisory.
    ('chief-risk-officer',          'Chief Risk Officer',                 'governance', true),
    ('head-of-devils-advocate',     'Head of Devil''s Advocate',          'governance', true),
    ('head-of-verification',        'Head of Verification',               'governance', true),
    ('head-of-compliance',          'Head of Compliance',                 'governance', true),
    ('editorial-director',          'Editorial Director',                 'editorial',  false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO analysis.responsibilities (id, role_id, summary, interpretive) VALUES
    ('cio-decides', 'chief-investment-officer',
     'Receives verified, challenged and aggregated work and records the decision. Performs no analysis.', false),
    ('research-director-reconciles', 'research-director',
     'Reconciles the research desks, prioritises, and proposes the thesis for review.', false),
    ('macro-regime', 'head-of-macro',
     'Reads the policy regime: official policy stance against what the market is pricing.', false),
    ('equity-fundamentals', 'head-of-equity-research',
     'Fundamentals, filings and valuation, and the thesis proposal that follows from them.', false),
    ('quant-statistics', 'head-of-quant-technical',
     'Statistical corroboration: breadth, volatility, correlation and significance.', false),
    -- The standing example. A reading is not a measurement, and the record has
    -- to say which one it is wherever the output appears.
    ('quant-technical-reading', 'head-of-quant-technical',
     'Technical and wave-based readings, which are interpretation rather than measurement.', true),
    ('mi-aggregates', 'market-intelligence-manager',
     'Aggregates the market intelligence desks into one regime view.', false),
    ('news-material-events', 'head-of-news-intelligence',
     'Material events from filings and official releases; separates signal from noise.', false),
    ('flow-crowding', 'head-of-flow-positioning',
     'Flow, positioning, liquidity and crowding as evidence of confirmation or fragility.', false),
    ('behavioural-sentiment', 'head-of-behavioural-finance',
     'Sentiment and positioning psychology, treated as evidence and never as a thesis.', true),
    ('portfolio-impact', 'portfolio-strategy-manager',
     'Portfolio impact, exposure, correlation and sizing implications of a thesis.', false),
    ('risk-downside', 'chief-risk-officer',
     'Downside, adverse scenarios, tail risk and the limits attached to acceptance.', false),
    ('advocate-contests', 'head-of-devils-advocate',
     'Contests theses and claims with counter-evidence, and may propose a competing thesis.', false),
    ('verification-checks', 'head-of-verification',
     'Verifies every material number, unit, citation and date against its evidence.', false),
    ('compliance-publishability', 'head-of-compliance',
     'Whether the material may be published, in this language, with these disclosures.', false),
    ('editorial-publishes', 'editorial-director',
     'Turns the recorded decision into published material. Adds no conclusions.', false)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------ departments --

-- The manager reference is deferred, so departments and their managers can be
-- inserted in either order within this transaction.
INSERT INTO analysis.departments (id, tenant_id, name, manager_employee_id, is_governance) VALUES
    ('executive',                  'system', 'Executive',                    'cio',                  false),
    ('research-office',            'system', 'Research Office',              'research-director',    false),
    ('global-macro',               'system', 'Global Macro',                 'macro-head',           false),
    ('equity-research',            'system', 'Equity Research',              'equity-head',          false),
    ('quant-technical',            'system', 'Quant & Technical Analysis',   'quant-head',           false),
    ('market-intelligence-office', 'system', 'Market Intelligence Office',   'mi-manager',           false),
    ('news-intelligence',          'system', 'News Intelligence',            'news-head',            false),
    ('flow-positioning',           'system', 'Flow & Positioning',           'flow-head',            false),
    ('behavioural-finance',        'system', 'Behavioural Finance',          'behavioural-head',     false),
    ('portfolio-strategy',         'system', 'Portfolio Strategy',           'portfolio-manager',    false),
    ('risk',                       'system', 'Risk',                         'chief-risk-officer',   true),
    ('devils-advocate',            'system', 'Devil''s Advocate',            'devils-advocate-head', true),
    ('verification',               'system', 'Verification',                 'verification-head',    true),
    ('compliance',                 'system', 'Compliance',                   'compliance-head',      true),
    ('editorial',                  'system', 'Editorial',                    'editorial-lead',       false)
ON CONFLICT (id) DO NOTHING;

-- Routing tags. A case reaches a department because a discipline matched, not
-- because a router enumerated the departments that exist.
INSERT INTO analysis.department_handles (department_id, discipline) VALUES
    ('research-office',            'aggregation'),
    ('global-macro',               'macro'),
    ('global-macro',               'rates'),
    ('global-macro',               'fx'),
    ('global-macro',               'policy'),
    ('equity-research',            'equity'),
    ('equity-research',            'valuation'),
    ('equity-research',            'fundamentals'),
    ('quant-technical',            'quant'),
    ('quant-technical',            'technical'),
    ('quant-technical',            'statistics'),
    ('market-intelligence-office', 'synthesis'),
    ('market-intelligence-office', 'regime'),
    ('news-intelligence',          'news'),
    ('news-intelligence',          'filings'),
    ('news-intelligence',          'events'),
    ('flow-positioning',           'flows'),
    ('flow-positioning',           'positioning'),
    ('flow-positioning',           'liquidity'),
    ('behavioural-finance',        'sentiment'),
    ('behavioural-finance',        'psychology'),
    ('portfolio-strategy',         'portfolio'),
    ('portfolio-strategy',         'allocation'),
    ('portfolio-strategy',         'sizing'),
    ('risk',                       'risk'),
    ('risk',                       'stress'),
    ('risk',                       'tail-risk'),
    ('devils-advocate',            'challenge'),
    ('verification',               'verification'),
    ('compliance',                 'compliance'),
    ('compliance',                 'disclosure'),
    ('editorial',                  'editorial'),
    ('editorial',                  'publication')
ON CONFLICT (department_id, discipline) DO NOTHING;

-- ------------------------------------------------------------- employees --

-- An AI agent is an employee, not a feature. `seniority` is here because the
-- behavioural specification calls for senior professionals rather than
-- assistants, and a future prompt builder needs to read that from somewhere
-- other than prose.
INSERT INTO analysis.employees
    (id, display_name, role_id, department_id, reports_to, seniority) VALUES
    ('cio', 'Chief Investment Officer', 'chief-investment-officer', 'executive', NULL, 'chief'),

    ('research-director', 'Research Director', 'research-director', 'research-office', 'cio', 'head'),
    ('macro-head', 'Head of Macro', 'head-of-macro', 'global-macro', 'research-director', 'head'),
    ('equity-head', 'Head of Equity Research', 'head-of-equity-research', 'equity-research', 'research-director', 'head'),
    ('quant-head', 'Head of Quant & Technical Analysis', 'head-of-quant-technical', 'quant-technical', 'research-director', 'head'),

    ('mi-manager', 'Market Intelligence Manager', 'market-intelligence-manager', 'market-intelligence-office', 'cio', 'head'),
    ('news-head', 'Head of News Intelligence', 'head-of-news-intelligence', 'news-intelligence', 'mi-manager', 'head'),
    ('flow-head', 'Head of Flow & Positioning', 'head-of-flow-positioning', 'flow-positioning', 'mi-manager', 'head'),
    ('behavioural-head', 'Head of Behavioural Finance', 'head-of-behavioural-finance', 'behavioural-finance', 'mi-manager', 'head'),

    ('portfolio-manager', 'Portfolio Strategy Manager', 'portfolio-strategy-manager', 'portfolio-strategy', 'cio', 'head'),

    -- The four controls report to the chief, not to what they review.
    ('chief-risk-officer', 'Chief Risk Officer', 'chief-risk-officer', 'risk', 'cio', 'chief'),
    ('devils-advocate-head', 'Head of Devil''s Advocate', 'head-of-devils-advocate', 'devils-advocate', 'cio', 'head'),
    ('verification-head', 'Head of Verification', 'head-of-verification', 'verification', 'cio', 'head'),
    ('compliance-head', 'Head of Compliance', 'head-of-compliance', 'compliance', 'cio', 'head'),

    ('editorial-lead', 'Editorial Director', 'editorial-director', 'editorial', 'cio', 'head')
ON CONFLICT (id) DO NOTHING;

-- --------------------------------------------------------- organization --

INSERT INTO analysis.organizations (id, tenant_id, name, chief_employee_id) VALUES
    ('financial-os', 'system', 'Financial OS Investment Organization', 'cio')
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------ seed version --

-- The checksum is over the organization AS IT NOW STANDS, not over this file.
-- The runner already detects an edited migration; this detects drift from any
-- source, including a manual change made directly against the database.
INSERT INTO analysis.organization_seed_versions (version, checksum)
SELECT
    '1',
    md5(
        (SELECT coalesce(string_agg(id || '|' || name || '|' || is_governance::text, ',' ORDER BY id), '')
         FROM analysis.departments)
        || '#' ||
        (SELECT coalesce(string_agg(id || '|' || role_id || '|' || department_id || '|' ||
                                    coalesce(reports_to, ''), ',' ORDER BY id), '')
         FROM analysis.employees)
        || '#' ||
        (SELECT coalesce(string_agg(id || '|' || function || '|' || can_block_publication::text, ',' ORDER BY id), '')
         FROM analysis.roles)
    )
ON CONFLICT (version) DO NOTHING;

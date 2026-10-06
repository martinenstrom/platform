/**
 * The relationship record's schema, version by version.
 *
 * Every migration is a frozen SQL string with its checksum recorded when it
 * is applied; a migration never changes after it ships — a new version is
 * appended. Structured facts are relational; only a frozen nested document
 * (a performance series point, a meeting baseline, a market event's
 * payload, a candidate's extracted items, an event's reminder rules) is
 * kept as JSON, because it is read and written whole and never queried
 * inside.
 *
 * Provenance is inline on every table that carries it: origin, the source
 * interaction, the source words, the source date, who created it, when,
 * the confidence and the confirmation.
 */

export interface SchemaMigration {
  version: number
  name: string
  sql: string
}

const PROVENANCE = `
  prov_origin TEXT NOT NULL,
  prov_source_interaction_id TEXT,
  prov_source_text TEXT,
  prov_source_date TEXT NOT NULL,
  prov_created_at TEXT NOT NULL,
  prov_created_by TEXT NOT NULL,
  prov_confidence TEXT NOT NULL,
  prov_confirmed INTEGER NOT NULL,
  prov_confirmed_at TEXT`

export const MIGRATIONS: readonly SchemaMigration[] = [
  {
    version: 1,
    name: 'relationship-record',
    sql: `
CREATE TABLE advisors (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL
);

CREATE TABLE offices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  display_name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  archived_at TEXT,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE households (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL
);

CREATE TABLE household_members (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  role TEXT NOT NULL,
  display_name TEXT NOT NULL,
  client_id TEXT,
  date_of_birth TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX household_members_household ON household_members(household_id);

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  office_id TEXT NOT NULL REFERENCES offices(id),
  display_name TEXT NOT NULL,
  segment TEXT NOT NULL,
  relationship_since TEXT NOT NULL,
  primary_advisor_id TEXT NOT NULL REFERENCES advisors(id),
  date_of_birth TEXT,
  risk_profile INTEGER CHECK (risk_profile IS NULL OR risk_profile BETWEEN 1 AND 7),
  preferred_channel TEXT NOT NULL,
  annual_income INTEGER,
  currency TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('onboarding', 'active', 'former')),
  lifecycle_since TEXT NOT NULL,
  closure_effective_date TEXT,
  closure_reason TEXT,
  closure_note TEXT
);
CREATE INDEX clients_office ON clients(office_id);
CREATE INDEX clients_status ON clients(lifecycle_status);

CREATE TABLE client_office_history (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  office_id TEXT NOT NULL REFERENCES offices(id),
  from_date TEXT NOT NULL,
  to_date TEXT
);
CREATE INDEX client_office_history_client ON client_office_history(client_id);

CREATE TABLE lifecycle_events (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL CHECK (subject IN ('client', 'office')),
  subject_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  at TEXT NOT NULL,
  by_advisor_id TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  note TEXT
);
CREATE INDEX lifecycle_events_subject ON lifecycle_events(subject_id);
CREATE INDEX lifecycle_events_at ON lifecycle_events(at);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  value INTEGER NOT NULL,
  valued_at TEXT NOT NULL,
  source TEXT NOT NULL,
  with_bank INTEGER NOT NULL,
  portfolio_id TEXT
);
CREATE INDEX assets_client ON assets(client_id);

CREATE TABLE liabilities (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  outstanding_balance INTEGER NOT NULL,
  interest_type TEXT NOT NULL,
  rate_percent REAL NOT NULL,
  maturity_date TEXT,
  collateral_asset_id TEXT,
  loan_to_value_percent REAL,
  next_review_date TEXT,
  with_bank INTEGER NOT NULL,
  valued_at TEXT NOT NULL
);
CREATE INDEX liabilities_client ON liabilities(client_id);

CREATE TABLE portfolios (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  valued_at TEXT NOT NULL,
  source TEXT NOT NULL,
  total_value INTEGER NOT NULL,
  benchmark_name TEXT NOT NULL,
  performance_ytd_percent REAL NOT NULL
);
CREATE INDEX portfolios_client ON portfolios(client_id);

CREATE TABLE portfolio_allocations (
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id),
  asset_class TEXT NOT NULL,
  strategic_percent REAL NOT NULL,
  current_percent REAL NOT NULL,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (portfolio_id, asset_class)
);

CREATE TABLE holdings (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id),
  name TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  market_value INTEGER NOT NULL,
  weight_percent REAL NOT NULL,
  performance_ytd_percent REAL NOT NULL,
  role TEXT NOT NULL,
  currency TEXT NOT NULL,
  region TEXT NOT NULL,
  sector TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);
CREATE INDEX holdings_portfolio ON holdings(portfolio_id);

CREATE TABLE portfolio_performance (
  portfolio_id TEXT PRIMARY KEY REFERENCES portfolios(id),
  points_json TEXT NOT NULL
);

CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  target_amount INTEGER,
  target_date TEXT,
  priority TEXT NOT NULL,
  progress_percent REAL NOT NULL,
  associated_asset_ids_json TEXT NOT NULL,
  status TEXT NOT NULL,
  notes TEXT NOT NULL,
  assessed_at TEXT NOT NULL
);
CREATE INDEX goals_client ON goals(client_id);

CREATE TABLE interactions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  type TEXT NOT NULL,
  date TEXT NOT NULL,
  advisor_id TEXT NOT NULL,
  source TEXT NOT NULL,
  importance TEXT NOT NULL,
  title TEXT NOT NULL,
  note_text TEXT NOT NULL,
  topics_json TEXT NOT NULL,
  key_points_json TEXT NOT NULL,
  amount INTEGER,
  ${PROVENANCE}
);
CREATE INDEX interactions_client_date ON interactions(client_id, date);

CREATE TABLE memory_candidates (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  advisor_id TEXT NOT NULL,
  note_text TEXT NOT NULL,
  interaction_date TEXT NOT NULL,
  interaction_type TEXT NOT NULL,
  source TEXT NOT NULL,
  importance TEXT NOT NULL,
  items_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  interaction_id TEXT
);
CREATE INDEX memory_candidates_client ON memory_candidates(client_id);

CREATE TABLE context_facts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  category TEXT NOT NULL,
  statement TEXT NOT NULL,
  status TEXT NOT NULL,
  status_at TEXT NOT NULL,
  ${PROVENANCE}
);
CREATE INDEX context_facts_client ON context_facts(client_id);

CREATE TABLE commitments (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  owner_advisor_id TEXT NOT NULL,
  completed_at TEXT,
  ${PROVENANCE}
);
CREATE INDEX commitments_client ON commitments(client_id);

CREATE TABLE important_events (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  recurring TEXT NOT NULL,
  importance TEXT NOT NULL,
  notes TEXT NOT NULL,
  reminder_rules_json TEXT NOT NULL,
  status TEXT NOT NULL,
  liability_id TEXT,
  ${PROVENANCE}
);
CREATE INDEX important_events_client ON important_events(client_id);

CREATE TABLE opportunities (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  potential_value INTEGER NOT NULL,
  probability_percent REAL NOT NULL,
  status TEXT NOT NULL,
  basis TEXT NOT NULL,
  next_action TEXT NOT NULL,
  owner_advisor_id TEXT NOT NULL,
  expected_date TEXT,
  ${PROVENANCE}
);
CREATE INDEX opportunities_client ON opportunities(client_id);

CREATE TABLE sentinel_dispositions (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  priority_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id),
  status TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  at TEXT NOT NULL,
  by_advisor_id TEXT NOT NULL,
  until TEXT,
  reason TEXT
);
CREATE INDEX sentinel_dispositions_client ON sentinel_dispositions(client_id);

CREATE TABLE market_ledger_events (
  record_key TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('active', 'history')),
  sort_order INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE meeting_snapshots (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  meeting_interaction_id TEXT NOT NULL,
  meeting_date TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX meeting_snapshots_client ON meeting_snapshots(client_id);

CREATE TABLE generated_documents (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  kind TEXT NOT NULL,
  version INTEGER NOT NULL,
  format TEXT NOT NULL,
  file_name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  source_as_of TEXT NOT NULL,
  meeting_id TEXT,
  meeting_date TEXT,
  audience TEXT NOT NULL,
  depth TEXT NOT NULL,
  slide_count INTEGER NOT NULL,
  core_count INTEGER NOT NULL,
  appendix_count INTEGER NOT NULL
);
CREATE INDEX generated_documents_client ON generated_documents(client_id);

CREATE TABLE id_sequences (
  kind TEXT PRIMARY KEY,
  next INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
]

export const CURRENT_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version

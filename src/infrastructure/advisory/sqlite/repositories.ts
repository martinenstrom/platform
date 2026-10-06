/**
 * The relationship record on SQLite: every advisory port, row by row.
 *
 * Each repository maps one table (or a parent with its children) to the
 * domain's records and back, in the orders the ports promise. Nothing is
 * derived here; the record is written as given and read as written.
 * Identities are minted from `id_sequences` inside the same transaction as
 * the write that uses them.
 */

import type {
  Advisor,
  Asset,
  Client,
  ClientOfficeHistory,
  Commitment,
  ContextFact,
  Goal,
  Household,
  HouseholdMember,
  ImportantEvent,
  Interaction,
  Liability,
  LifecycleEvent,
  MarketLedgerState,
  MeetingSnapshot,
  MemoryCandidate,
  Office,
  Opportunity,
  Portfolio,
  Provenance,
  SentinelDisposition,
} from '~/domain/advisory'
import type { AdvisoryRepositories, MintedKind } from '~/application/advisory/ports'
import { inTransaction, type Database } from './database'

type Row = Record<string, unknown>

const str = (row: Row, key: string): string => String(row[key])
const num = (row: Row, key: string): number => Number(row[key])
const opt = (row: Row, key: string): string | null =>
  row[key] === null || row[key] === undefined ? null : String(row[key])
const optNum = (row: Row, key: string): number | null =>
  row[key] === null || row[key] === undefined ? null : Number(row[key])
const bool = (row: Row, key: string): boolean => Number(row[key]) === 1
const json = <T>(row: Row, key: string): T => JSON.parse(String(row[key])) as T

/* ------------------------------------------------------------ provenance */

const PROVENANCE_COLUMNS =
  'prov_origin, prov_source_interaction_id, prov_source_text, prov_source_date, prov_created_at, prov_created_by, prov_confidence, prov_confirmed, prov_confirmed_at'

function provenanceValues(p: Provenance): unknown[] {
  return [
    p.origin,
    p.sourceInteractionId,
    p.sourceText,
    p.sourceDate,
    p.createdAt,
    p.createdBy,
    p.confidence,
    p.confirmedByAdvisor ? 1 : 0,
    p.confirmedAt,
  ]
}

function provenanceOf(row: Row): Provenance {
  return {
    origin: str(row, 'prov_origin') as Provenance['origin'],
    sourceInteractionId: opt(row, 'prov_source_interaction_id'),
    sourceText: opt(row, 'prov_source_text'),
    sourceDate: str(row, 'prov_source_date'),
    createdAt: str(row, 'prov_created_at'),
    createdBy: str(row, 'prov_created_by'),
    confidence: str(row, 'prov_confidence') as Provenance['confidence'],
    confirmedByAdvisor: bool(row, 'prov_confirmed'),
    confirmedAt: opt(row, 'prov_confirmed_at'),
  }
}

/* --------------------------------------------------------------- mappers */

function clientOf(row: Row): Client {
  const reason = opt(row, 'closure_reason')
  return {
    id: str(row, 'id'),
    householdId: str(row, 'household_id'),
    officeId: str(row, 'office_id'),
    displayName: str(row, 'display_name'),
    segment: str(row, 'segment') as Client['segment'],
    relationshipSince: str(row, 'relationship_since'),
    primaryAdvisorId: str(row, 'primary_advisor_id'),
    dateOfBirth: opt(row, 'date_of_birth'),
    riskProfile: optNum(row, 'risk_profile') as Client['riskProfile'],
    preferredChannel: str(row, 'preferred_channel') as Client['preferredChannel'],
    annualIncome: optNum(row, 'annual_income'),
    currency: 'SEK',
    lifecycle: {
      status: str(row, 'lifecycle_status') as Client['lifecycle']['status'],
      since: str(row, 'lifecycle_since'),
      closure: reason
        ? {
            effectiveDate: str(row, 'closure_effective_date'),
            reason: reason as NonNullable<Client['lifecycle']['closure']>['reason'],
            note: opt(row, 'closure_note'),
          }
        : null,
    },
  }
}

function clientValues(c: Client): unknown[] {
  return [
    c.id,
    c.householdId,
    c.officeId,
    c.displayName,
    c.segment,
    c.relationshipSince,
    c.primaryAdvisorId,
    c.dateOfBirth,
    c.riskProfile,
    c.preferredChannel,
    c.annualIncome,
    c.currency,
    c.lifecycle.status,
    c.lifecycle.since,
    c.lifecycle.closure?.effectiveDate ?? null,
    c.lifecycle.closure?.reason ?? null,
    c.lifecycle.closure?.note ?? null,
  ]
}

const CLIENT_COLUMNS =
  'id, household_id, office_id, display_name, segment, relationship_since, primary_advisor_id, date_of_birth, risk_profile, preferred_channel, annual_income, currency, lifecycle_status, lifecycle_since, closure_effective_date, closure_reason, closure_note'

function officeOf(row: Row): Office {
  const description = opt(row, 'description')
  return {
    id: str(row, 'id'),
    name: str(row, 'name'),
    city: str(row, 'city'),
    displayName: str(row, 'display_name'),
    shortName: str(row, 'short_name'),
    status: str(row, 'status') as Office['status'],
    archivedAt: opt(row, 'archived_at'),
    ...(description !== null ? { description } : {}),
  }
}

function assetOf(row: Row): Asset {
  const portfolioId = opt(row, 'portfolio_id')
  return {
    id: str(row, 'id'),
    clientId: str(row, 'client_id'),
    kind: str(row, 'kind') as Asset['kind'],
    title: str(row, 'title'),
    value: num(row, 'value'),
    valuedAt: str(row, 'valued_at'),
    source: str(row, 'source') as Asset['source'],
    withBank: bool(row, 'with_bank'),
    ...(portfolioId !== null ? { portfolioId } : {}),
  }
}

function liabilityOf(row: Row): Liability {
  const collateral = opt(row, 'collateral_asset_id')
  const ltv = optNum(row, 'loan_to_value_percent')
  return {
    id: str(row, 'id'),
    clientId: str(row, 'client_id'),
    kind: str(row, 'kind') as Liability['kind'],
    title: str(row, 'title'),
    outstandingBalance: num(row, 'outstanding_balance'),
    interestType: str(row, 'interest_type') as Liability['interestType'],
    ratePercent: num(row, 'rate_percent'),
    maturityDate: opt(row, 'maturity_date'),
    ...(collateral !== null ? { collateralAssetId: collateral } : {}),
    ...(ltv !== null ? { loanToValuePercent: ltv } : {}),
    nextReviewDate: opt(row, 'next_review_date'),
    withBank: bool(row, 'with_bank'),
    valuedAt: str(row, 'valued_at'),
  }
}

function goalOf(row: Row): Goal {
  return {
    id: str(row, 'id'),
    clientId: str(row, 'client_id'),
    kind: str(row, 'kind') as Goal['kind'],
    title: str(row, 'title'),
    targetAmount: optNum(row, 'target_amount'),
    targetDate: opt(row, 'target_date'),
    priority: str(row, 'priority') as Goal['priority'],
    progressPercent: num(row, 'progress_percent'),
    associatedAssetIds: json<string[]>(row, 'associated_asset_ids_json'),
    status: str(row, 'status') as Goal['status'],
    notes: str(row, 'notes'),
    assessedAt: str(row, 'assessed_at'),
  }
}

function interactionOf(row: Row): Interaction {
  const amount = optNum(row, 'amount')
  return {
    id: str(row, 'id'),
    clientId: str(row, 'client_id'),
    type: str(row, 'type') as Interaction['type'],
    date: str(row, 'date'),
    advisorId: str(row, 'advisor_id'),
    source: str(row, 'source') as Interaction['source'],
    importance: str(row, 'importance') as Interaction['importance'],
    title: str(row, 'title'),
    noteText: str(row, 'note_text'),
    topics: json<Interaction['topics']>(row, 'topics_json'),
    keyPoints: json<string[]>(row, 'key_points_json'),
    ...(amount !== null ? { amount } : {}),
    provenance: provenanceOf(row),
  }
}

function candidateOf(row: Row): MemoryCandidate {
  return {
    id: str(row, 'id'),
    clientId: str(row, 'client_id'),
    advisorId: str(row, 'advisor_id'),
    noteText: str(row, 'note_text'),
    interactionDate: str(row, 'interaction_date'),
    interactionType: str(row, 'interaction_type') as MemoryCandidate['interactionType'],
    source: str(row, 'source') as MemoryCandidate['source'],
    importance: str(row, 'importance') as MemoryCandidate['importance'],
    items: json<MemoryCandidate['items']>(row, 'items_json'),
    status: str(row, 'status') as MemoryCandidate['status'],
    createdAt: str(row, 'created_at'),
    resolvedAt: opt(row, 'resolved_at'),
    interactionId: opt(row, 'interaction_id'),
  }
}

function factOf(row: Row): ContextFact {
  return {
    id: str(row, 'id'),
    clientId: str(row, 'client_id'),
    category: str(row, 'category') as ContextFact['category'],
    statement: str(row, 'statement'),
    status: str(row, 'status') as ContextFact['status'],
    statusAt: str(row, 'status_at'),
    provenance: provenanceOf(row),
  }
}

function commitmentOf(row: Row): Commitment {
  return {
    id: str(row, 'id'),
    clientId: str(row, 'client_id'),
    title: str(row, 'title'),
    createdAt: str(row, 'created_at'),
    dueDate: opt(row, 'due_date'),
    status: str(row, 'status') as Commitment['status'],
    priority: str(row, 'priority') as Commitment['priority'],
    ownerAdvisorId: str(row, 'owner_advisor_id'),
    completedAt: opt(row, 'completed_at'),
    provenance: provenanceOf(row),
  }
}

function eventOf(row: Row): ImportantEvent {
  const liabilityId = opt(row, 'liability_id')
  return {
    id: str(row, 'id'),
    clientId: str(row, 'client_id'),
    type: str(row, 'type') as ImportantEvent['type'],
    title: str(row, 'title'),
    date: str(row, 'date'),
    recurring: str(row, 'recurring') as ImportantEvent['recurring'],
    importance: str(row, 'importance') as ImportantEvent['importance'],
    notes: str(row, 'notes'),
    reminderRules: json<ImportantEvent['reminderRules']>(row, 'reminder_rules_json'),
    status: str(row, 'status') as ImportantEvent['status'],
    ...(liabilityId !== null ? { liabilityId } : {}),
    provenance: provenanceOf(row),
  }
}

function opportunityOf(row: Row): Opportunity {
  return {
    id: str(row, 'id'),
    clientId: str(row, 'client_id'),
    type: str(row, 'type') as Opportunity['type'],
    title: str(row, 'title'),
    potentialValue: num(row, 'potential_value'),
    probabilityPercent: num(row, 'probability_percent'),
    status: str(row, 'status') as Opportunity['status'],
    basis: str(row, 'basis'),
    nextAction: str(row, 'next_action'),
    ownerAdvisorId: str(row, 'owner_advisor_id'),
    expectedDate: opt(row, 'expected_date'),
    provenance: provenanceOf(row),
  }
}

function dispositionOf(row: Row): SentinelDisposition {
  return {
    priorityId: str(row, 'priority_id'),
    clientId: str(row, 'client_id'),
    status: str(row, 'status') as SentinelDisposition['status'],
    fingerprint: str(row, 'fingerprint'),
    at: str(row, 'at'),
    by: str(row, 'by_advisor_id'),
    until: opt(row, 'until'),
    reason: opt(row, 'reason'),
  }
}

function lifecycleEventOf(row: Row): LifecycleEvent {
  return {
    id: str(row, 'id'),
    subject: str(row, 'subject') as LifecycleEvent['subject'],
    subjectId: str(row, 'subject_id'),
    kind: str(row, 'kind') as LifecycleEvent['kind'],
    effectiveDate: str(row, 'effective_date'),
    at: str(row, 'at'),
    by: str(row, 'by_advisor_id'),
    detail: json<LifecycleEvent['detail']>(row, 'detail_json'),
    note: opt(row, 'note'),
  }
}

function stretchOf(row: Row): ClientOfficeHistory {
  return {
    id: str(row, 'id'),
    clientId: str(row, 'client_id'),
    officeId: str(row, 'office_id'),
    from: str(row, 'from_date'),
    to: opt(row, 'to_date'),
  }
}

/* ---------------------------------------------------------- repositories */

export function createSqliteAdvisoryRepositories(db: Database): AdvisoryRepositories {
  const all = (sql: string, ...params: unknown[]) =>
    db.prepare(sql).all(...(params as never[])) as Row[]
  const one = (sql: string, ...params: unknown[]) =>
    (db.prepare(sql).get(...(params as never[])) as Row | undefined) ?? null
  const run = (sql: string, ...params: unknown[]) =>
    db.prepare(sql).run(...(params as never[]))

  const writeHousehold = (household: Household) => {
    run(
      'INSERT INTO households (id, display_name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name',
      household.id,
      household.displayName,
    )
    run('DELETE FROM household_members WHERE household_id = ?', household.id)
    household.members.forEach((member, index) =>
      run(
        'INSERT INTO household_members (id, household_id, role, display_name, client_id, date_of_birth, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
        member.id,
        household.id,
        member.role,
        member.displayName,
        member.clientId ?? null,
        member.dateOfBirth ?? null,
        index,
      ),
    )
  }

  const readPortfolio = (row: Row): Portfolio => {
    const id = str(row, 'id')
    return {
      id,
      clientId: str(row, 'client_id'),
      valuedAt: str(row, 'valued_at'),
      source: str(row, 'source') as Portfolio['source'],
      totalValue: num(row, 'total_value'),
      benchmarkName: str(row, 'benchmark_name'),
      performanceYtdPercent: num(row, 'performance_ytd_percent'),
      allocation: all(
        'SELECT asset_class, strategic_percent, current_percent FROM portfolio_allocations WHERE portfolio_id = ? ORDER BY sort_order',
        id,
      ).map((a) => ({
        assetClass: str(
          a,
          'asset_class',
        ) as Portfolio['allocation'][number]['assetClass'],
        strategicPercent: num(a, 'strategic_percent'),
        currentPercent: num(a, 'current_percent'),
      })),
      holdings: all(
        'SELECT * FROM holdings WHERE portfolio_id = ? ORDER BY sort_order',
        id,
      ).map((h) => ({
        id: str(h, 'id'),
        portfolioId: id,
        name: str(h, 'name'),
        assetClass: str(h, 'asset_class') as Portfolio['holdings'][number]['assetClass'],
        marketValue: num(h, 'market_value'),
        weightPercent: num(h, 'weight_percent'),
        performanceYtdPercent: num(h, 'performance_ytd_percent'),
        role: str(h, 'role') as Portfolio['holdings'][number]['role'],
        currency: str(h, 'currency') as Portfolio['holdings'][number]['currency'],
        region: str(h, 'region') as Portfolio['holdings'][number]['region'],
        sector: str(h, 'sector') as Portfolio['holdings'][number]['sector'],
      })),
      performance: (() => {
        const points = one(
          'SELECT points_json FROM portfolio_performance WHERE portfolio_id = ?',
          id,
        )
        return points ? json<Portfolio['performance']>(points, 'points_json') : []
      })(),
    }
  }

  const repositories: AdvisoryRepositories = {
    clients: {
      async list() {
        return all(`SELECT ${CLIENT_COLUMNS} FROM clients ORDER BY id`).map(clientOf)
      },
      async byId(id) {
        const row = one(`SELECT ${CLIENT_COLUMNS} FROM clients WHERE id = ?`, id)
        return row ? clientOf(row) : null
      },
      async addClient(client) {
        run(
          `INSERT INTO clients (${CLIENT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ...clientValues(client),
        )
      },
      async saveClient(client) {
        const result = run(
          `UPDATE clients SET household_id = ?, office_id = ?, display_name = ?, segment = ?, relationship_since = ?, primary_advisor_id = ?, date_of_birth = ?, risk_profile = ?, preferred_channel = ?, annual_income = ?, currency = ?, lifecycle_status = ?, lifecycle_since = ?, closure_effective_date = ?, closure_reason = ?, closure_note = ? WHERE id = ?`,
          ...clientValues(client).slice(1),
          client.id,
        )
        if (Number(result.changes) === 0)
          throw new Error(`client ${client.id} does not exist`)
      },
      async householdById(id) {
        const row = one('SELECT id, display_name FROM households WHERE id = ?', id)
        if (!row) return null
        const members: HouseholdMember[] = all(
          'SELECT * FROM household_members WHERE household_id = ? ORDER BY sort_order',
          id,
        ).map((m) => {
          const clientId = opt(m, 'client_id')
          const dateOfBirth = opt(m, 'date_of_birth')
          return {
            id: str(m, 'id'),
            householdId: id,
            role: str(m, 'role') as HouseholdMember['role'],
            displayName: str(m, 'display_name'),
            ...(clientId !== null ? { clientId } : {}),
            ...(dateOfBirth !== null ? { dateOfBirth } : {}),
          }
        })
        return { id, displayName: str(row, 'display_name'), members }
      },
      async saveHousehold(household) {
        writeHousehold(household)
      },
      async advisorById(id) {
        const row = one('SELECT id, display_name FROM advisors WHERE id = ?', id)
        return row ? { id: str(row, 'id'), displayName: str(row, 'display_name') } : null
      },
      async advisors() {
        return all('SELECT id, display_name FROM advisors ORDER BY id').map((row) => ({
          id: str(row, 'id'),
          displayName: str(row, 'display_name'),
        }))
      },
      async saveAdvisor(advisor) {
        run(
          'INSERT INTO advisors (id, display_name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name',
          advisor.id,
          advisor.displayName,
        )
      },
      async offices() {
        return all('SELECT * FROM offices ORDER BY sort_order, id').map(officeOf)
      },
      async officeById(id) {
        const row = one('SELECT * FROM offices WHERE id = ?', id)
        return row ? officeOf(row) : null
      },
      async addOffice(office) {
        const next = one('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM offices')
        run(
          'INSERT INTO offices (id, name, city, display_name, short_name, status, archived_at, description, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          office.id,
          office.name,
          office.city,
          office.displayName,
          office.shortName,
          office.status,
          office.archivedAt,
          office.description ?? null,
          next ? num(next, 'n') : 0,
        )
      },
      async saveOffice(office) {
        const result = run(
          'UPDATE offices SET name = ?, city = ?, display_name = ?, short_name = ?, status = ?, archived_at = ?, description = ? WHERE id = ?',
          office.name,
          office.city,
          office.displayName,
          office.shortName,
          office.status,
          office.archivedAt,
          office.description ?? null,
          office.id,
        )
        if (Number(result.changes) === 0)
          throw new Error(`office ${office.id} does not exist`)
      },
    },
    wealth: {
      async assetsOf(clientId) {
        return all(
          'SELECT * FROM assets WHERE client_id = ? ORDER BY value DESC, id',
          clientId,
        ).map(assetOf)
      },
      async liabilitiesOf(clientId) {
        return all(
          'SELECT * FROM liabilities WHERE client_id = ? ORDER BY outstanding_balance DESC, id',
          clientId,
        ).map(liabilityOf)
      },
      async addAsset(a) {
        run(
          'INSERT INTO assets (id, client_id, kind, title, value, valued_at, source, with_bank, portfolio_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          a.id,
          a.clientId,
          a.kind,
          a.title,
          a.value,
          a.valuedAt,
          a.source,
          a.withBank ? 1 : 0,
          a.portfolioId ?? null,
        )
      },
      async addLiability(l) {
        run(
          'INSERT INTO liabilities (id, client_id, kind, title, outstanding_balance, interest_type, rate_percent, maturity_date, collateral_asset_id, loan_to_value_percent, next_review_date, with_bank, valued_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          l.id,
          l.clientId,
          l.kind,
          l.title,
          l.outstandingBalance,
          l.interestType,
          l.ratePercent,
          l.maturityDate,
          l.collateralAssetId ?? null,
          l.loanToValuePercent ?? null,
          l.nextReviewDate,
          l.withBank ? 1 : 0,
          l.valuedAt,
        )
      },
    },
    portfolios: {
      async portfolioOf(clientId) {
        const row = one(
          'SELECT * FROM portfolios WHERE client_id = ? ORDER BY id LIMIT 1',
          clientId,
        )
        return row ? readPortfolio(row) : null
      },
    },
    goals: {
      async goalsOf(clientId) {
        return all('SELECT * FROM goals WHERE client_id = ? ORDER BY id', clientId).map(
          goalOf,
        )
      },
      async addGoal(g) {
        run(
          'INSERT INTO goals (id, client_id, kind, title, target_amount, target_date, priority, progress_percent, associated_asset_ids_json, status, notes, assessed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          g.id,
          g.clientId,
          g.kind,
          g.title,
          g.targetAmount,
          g.targetDate,
          g.priority,
          g.progressPercent,
          JSON.stringify(g.associatedAssetIds),
          g.status,
          g.notes,
          g.assessedAt,
        )
      },
    },
    interactions: {
      async interactionsOf(clientId) {
        return all(
          'SELECT * FROM interactions WHERE client_id = ? ORDER BY date DESC, id DESC',
          clientId,
        ).map(interactionOf)
      },
      async addInteraction(i) {
        run(
          `INSERT INTO interactions (id, client_id, type, date, advisor_id, source, importance, title, note_text, topics_json, key_points_json, amount, ${PROVENANCE_COLUMNS})
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          i.id,
          i.clientId,
          i.type,
          i.date,
          i.advisorId,
          i.source,
          i.importance,
          i.title,
          i.noteText,
          JSON.stringify(i.topics),
          JSON.stringify(i.keyPoints),
          i.amount ?? null,
          ...provenanceValues(i.provenance),
        )
      },
      async candidatesOf(clientId) {
        return all(
          'SELECT * FROM memory_candidates WHERE client_id = ? ORDER BY created_at DESC, id DESC',
          clientId,
        ).map(candidateOf)
      },
      async candidateById(id) {
        const row = one('SELECT * FROM memory_candidates WHERE id = ?', id)
        return row ? candidateOf(row) : null
      },
      async saveCandidate(c) {
        run(
          `INSERT INTO memory_candidates (id, client_id, advisor_id, note_text, interaction_date, interaction_type, source, importance, items_json, status, created_at, resolved_at, interaction_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET note_text = excluded.note_text, interaction_date = excluded.interaction_date, interaction_type = excluded.interaction_type,
             source = excluded.source, importance = excluded.importance, items_json = excluded.items_json, status = excluded.status,
             resolved_at = excluded.resolved_at, interaction_id = excluded.interaction_id`,
          c.id,
          c.clientId,
          c.advisorId,
          c.noteText,
          c.interactionDate,
          c.interactionType,
          c.source,
          c.importance,
          JSON.stringify(c.items),
          c.status,
          c.createdAt,
          c.resolvedAt,
          c.interactionId,
        )
      },
    },
    context: {
      async factsOf(clientId) {
        return all(
          'SELECT * FROM context_facts WHERE client_id = ? ORDER BY prov_source_date DESC, id',
          clientId,
        ).map(factOf)
      },
      async addFact(f) {
        run(
          `INSERT INTO context_facts (id, client_id, category, statement, status, status_at, ${PROVENANCE_COLUMNS})
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          f.id,
          f.clientId,
          f.category,
          f.statement,
          f.status,
          f.statusAt,
          ...provenanceValues(f.provenance),
        )
      },
      async saveFact(f) {
        run(
          'UPDATE context_facts SET category = ?, statement = ?, status = ?, status_at = ? WHERE id = ?',
          f.category,
          f.statement,
          f.status,
          f.statusAt,
          f.id,
        )
      },
    },
    commitments: {
      async commitmentsOf(clientId) {
        return all(
          'SELECT * FROM commitments WHERE client_id = ? ORDER BY created_at DESC, id',
          clientId,
        ).map(commitmentOf)
      },
      async addCommitment(c) {
        run(
          `INSERT INTO commitments (id, client_id, title, created_at, due_date, status, priority, owner_advisor_id, completed_at, ${PROVENANCE_COLUMNS})
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          c.id,
          c.clientId,
          c.title,
          c.createdAt,
          c.dueDate,
          c.status,
          c.priority,
          c.ownerAdvisorId,
          c.completedAt,
          ...provenanceValues(c.provenance),
        )
      },
      async commitmentById(id) {
        const row = one('SELECT * FROM commitments WHERE id = ?', id)
        return row ? commitmentOf(row) : null
      },
      async saveCommitment(c) {
        run(
          'UPDATE commitments SET title = ?, due_date = ?, status = ?, priority = ?, owner_advisor_id = ?, completed_at = ? WHERE id = ?',
          c.title,
          c.dueDate,
          c.status,
          c.priority,
          c.ownerAdvisorId,
          c.completedAt,
          c.id,
        )
      },
    },
    events: {
      async eventsOf(clientId) {
        return all(
          'SELECT * FROM important_events WHERE client_id = ? ORDER BY date, id',
          clientId,
        ).map(eventOf)
      },
      async addEvent(e) {
        run(
          `INSERT INTO important_events (id, client_id, type, title, date, recurring, importance, notes, reminder_rules_json, status, liability_id, ${PROVENANCE_COLUMNS})
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          e.id,
          e.clientId,
          e.type,
          e.title,
          e.date,
          e.recurring,
          e.importance,
          e.notes,
          JSON.stringify(e.reminderRules),
          e.status,
          e.liabilityId ?? null,
          ...provenanceValues(e.provenance),
        )
      },
      async saveEvent(e) {
        run(
          'UPDATE important_events SET type = ?, title = ?, date = ?, recurring = ?, importance = ?, notes = ?, reminder_rules_json = ?, status = ?, liability_id = ? WHERE id = ?',
          e.type,
          e.title,
          e.date,
          e.recurring,
          e.importance,
          e.notes,
          JSON.stringify(e.reminderRules),
          e.status,
          e.liabilityId ?? null,
          e.id,
        )
      },
    },
    opportunities: {
      async opportunitiesOf(clientId) {
        return all(
          'SELECT * FROM opportunities WHERE client_id = ? ORDER BY potential_value DESC, id',
          clientId,
        ).map(opportunityOf)
      },
    },
    sentinel: {
      async dispositions() {
        return all('SELECT * FROM sentinel_dispositions ORDER BY seq').map(dispositionOf)
      },
      async dispositionsOf(clientId) {
        return all(
          'SELECT * FROM sentinel_dispositions WHERE client_id = ? ORDER BY seq',
          clientId,
        ).map(dispositionOf)
      },
      async addDisposition(d) {
        run(
          'INSERT INTO sentinel_dispositions (priority_id, client_id, status, fingerprint, at, by_advisor_id, until, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          d.priorityId,
          d.clientId,
          d.status,
          d.fingerprint,
          d.at,
          d.by,
          d.until,
          d.reason,
        )
      },
    },
    meetingSnapshots: {
      async latestFor(clientId) {
        const row = one(
          'SELECT * FROM meeting_snapshots WHERE client_id = ? ORDER BY meeting_date DESC, captured_at DESC LIMIT 1',
          clientId,
        )
        return row ? json<MeetingSnapshot>(row, 'payload_json') : null
      },
      async allFor(clientId) {
        return all(
          'SELECT * FROM meeting_snapshots WHERE client_id = ? ORDER BY meeting_date DESC, captured_at DESC',
          clientId,
        ).map((row) => json<MeetingSnapshot>(row, 'payload_json'))
      },
      async save(s) {
        run(
          `INSERT INTO meeting_snapshots (id, client_id, meeting_interaction_id, meeting_date, captured_at, payload_json)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET meeting_interaction_id = excluded.meeting_interaction_id, meeting_date = excluded.meeting_date,
             captured_at = excluded.captured_at, payload_json = excluded.payload_json`,
          s.id,
          s.clientId,
          s.meetingInteractionId,
          s.meetingDate,
          s.capturedAt,
          JSON.stringify(s),
        )
      },
    },
    marketEvents: {
      async state() {
        const rows = all(
          'SELECT state, payload_json FROM market_ledger_events ORDER BY sort_order',
        )
        const state: MarketLedgerState = {
          active: rows
            .filter((r) => str(r, 'state') === 'active')
            .map((r) => json<MarketLedgerState['active'][number]>(r, 'payload_json')),
          history: rows
            .filter((r) => str(r, 'state') === 'history')
            .map((r) => json<MarketLedgerState['history'][number]>(r, 'payload_json')),
        }
        return state
      },
      async replace(state) {
        await inTransaction(db, async () => {
          run('DELETE FROM market_ledger_events')
          state.active.forEach((event, index) =>
            run(
              'INSERT INTO market_ledger_events (record_key, state, sort_order, payload_json) VALUES (?, ?, ?, ?)',
              `active:${event.id}`,
              'active',
              index,
              JSON.stringify(event),
            ),
          )
          state.history.forEach((event, index) =>
            run(
              'INSERT INTO market_ledger_events (record_key, state, sort_order, payload_json) VALUES (?, ?, ?, ?)',
              `history:${event.recordId}`,
              'history',
              1_000_000 + index,
              JSON.stringify(event),
            ),
          )
        })
      },
    },
    lifecycle: {
      async eventsOf(subjectId) {
        return all(
          'SELECT * FROM lifecycle_events WHERE subject_id = ? ORDER BY at DESC, id DESC',
          subjectId,
        ).map(lifecycleEventOf)
      },
      async events() {
        return all('SELECT * FROM lifecycle_events ORDER BY at DESC, id DESC').map(
          lifecycleEventOf,
        )
      },
      async addEvent(e) {
        run(
          'INSERT INTO lifecycle_events (id, subject, subject_id, kind, effective_date, at, by_advisor_id, detail_json, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          e.id,
          e.subject,
          e.subjectId,
          e.kind,
          e.effectiveDate,
          e.at,
          e.by,
          JSON.stringify(e.detail),
          e.note,
        )
      },
      async officeHistoryOf(clientId) {
        return all(
          'SELECT * FROM client_office_history WHERE client_id = ? ORDER BY from_date, id',
          clientId,
        ).map(stretchOf)
      },
      async addOfficeHistory(s) {
        run(
          'INSERT INTO client_office_history (id, client_id, office_id, from_date, to_date) VALUES (?, ?, ?, ?, ?)',
          s.id,
          s.clientId,
          s.officeId,
          s.from,
          s.to,
        )
      },
      async saveOfficeHistory(s) {
        run(
          'UPDATE client_office_history SET office_id = ?, from_date = ?, to_date = ? WHERE id = ?',
          s.officeId,
          s.from,
          s.to,
          s.id,
        )
      },
    },
    ids: {
      async mint(kind: MintedKind) {
        return inTransaction(db, async () => {
          run(
            'INSERT INTO id_sequences (kind, next) VALUES (?, 1) ON CONFLICT(kind) DO UPDATE SET next = next + 1',
            kind,
          )
          const row = one('SELECT next FROM id_sequences WHERE kind = ?', kind)
          return `${kind}-${String(num(row!, 'next')).padStart(4, '0')}`
        })
      },
    },
    transaction(work) {
      return inTransaction(db, work)
    },
  }
  return repositories
}

/* ------------------------------------------------------------- seeding */

/** The whole seed written in one transaction — development, demonstration and tests only. */
export async function writeSeed(
  db: Database,
  seed: {
    advisors: readonly Advisor[]
    offices: readonly Office[]
    households: readonly Household[]
    clients: readonly Client[]
    assets: readonly Asset[]
    liabilities: readonly Liability[]
    portfolios: readonly Portfolio[]
    goals: readonly Goal[]
    interactions: readonly Interaction[]
    contextFacts: readonly ContextFact[]
    commitments: readonly Commitment[]
    events: readonly ImportantEvent[]
    opportunities: readonly Opportunity[]
    meetingSnapshots: readonly MeetingSnapshot[]
  },
): Promise<void> {
  const repositories = createSqliteAdvisoryRepositories(db)
  const run = (sql: string, ...params: unknown[]) =>
    db.prepare(sql).run(...(params as never[]))
  await inTransaction(db, async () => {
    for (const advisor of seed.advisors)
      run(
        'INSERT INTO advisors (id, display_name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name',
        advisor.id,
        advisor.displayName,
      )
    for (const office of seed.offices) await repositories.clients.addOffice(office)
    for (const household of seed.households)
      await repositories.clients.saveHousehold(household)
    for (const client of seed.clients) {
      await repositories.clients.addClient(client)
      await repositories.lifecycle.addOfficeHistory({
        id: `stretch-seed-${client.id}`,
        clientId: client.id,
        officeId: client.officeId,
        from: client.relationshipSince,
        to: null,
      })
    }
    for (const asset of seed.assets) await repositories.wealth.addAsset(asset)
    for (const liability of seed.liabilities)
      await repositories.wealth.addLiability(liability)
    for (const portfolio of seed.portfolios) writePortfolioInto(db, portfolio)
    for (const goal of seed.goals) await repositories.goals.addGoal(goal)
    for (const interaction of seed.interactions)
      await repositories.interactions.addInteraction(interaction)
    for (const fact of seed.contextFacts) await repositories.context.addFact(fact)
    for (const commitment of seed.commitments)
      await repositories.commitments.addCommitment(commitment)
    for (const event of seed.events) await repositories.events.addEvent(event)
    for (const o of seed.opportunities)
      run(
        `INSERT INTO opportunities (id, client_id, type, title, potential_value, probability_percent, status, basis, next_action, owner_advisor_id, expected_date, ${PROVENANCE_COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        o.id,
        o.clientId,
        o.type,
        o.title,
        o.potentialValue,
        o.probabilityPercent,
        o.status,
        o.basis,
        o.nextAction,
        o.ownerAdvisorId,
        o.expectedDate,
        ...provenanceValues(o.provenance),
      )
    for (const snapshot of seed.meetingSnapshots)
      await repositories.meetingSnapshots.save(snapshot)
  })
}

/** The portfolio with its children, written whole; shared by the seed and by later imports. */
export function writePortfolioInto(db: Database, portfolio: Portfolio): void {
  const run = (sql: string, ...params: unknown[]) =>
    db.prepare(sql).run(...(params as never[]))
  run(
    `INSERT INTO portfolios (id, client_id, valued_at, source, total_value, benchmark_name, performance_ytd_percent)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET client_id = excluded.client_id, valued_at = excluded.valued_at, source = excluded.source,
       total_value = excluded.total_value, benchmark_name = excluded.benchmark_name, performance_ytd_percent = excluded.performance_ytd_percent`,
    portfolio.id,
    portfolio.clientId,
    portfolio.valuedAt,
    portfolio.source,
    portfolio.totalValue,
    portfolio.benchmarkName,
    portfolio.performanceYtdPercent,
  )
  run('DELETE FROM portfolio_allocations WHERE portfolio_id = ?', portfolio.id)
  portfolio.allocation.forEach((slice, index) =>
    run(
      'INSERT INTO portfolio_allocations (portfolio_id, asset_class, strategic_percent, current_percent, sort_order) VALUES (?, ?, ?, ?, ?)',
      portfolio.id,
      slice.assetClass,
      slice.strategicPercent,
      slice.currentPercent,
      index,
    ),
  )
  run('DELETE FROM holdings WHERE portfolio_id = ?', portfolio.id)
  portfolio.holdings.forEach((holding, index) =>
    run(
      'INSERT INTO holdings (id, portfolio_id, name, asset_class, market_value, weight_percent, performance_ytd_percent, role, currency, region, sector, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      holding.id,
      portfolio.id,
      holding.name,
      holding.assetClass,
      holding.marketValue,
      holding.weightPercent,
      holding.performanceYtdPercent,
      holding.role,
      holding.currency,
      holding.region,
      holding.sector,
      index,
    ),
  )
  run(
    'INSERT INTO portfolio_performance (portfolio_id, points_json) VALUES (?, ?) ON CONFLICT(portfolio_id) DO UPDATE SET points_json = excluded.points_json',
    portfolio.id,
    JSON.stringify(portfolio.performance),
  )
}

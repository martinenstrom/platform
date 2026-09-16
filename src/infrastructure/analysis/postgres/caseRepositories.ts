/**
 * Cases and thesis revisions.
 *
 * Every method is one `unitOfWork` — one connection, one transaction, joined
 * to the caller's when there is one. That is what makes a three-statement
 * `create` atomic and a three-statement `get` a single coherent snapshot,
 * without the caller having to know how many statements either uses.
 *
 * ## Why the statements live in a frozen catalogue
 *
 * `StorageProvenance.queryCatalogHash` answers "which SQL produced this
 * analysis" years later, and is computable only while every statement is
 * enumerable. See D-S20.
 *
 * ## `COLLATE "C"`
 *
 * Byte order, matching the in-memory comparator. The test cluster collates
 * `Swedish_Sweden.1252`, where `å` sorts after `z`. Ids are ASCII today, so
 * this changes nothing observable and removes an environment-dependent
 * divergence before stage 4 has to find it.
 */

import { ConcurrencyConflictError } from '~/application/analysis/repositories'
import type {
  CaseAmendmentRepository,
  CaseRepository,
  ThesisRepository,
} from '~/application/analysis/repositories'
import type { InvestmentCase, InvestmentThesis } from '~/domain/analysis'
import { toCase, toCaseAmendment, toThesis } from './mapping'
import type {
  CaseAmendmentRow,
  CaseParticipantRow,
  CaseRow,
  ThesisClaimLinkRow,
  ThesisRevisionRow,
  TransitionEventRow,
} from './rows'
import { catalog, one, run, ts, type Queryable, type SqlContext } from './sql'
import { unitOfWork, type Scope } from './transaction'

const CASE_COLUMNS = `
  id, tenant_id, version, owner_employee_id, subject_kind, subject_ref,
  subject_display_name, question, stage, playbook_id, playbook_version,
  ${ts('opened_at')}, ${ts('closed_at')}
`

const TRANSITION_COLUMNS = `
  event_id, subject, case_id, tenant_id, thesis_id, revision_id, assignment_id,
  run_id, from_state, to_state, actor_employee_id, actor_department_id, reason,
  ${ts('occurred_at')}, correlation_id, causation_id, aggregate_version, corrects
`

export const CASE_SQL = catalog({
  get: `SELECT ${CASE_COLUMNS} FROM analysis.cases WHERE id = $1`,

  list: `SELECT ${CASE_COLUMNS} FROM analysis.cases
         ORDER BY opened_at DESC, id COLLATE "C"`,

  participants: `SELECT case_id, department_id FROM analysis.case_participants
                 WHERE case_id = ANY($1::text[])
                 ORDER BY case_id COLLATE "C", department_id COLLATE "C"`,

  /*
   * The movement history, projected rather than stored: two copies of one
   * history are two things that can disagree, and this table is the one with
   * append-only permissions behind it.
   *
   * `from_state IS NOT NULL` excludes creation events. A creation is not a
   * MOVEMENT, and `CaseTransition.from` is required — including them would
   * mean inventing a stage the case was never in.
   */
  transitions: `SELECT ${TRANSITION_COLUMNS} FROM analysis.transition_events
                WHERE case_id = ANY($1::text[]) AND subject = 'case'
                  AND from_state IS NOT NULL
                ORDER BY occurred_at, event_id COLLATE "C"`,

  create: `INSERT INTO analysis.cases
             (id, tenant_id, version, owner_employee_id, subject_kind, subject_ref,
              subject_display_name, question, stage, opened_at, closed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (id) DO NOTHING`,

  addParticipants: `INSERT INTO analysis.case_participants (case_id, department_id)
                    SELECT $1, unnest($2::text[])
                    ON CONFLICT DO NOTHING`,

  /*
   * Only the columns `finos_app` holds an UPDATE grant for. A blanket SET
   * would be denied — and could rewrite the question the case was opened to
   * answer, which is what the case IS.
   *
   * The playbook pin joined that list in 0014, because `intake` is a legal
   * resting state and the workflow is chosen after the case exists. It is
   * guarded by a trigger rather than by absence: a pinned case can never be
   * re-pinned, so the version its assignments came from cannot be rewritten.
   */
  save: `UPDATE analysis.cases
            SET stage = $2, version = $3, closed_at = $4,
                playbook_id = $6, playbook_version = $7
          WHERE id = $1 AND version = $5
         RETURNING version`,

  currentVersion: `SELECT version FROM analysis.cases WHERE id = $1`,
})

/** Groups child rows by parent id, so hydration never queries in a loop. */
export function groupBy<T>(
  rows: readonly T[],
  key: (row: T) => string,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const row of rows) {
    const id = key(row)
    const existing = grouped.get(id)
    if (existing) existing.push(row)
    else grouped.set(id, [row])
  }
  return grouped
}

export function createCaseRepository(
  scope: Scope,
  context: SqlContext,
  tenantId: string,
): CaseRepository {
  /**
   * Hydrates any number of cases in two further statements.
   *
   * `= ANY` rather than a join, because participants and transitions are
   * collections: a join would return their Cartesian product and repeat every
   * case column once per combination.
   */
  async function hydrate(
    client: Queryable,
    rows: CaseRow[],
    operation: string,
  ): Promise<InvestmentCase[]> {
    if (rows.length === 0) return []
    const ids = rows.map((row) => row.id)

    const [participants, transitions] = await Promise.all([
      run<CaseParticipantRow>(client, context, operation, CASE_SQL.participants, [ids]),
      run<TransitionEventRow>(client, context, operation, CASE_SQL.transitions, [ids]),
    ])

    const byCase = groupBy(participants, (row) => row.case_id)
    const movements = groupBy(transitions, (row) => row.case_id)

    return rows.map((row) =>
      toCase(
        row,
        (byCase.get(row.id) ?? []).map((entry) => entry.department_id),
        movements.get(row.id) ?? [],
      ),
    )
  }

  async function readOne(client: Queryable, caseId: string, operation: string) {
    const row = await one<CaseRow>(client, context, operation, CASE_SQL.get, [caseId])
    if (!row) return null
    return (await hydrate(client, [row], operation))[0]!
  }

  async function writeParticipants(
    client: Queryable,
    investmentCase: InvestmentCase,
    operation: string,
  ) {
    if (investmentCase.participatingDepartmentIds.length === 0) return
    await run(client, context, operation, CASE_SQL.addParticipants, [
      investmentCase.id,
      [...investmentCase.participatingDepartmentIds],
    ])
  }

  return {
    get: (caseId) =>
      unitOfWork(scope, 'cases.get', (client) => readOne(client, caseId, 'cases.get')),

    list: () =>
      unitOfWork(scope, 'cases.list', async (client) => {
        const rows = await run<CaseRow>(client, context, 'cases.list', CASE_SQL.list)
        return hydrate(client, rows, 'cases.list')
      }),

    create: (investmentCase) =>
      unitOfWork(scope, 'cases.create', async (client) => {
        await run(client, context, 'cases.create', CASE_SQL.create, [
          investmentCase.id,
          tenantId,
          investmentCase.version,
          investmentCase.ownerEmployeeId,
          investmentCase.subject.kind,
          investmentCase.subject.ref,
          investmentCase.subject.displayName,
          investmentCase.question,
          investmentCase.stage,
          investmentCase.openedAt,
          investmentCase.closedAt ?? null,
        ])
        await writeParticipants(client, investmentCase, 'cases.create')
        /*
         * Re-read rather than echo the argument. `ON CONFLICT DO NOTHING`
         * means a replay wrote nothing, and the caller is entitled to the case
         * that actually exists — which is the in-memory adapter's behaviour.
         */
        return (await readOne(client, investmentCase.id, 'cases.create'))!
      }),

    save: (investmentCase, expectedVersion) =>
      unitOfWork(scope, 'cases.save', async (client) => {
        const updated = await run<{ version: number }>(
          client,
          context,
          'cases.save',
          CASE_SQL.save,
          [
            investmentCase.id,
            investmentCase.stage,
            investmentCase.version,
            investmentCase.closedAt ?? null,
            expectedVersion,
            investmentCase.playbookId ?? null,
            investmentCase.playbookVersion ?? null,
          ],
        )

        if (updated.length === 0) {
          // Zero rows means the version moved or the case is gone. The extra
          // read is what lets the error say which.
          const current = await one<{ version: number }>(
            client,
            context,
            'cases.save',
            CASE_SQL.currentVersion,
            [investmentCase.id],
          )
          throw new ConcurrencyConflictError(
            investmentCase.id,
            expectedVersion,
            current?.version ?? -1,
          )
        }

        await writeParticipants(client, investmentCase, 'cases.save')
        return (await readOne(client, investmentCase.id, 'cases.save'))!
      }),
  }
}

/* ------------------------------------------------------------ amendments */

const AMENDMENT_COLUMNS = `
  id, case_id, text, by_employee_id, by_department_id, case_version,
  ${ts('recorded_at')}
`

export const AMENDMENT_SQL = catalog({
  get: `SELECT ${AMENDMENT_COLUMNS} FROM analysis.case_amendments WHERE id = $1`,

  listForCase: `SELECT ${AMENDMENT_COLUMNS} FROM analysis.case_amendments
                WHERE case_id = $1
                ORDER BY recorded_at, id COLLATE "C"`,

  /* Append-only: `finos_app` holds no UPDATE or DELETE on this table (0050). */
  append: `INSERT INTO analysis.case_amendments
             (id, tenant_id, case_id, text, by_employee_id, by_department_id,
              case_version, recorded_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO NOTHING`,
})

export function createCaseAmendmentRepository(
  scope: Scope,
  context: SqlContext,
  tenantId: string,
): CaseAmendmentRepository {
  return {
    append: (amendment) =>
      unitOfWork(scope, 'amendments.append', async (client) => {
        await run(client, context, 'amendments.append', AMENDMENT_SQL.append, [
          amendment.id,
          tenantId,
          amendment.caseId,
          amendment.text,
          amendment.byEmployeeId,
          amendment.byDepartmentId,
          amendment.caseVersion,
          amendment.at,
        ])
        /* Re-read, as `cases.create` does: a replay wrote nothing, and the stored one is the truth. */
        const row = await one<CaseAmendmentRow>(client, context, 'amendments.append', AMENDMENT_SQL.get, [amendment.id])
        return toCaseAmendment(row!)
      }),

    get: (amendmentId) =>
      unitOfWork(scope, 'amendments.get', async (client) => {
        const row = await one<CaseAmendmentRow>(client, context, 'amendments.get', AMENDMENT_SQL.get, [amendmentId])
        return row ? toCaseAmendment(row) : null
      }),

    listForCase: (caseId) =>
      unitOfWork(scope, 'amendments.listForCase', async (client) => {
        const rows = await run<CaseAmendmentRow>(client, context, 'amendments.listForCase', AMENDMENT_SQL.listForCase, [caseId])
        return rows.map(toCaseAmendment)
      }),
  }
}

/* ---------------------------------------------------------------- theses */

const REVISION_COLUMNS = `
  revision_id, thesis_id, revision_number, supersedes_revision_id, case_id,
  statement, position, lifecycle, invalidation_criteria, horizon, implications,
  proposed_by_department_id, proposed_by_employee_id,
  proposed_by_agent_principal_id,
  ${ts('proposed_at')}, ${ts('revised_at')}, revision_reason, aggregation_id,
  revision_cause
`

export const THESIS_SQL = catalog({
  get: `SELECT ${REVISION_COLUMNS} FROM analysis.thesis_revisions WHERE revision_id = $1`,

  listForCase: `SELECT ${REVISION_COLUMNS} FROM analysis.thesis_revisions
                WHERE case_id = $1
                ORDER BY thesis_id COLLATE "C", revision_number`,

  links: `SELECT revision_id, claim_id, relation FROM analysis.thesis_claim_links
          WHERE revision_id = ANY($1::text[])
          ORDER BY revision_id COLLATE "C", relation COLLATE "C", claim_id COLLATE "C"`,

  /*
   * `lifecycle` is the only column the runtime may update, and the only one a
   * sealed revision may legitimately change — marking it superseded is how a
   * lineage records that a newer version exists.
   */
  save: `INSERT INTO analysis.thesis_revisions
           (revision_id, thesis_id, revision_number, supersedes_revision_id, case_id,
            statement, position, lifecycle, invalidation_criteria, horizon,
            implications, proposed_by_department_id, proposed_by_employee_id,
            proposed_by_agent_principal_id,
            proposed_at, revised_at, revision_reason, aggregation_id,
            revision_cause)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (revision_id) DO UPDATE SET lifecycle = EXCLUDED.lifecycle`,

  saveLinks: `INSERT INTO analysis.thesis_claim_links (revision_id, claim_id, relation)
              SELECT $1, unnest($2::text[]), $3
              ON CONFLICT DO NOTHING`,
})

export function createThesisRepository(
  scope: Scope,
  context: SqlContext,
): ThesisRepository {
  async function hydrate(
    client: Queryable,
    rows: ThesisRevisionRow[],
    operation: string,
  ): Promise<InvestmentThesis[]> {
    if (rows.length === 0) return []
    const links = await run<ThesisClaimLinkRow>(
      client,
      context,
      operation,
      THESIS_SQL.links,
      [rows.map((row) => row.revision_id)],
    )
    const byRevision = groupBy(links, (link) => link.revision_id)
    return rows.map((row) => toThesis(row, byRevision.get(row.revision_id) ?? []))
  }

  async function readOne(client: Queryable, revisionId: string, operation: string) {
    const row = await one<ThesisRevisionRow>(client, context, operation, THESIS_SQL.get, [
      revisionId,
    ])
    if (!row) return null
    return (await hydrate(client, [row], operation))[0]!
  }

  return {
    get: (revisionId) =>
      unitOfWork(scope, 'theses.get', (client) =>
        readOne(client, revisionId, 'theses.get'),
      ),

    listForCase: (caseId) =>
      unitOfWork(scope, 'theses.listForCase', async (client) => {
        const rows = await run<ThesisRevisionRow>(
          client,
          context,
          'theses.listForCase',
          THESIS_SQL.listForCase,
          [caseId],
        )
        return hydrate(client, rows, 'theses.listForCase')
      }),

    save: (revision) =>
      unitOfWork(scope, 'theses.save', async (client) => {
        await run(client, context, 'theses.save', THESIS_SQL.save, [
          revision.revisionId,
          revision.thesisId,
          revision.revisionNumber,
          revision.supersedesRevisionId ?? null,
          revision.caseId,
          revision.statement,
          revision.position,
          revision.lifecycle,
          revision.invalidationCriteria,
          revision.horizon ?? null,
          [...revision.implications],
          revision.proposedByDepartmentId,
          /* Exactly one principal; the other column stays null. */
          revision.proposedByEmployeeId ?? null,
          revision.proposedByAgentPrincipalId ?? null,
          revision.proposedAt,
          revision.revisedAt ?? null,
          revision.revisionReason ?? null,
          revision.aggregationId ?? null,
          revision.revisionCause,
        ])

        for (const [relation, ids] of [
          ['supporting', revision.supportingClaimIds],
          ['opposing', revision.opposingClaimIds],
          ['cites', revision.citedByClaimIds],
        ] as const) {
          if (ids.length > 0) {
            await run(client, context, 'theses.save', THESIS_SQL.saveLinks, [
              revision.revisionId,
              [...ids],
              relation,
            ])
          }
        }
        return (await readOne(client, revision.revisionId, 'theses.save'))!
      }),
  }
}

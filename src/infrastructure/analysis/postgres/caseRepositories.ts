/**
 * Cases and thesis revisions.
 *
 * ## Why the statements live in a frozen catalogue
 *
 * `StorageProvenance.queryCatalogHash` answers "which SQL produced this
 * analysis", years later. It is computable only if every statement the adapter
 * can issue is enumerable, which is a structural property — retrofitting it
 * once SQL is inlined at forty call sites is a refactor of the whole adapter.
 * See D-S20.
 *
 * ## `COLLATE "C"`
 *
 * Byte order, matching the in-memory comparator. The test cluster collates
 * `Swedish_Sweden.1252`, where `å` sorts after `z`; a JS runtime sorts it
 * elsewhere. Ids are ASCII today, so this changes nothing observable and
 * removes an environment-dependent divergence before stage 4 has to find it.
 */

import { ConcurrencyConflictError } from '~/application/analysis/repositories'
import type {
  CaseRepository,
  ThesisRepository,
} from '~/application/analysis/repositories'
import type { InvestmentCase, InvestmentThesis } from '~/domain/analysis'
import { toCase, toThesis } from './mapping'
import type {
  CaseParticipantRow,
  CaseRow,
  ThesisClaimLinkRow,
  ThesisRevisionRow,
  TransitionEventRow,
} from './rows'
import { catalog, one, run, ts, type SqlContext } from './sql'
import { activeClient, type Scope } from './transaction'

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

  // opened_at DESC, then id — the port's contract.
  list: `SELECT ${CASE_COLUMNS} FROM analysis.cases
         ORDER BY opened_at DESC, id COLLATE "C"`,

  participants: `SELECT case_id, department_id FROM analysis.case_participants
                 WHERE case_id = ANY($1::text[])
                 ORDER BY case_id COLLATE "C", department_id COLLATE "C"`,

  /*
   * The movement history. Projected rather than stored: two copies of one
   * history are two things that can disagree, and this table is the one with
   * append-only permissions behind it.
   */
  transitions: `SELECT ${TRANSITION_COLUMNS} FROM analysis.transition_events
                WHERE case_id = ANY($1::text[]) AND subject = 'case'
                ORDER BY occurred_at, event_id COLLATE "C"`,

  // Idempotent on id: a replayed open-case command returns the existing case.
  create: `INSERT INTO analysis.cases
             (id, tenant_id, version, owner_employee_id, subject_kind, subject_ref,
              subject_display_name, question, stage, opened_at, closed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (id) DO NOTHING`,

  addParticipants: `INSERT INTO analysis.case_participants (case_id, department_id)
                    SELECT $1, unnest($2::text[])
                    ON CONFLICT DO NOTHING`,

  /*
   * Only the three columns `finos_app` holds an UPDATE grant for. A blanket
   * SET would be denied — and would also be able to rewrite the question the
   * case was opened to answer, which is what the case IS.
   */
  save: `UPDATE analysis.cases SET stage = $2, version = $3, closed_at = $4
         WHERE id = $1 AND version = $5
         RETURNING version`,

  currentVersion: `SELECT version FROM analysis.cases WHERE id = $1`,
})

/** Groups child rows by their parent id, so hydration never queries in a loop. */
function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
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
   * Hydrates any number of cases in three statements.
   *
   * One for the cases, one for every participant, one for every transition —
   * `= ANY` rather than a join, because participants and transitions are
   * collections: a join would return their Cartesian product and repeat every
   * case column once per combination.
   */
  async function hydrate(rows: CaseRow[], operation: string): Promise<InvestmentCase[]> {
    if (rows.length === 0) return []
    const client = activeClient(scope, operation)
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

  return {
    async get(caseId) {
      const client = activeClient(scope, 'cases.get')
      const row = await one<CaseRow>(client, context, 'cases.get', CASE_SQL.get, [caseId])
      if (!row) return null
      return (await hydrate([row], 'cases.get'))[0]!
    },

    async list() {
      const client = activeClient(scope, 'cases.list')
      const rows = await run<CaseRow>(client, context, 'cases.list', CASE_SQL.list)
      return hydrate(rows, 'cases.list')
    },

    async create(investmentCase) {
      const client = activeClient(scope, 'cases.create')
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
      if (investmentCase.participatingDepartmentIds.length > 0) {
        await run(client, context, 'cases.create', CASE_SQL.addParticipants, [
          investmentCase.id,
          [...investmentCase.participatingDepartmentIds],
        ])
      }
      /*
       * Re-read rather than echo the argument. `ON CONFLICT DO NOTHING` means
       * a replay wrote nothing, and the caller is entitled to the case that
       * actually exists — which is the in-memory adapter's behaviour too.
       */
      return (await this.get(investmentCase.id))!
    },

    async save(investmentCase, expectedVersion) {
      const client = activeClient(scope, 'cases.save')
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
        ],
      )

      if (updated.length === 0) {
        /*
         * Zero rows means either the version moved or the case is gone. The
         * extra read is what lets the error say which — worth one statement on
         * a path that is already failing.
         */
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

      if (investmentCase.participatingDepartmentIds.length > 0) {
        await run(client, context, 'cases.save', CASE_SQL.addParticipants, [
          investmentCase.id,
          [...investmentCase.participatingDepartmentIds],
        ])
      }
      return (await this.get(investmentCase.id))!
    },
  }
}

/* ---------------------------------------------------------------- theses */

const REVISION_COLUMNS = `
  revision_id, thesis_id, revision_number, supersedes_revision_id, case_id,
  statement, position, lifecycle, invalidation_criteria, horizon,
  proposed_by_department_id, proposed_by_employee_id,
  ${ts('proposed_at')}, ${ts('revised_at')}, revision_reason
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
            proposed_by_department_id, proposed_by_employee_id, proposed_at,
            revised_at, revision_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
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
    rows: ThesisRevisionRow[],
    operation: string,
  ): Promise<InvestmentThesis[]> {
    if (rows.length === 0) return []
    const client = activeClient(scope, operation)
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

  return {
    async get(revisionId) {
      const client = activeClient(scope, 'theses.get')
      const row = await one<ThesisRevisionRow>(
        client,
        context,
        'theses.get',
        THESIS_SQL.get,
        [revisionId],
      )
      if (!row) return null
      return (await hydrate([row], 'theses.get'))[0]!
    },

    async listForCase(caseId) {
      const client = activeClient(scope, 'theses.listForCase')
      const rows = await run<ThesisRevisionRow>(
        client,
        context,
        'theses.listForCase',
        THESIS_SQL.listForCase,
        [caseId],
      )
      return hydrate(rows, 'theses.listForCase')
    },

    async save(revision) {
      const client = activeClient(scope, 'theses.save')
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
        revision.proposedByDepartmentId,
        revision.proposedByEmployeeId,
        revision.proposedAt,
        revision.revisedAt ?? null,
        revision.revisionReason ?? null,
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
      return (await this.get(revision.revisionId))!
    },
  }
}

export { groupBy }

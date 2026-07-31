/**
 * Playbook versions and conditional-requirement resolutions.
 *
 * Both are append-only, and both are append-only for the same reason: a case
 * pins the workflow it started under, and a governance gate that applied to a
 * specific argument applied to that argument forever. Editing either in place
 * would rewrite what a past decision was made against.
 *
 * The runtime holds `SELECT, INSERT` on every table here and no `UPDATE`, so
 * the guarantee is enforced by the database rather than by this file's good
 * intentions.
 */

import { ConflictingRecordError } from '~/application/analysis/repositories'
import type {
  PlaybookRepository,
  RequirementRepository,
} from '~/application/analysis/repositories'
import {
  requirementResolutionIdentity,
  requirementResolutionSemanticKey,
} from '~/application/analysis/writeOnce'
import {
  playbookContentHash,
  type CasePlaybook,
  type PlaybookEntry,
} from '~/application/analysis/playbooks'
import type { RequirementResolution } from '~/domain/analysis'
import { toRequirementResolution } from './mapping'
import { seal } from '../seal'
import { ensureProvenance } from './provenance'
import type {
  PlaybookEntryDependencyRow,
  PlaybookEntryRow,
  PlaybookVersionRow,
  RequirementResolutionRow,
} from './rows'
import { catalog, one, run, ts, type Queryable, type SqlContext } from './sql'
import { unitOfWork, type Scope } from './transaction'

/* ------------------------------------------------------------- playbooks */

export const PLAYBOOK_SQL = catalog({
  version: `SELECT playbook_id, version, content_hash,
                   p.case_kind, p.name
            FROM analysis.playbook_versions v
            JOIN analysis.playbooks p ON p.id = v.playbook_id
            WHERE v.playbook_id = $1 AND v.version = $2`,

  /** `priority DESC, entry_key` — the port's contract, matched in memory. */
  entries: `SELECT entry_key, department_id, brief, requirement, priority,
                   discipline_tag, conditional_rule_id, conditional_rule_version
            FROM analysis.playbook_entries
            WHERE playbook_id = $1 AND version = $2
            ORDER BY priority DESC, entry_key COLLATE "C"`,

  dependencies: `SELECT entry_key, depends_on, kind
                 FROM analysis.playbook_entry_dependencies
                 WHERE playbook_id = $1 AND version = $2
                 ORDER BY entry_key COLLATE "C", kind COLLATE "C",
                          depends_on COLLATE "C"`,

  /*
   * The playbook header is shared by every version, so a second version of an
   * existing playbook must not fail on it. The version row is where identity
   * is enforced.
   */
  upsertPlaybook: `INSERT INTO analysis.playbooks (id, case_kind, name)
                   VALUES ($1,$2,$3)
                   ON CONFLICT (id) DO NOTHING`,

  insertVersion: `INSERT INTO analysis.playbook_versions
                    (playbook_id, version, content_hash)
                  VALUES ($1,$2,$3)
                  ON CONFLICT (playbook_id, version) DO NOTHING`,

  insertEntry: `INSERT INTO analysis.playbook_entries
                  (playbook_id, version, entry_key, department_id, brief,
                   requirement, priority, discipline_tag,
                   conditional_rule_id, conditional_rule_version)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                ON CONFLICT (playbook_id, version, entry_key) DO NOTHING`,

  insertDependency: `INSERT INTO analysis.playbook_entry_dependencies
                       (playbook_id, version, entry_key, depends_on, kind)
                     VALUES ($1,$2,$3,$4,$5)
                     ON CONFLICT (playbook_id, version, entry_key, depends_on)
                       DO NOTHING`,
})

function toPlaybook(
  version: PlaybookVersionRow,
  entryRows: readonly PlaybookEntryRow[],
  dependencyRows: readonly PlaybookEntryDependencyRow[],
): CasePlaybook {
  const edges = (key: string, kind: string) =>
    dependencyRows
      .filter((row) => row.entry_key === key && row.kind === kind)
      .map((row) => row.depends_on)

  const entries: PlaybookEntry[] = entryRows.map((row) => ({
    key: row.entry_key,
    departmentId: row.department_id,
    brief: row.brief,
    blockedBy: edges(row.entry_key, 'blocking'),
    optionalInputs: edges(row.entry_key, 'optional-input'),
    requirement: row.requirement as PlaybookEntry['requirement'],
    ...(row.conditional_rule_id && row.conditional_rule_version
      ? {
          conditionalRule: {
            ruleId: row.conditional_rule_id,
            ruleVersion: row.conditional_rule_version,
          },
        }
      : {}),
    priority: row.priority,
    ...(row.discipline_tag ? { disciplineTag: row.discipline_tag } : {}),
  }))

  // Sealed, like every other value leaving an adapter: rows arrive as freshly
  // allocated mutable objects and nothing mutable reaches application code.
  return seal(
    {
      id: version.playbook_id,
      version: version.version,
      caseKind: version.case_kind,
      name: version.name,
      entries,
    },
    'playbooks',
  )
}

export function createPlaybookRepository(
  scope: Scope,
  context: SqlContext,
): PlaybookRepository {
  async function read(
    client: Queryable,
    playbookId: string,
    version: string,
    operation: string,
  ): Promise<CasePlaybook | null> {
    const versionRow = await one<PlaybookVersionRow>(
      client,
      context,
      operation,
      PLAYBOOK_SQL.version,
      [playbookId, version],
    )
    if (!versionRow) return null

    const [entryRows, dependencyRows] = await Promise.all([
      run<PlaybookEntryRow>(client, context, operation, PLAYBOOK_SQL.entries, [
        playbookId,
        version,
      ]),
      run<PlaybookEntryDependencyRow>(
        client,
        context,
        operation,
        PLAYBOOK_SQL.dependencies,
        [playbookId, version],
      ),
    ])

    return toPlaybook(versionRow, entryRows, dependencyRows)
  }

  return {
    get: (playbookId, version) =>
      unitOfWork(scope, 'playbooks.get', (client) =>
        read(client, playbookId, version, 'playbooks.get'),
      ),

    register: (playbook) =>
      unitOfWork(scope, 'playbooks.register', async (client) => {
        const contentHash = playbookContentHash(playbook)

        /*
         * Compared against the STORED hash rather than against the
         * reconstructed playbook. Rebuilding and re-hashing would compare this
         * build's mapping code with itself, and a mapping bug would then read
         * as agreement.
         */
        const existingVersion = await one<PlaybookVersionRow>(
          client,
          context,
          'playbooks.register',
          PLAYBOOK_SQL.version,
          [playbook.id, playbook.version],
        )
        if (existingVersion) {
          if (existingVersion.content_hash !== contentHash) {
            throw new ConflictingRecordError(
              'Playbook version',
              `${playbook.id}|${playbook.version}`,
              'playbooks.register',
            )
          }
          return (await read(
            client,
            playbook.id,
            playbook.version,
            'playbooks.register',
          ))!
        }

        await run(client, context, 'playbooks.register', PLAYBOOK_SQL.upsertPlaybook, [
          playbook.id,
          playbook.caseKind,
          playbook.name,
        ])
        await run(client, context, 'playbooks.register', PLAYBOOK_SQL.insertVersion, [
          playbook.id,
          playbook.version,
          contentHash,
        ])

        for (const entry of playbook.entries) {
          await run(client, context, 'playbooks.register', PLAYBOOK_SQL.insertEntry, [
            playbook.id,
            playbook.version,
            entry.key,
            entry.departmentId,
            entry.brief,
            entry.requirement,
            entry.priority,
            entry.disciplineTag ?? null,
            entry.conditionalRule?.ruleId ?? null,
            entry.conditionalRule?.ruleVersion ?? null,
          ])
        }

        /*
         * Edges after every entry exists — they are foreign keys onto entries
         * in the same version, and an entry may depend on one declared later
         * in the list.
         */
        for (const entry of playbook.entries) {
          for (const [kind, keys] of [
            ['blocking', entry.blockedBy],
            ['optional-input', entry.optionalInputs],
          ] as const) {
            for (const dependsOn of keys) {
              await run(
                client,
                context,
                'playbooks.register',
                PLAYBOOK_SQL.insertDependency,
                [playbook.id, playbook.version, entry.key, dependsOn, kind],
              )
            }
          }
        }

        return (await read(client, playbook.id, playbook.version, 'playbooks.register'))!
      }),
  }
}

/* ------------------------------------------------- requirement resolutions */

const RESOLUTION_COLUMNS = `
  case_id, playbook_entry_key, revision_id, state, rule_id, rule_version,
  reason, ${ts('evaluated_at')},
  evaluated_by_employee_id, evaluated_by_role_id, evaluated_by_role_function,
  evaluated_by_department_id, evaluated_by_department_is_governance,
  evaluated_by_department_handles, evaluated_by_authentication,
  organization_seed_version
`

export const REQUIREMENT_SQL = catalog({
  get: `SELECT ${RESOLUTION_COLUMNS} FROM analysis.requirement_resolutions
        WHERE case_id = $1 AND playbook_entry_key = $2 AND revision_id = $3`,

  /** `playbookEntryKey`, then `revisionId` — the port's stated ordering. */
  listForCase: `SELECT ${RESOLUTION_COLUMNS} FROM analysis.requirement_resolutions
                WHERE case_id = $1
                ORDER BY playbook_entry_key COLLATE "C", revision_id COLLATE "C"`,

  /*
   * `DO NOTHING` rather than `DO UPDATE`: the row is write-once, and the
   * caller has already compared the stored content. A conflicting write is
   * refused above with a named error rather than silently ignored here.
   */
  save: `INSERT INTO analysis.requirement_resolutions
           (case_id, tenant_id, playbook_entry_key, revision_id, state,
            rule_id, rule_version, reason, input_hash, evaluated_at,
            evaluated_by_employee_id, evaluated_by_role_id,
            evaluated_by_role_function, evaluated_by_department_id,
            evaluated_by_department_is_governance,
            evaluated_by_department_handles, evaluated_by_authentication,
            organization_seed_version, provenance_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (case_id, playbook_entry_key, revision_id) DO NOTHING`,
})

export function createRequirementRepository(
  scope: Scope,
  context: SqlContext,
  tenantId: string,
): RequirementRepository {
  return {
    listForCase: (caseId) =>
      unitOfWork(scope, 'requirements.listForCase', async (client) => {
        const rows = await run<RequirementResolutionRow>(
          client,
          context,
          'requirements.listForCase',
          REQUIREMENT_SQL.listForCase,
          [caseId],
        )
        return rows.map(toRequirementResolution)
      }),

    save: (resolution: RequirementResolution, provenance) =>
      unitOfWork(scope, 'requirements.save', async (client) => {
        const existing = await one<RequirementResolutionRow>(
          client,
          context,
          'requirements.save',
          REQUIREMENT_SQL.get,
          [resolution.caseId, resolution.playbookEntryKey, resolution.revisionId],
        )
        /*
         * The resolution owns its foreign key, for the same reason the ledger
         * does: nothing may write a record whose provenance row is missing,
         * and requiring the caller to have written it first would make an
         * ordering rule out of something the store can guarantee.
         */
        await ensureProvenance(client, context, provenance, resolution.evaluatedAt)

        if (existing) {
          const stored = toRequirementResolution(existing)
          if (
            requirementResolutionSemanticKey(stored) !==
            requirementResolutionSemanticKey(resolution)
          ) {
            throw new ConflictingRecordError(
              'Requirement resolution',
              requirementResolutionIdentity(resolution),
              'requirements.save',
            )
          }
          return stored
        }

        await run(client, context, 'requirements.save', REQUIREMENT_SQL.save, [
          resolution.caseId,
          tenantId,
          resolution.playbookEntryKey,
          resolution.revisionId,
          resolution.state,
          resolution.ruleId,
          resolution.ruleVersion,
          resolution.reason,
          resolution.inputHash,
          resolution.evaluatedAt,
          resolution.evaluatedBy.employeeId,
          resolution.evaluatedBy.roleId,
          resolution.evaluatedBy.roleFunction,
          resolution.evaluatedBy.departmentId,
          resolution.evaluatedBy.departmentIsGovernance,
          [...resolution.evaluatedBy.departmentHandles],
          resolution.evaluatedBy.authentication,
          resolution.evaluatedBy.organizationSeedVersion,
          provenance.provenanceId,
        ])

        return resolution
      }),
  }
}

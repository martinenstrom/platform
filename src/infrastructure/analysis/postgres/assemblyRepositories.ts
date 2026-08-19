/**
 * The assembly acts, in PostgreSQL.
 *
 * Append-only, keyed on `assembly_id` — which is derived from the command id,
 * so a retry addresses the same record rather than filing a second act nobody
 * performed. Migration `0033` grants only SELECT and INSERT: a record of what a
 * person did that could be edited afterwards is not a record of what they did.
 *
 * `ON CONFLICT DO NOTHING`, then read back. The same pattern the observation
 * store follows, and for the same reason — only a read says what is actually
 * held under the key.
 *
 * **Different content under the same key is a real disagreement**, unlike an
 * observation whose content hash is part of its key. Two different assemblies
 * cannot share a command id, so a conflict with differing content means two
 * acts were filed under one identity, and returning the stored one silently
 * would hide it. It is reported rather than absorbed.
 */

import type { EvidenceAssemblyRepository } from '~/application/analysis/repositories'
import { ConflictingRecordError } from '~/application/analysis/repositories'
import { sameAssemblyAct } from '~/domain/analysis'
import { toEvidenceAssembly } from './mapping'
import { ensureProvenance } from './provenance'
import type { EvidenceAssemblyRow } from './rows'
import { catalog, one, run, ts, type Queryable, type SqlContext } from './sql'
import { unitOfWork, type Scope } from './transaction'

const COLUMNS = `assembly_id, evidence_set_id, rule_id, subject_family,
                 window_from, window_to, ${ts('known_at')},
                 selected_subjects, observation_count, derived_count,
                 ${ts('assembled_at')}, actor_employee_id,
                 on_behalf_of_department_id, correlation_id`

export const ASSEMBLY_SQL = catalog({
  get: `SELECT ${COLUMNS}
        FROM analysis.evidence_assemblies
        WHERE assembly_id = $1`,

  /**
   * Every act that produced one set, newest first.
   *
   * Plural by construction: a set is content-addressed on membership, so two
   * selections that pick the same observations are one artifact reached by two
   * acts. `assembly_id COLLATE "C"` breaks a tie, because an order that depends
   * on the server's collation is not an order.
   */
  forSet: `SELECT ${COLUMNS}
           FROM analysis.evidence_assemblies
           WHERE evidence_set_id = $1
           ORDER BY assembled_at DESC, assembly_id COLLATE "C" DESC`,

  list: `SELECT ${COLUMNS}
         FROM analysis.evidence_assemblies
         ORDER BY assembled_at DESC, assembly_id COLLATE "C" DESC
         LIMIT $1`,

  record: `INSERT INTO analysis.evidence_assemblies
             (assembly_id, evidence_set_id, rule_id, subject_family,
              window_from, window_to, known_at, selected_subjects,
              observation_count, derived_count, assembled_at,
              actor_employee_id, on_behalf_of_department_id, correlation_id,
              provenance_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::text[],
                   $9::integer, $10::integer, $11::timestamptz, $12, $13, $14,
                   $15)
           ON CONFLICT (assembly_id) DO NOTHING`,
})

export function createEvidenceAssemblyRepository(
  scope: Scope,
  context: SqlContext,
): EvidenceAssemblyRepository {
  async function readOne(client: Queryable, assemblyId: string, operation: string) {
    const row = await one<EvidenceAssemblyRow>(
      client,
      context,
      operation,
      ASSEMBLY_SQL.get,
      [assemblyId],
    )
    return row ? toEvidenceAssembly(row) : null
  }

  return {
    record: (assembly, provenance) =>
      unitOfWork(scope, 'assemblies.record', async (client) => {
        await ensureProvenance(client, context, provenance, assembly.assembledAt)

        await run(client, context, 'assemblies.record', ASSEMBLY_SQL.record, [
          assembly.assemblyId,
          assembly.evidenceSetId,
          assembly.selection.ruleId,
          assembly.selection.subjectFamily,
          assembly.selection.from,
          assembly.selection.to,
          assembly.selection.knownAt,
          [...assembly.selectedSubjects],
          String(assembly.observationCount),
          String(assembly.derivedCount),
          assembly.assembledAt,
          assembly.actorEmployeeId,
          assembly.onBehalfOfDepartmentId,
          assembly.correlationId,
          provenance.provenanceId,
        ])

        const stored = (await readOne(client, assembly.assemblyId, 'assemblies.record'))!
        /*
         * A benign replay returns the stored act. A DIFFERENT act under the same
         * id is two judgements filed under one name, and the store says so
         * rather than picking one — the rule `ConflictingRecordError` exists for.
         */
        if (!sameAssemblyAct(stored, assembly)) {
          throw new ConflictingRecordError(
            'Evidence assembly',
            assembly.assemblyId,
            'assemblies.record',
            assembly.correlationId,
          )
        }
        return stored
      }),

    get: (assemblyId) =>
      unitOfWork(scope, 'assemblies.get', (client) =>
        readOne(client, assemblyId, 'assemblies.get'),
      ),

    forSet: (evidenceSetId) =>
      unitOfWork(scope, 'assemblies.forSet', async (client) => {
        const rows = await run<EvidenceAssemblyRow>(
          client,
          context,
          'assemblies.forSet',
          ASSEMBLY_SQL.forSet,
          [evidenceSetId],
        )
        return rows.map(toEvidenceAssembly)
      }),

    list: (limit) =>
      unitOfWork(scope, 'assemblies.list', async (client) => {
        const rows = await run<EvidenceAssemblyRow>(
          client,
          context,
          'assemblies.list',
          ASSEMBLY_SQL.list,
          [limit],
        )
        return rows.map(toEvidenceAssembly)
      }),
  }
}

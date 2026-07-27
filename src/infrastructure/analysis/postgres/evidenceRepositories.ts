/**
 * Evidence sets, stored results and idempotency keys.
 *
 * All three are content-addressed or key-addressed and written once. The
 * pattern is the same throughout: `ON CONFLICT DO NOTHING`, then read what is
 * actually there — which is what makes a replay return the original rather
 * than a value the caller happened to pass in.
 */

import {
  ConflictingRecordError,
  type EvidenceRepository,
  type IdempotencyStore,
} from '~/application/analysis/repositories'
import type { ResultStore } from '~/application/analysis/resultStore'
import { toEvidenceSet, toStoredResult } from './mapping'
import type {
  AgentResultRow,
  EvidenceItemRow,
  EvidenceSetRow,
  IdempotencyKeyRow,
} from './rows'
import { catalog, one, run, ts, type SqlContext } from './sql'
import { activeClient, type Scope } from './transaction'

/* ---------------------------------------------------------------- evidence */

export const EVIDENCE_SQL = catalog({
  get: `SELECT id, ${ts('assembled_at')}, correlation_id, co_temporality, disagreements
        FROM analysis.evidence_sets WHERE id = $1`,

  items: `SELECT evidence_set_id, observation_id, subject_kind, subject, kind,
                 ${ts('observed_at')}, source_id, series_id, methodology,
                 content_hash, value, provenance
          FROM analysis.evidence_items WHERE evidence_set_id = $1
          ORDER BY observation_id COLLATE "C"`,

  /*
   * The id IS the hash of the contents, so a conflict means this exact set is
   * already stored. There is nothing an update could legitimately do.
   */
  save: `INSERT INTO analysis.evidence_sets
           (id, assembled_at, correlation_id, co_temporality, disagreements)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,

  saveItem: `INSERT INTO analysis.evidence_items
               (evidence_set_id, observation_id, subject_kind, subject, kind,
                observed_at, source_id, series_id, methodology, content_hash,
                value, provenance)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             ON CONFLICT DO NOTHING`,
})

export function createEvidenceRepository(
  scope: Scope,
  context: SqlContext,
): EvidenceRepository {
  return {
    async get(setId) {
      const client = activeClient(scope, 'evidence.get')
      const row = await one<EvidenceSetRow>(
        client,
        context,
        'evidence.get',
        EVIDENCE_SQL.get,
        [setId],
      )
      if (!row) return null
      const items = await run<EvidenceItemRow>(
        client,
        context,
        'evidence.get',
        EVIDENCE_SQL.items,
        [setId],
      )
      // Recomputes and verifies the content hash. See `toEvidenceSet`.
      return toEvidenceSet(row, items)
    },

    async save(set) {
      const client = activeClient(scope, 'evidence.save')
      const existing = await this.get(set.id)
      if (existing) return existing

      await run(client, context, 'evidence.save', EVIDENCE_SQL.save, [
        set.id,
        set.assembledAt,
        set.correlationId,
        JSON.stringify(set.coTemporality),
        JSON.stringify(set.disagreements),
      ])

      for (const item of set.items) {
        await run(client, context, 'evidence.save', EVIDENCE_SQL.saveItem, [
          set.id,
          item.ref.id,
          item.ref.subjectKind,
          item.ref.subject,
          item.ref.kind,
          item.ref.observedAt,
          item.ref.sourceId,
          item.ref.seriesId ?? null,
          item.ref.methodology ?? null,
          item.ref.contentHash,
          JSON.stringify(item.value ?? null),
          JSON.stringify(item.provenance ?? {}),
        ])
      }
      return (await this.get(set.id))!
    },
  }
}

/* ----------------------------------------------------------------- results */

export const RESULT_SQL = catalog({
  get: `SELECT key, claims, ${ts('stored_at')}, inputs
        FROM analysis.agent_results WHERE key = $1`,

  save: `INSERT INTO analysis.agent_results (key, claims, stored_at, inputs)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO NOTHING`,
})

export function createResultStore(scope: Scope, context: SqlContext): ResultStore {
  return {
    async get(key) {
      const client = activeClient(scope, 'results.get')
      const row = await one<AgentResultRow>(
        client,
        context,
        'results.get',
        RESULT_SQL.get,
        [key],
      )
      return row ? toStoredResult(row) : null
    },

    async put(result) {
      const client = activeClient(scope, 'results.put')
      const existing = await this.get(result.key)
      if (existing) {
        /*
         * The key covers every semantic input, so the same key holding a
         * different result means one of those inputs is not in the key — a
         * fault worth hearing about rather than overwriting.
         */
        if (JSON.stringify(existing.claims) !== JSON.stringify(result.claims)) {
          throw new ConflictingRecordError('Agent result', result.key, 'results.put')
        }
        return existing
      }

      await run(client, context, 'results.put', RESULT_SQL.save, [
        result.key,
        JSON.stringify(result.claims),
        result.storedAt,
        JSON.stringify(result.inputs),
      ])
      return (await this.get(result.key))!
    },
  }
}

/* ------------------------------------------------------------- idempotency */

export const IDEMPOTENCY_SQL = catalog({
  get: `SELECT key, command_type, result_ref, ${ts('created_at')}
        FROM analysis.idempotency_keys WHERE key = $1`,

  /*
   * `DO NOTHING` then re-read, rather than `DO UPDATE … RETURNING`. Two
   * reasons, and either alone would be sufficient: the runtime holds no UPDATE
   * grant on this table, and the re-read is only correct under READ COMMITTED,
   * where each statement takes a fresh snapshot and can therefore see the row
   * a concurrent transaction just committed.
   */
  reserve: `INSERT INTO analysis.idempotency_keys
              (key, command_type, result_ref, created_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (key) DO NOTHING`,
})

export function createIdempotencyStore(
  scope: Scope,
  context: SqlContext,
): IdempotencyStore {
  return {
    async get(key) {
      const client = activeClient(scope, 'idempotency.get')
      const row = await one<IdempotencyKeyRow>(
        client,
        context,
        'idempotency.get',
        IDEMPOTENCY_SQL.get,
        [key],
      )
      return row
        ? {
            key: row.key,
            commandType: row.command_type,
            resultRef: row.result_ref,
            createdAt: row.created_at,
          }
        : null
    },

    async reserve(record) {
      const client = activeClient(scope, 'idempotency.reserve')
      await run(client, context, 'idempotency.reserve', IDEMPOTENCY_SQL.reserve, [
        record.key,
        record.commandType,
        record.resultRef,
        record.createdAt,
      ])
      /*
       * Always the stored record, never the argument. A held key returns its
       * ORIGINAL `result_ref`, which is how a replay returns the first result
       * instead of producing a second effect.
       */
      return (await this.get(record.key))!
    },
  }
}

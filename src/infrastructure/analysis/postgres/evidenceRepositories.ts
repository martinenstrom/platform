/**
 * Evidence sets, stored results and idempotency keys.
 *
 * All three are content- or key-addressed and written once. The pattern is the
 * same throughout: `ON CONFLICT DO NOTHING`, then read what is actually there
 * — which is what makes a replay return the original rather than a value the
 * caller happened to pass in.
 *
 * A collision is not automatically a replay. Where the stored record differs
 * from the incoming one, `ConflictingRecordError` is raised, using the same
 * comparison the in-memory adapter uses.
 */

import {
  ConflictingRecordError,
  type EvidenceRepository,
  type IdempotencyStore,
} from '~/application/analysis/repositories'
import type { ResultStore } from '~/application/analysis/resultStore'
import {
  evidenceSetSemanticKey,
  resultSemanticKey,
} from '~/application/analysis/writeOnce'
import { toEvidenceSet, toStoredResult } from './mapping'
import type {
  AgentResultRow,
  EvidenceItemRow,
  EvidenceSetRow,
  IdempotencyKeyRow,
} from './rows'
import { catalog, one, run, ts, type Queryable, type SqlContext } from './sql'
import { singleStatement, unitOfWork, type Scope } from './transaction'

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
   * The id IS the hash of the composition, so a conflict means this set is
   * already stored. There is nothing an update could legitimately do.
   */
  save: `INSERT INTO analysis.evidence_sets
           (id, assembled_at, correlation_id, co_temporality, disagreements)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,

  /** One statement for the whole set, rather than one round trip per item. */
  saveItems: `INSERT INTO analysis.evidence_items
                (evidence_set_id, observation_id, subject_kind, subject, kind,
                 observed_at, source_id, series_id, methodology, content_hash,
                 value, provenance)
              SELECT $1, o, sk, s, k, ob::timestamptz, src, ser, m, h,
                     v::jsonb, p::jsonb
              FROM unnest($2::text[], $3::text[], $4::text[], $5::text[],
                          $6::text[], $7::text[], $8::text[], $9::text[],
                          $10::text[], $11::text[], $12::text[])
                   AS batch(o, sk, s, k, ob, src, ser, m, h, v, p)
              ON CONFLICT DO NOTHING`,
})

export function createEvidenceRepository(
  scope: Scope,
  context: SqlContext,
): EvidenceRepository {
  async function readOne(client: Queryable, setId: string, operation: string) {
    const row = await one<EvidenceSetRow>(client, context, operation, EVIDENCE_SQL.get, [
      setId,
    ])
    if (!row) return null
    const items = await run<EvidenceItemRow>(
      client,
      context,
      operation,
      EVIDENCE_SQL.items,
      [setId],
    )
    // Recomputes and verifies the content hash. See `toEvidenceSet`.
    return toEvidenceSet(row, items)
  }

  return {
    get: (setId) =>
      unitOfWork(scope, 'evidence.get', (client) =>
        readOne(client, setId, 'evidence.get'),
      ),

    save: (set) =>
      unitOfWork(scope, 'evidence.save', async (client) => {
        const existing = await readOne(client, set.id, 'evidence.save')
        if (existing) {
          /*
           * The id hashes the COMPOSITION, not the payloads, so two sets can
           * share an id and hold different values. Comparing the payloads is
           * what makes that detectable rather than silently accepted.
           */
          if (evidenceSetSemanticKey(existing) !== evidenceSetSemanticKey(set)) {
            throw new ConflictingRecordError('Evidence set', set.id, 'evidence.save')
          }
          return existing
        }

        await run(client, context, 'evidence.save', EVIDENCE_SQL.save, [
          set.id,
          set.assembledAt,
          set.correlationId,
          JSON.stringify(set.coTemporality),
          JSON.stringify(set.disagreements),
        ])

        if (set.items.length > 0) {
          const items = [...set.items]
          await run(client, context, 'evidence.save', EVIDENCE_SQL.saveItems, [
            set.id,
            items.map((item) => item.ref.id),
            items.map((item) => item.ref.subjectKind),
            items.map((item) => item.ref.subject),
            items.map((item) => item.ref.kind),
            items.map((item) => item.ref.observedAt),
            items.map((item) => item.ref.sourceId),
            items.map((item) => item.ref.seriesId ?? null),
            items.map((item) => item.ref.methodology ?? null),
            items.map((item) => item.ref.contentHash),
            items.map((item) => JSON.stringify(item.value ?? null)),
            items.map((item) => JSON.stringify(item.provenance ?? {})),
          ])
        }
        return (await readOne(client, set.id, 'evidence.save'))!
      }),
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
  const read = async (client: Queryable, key: string, operation: string) => {
    const row = await one<AgentResultRow>(client, context, operation, RESULT_SQL.get, [
      key,
    ])
    return row ? toStoredResult(row) : null
  }

  return {
    /** One statement. */
    async get(key) {
      return read(singleStatement(scope, 'results.get'), key, 'results.get')
    },

    put: (result) =>
      unitOfWork(scope, 'results.put', async (client) => {
        const existing = await read(client, result.key, 'results.put')
        if (existing) {
          /*
           * The key covers every semantic input, so the same key holding a
           * different result means one of those inputs is not in the key — a
           * fault worth hearing about rather than overwriting.
           */
          if (resultSemanticKey(existing) !== resultSemanticKey(result)) {
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
        return (await read(client, result.key, 'results.put'))!
      }),
  }
}

/* ------------------------------------------------------------- idempotency */

export const IDEMPOTENCY_SQL = catalog({
  get: `SELECT key, command_type, result_ref, ${ts('created_at')}
        FROM analysis.idempotency_keys WHERE key = $1`,

  /*
   * `DO NOTHING` then re-read, rather than `DO UPDATE … RETURNING`. Two
   * reasons, either sufficient: the runtime holds no UPDATE grant on this
   * table, and the re-read is only correct under READ COMMITTED, where each
   * statement takes a fresh snapshot and can see the row a concurrent
   * transaction just committed. `unitOfWork` states that level explicitly.
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
  const read = async (client: Queryable, key: string, operation: string) => {
    const row = await one<IdempotencyKeyRow>(
      client,
      context,
      operation,
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
  }

  return {
    /** One statement. */
    async get(key) {
      return read(singleStatement(scope, 'idempotency.get'), key, 'idempotency.get')
    },

    reserve: (record) =>
      unitOfWork(scope, 'idempotency.reserve', async (client) => {
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
        return (await read(client, record.key, 'idempotency.reserve'))!
      }),
  }
}

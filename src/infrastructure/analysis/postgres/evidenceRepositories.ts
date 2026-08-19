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
} from '~/application/analysis/repositories'
import type { ResultStore } from '~/application/analysis/resultStore'
import {
  evidenceSetSemanticKey,
  resultSemanticKey,
} from '~/application/analysis/writeOnce'
import { toEvidenceSet, toStoredResult } from './mapping'
import { ensureProvenance } from './provenance'
import type { AgentResultRow, EvidenceItemRow, EvidenceSetRow } from './rows'
import { catalog, one, run, ts, type Queryable, type SqlContext } from './sql'
import { singleStatement, unitOfWork, type Scope } from './transaction'

/* ---------------------------------------------------------------- evidence */

export const EVIDENCE_SQL = catalog({
  get: `SELECT id, ${ts('assembled_at')}, correlation_id, co_temporality, disagreements
        FROM analysis.evidence_sets WHERE id = $1`,

  /**
   * What the institution holds, newest first.
   *
   * `COLLATE "C"` on the tie-break for the reason every ordering here carries
   * it: an order that varies by the server's collation is not an order.
   */
  list: `SELECT id, ${ts('assembled_at')}, correlation_id, co_temporality, disagreements
         FROM analysis.evidence_sets
         ORDER BY assembled_at DESC, id COLLATE "C" DESC
         LIMIT $1`,

  /*
   * A linked row carries no payload; the observation does. COALESCE reads
   * whichever shape the row is (migration 0032), so hydration branches in SQL
   * rather than leaving both to be reconciled in TypeScript.
   *
   * A LEFT JOIN, not an inner one: a linked row whose observation is missing
   * must reach the mapper as a NULL payload and be refused there by name,
   * rather than vanishing from the set and turning a broken link into a
   * silently smaller body of evidence.
   */
  items: `SELECT i.evidence_set_id, i.observation_id, i.subject_kind, i.subject,
                 i.kind, ${ts('i.observed_at')}, i.source_id, i.series_id,
                 i.methodology, i.key_generation, i.reference_period,
                 i.content_hash, i.links_observation,
                 COALESCE(i.value, o.value) AS value,
                 COALESCE(i.provenance, o.provenance) AS provenance
          FROM analysis.evidence_items i
          LEFT JOIN analysis.observations o
            ON i.links_observation
           AND o.observation_id = i.observation_id
           AND o.content_hash = i.content_hash
          WHERE i.evidence_set_id = $1
          ORDER BY i.observation_id COLLATE "C"`,

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
                 observed_at, source_id, series_id, methodology,
                 key_generation, reference_period, content_hash,
                 links_observation, value, provenance)
              SELECT $1, o, sk, s, k, ob::timestamptz, src, ser, m,
                     kg::smallint, rp, h, lnk::boolean,
                     CASE WHEN lnk::boolean THEN NULL ELSE v::jsonb END,
                     CASE WHEN lnk::boolean THEN NULL ELSE p::jsonb END
              FROM unnest($2::text[], $3::text[], $4::text[], $5::text[],
                          $6::text[], $7::text[], $8::text[], $9::text[],
                          $10::text[], $11::text[], $12::text[], $13::text[],
                          $14::text[], $15::text[])
                   AS batch(o, sk, s, k, ob, src, ser, m, kg, rp, h, v, p, lnk)
              ON CONFLICT DO NOTHING`,
  /**
   * Which of a set's observations the firm actually holds in the store.
   *
   * One statement for the whole set rather than one per item — `queryCount`
   * asserts that saving a set costs a fixed number of statements however many
   * observations it carries, and a per-item existence check would quietly make
   * that false.
   */
  heldObservations: `SELECT observation_id, content_hash
                     FROM analysis.observations
                     WHERE (observation_id, content_hash)
                           IN (SELECT * FROM unnest($1::text[], $2::text[]))`,
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

    list: (limit) =>
      unitOfWork(scope, 'evidence.list', async (client) => {
        const rows = await run<EvidenceSetRow>(
          client,
          context,
          'evidence.list',
          EVIDENCE_SQL.list,
          [limit],
        )
        /*
         * Hydrated one set at a time, through the same reader `get` uses —
         * which recomputes and verifies each content hash. A bulk join that
         * skipped that would let this path return sets the single-set path
         * would refuse, and a listing that trusts what `get` checks is a second
         * standard of admissibility.
         */
        const sets = []
        for (const row of rows) {
          const found = await readOne(client, row.id, 'evidence.list')
          if (found) sets.push(found)
        }
        return sets
      }),

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
          /*
           * An item LINKS when the firm actually holds the observation, and
           * carries its own payload when it does not. Determined from the store
           * rather than declared by the caller: whether the institution holds a
           * fact is a property of the institution, and a caller asserting it
           * would be asserting something it cannot know.
           *
           * A set is written once and is immutable, so this is decided once and
           * never drifts. See migration 0032 and gate §0.3b.
           */
          const held = await run<{ observation_id: string; content_hash: string }>(
            client,
            context,
            'evidence.save',
            EVIDENCE_SQL.heldObservations,
            [items.map((item) => item.ref.id), items.map((item) => item.ref.contentHash)],
          )
          const linked = new Set(
            held.map((row) => `${row.observation_id}|${row.content_hash}`),
          )
          const linksObservation = items.map((item) =>
            linked.has(`${item.ref.id}|${item.ref.contentHash}`),
          )

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
            items.map((item) => String(item.ref.keyGeneration)),
            items.map((item) => item.ref.referencePeriod ?? null),
            items.map((item) => item.ref.contentHash),
            items.map((item) => JSON.stringify(item.value ?? null)),
            items.map((item) => JSON.stringify(item.provenance ?? {})),
            linksObservation.map((flag) => String(flag)),
          ])
        }
        return (await readOne(client, set.id, 'evidence.save'))!
      }),
  }
}

/* ----------------------------------------------------------------- results */

export const RESULT_SQL = catalog({
  get: `SELECT key, claims, ${ts('stored_at')}, inputs, provider_kind
        FROM analysis.agent_results WHERE key = $1`,

  save: `INSERT INTO analysis.agent_results
             (key, claims, stored_at, inputs, provider_kind, provenance_id)
         VALUES ($1, $2, $3, $4, $5, $6)
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

    put: (result, provenance) =>
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

        // The provenance row first, for the same reason a run needs it: the
        // foreign key is what makes "which code wrote this" answerable.
        await ensureProvenance(client, context, provenance, result.storedAt)

        await run(client, context, 'results.put', RESULT_SQL.save, [
          result.key,
          JSON.stringify(result.claims),
          result.storedAt,
          JSON.stringify(result.inputs),
          result.providerKind,
          provenance.provenanceId,
        ])
        return (await read(client, result.key, 'results.put'))!
      }),
  }
}

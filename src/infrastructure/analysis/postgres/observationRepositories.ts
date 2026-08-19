/**
 * Durable observations, in PostgreSQL.
 *
 * Append-only, keyed `(observation_id, content_hash)`. A revision is a second
 * row rather than an overwrite, and that is enforced twice: the primary key
 * cannot be reached by a differing value, and migration `0031` deliberately
 * grants only SELECT and INSERT — the privilege the store does not hold is the
 * one it cannot misuse.
 *
 * `ON CONFLICT DO NOTHING`, then read back what is actually there. The same
 * pattern the evidence repository follows, and for the same reason: a re-poll
 * that finds nothing revised must return the stored record rather than the
 * value the caller happened to pass in.
 *
 * **No conflict comparison here, unlike evidence sets.** An evidence-set id
 * hashes composition rather than payloads, so two sets can share an id and hold
 * different values — which is why `evidence.save` compares semantic keys. An
 * observation's key includes its content hash, so a differing value produces a
 * different row by construction and the collision cannot arise.
 */

import type { ObservationRepository } from '~/application/analysis/repositories'
import type { DurableObservation } from '~/domain/analysis'
import { toObservation } from './mapping'
import { ensureProvenance } from './provenance'
import type { ObservationRow } from './rows'
import { catalog, one, run, ts, type Queryable, type SqlContext } from './sql'
import { unitOfWork, type Scope } from './transaction'

export const OBSERVATION_SQL = catalog({
  get: `SELECT observation_id, content_hash, key_generation, subject_kind, subject,
               kind, source_id, series_id, methodology, reference_period,
               ${ts('observed_at')}, ${ts('recorded_at')}, correlation_id,
               value, provenance
        FROM analysis.observations
        WHERE observation_id = $1 AND content_hash = $2`,

  /** Every version of one fact, oldest first. The revision history. */
  versions: `SELECT observation_id, content_hash, key_generation, subject_kind, subject,
                    kind, source_id, series_id, methodology, reference_period,
                    ${ts('observed_at')}, ${ts('recorded_at')}, correlation_id,
                    value, provenance
             FROM analysis.observations
             WHERE observation_id = $1
             ORDER BY recorded_at, content_hash COLLATE "C"`,

  /**
   * The series: one record per reference period, resolved bitemporally.
   *
   * `DISTINCT ON (reference_period)` with the inner ordering picking the latest
   * version the firm held — which is what makes this a query over individually
   * identifiable observations rather than a stored aggregate. Each row that
   * comes back is a whole observation with its own reference and content hash,
   * so a claim cites the March print rather than the series.
   *
   * `$8` is the knowledge-time bound. NULL means "latest known"; a value means
   * "as the firm knew it then", and a version recorded later is excluded rather
   * than back-dated.
   *
   * `COLLATE "C"` on every text tie-break, for the reason every ordering here
   * carries it: an order that varies by the server's collation is not an order.
   */
  series: `SELECT DISTINCT ON (reference_period COLLATE "C")
                  observation_id, content_hash, key_generation, subject_kind, subject,
                  kind, source_id, series_id, methodology, reference_period,
                  ${ts('observed_at')}, ${ts('recorded_at')}, correlation_id,
                  value, provenance
           FROM analysis.observations
           WHERE subject = $1
             AND kind = $2
             AND source_id = $3
             AND ($4::text IS NULL OR series_id = $4)
             AND ($5::text IS NULL OR methodology = $5)
             AND reference_period IS NOT NULL
             AND reference_period >= $6
             AND reference_period <= $7
             AND ($8::timestamptz IS NULL OR recorded_at <= $8::timestamptz)
           ORDER BY reference_period COLLATE "C",
                    recorded_at DESC,
                    content_hash COLLATE "C" DESC`,

  record: `INSERT INTO analysis.observations
             (observation_id, content_hash, key_generation, subject_kind, subject,
              kind, source_id, series_id, methodology, reference_period,
              observed_at, recorded_at, correlation_id, value, provenance,
              provenance_id)
           SELECT o, h, kg::smallint, sk, s, k, src, ser, m, rp,
                  ob::timestamptz, rec::timestamptz, corr, v::jsonb, p::jsonb, $16
           FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[],
                       $6::text[], $7::text[], $8::text[], $9::text[], $10::text[],
                       $11::text[], $12::text[], $13::text[], $14::text[], $15::text[])
                AS batch(o, h, kg, sk, s, k, src, ser, m, rp, ob, rec, corr, v, p)
           ON CONFLICT (observation_id, content_hash) DO NOTHING
           RETURNING observation_id, content_hash`,
})

export function createObservationRepository(
  scope: Scope,
  context: SqlContext,
): ObservationRepository {
  async function readOne(
    client: Queryable,
    observationId: string,
    contentHash: string,
    operation: string,
  ) {
    const row = await one<ObservationRow>(
      client,
      context,
      operation,
      OBSERVATION_SQL.get,
      [observationId, contentHash],
    )
    return row ? toObservation(row) : null
  }

  return {
    record: (observations, provenance) =>
      unitOfWork(scope, 'observations.record', async (client) => {
        if (observations.length === 0) return []
        await ensureProvenance(client, context, provenance, observations[0]!.recordedAt)

        const items = [...observations]
        const inserted = await run<{ observation_id: string; content_hash: string }>(
          client,
          context,
          'observations.record',
          OBSERVATION_SQL.record,
          [
            items.map((item) => item.ref.id),
            items.map((item) => item.ref.contentHash),
            items.map((item) => String(item.ref.keyGeneration)),
            items.map((item) => item.ref.subjectKind),
            items.map((item) => item.ref.subject),
            items.map((item) => item.ref.kind),
            items.map((item) => item.ref.sourceId),
            items.map((item) => item.ref.seriesId ?? null),
            items.map((item) => item.ref.methodology ?? null),
            items.map((item) => item.ref.referencePeriod ?? null),
            items.map((item) => item.ref.observedAt),
            items.map((item) => item.recordedAt),
            items.map((item) => item.correlationId),
            items.map((item) => JSON.stringify(item.value ?? null)),
            items.map((item) => JSON.stringify(item.provenance ?? {})),
            provenance.provenanceId,
          ],
        )

        /*
         * Read back what the database actually stored, rather than returning
         * the inputs that happened to survive the conflict filter. `RETURNING`
         * says which keys were new; only a read says what is now held under
         * them — and a record whose stored form differed from its input would
         * otherwise go unnoticed until a citation failed to resolve.
         */
        const recorded: DurableObservation[] = []
        for (const key of inserted) {
          const stored = await readOne(
            client,
            key.observation_id,
            key.content_hash,
            'observations.record',
          )
          if (stored) recorded.push(stored)
        }
        return recorded
      }),

    get: (observationId, contentHash) =>
      unitOfWork(scope, 'observations.get', (client) =>
        readOne(client, observationId, contentHash, 'observations.get'),
      ),

    versions: (observationId) =>
      unitOfWork(scope, 'observations.versions', async (client) => {
        const rows = await run<ObservationRow>(
          client,
          context,
          'observations.versions',
          OBSERVATION_SQL.versions,
          [observationId],
        )
        return rows.map(toObservation)
      }),

    series: (query) =>
      unitOfWork(scope, 'observations.series', async (client) => {
        const rows = await run<ObservationRow>(
          client,
          context,
          'observations.series',
          OBSERVATION_SQL.series,
          [
            query.subject,
            query.kind,
            query.sourceId,
            query.seriesId ?? null,
            query.methodology ?? null,
            query.from,
            query.to,
            query.knownAt ?? null,
          ],
        )
        /*
         * Already ordered, and deliberately not re-sorted here. `DISTINCT ON`
         * requires its own column to lead the ORDER BY, so the rows arrive
         * ascending by reference period under `COLLATE "C"` — UTF-8 byte order,
         * the same order the in-memory adapter applies. There is exactly one
         * row per period, so the port's content-hash tie-break is unreachable
         * on this path.
         *
         * A JS re-sort would have to use a locale-independent comparator to be
         * correct at all, and would still only reproduce what the database has
         * already guaranteed.
         */
        return rows.map(toObservation)
      }),
  }
}

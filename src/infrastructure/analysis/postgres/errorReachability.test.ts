/**
 * Telling "the database refused us" apart from "the database rejected this".
 *
 * A connection-level failure and a statement-level failure are different
 * institutional events with different operators and different remedies. One
 * means a server is not there; the other means the schema said no. The mapping
 * has to separate them, because the message it produces is what sends somebody
 * either to `pg_ctl` or to a migration.
 *
 * ## Why this file exists
 *
 * On 2026-08-30 the development cluster was down and every institutional read
 * surface reported
 *
 *     "provenance" failed with an unmapped database error (SQLSTATE ECONNREFUSED)
 *
 * `ECONNREFUSED` is a socket errno from the operating system. It is **not** a
 * SQLSTATE, there is no such SQLSTATE, and naming it as one pointed at the
 * schema when the actual fault was that nothing was listening on the port. The
 * outage was diagnosed as a possible code regression partly because of this
 * sentence.
 *
 * The user-visible outcome was never wrong — both classes reach
 * `SERVICE_UNAVAILABLE` — so what is pinned here is the operator's answer and
 * the metric's category, not the reader's.
 *
 * ## The near-miss matters as much as the violation
 *
 * A test that only proved `ECONNREFUSED` becomes `StorageUnavailableError`
 * would also pass if the mapping declared *everything* unreachable. So a
 * genuine unmapped SQLSTATE is pinned alongside it and must keep its SQLSTATE
 * and its plain `StorageError`.
 */

import { describe, expect, it } from 'vitest'
import {
  StorageError,
  StorageUnavailableError,
} from '~/application/analysis/repositories'
import { errorCategory, mapDatabaseError } from './sql'

const mapped = (code: string, message = 'connect ' + code) =>
  mapDatabaseError({ code, message } as never, 'provenance')

describe('a database that cannot be reached', () => {
  /*
   * The errnos a client socket actually produces against an absent, wedged or
   * misnamed host. `ECONNRESET` was already handled; the other four were not,
   * and nothing distinguishes them institutionally — in every case the firm
   * failed to reach its own storage.
   */
  const UNREACHABLE = [
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENOTFOUND',
  ]

  it.each(UNREACHABLE)('classifies %s as unreachable, not as a database error', (code) => {
    expect(mapped(code)).toBeInstanceOf(StorageUnavailableError)
  })

  it.each(UNREACHABLE)('never calls %s a SQLSTATE', (code) => {
    /*
     * The specific regression. A socket errno rendered as "(SQLSTATE ...)" is
     * a false statement about where the fault is, and it is the sentence an
     * operator reads first.
     */
    expect(mapped(code).message).not.toContain('SQLSTATE')
  })

  it('reports the outage under its own metric category', () => {
    // `storage` is the catch-all. An outage classified into it is invisible
    // among ordinary statement failures exactly when someone is looking for it.
    expect(errorCategory(mapped('ECONNREFUSED'))).toBe('storageunavailable')
  })

  it('keeps the 08 connection-exception class unreachable', () => {
    // Already true, and pinned so the errno work cannot displace it: these are
    // the server's own way of saying the connection failed.
    expect(mapped('08006')).toBeInstanceOf(StorageUnavailableError)
    expect(mapped('08003')).toBeInstanceOf(StorageUnavailableError)
  })

  it('leaves the driver message out of the mapped error', () => {
    /*
     * Unchanged rule, restated here because this branch now carries errors
     * whose message names a host and a port. A refusal must not become a way
     * to read the deployment.
     */
    const error = mapped('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:54320')
    expect(error.message).not.toContain('54320')
    expect(error.message).not.toContain('127.0.0.1')
  })
})

describe('a database that answered and refused the statement', () => {
  /*
   * The near-miss. `22P02` is invalid_text_representation — a real SQLSTATE
   * this mapping has no branch for. It must stay an unmapped database error,
   * keep its SQLSTATE, and never be reported as an outage. If this test ever
   * fails alongside the ones above passing, the mapping has stopped
   * discriminating and started declaring everything unreachable.
   */
  it('leaves an unmapped SQLSTATE as a plain storage error', () => {
    const error = mapped('22P02')
    expect(error).toBeInstanceOf(StorageError)
    expect(error).not.toBeInstanceOf(StorageUnavailableError)
  })

  it('keeps the SQLSTATE on an error that genuinely has one', () => {
    expect(mapped('22P02').message).toContain('SQLSTATE 22P02')
    expect(errorCategory(mapped('22P02'))).toBe('storage')
  })

  it('does not treat a missing code as unreachable', () => {
    // An error with no code at all is unclassified, not an outage.
    const error = mapDatabaseError({ message: 'something' } as never, 'provenance')
    expect(error).not.toBeInstanceOf(StorageUnavailableError)
  })
})

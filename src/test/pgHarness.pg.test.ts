/**
 * What the harness actually did, observed rather than assumed.
 *
 * The ownership *decision* is exhaustively unit-tested in `pgOwnership.test.ts`
 * against synthetic inputs. This file checks the parts that need a real cluster:
 * that the port is dynamic, that the marker on disk describes the process that
 * is running, and that the evidence chain a teardown will rely on is genuinely
 * there.
 *
 * **The unowned-process path is not integration-tested, and is not claimed to
 * be.** Proving "we do not kill a foreign PostgreSQL" would mean starting one
 * to be spared, and a test that manufactures a database in order to not kill it
 * is a test that can kill something. That path is proven by the decision table.
 */

import { describe, expect, it } from 'vitest'
import { inject } from 'vitest'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decideOwnership, parseMarker, parsePostmasterPid } from './pgOwnership'

const MARKER_PATH = join(tmpdir(), 'finos-pg-harness.json')

const portOf = (url: string) => Number(new URL(url).port)

describe('the harness allocated a dynamic port', () => {
  it('is not the old fixed 54330', () => {
    /*
     * The fixed port was the cause: one run killed without teardown kept it,
     * and the next could not bind. Its absence is the fix, so it is asserted
     * rather than assumed.
     */
    expect(portOf(inject('adminUrl'))).not.toBe(54_330)
  })

  it('is a plausible ephemeral port the OS assigned', () => {
    const port = portOf(inject('adminUrl'))
    expect(port).toBeGreaterThan(1_024)
    expect(port).toBeLessThanOrEqual(65_535)
  })
})

describe('the ownership marker describes the cluster that is running', () => {
  it('is well formed and of the current version', async () => {
    const marker = parseMarker(await readFile(MARKER_PATH, 'utf8').catch(() => null))
    expect(marker.kind).toBe('ok')
  })

  it('names the port the workers are connected to', async () => {
    const marker = parseMarker(await readFile(MARKER_PATH, 'utf8'))
    expect(marker.kind === 'ok' && marker.marker.port).toBe(portOf(inject('adminUrl')))
  })

  it('names a cluster directory this harness created', async () => {
    const marker = parseMarker(await readFile(MARKER_PATH, 'utf8'))
    expect(marker.kind === 'ok' && marker.marker.directory).toContain('finos-pg-')
  })

  it('agrees with the postmaster.pid PostgreSQL wrote', async () => {
    /*
     * The whole ownership chain, end to end, against a live cluster: our marker
     * and PostgreSQL's own file naming the same pid and the same port, in a
     * directory we created.
     */
    const marker = parseMarker(await readFile(MARKER_PATH, 'utf8'))
    expect(marker.kind).toBe('ok')
    if (marker.kind !== 'ok') return

    const postmaster = parsePostmasterPid(
      await readFile(join(marker.marker.directory, 'postmaster.pid'), 'utf8').catch(
        () => null,
      ),
    )
    expect(postmaster).toEqual({
      kind: 'ok',
      pid: marker.marker.pid,
      port: marker.marker.port,
    })
  })

  it('would permit termination of this cluster, and only because everything agrees', async () => {
    const marker = parseMarker(await readFile(MARKER_PATH, 'utf8'))
    if (marker.kind !== 'ok') throw new Error('no marker')

    const postmaster = parsePostmasterPid(
      await readFile(join(marker.marker.directory, 'postmaster.pid'), 'utf8'),
    )

    const decision = decideOwnership({
      marker,
      directoryUnderPrefix: marker.marker.directory.includes('finos-pg-'),
      postmaster,
      pidAlive: true,
      portOccupied: true,
    })
    expect(decision.action).toBe('terminate-owned-process')

    // ...and one wrong field is enough to withdraw that permission.
    const withForeignDirectory = decideOwnership({
      marker,
      directoryUnderPrefix: false,
      postmaster,
      pidAlive: true,
      portOccupied: true,
    })
    expect(withForeignDirectory.action).toBe('refuse-ambiguous')
  })
})

describe('the running postmaster is the one the marker names', () => {
  it('is alive', async () => {
    const marker = parseMarker(await readFile(MARKER_PATH, 'utf8'))
    if (marker.kind !== 'ok') throw new Error('no marker')

    // Signal 0: existence, nothing delivered.
    expect(() => process.kill(marker.marker.pid, 0)).not.toThrow()
  })
})

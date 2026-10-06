// @vitest-environment node
/**
 * The composition root as the desktop runs it: an absent record is not
 * created behind the person's back; CREATE NEW makes an empty record that
 * is never seeded; the record opened once is the record every door gets;
 * an act leaves a snapshot behind; a controlled shutdown closes in order
 * and the next start is clean; a session that ends without closing leaves
 * its committed writes in the write-ahead log, which the next open folds
 * in and reports.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createClient } from '~/application/advisory/lifecycle'
import { createOffice } from '~/application/advisory/officeLifecycle'
import { FakeClock } from '~/domain/shared/clock'
import { listSnapshots } from '~/infrastructure/backup/snapshots'
import { LOG_FILE } from '~/infrastructure/platform/log'
import {
  advisoryStoreState,
  createAdvisoryContext,
  initialiseFinancialOs,
  shutdownAdvisoryStore,
  snapshotIfChanged,
  StoreNotInitialisedError,
} from './container'
import { hadUncleanShutdown, openDatabase } from './sqlite/database'
import { openAdvisoryStore } from './sqlite/store'

const ENV = ['FINANCIAL_OS_MODE', 'FINANCIAL_OS_DATA_DIR', 'FINANCIAL_OS_STORE', 'FINANCIAL_OS_DEMO_SEED'] as const
let saved: Record<string, string | undefined>
let root: string
const clock = new FakeClock('2026-10-04T10:00:00.000Z')
const ADVISOR = { id: 'adv-martin', displayName: 'Martin' }

beforeEach(async () => {
  await shutdownAdvisoryStore()
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
  root = mkdtempSync(join(tmpdir(), 'fos-container-'))
  process.env.FINANCIAL_OS_MODE = 'desktop'
  process.env.FINANCIAL_OS_DATA_DIR = root
  delete process.env.FINANCIAL_OS_STORE
  delete process.env.FINANCIAL_OS_DEMO_SEED
})
afterEach(async () => {
  await shutdownAdvisoryStore()
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  rmSync(root, { recursive: true, force: true })
})

describe('the desktop composition root', () => {
  it('never creates the record silently: an absent file is NOT_INITIALISED and stays absent', async () => {
    await expect(createAdvisoryContext(clock)).rejects.toBeInstanceOf(StoreNotInitialisedError)
    expect(existsSync(join(root, 'financial-os.db'))).toBe(false)
    expect(advisoryStoreState()?.outcome).toMatchObject({ ok: false, code: 'NOT_INITIALISED' })
  })

  it('CREATE NEW makes an empty record at the current schema, never seeded, and the doors then open it', async () => {
    const made = await initialiseFinancialOs(clock, ADVISOR)
    expect(made).toEqual({ ok: true, created: true })
    expect(existsSync(join(root, 'financial-os.db'))).toBe(true)
    const context = await createAdvisoryContext(clock)
    expect(await context.repositories.clients.list()).toEqual([])
    expect(await context.repositories.clients.offices()).toEqual([])
    /* The one advisor the record is set up for, and nothing else. */
    expect(await context.repositories.clients.advisors()).toEqual([ADVISOR])
    /* A second CREATE NEW on an existing record creates nothing and changes nothing. */
    expect(await initialiseFinancialOs(clock, ADVISOR)).toEqual({ ok: true, created: false })
    /* The log says what happened, as events. */
    const log = readFileSync(join(root, 'logs', LOG_FILE), 'utf8')
    expect(log).toMatch(/"event":"store\.initialised"/)
    expect(log).toMatch(/"event":"store\.opened"/)
  })

  it('an act leaves a snapshot behind; a shutdown closes in order; the next start is clean', async () => {
    await initialiseFinancialOs(clock, ADVISOR)
    const context = await createAdvisoryContext(clock)
    const office = await createOffice(context, {
      displayName: 'Stureplan',
      shortName: null,
      city: 'Stockholm',
      description: null,
      by: 'adv-martin',
    })
    expect(office.ok).toBe(true)
    if (!office.ok) return
    const created = await createClient(context, {
      displayName: 'Anna Exempel',
      segment: 'private-banking',
      officeId: office.office.id,
      advisorId: 'adv-martin',
      relationshipSince: '2026-10-04',
      status: 'onboarding',
      by: 'adv-martin',
    })
    expect(created.ok).toBe(true)
    const snapshot = await snapshotIfChanged('manual')
    expect(snapshot?.verified).toBe(true)
    expect(snapshot?.counts).toMatchObject({ clients: 1, offices: 1 })
    /* Nothing changed since: the scheduled trigger takes nothing. */
    expect(await snapshotIfChanged('interval')).toBeNull()
    expect(listSnapshots(join(root, 'backups', 'snapshots'))).toHaveLength(1)

    await shutdownAdvisoryStore()
    expect(advisoryStoreState()).toBeNull()
    expect(hadUncleanShutdown(join(root, 'financial-os.db'))).toBe(false)
    const again = await createAdvisoryContext(clock)
    expect((await again.repositories.clients.list()).map((c) => c.displayName)).toEqual([
      'Anna Exempel',
    ])
    expect(advisoryStoreState()?.outcome).toMatchObject({ ok: true, uncleanShutdown: false })
  })

  it('folds in what a session that never closed had committed, and says the end was unclean', async () => {
    await initialiseFinancialOs(clock, ADVISOR)
    await shutdownAdvisoryStore()
    const path = join(root, 'financial-os.db')
    /* A session that writes and is then gone — the handle is never closed. */
    const session = openDatabase(path)
    session
      .prepare(
        'INSERT INTO offices (id, name, city, display_name, short_name, status, archived_at, description, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run('of-x', 'X', 'Stockholm', 'X', 'X', 'active', null, null, 1)
    expect(hadUncleanShutdown(path)).toBe(true)
    const next = await openAdvisoryStore(path, { createIfMissing: false })
    expect(next.ok).toBe(true)
    if (!next.ok) return
    expect(next.uncleanShutdown).toBe(true)
    expect((await next.repositories.clients.offices()).map((o) => o.id)).toEqual(['of-x'])
    next.db.close()
    session.close()
  })
})

/**
 * The advisory composition root.
 *
 * One place decides which repositories the advisory context runs on and
 * which clock it reads. The desktop runs on SQLite in the person's data
 * directory and is never seeded; development keeps the synthetic record in
 * memory unless it asks for SQLite, and may seed the demonstration into an
 * empty SQLite store only when it says so explicitly. Nothing above this
 * file knows which it got.
 *
 * A person's record is never created silently: an absent file in desktop
 * mode is `NOT_INITIALISED`, and the first-run page asks whether to create
 * a new Financial OS or restore one. Once open, the record is snapshotted
 * on a schedule and a minute after it changes, closed in order at a
 * controlled shutdown (a hook the desktop host calls), and everything it
 * does is written to the diagnostic log as events and codes.
 */

import { existsSync } from 'node:fs'
import type {
  AdvisoryContext,
  AdvisoryRepositories,
  MarketObservationSource,
} from '~/application/advisory/ports'
import type { Advisor } from '~/domain/advisory'
import type { Clock } from '~/domain/shared/clock'
import {
  applyRetention,
  createSnapshot,
  listSnapshots,
  type SnapshotMeta,
  type SnapshotTrigger,
} from '~/infrastructure/backup/snapshots'
import {
  dailyExportDue,
  exportBundle,
  readBackupConfig,
} from '~/infrastructure/backup/destinations'
import { BackupScheduler } from '~/infrastructure/backup/scheduler'
import { loadPassphrase } from '~/infrastructure/backup/secrets'
import {
  appVersion,
  createsOnFirstOpen,
  dataLayout,
  demoSeedAllowed,
  runtimeMode,
  storeKind,
  type DataLayout,
} from '~/infrastructure/platform/dataDir'
import { configureLogger, logger } from '~/infrastructure/platform/log'
import { closeInOrder, totalChanges, type Database } from './sqlite/database'
import { openAdvisoryStore, type OpenStoreOutcome } from './sqlite/store'
import { writeSeed } from './sqlite/repositories'
import { createSyntheticAdvisoryRepositories } from './syntheticRepositories'
import { syntheticClients } from './syntheticClients'

export interface AdvisoryStoreState {
  kind: 'sqlite' | 'synthetic'
  layout: DataLayout | null
  outcome: OpenStoreOutcome | null
  /** The moment the store was opened, for the status page. */
  openedAt: string | null
  /** Rows changed on this connection when the last snapshot was taken; a snapshot is skipped when nothing moved. */
  changesAtLastSnapshot: number
  lastSnapshot: SnapshotMeta | null
  scheduler: BackupScheduler | null
}

/* Process-wide, on `globalThis`: the dev server holds more than one instance of this module. */
const STATE_KEY = Symbol.for('financial-os:advisory-store-state')
const SHUTDOWN_KEY = Symbol.for('financial-os:shutdown')
const registry = globalThis as unknown as {
  [STATE_KEY]?: AdvisoryStoreState | null
  [SHUTDOWN_KEY]?: (() => Promise<void>) | null
}

/** What the composition root opened: the store kind, the data directory, and how the open went. */
export function advisoryStoreState(): AdvisoryStoreState | null {
  return registry[STATE_KEY] ?? null
}

function setState(state: AdvisoryStoreState | null): void {
  registry[STATE_KEY] = state
}

/** The record is not there to open: the first-run page decides what happens. */
export class StoreNotInitialisedError extends Error {
  readonly code = 'NOT_INITIALISED'
  constructor() {
    super('advisory store not initialised')
    this.name = 'StoreNotInitialisedError'
  }
}

/** The record refused to open; the typed outcome is on the store state, this carries its code. */
export class StoreUnavailableError extends Error {
  constructor(readonly code: string, detail: string) {
    super(`advisory store unavailable: ${code} (${detail})`)
    this.name = 'StoreUnavailableError'
  }
}

/**
 * The market is handed in, never built here: its source reaches into the
 * market-data container, which must stay out of every module the client
 * bundle can follow (see `serverFns.ts` and `marketSource.ts`).
 */
export async function createAdvisoryContext(
  clock: Clock,
  market?: MarketObservationSource,
): Promise<AdvisoryContext> {
  const today = clock.isoNow().slice(0, 10)
  const repositories = await openRepositories(today, clock)
  return {
    repositories,
    clock,
    ...(market ? { market } : {}),
  }
}

async function openRepositories(today: string, clock: Clock): Promise<AdvisoryRepositories> {
  const mode = runtimeMode()
  if (storeKind(mode) === 'synthetic') {
    setState({
      kind: 'synthetic',
      layout: null,
      outcome: null,
      openedAt: clock.isoNow(),
      changesAtLastSnapshot: 0,
      lastSnapshot: null,
      scheduler: null,
    })
    return createSyntheticAdvisoryRepositories(syntheticClients(today))
  }
  const layout = dataLayout()
  configureLogger(layout.logs)
  const opened = await openStore(layout, clock, { createIfMissing: createsOnFirstOpen(mode) })
  if (!opened.ok) {
    if (opened.code === 'NOT_INITIALISED') throw new StoreNotInitialisedError()
    throw new StoreUnavailableError(opened.code, opened.detail)
  }
  if (opened.created && demoSeedAllowed(mode)) {
    await writeSeed(opened.db, syntheticClients(today))
    logger().info('store.seeded', { mode })
  }
  return opened.repositories
}

/** Open the file, record the outcome, arm the backups; the one path every open takes. */
async function openStore(
  layout: DataLayout,
  clock: Clock,
  options: { createIfMissing: boolean },
): Promise<OpenStoreOutcome> {
  const previous = advisoryStoreState()
  if (previous?.kind === 'sqlite' && previous.outcome?.ok) return previous.outcome
  const outcome = await openAdvisoryStore(layout.database, {
    preMigrationDir: layout.preMigration,
    now: () => clock.now(),
    createIfMissing: options.createIfMissing,
  })
  const state: AdvisoryStoreState = {
    kind: 'sqlite',
    layout,
    outcome,
    openedAt: clock.isoNow(),
    changesAtLastSnapshot: 0,
    lastSnapshot: listSnapshots(layout.snapshots)[0] ?? null,
    scheduler: null,
  }
  setState(state)
  if (!outcome.ok) {
    if (outcome.code !== 'NOT_INITIALISED')
      logger().error('store.open.refused', undefined, {
        code: outcome.code,
        detail: outcome.detail,
        uncleanShutdown: outcome.uncleanShutdown,
      })
    return outcome
  }
  logger().info('store.opened', {
    created: outcome.created,
    uncleanShutdown: outcome.uncleanShutdown,
    schemaFrom: outcome.migration.from,
    schemaTo: outcome.migration.to,
    applied: outcome.migration.applied,
    preMigrationSnapshot: outcome.preMigrationSnapshot !== null,
  })
  if (outcome.uncleanShutdown) logger().warn('store.unclean-shutdown-noticed')
  /* The acts the record performs: a minute after any of them, a snapshot. */
  const scheduler = new BackupScheduler({
    snapshot: (trigger) => snapshotIfChanged(trigger).then(() => undefined),
    dailyExport: () => dailyExportIfDue(clock),
  })
  state.scheduler = scheduler
  const repositories = outcome.repositories
  const transaction = repositories.transaction.bind(repositories)
  repositories.transaction = async (work) => {
    const result = await transaction(work)
    scheduler.afterAct()
    return result
  }
  scheduler.start()
  registry[SHUTDOWN_KEY] = shutdownAdvisoryStore
  /* An existing record brought to a newer schema is snapshotted at once; an existing record otherwise gets its first snapshot at start. A file created just now holds nothing to keep. */
  if (!outcome.created) {
    if (outcome.migration.applied.length > 0) await snapshotIfChanged('post-migration', true)
    else await snapshotIfChanged('startup')
  }
  return outcome
}

/* ------------------------------------------------------------ first run */

/**
 * CREATE NEW FINANCIAL OS: an empty record at the current schema, written
 * only now, holding nothing but the one advisor it is set up for — never a
 * demonstration client.
 */
export async function initialiseFinancialOs(
  clock: Clock,
  advisor: Advisor,
): Promise<{ ok: true; created: boolean } | { ok: false; code: string; detail: string }> {
  if (storeKind() === 'synthetic') return { ok: false, code: 'NOT_SQLITE', detail: 'synthetic record' }
  const layout = dataLayout()
  configureLogger(layout.logs)
  const existed = existsSync(layout.database)
  /* A record already open is the record; nothing is reopened beside it. */
  const current = advisoryStoreState()
  if (current?.kind === 'sqlite' && current.outcome?.ok) return { ok: true, created: false }
  setState(null)
  const outcome = await openStore(layout, clock, { createIfMissing: true })
  if (!outcome.ok) return { ok: false, code: outcome.code, detail: outcome.detail }
  if (!existed) {
    await outcome.repositories.clients.saveAdvisor(advisor)
    outcome.db
      .prepare('INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)')
      .run(
        'setup',
        JSON.stringify({ createdAt: clock.isoNow(), appVersion: appVersion(), via: 'create-new' }),
        clock.isoNow(),
      )
    logger().info('store.initialised', { via: 'create-new' })
  }
  return { ok: true, created: !existed }
}

/* -------------------------------------------------------------- backups */

/** The live database, for a backup or a bundle; null unless SQLite is open. */
export function liveDatabase(): { db: Database; layout: DataLayout } | null {
  const state = advisoryStoreState()
  if (state?.kind !== 'sqlite' || !state.outcome?.ok || !state.layout) return null
  return { db: state.outcome.db, layout: state.layout }
}

/**
 * A snapshot, unless nothing was written since the last one — a manual
 * request and a post-migration one are taken regardless. Retention runs
 * after each.
 */
export async function snapshotIfChanged(
  trigger: SnapshotTrigger,
  force = trigger === 'manual' || trigger === 'post-migration' || trigger === 'pre-restore',
): Promise<SnapshotMeta | null> {
  const state = advisoryStoreState()
  const live = liveDatabase()
  if (!state || !live) return null
  const changes = totalChanges(live.db)
  if (!force && changes === state.changesAtLastSnapshot && state.lastSnapshot) return null
  try {
    const meta = await createSnapshot(live.db, live.layout.snapshots, {
      trigger,
      appVersion: appVersion(),
    })
    state.changesAtLastSnapshot = changes
    state.lastSnapshot = meta
    const thinned = applyRetention(live.layout.snapshots, new Date())
    logger().info('backup.snapshot', {
      trigger,
      id: meta.id,
      verified: meta.verified,
      sizeBytes: meta.sizeBytes,
      removed: thinned.removed.length,
    })
    return meta
  } catch (error) {
    logger().error('backup.snapshot.failed', error, { trigger })
    return null
  }
}

/** The unattended export to the external destination, when it is due and a passphrase is kept. */
async function dailyExportIfDue(clock: Clock): Promise<void> {
  const live = liveDatabase()
  if (!live) return
  const config = readBackupConfig(live.layout)
  if (!dailyExportDue(config, clock.now()) || !config.external) return
  const passphrase = loadPassphrase(live.layout)
  if (!passphrase) {
    logger().warn('backup.export.skipped', { reason: 'NO_PASSPHRASE' })
    return
  }
  try {
    const record = await exportBundle({
      db: live.db,
      layout: live.layout,
      destination: { kind: 'EXTERNAL', path: config.external.path },
      passphrase,
      appVersion: appVersion(),
      now: () => clock.now(),
    })
    logger().info('backup.export', {
      destination: 'EXTERNAL',
      bundleId: record.bundleId,
      verified: record.verified,
      sizeBytes: record.sizeBytes,
    })
  } catch (error) {
    logger().error('backup.export.failed', error, { destination: 'EXTERNAL' })
  }
}

/* ------------------------------------------------------------- shutdown */

/**
 * A controlled end: the scheduler's pending snapshot taken, the store
 * closed in order so no write-ahead log is left behind. Also what a
 * restore calls before it swaps the files.
 */
export async function shutdownAdvisoryStore(): Promise<void> {
  const state = advisoryStoreState()
  if (!state) return
  if (state.scheduler) {
    try {
      await state.scheduler.shutdown()
    } catch (error) {
      logger().error('backup.shutdown-snapshot.failed', error)
    }
    state.scheduler = null
  }
  if (state.kind === 'sqlite' && state.outcome?.ok) {
    try {
      closeInOrder(state.outcome.db)
      logger().info('store.closed')
    } catch (error) {
      logger().error('store.close.failed', error)
    }
  }
  setState(null)
  registry[SHUTDOWN_KEY] = null
}

/** Forget the store without closing it — after a failed open, so the next door tries again. */
export function forgetAdvisoryStore(): void {
  const state = advisoryStoreState()
  if (state?.kind === 'sqlite' && state.outcome?.ok) return
  setState(null)
}

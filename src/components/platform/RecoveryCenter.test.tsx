/**
 * Säkerhet & backup, rendered against a typed status and driven through
 * the platform doors: the facts a person reads, the acts they can take,
 * what an outcome says, and what Recovery Mode offers first.
 */

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SnapshotMeta, SystemStatus } from '~/infrastructure/platform/serverFns'
import { renderInRouter } from '~/test/renderInRouter'
import { RecoveryCenter } from './RecoveryCenter'

const doors = vi.hoisted(() => ({
  createSnapshotFn: vi.fn(),
  verifyBackupsFn: vi.fn(),
  exportBundleFn: vi.fn(),
  inspectBundleFn: vi.fn(),
  restoreFromBundleFn: vi.fn(),
  restoreFromSnapshotFn: vi.fn(),
  setBackupDestinationFn: vi.fn(),
  setBackupPassphraseFn: vi.fn(),
  clearBackupPassphraseFn: vi.fn(),
}))
vi.mock('~/infrastructure/platform/serverFns', () => doors)

const STUBS = ['/settings', '/recovery', '/clients', '/setup'] as const

const snapshot = (over: Partial<SnapshotMeta> = {}): SnapshotMeta => ({
  id: 'financial-os-2026-10-04T08-00-00-000Z-manual',
  path: 'C:/data/backups/snapshots/financial-os-2026-10-04T08-00-00-000Z-manual.db',
  createdAt: '2026-10-04T08:00:00.000Z',
  trigger: 'manual',
  sizeBytes: 1_200_000,
  schemaVersion: 1,
  sha256: 'abc',
  verified: true,
  verification: 'ok',
  appVersion: '0.1.0',
  counts: { clients: 7, offices: 3, documents: 2 },
  ...over,
})

function statusAt(over: Partial<SystemStatus['database']> = {}, snapshots: SnapshotMeta[] = [snapshot()]): SystemStatus {
  return {
    mode: 'desktop',
    store: 'sqlite',
    desktop: false,
    appVersion: '0.1.0',
    schemaVersion: 1,
    dataRoot: 'C:/data',
    database: {
      state: 'OK',
      path: 'C:/data/financial-os.db',
      sizeBytes: 2_400_000,
      code: null,
      detail: null,
      uncleanShutdown: false,
      openedAt: '2026-10-04T09:00:00.000Z',
      counts: { clients: 7, offices: 3, documents: 2 },
      ...over,
    },
    backups: {
      snapshotsDir: 'C:/data/backups/snapshots',
      bundlesDir: 'C:/data/backups/bundles',
      snapshots,
      lastSnapshot: snapshots[0] ?? null,
      config: {
        external: { path: 'E:/Backups', chosenAt: '2026-10-01T00:00:00.000Z' },
        lastExport: null,
        lastExportError: {
          at: '2026-10-03T06:00:00.000Z',
          destination: 'EXTERNAL',
          code: 'DESTINATION_UNAVAILABLE',
          detail: 'folder missing',
        },
        dailyExport: true,
      },
      passphrase: 'none',
    },
    generatedAt: '2026-10-04T09:00:00.000Z',
  }
}

beforeEach(() => {
  for (const fn of Object.values(doors)) fn.mockReset()
})

describe('Säkerhet & backup', () => {
  it('states the record, its protection and the acts, in counts and moments', async () => {
    const view = await renderInRouter(
      <RecoveryCenter status={statusAt()} onChanged={() => {}} />,
      STUBS,
    )
    const centre = screen.getByRole('region', { name: 'Säkerhet & backup' })
    expect(within(centre).getByText('Öppen och kontrollerad')).toBeInTheDocument()
    expect(within(centre).getByText(/7 klienter · 3 kontor · 2 dokument · 2,3 MB/)).toBeInTheDocument()
    expect(within(centre).getByText('C:/data')).toBeInTheDocument()
    expect(within(centre).getByText(/manuell · verifierad · 1 lokala/)).toBeInTheDocument()
    expect(within(centre).getByText('E:/Backups')).toBeInTheDocument()
    /* A destination that was not there is reported, never silently skipped. */
    expect(within(centre).getByText(/Mappen finns inte eller går inte att skriva till/)).toBeInTheDocument()
    expect(within(centre).getByText('Ingen lösenfras sparad')).toBeInTheDocument()
    for (const name of [
      'Skapa backup nu',
      'Verifiera backup',
      'Exportera krypterad backup',
      'Återställ från backup',
      'Extern mapp',
      'Lösenfras',
    ])
      expect(within(centre).getByRole('button', { name })).toBeInTheDocument()
    /* No desktop host: no folder to open, no autostart to offer. */
    expect(within(centre).queryByRole('button', { name: 'Öppna backupmapp' })).toBeNull()
    expect(within(centre).queryByText(/Starta Financial OS med Windows/)).toBeNull()
    /* In settings, a local snapshot is listed but not offered for restore. */
    const rows = within(centre).getByRole('list', { name: 'Lokala ögonblicksbilder' })
    expect(within(rows).queryByRole('button', { name: 'Återställ' })).toBeNull()
    view.unmount()
  })

  it('takes a backup now and says what it took; verifies and lists what passed', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()
    doors.createSnapshotFn.mockResolvedValue({
      ok: true,
      snapshot: snapshot({ createdAt: '2026-10-04T09:30:00.000Z', sizeBytes: 1_300_000 }),
    })
    doors.verifyBackupsFn.mockResolvedValue({
      ok: true,
      snapshots: [
        { snapshot: snapshot(), verification: { ok: true, checksum: 'ok', quickCheck: 'ok', foreignKeyViolations: 0, schemaVersion: 1, counts: null } },
        {
          snapshot: snapshot({ id: 'older', createdAt: '2026-10-03T08:00:00.000Z', trigger: 'interval' }),
          verification: { ok: false, checksum: 'mismatch', quickCheck: 'ok', foreignKeyViolations: 0, schemaVersion: 1, counts: null },
        },
      ],
      lastExport: null,
    })
    const view = await renderInRouter(
      <RecoveryCenter status={statusAt()} onChanged={onChanged} />,
      STUBS,
    )
    await user.click(screen.getByRole('button', { name: 'Skapa backup nu' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Ögonblicksbild tagen .* 1,2 MB · verifierad/))
    expect(doors.createSnapshotFn).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Verifiera backup' }))
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('2 ögonblicksbilder kontrollerade, 1 med fel'),
    )
    expect(screen.getByText('kontrollsumman stämmer inte')).toBeInTheDocument()
    view.unmount()
  })

  it('refuses an export without a passphrase that matches, and reports the outcome in words', async () => {
    const user = userEvent.setup()
    doors.exportBundleFn.mockResolvedValue({ ok: false, code: 'DESTINATION_UNAVAILABLE', detail: 'folder missing' })
    const view = await renderInRouter(
      <RecoveryCenter status={statusAt()} onChanged={() => {}} />,
      STUBS,
    )
    await user.click(screen.getByRole('button', { name: 'Exportera krypterad backup' }))
    const panel = screen.getByRole('region', { name: 'Exportera krypterad backup' })
    const exportButton = within(panel).getByRole('button', { name: 'Exportera' })
    expect(exportButton).toBeDisabled()
    await user.type(within(panel).getByLabelText(/^Lösenfras/), 'correct horse')
    await user.type(within(panel).getByLabelText(/Bekräfta lösenfras/), 'correct hors')
    expect(exportButton).toBeDisabled()
    await user.type(within(panel).getByLabelText(/Bekräfta lösenfras/), 'e')
    expect(exportButton).toBeEnabled()
    await user.click(exportButton)
    await waitFor(() =>
      expect(within(panel).getByText(/Mappen finns inte eller går inte att skriva till\. folder missing/)).toBeInTheDocument(),
    )
    expect(doors.exportBundleFn).toHaveBeenCalledWith({ data: { passphrase: 'correct horse', to: 'EXTERNAL' } })
    view.unmount()
  })

  it('in Recovery Mode: says why the record refused, opens the restore first, reviews before restoring, and offers the verified snapshot', async () => {
    const user = userEvent.setup()
    doors.inspectBundleFn.mockResolvedValue({
      ok: true,
      inspection: {
        ok: true,
        manifest: {
          format: 'financialos-bundle',
          formatVersion: 1,
          bundleId: 'b-1',
          createdAt: '2026-10-03T18:00:00.000Z',
          appVersion: '0.1.0',
          schemaVersion: 1,
          counts: { clients: 6, offices: 3, documents: 1 },
          entries: [],
        },
        issues: [],
        database: { quickCheck: 'ok', foreignKeyViolations: 0, schemaVersion: 1 },
        schemaCompatible: true,
        documents: 1,
        sizeBytes: 900_000,
        sha256: 'x',
      },
    })
    doors.restoreFromBundleFn.mockResolvedValue({
      ok: true,
      summary: {
        source: 'bundle',
        sourceId: 'b-1',
        sourceCreatedAt: '2026-10-03T18:00:00.000Z',
        counts: { clients: 6, offices: 3, documents: 1 },
        schema: { from: 1, to: 1 },
        documentsRestored: 1,
        safetySnapshot: null,
        replacedDatabase: 'C:/data/financial-os.db.replaced-x',
        replacedDocuments: null,
        restoredAt: '2026-10-04T09:05:00.000Z',
      },
    })
    const status = statusAt(
      { state: 'RECOVERY', code: 'INTEGRITY_FAILED', detail: '*** in database main ***', openedAt: null, counts: null },
      [snapshot(), snapshot({ id: 'unverified', verified: false, verification: 'no sidecar', createdAt: '2026-10-02T08:00:00.000Z' })],
    )
    const view = await renderInRouter(
      <RecoveryCenter status={status} mode="recovery" onChanged={() => {}} />,
      STUBS,
    )
    expect(screen.getByText('Databasen är skadad')).toBeInTheDocument()
    expect(screen.getByText('*** in database main ***')).toBeInTheDocument()
    const panel = screen.getByRole('region', { name: 'Återställ från backup' })
    const review = within(panel).getByRole('button', { name: 'Granska backup' })
    expect(review).toBeDisabled()
    await user.type(within(panel).getByLabelText(/Backupfil/), 'E:/Backups/financial-os.financialos')
    await user.type(within(panel).getByLabelText(/^Lösenfras/), 'correct horse')
    await user.click(review)
    await waitFor(() => expect(within(panel).getByText('Backupens innehåll')).toBeInTheDocument())
    expect(within(panel).getByText('6 klienter · 3 kontor · 1 dokument')).toBeInTheDocument()
    const restore = within(panel).getByRole('button', { name: 'Återställ' })
    expect(restore).toBeDisabled()
    await user.click(within(panel).getByRole('checkbox'))
    expect(restore).toBeEnabled()
    await user.click(restore)
    await waitFor(() => expect(screen.getByText(/Financial OS är återställt från backupen/)).toBeInTheDocument())
    expect(doors.restoreFromBundleFn).toHaveBeenCalledWith({
      data: { path: 'E:/Backups/financial-os.financialos', passphrase: 'correct horse' },
    })
    /* The verified snapshot can be restored, after a confirmation; the unverified one cannot. */
    const rows = within(screen.getByRole('list', { name: 'Lokala ögonblicksbilder' })).getAllByRole('listitem')
    expect(within(rows[0]!).getByRole('button', { name: 'Återställ' })).toBeEnabled()
    expect(within(rows[1]!).getByRole('button', { name: 'Återställ' })).toBeDisabled()
    await user.click(within(rows[0]!).getByRole('button', { name: 'Återställ' }))
    expect(within(rows[0]!).getByRole('button', { name: 'Bekräfta återställning' })).toBeInTheDocument()
    view.unmount()
  })

  it('on the synthetic record says what the module is for and offers nothing', async () => {
    const view = await renderInRouter(
      <RecoveryCenter status={{ ...statusAt(), store: 'synthetic' }} onChanged={() => {}} />,
      STUBS,
    )
    expect(screen.getByText(/den här miljön kör registret i minnet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Skapa backup nu' })).toBeNull()
    view.unmount()
  })
})

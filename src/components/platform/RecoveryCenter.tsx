import { Link } from '@tanstack/react-router'
import {
  Archive,
  FolderOpen,
  HardDrive,
  KeyRound,
  RotateCcw,
  ShieldCheck,
  Upload,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '~/lib/cn'
import {
  clearBackupPassphraseFn,
  createSnapshotFn,
  exportBundleFn,
  inspectBundleFn,
  restoreFromBundleFn,
  restoreFromSnapshotFn,
  setBackupDestinationFn,
  setBackupPassphraseFn,
  verifyBackupsFn,
  type RestoreResponse,
  type SnapshotMeta,
  type SystemStatus,
  type VerifyBackupsResponse,
} from '~/infrastructure/platform/serverFns'
import {
  countsText,
  DATABASE_STATE_LABEL,
  formatBytes,
  formatMoment,
  PASSPHRASE_KEEPING_LABEL,
  STORE_FAILURE_TEXT,
  systemCodeText,
  TRIGGER_LABEL,
} from '~/presentation/platform/systemText'
import { Fact, ModuleHead, ModuleIcon } from '../clients/dossier/Module'
import { useDesktopBridge } from './desktopBridge'

type Panel = 'export' | 'restore' | 'destination' | 'passphrase' | null

/**
 * Säkerhet & backup — the Recovery Center.
 *
 * One module in the dossier's own material: what the system is (the
 * database, where it lives, how much it holds), what protects it (the
 * last snapshot, the last external export, whether a passphrase is kept),
 * and the acts — a backup now, a verification, an encrypted export, a
 * restore, the folder, the external destination. Every outcome is a
 * sentence from a code; no stack ever reaches here. In Recovery Mode the
 * same module stands alone on its page, with the restore offered first.
 */
export function RecoveryCenter({
  status,
  onChanged,
  mode = 'settings',
}: {
  status: SystemStatus
  /** The page re-reads the status after an act. */
  onChanged: () => Promise<void> | void
  mode?: 'settings' | 'recovery'
}) {
  const [panel, setPanel] = useState<Panel>(mode === 'recovery' ? 'restore' : null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [verification, setVerification] = useState<Extract<
    VerifyBackupsResponse,
    { ok: true }
  > | null>(null)
  const desktop = useDesktopBridge()
  const sqlite = status.store === 'sqlite'
  const open = status.database.state === 'OK'
  const config = status.backups.config

  async function act(name: string, work: () => Promise<{ tone: 'ok' | 'bad'; text: string }>) {
    setBusy(name)
    setMessage(null)
    try {
      setMessage(await work())
      await onChanged()
    } catch {
      setMessage({ tone: 'bad', text: systemCodeText('SERVICE_UNAVAILABLE') })
    } finally {
      setBusy(null)
    }
  }

  const snapshotNow = () =>
    act('snapshot', async () => {
      const result = await createSnapshotFn()
      return result.ok
        ? {
            tone: 'ok',
            text: `Ögonblicksbild tagen ${formatMoment(result.snapshot.createdAt)} · ${formatBytes(result.snapshot.sizeBytes)} · ${result.snapshot.verified ? 'verifierad' : 'EJ verifierad'}.`,
          }
        : { tone: 'bad', text: systemCodeText(result.code) }
    })

  const verify = () =>
    act('verify', async () => {
      const result = await verifyBackupsFn()
      if (!result.ok) return { tone: 'bad', text: systemCodeText(result.code) }
      setVerification(result)
      const failing = result.snapshots.filter((s) => !s.verification.ok).length
      const exportText = result.lastExport
        ? result.lastExport.inspection
          ? result.lastExport.inspection.ok
            ? 'Senaste exporten öppnades och är hel.'
            : 'Senaste exporten har fel — se nedan.'
          : `Senaste exporten kunde inte kontrolleras: ${systemCodeText(result.lastExport.error ?? 'VERIFY_FAILED')}`
        : 'Ingen export att kontrollera.'
      return {
        tone: failing === 0 && (result.lastExport?.inspection?.ok ?? true) ? 'ok' : 'bad',
        text: `${result.snapshots.length} ögonblicksbilder kontrollerade, ${failing} med fel. ${exportText}`,
      }
    })

  async function openFolder(path: string | null) {
    if (!desktop || !path) return
    const outcome = await desktop.openPath(path)
    if (outcome) setMessage({ tone: 'bad', text: `Mappen kunde inte öppnas: ${outcome}` })
  }

  const failure = status.database.code && status.database.code !== 'NOT_INITIALISED'
    ? STORE_FAILURE_TEXT[status.database.code]
    : null

  return (
    <section aria-label="Säkerhet & backup" className="ref-panel flex min-w-0 flex-col">
      <ModuleHead
        title="Säkerhet & backup"
        icon={ShieldCheck}
        meta={`schema v${status.schemaVersion} · ${status.appVersion}${status.desktop ? ' · desktop' : ''}`}
      />
      {!sqlite ? (
        <p className="type-inst-sub px-5 pb-5">{systemCodeText('NOT_SQLITE')}</p>
      ) : (
        <>
          {failure && (
            <div className="mx-5 mb-4 rounded-lg border border-negative/40 bg-negative/10 px-4 py-3">
              <p className="type-section text-negative">{failure.title}</p>
              <p className="mt-1 text-[13px] leading-snug text-content">{failure.body}</p>
              {status.database.detail && (
                <p className="type-machine mt-1.5">{status.database.detail}</p>
              )}
            </div>
          )}
          {status.database.uncleanShutdown && open && (
            <p className="mx-5 mb-4 rounded-lg border border-line bg-surface-2/60 px-4 py-2.5 text-[12.5px] leading-snug text-content-muted">
              Senaste sessionen avslutades inte i ordning. Databasen kontrollerades vid start
              och är hel.
            </p>
          )}
          <dl className="grid gap-x-6 gap-y-4 px-5 pb-4 md:grid-cols-2 xl:grid-cols-3">
            <Fact label="Databas">
              {DATABASE_STATE_LABEL[status.database.state]}
              {open && (
                <span className="block text-content-muted">
                  {countsText(status.database.counts)} · {formatBytes(status.database.sizeBytes)}
                </span>
              )}
            </Fact>
            <Fact label="Datamapp">
              <span className="type-machine block break-all">{status.dataRoot ?? '—'}</span>
            </Fact>
            <Fact label="Senaste ögonblicksbild">
              {status.backups.lastSnapshot ? (
                <>
                  {formatMoment(status.backups.lastSnapshot.createdAt)}
                  <span className="block text-content-muted">
                    {TRIGGER_LABEL[status.backups.lastSnapshot.trigger]} ·{' '}
                    {status.backups.lastSnapshot.verified ? 'verifierad' : 'ej verifierad'} ·{' '}
                    {status.backups.snapshots.length} lokala
                  </span>
                </>
              ) : (
                'Ingen ögonblicksbild ännu'
              )}
            </Fact>
            <Fact label="Extern backup">
              {config?.external ? (
                <>
                  <span className="type-machine block break-all">{config.external.path}</span>
                  <span className="block text-content-muted">
                    {config.lastExport && config.lastExport.destination === 'EXTERNAL'
                      ? `senast ${formatMoment(config.lastExport.at)} · ${config.lastExport.verified ? 'verifierad' : 'ej verifierad'}`
                      : 'ingen export ännu'}
                    {config.dailyExport ? ' · daglig export på' : ' · daglig export av'}
                  </span>
                </>
              ) : (
                'Ingen extern mapp vald'
              )}
              {config?.lastExportError && (
                <span className="block text-negative">
                  Senaste försök {formatMoment(config.lastExportError.at)}:{' '}
                  {systemCodeText(config.lastExportError.code)}
                </span>
              )}
            </Fact>
            <Fact label="Lösenfras för backup">
              {PASSPHRASE_KEEPING_LABEL[status.backups.passphrase]}
            </Fact>
            <Fact label="Senaste export">
              {config?.lastExport
                ? `${formatMoment(config.lastExport.at)} · ${config.lastExport.destination === 'EXTERNAL' ? 'extern' : 'lokal'} · ${formatBytes(config.lastExport.sizeBytes)}`
                : 'Ingen krypterad backup exporterad'}
            </Fact>
          </dl>

          <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
            <button
              type="button"
              disabled={!open || busy !== null}
              onClick={() => void snapshotNow()}
              className={cn('jarvis-gold-btn dossier-cta', (!open || busy) && 'opacity-50')}
            >
              Skapa backup nu
            </button>
            <Ghost onClick={() => void verify()} disabled={busy !== null}>
              Verifiera backup
            </Ghost>
            <Ghost onClick={() => setPanel(panel === 'export' ? null : 'export')} disabled={!open}>
              Exportera krypterad backup
            </Ghost>
            <Ghost onClick={() => setPanel(panel === 'restore' ? null : 'restore')}>
              Återställ från backup
            </Ghost>
            {desktop && (
              <Ghost onClick={() => void openFolder(status.backups.snapshotsDir)}>
                Öppna backupmapp
              </Ghost>
            )}
            <Ghost onClick={() => setPanel(panel === 'destination' ? null : 'destination')}>
              Extern mapp
            </Ghost>
            <Ghost onClick={() => setPanel(panel === 'passphrase' ? null : 'passphrase')}>
              Lösenfras
            </Ghost>
          </div>

          {message && (
            <p
              role="status"
              className={cn(
                'mx-5 mb-4 text-[12.5px] leading-snug',
                message.tone === 'ok' ? 'text-positive' : 'text-negative',
              )}
            >
              {message.text}
            </p>
          )}

          {panel === 'export' && (
            <ExportPanel
              status={status}
              onClose={() => setPanel(null)}
              onDone={async (text) => {
                setMessage({ tone: 'ok', text })
                setPanel(null)
                await onChanged()
              }}
            />
          )}
          {panel === 'restore' && (
            <RestorePanel status={status} mode={mode} onClose={() => setPanel(null)} />
          )}
          {panel === 'destination' && (
            <DestinationPanel
              status={status}
              onClose={() => setPanel(null)}
              onDone={async (text) => {
                setMessage({ tone: 'ok', text })
                setPanel(null)
                await onChanged()
              }}
            />
          )}
          {panel === 'passphrase' && (
            <PassphrasePanel
              status={status}
              onClose={() => setPanel(null)}
              onDone={async (text) => {
                setMessage({ tone: 'ok', text })
                setPanel(null)
                await onChanged()
              }}
            />
          )}

          {verification && <VerificationList result={verification} />}

          <SnapshotRows
            snapshots={status.backups.snapshots}
            allowRestore={mode === 'recovery' || !open}
          />
          {desktop && <AutostartRow />}
        </>
      )}
    </section>
  )
}

/* ----------------------------------------------------------------- panels */

function ExportPanel({
  status,
  onClose,
  onDone,
}: {
  status: SystemStatus
  onClose: () => void
  onDone: (text: string) => Promise<void>
}) {
  const kept = status.backups.passphrase !== 'none'
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [to, setTo] = useState<'EXTERNAL' | 'LOCAL'>(
    status.backups.config?.external ? 'EXTERNAL' : 'LOCAL',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const needsPassphrase = !kept || passphrase.length > 0
  const canSubmit =
    !busy && (!needsPassphrase || (passphrase.length >= 8 && passphrase === confirm))

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const result = await exportBundleFn({
        data: { ...(passphrase ? { passphrase } : {}), to },
      })
      if (result.ok)
        await onDone(
          `Krypterad backup skriven ${formatMoment(result.record.at)} till ${result.record.path} · ${formatBytes(result.record.sizeBytes)} · ${result.record.verified ? 'öppnad och verifierad efter skrivning' : 'EJ verifierad'}.`,
        )
      else setError(systemCodeText(result.code, result.detail))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ActPanel
      title="Exportera krypterad backup"
      icon={Upload}
      onClose={onClose}
      lede="Databasen och alla genererade dokument i en fil (.financialos), krypterad med AES-256-GCM under din lösenfras. Utan lösenfrasen kan filen inte öppnas — av någon."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Till">
          <select
            className="hq-field w-full py-1 text-[13px]"
            value={to}
            onChange={(e) => setTo(e.target.value as 'EXTERNAL' | 'LOCAL')}
          >
            {status.backups.config?.external && (
              <option value="EXTERNAL">Extern mapp · {status.backups.config.external.path}</option>
            )}
            <option value="LOCAL">Lokal backupmapp · {status.backups.bundlesDir}</option>
          </select>
        </Field>
        <div />
        <Field label={kept ? 'Ny lösenfras (valfritt — den sparade används annars)' : 'Lösenfras'} required={!kept}>
          <input
            type="password"
            autoComplete="new-password"
            className="hq-field w-full py-1 text-[13px]"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="minst 8 tecken"
          />
        </Field>
        <Field label="Bekräfta lösenfras" required={!kept}>
          <input
            type="password"
            autoComplete="new-password"
            className="hq-field w-full py-1 text-[13px]"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
      </div>
      <p className="type-inst-sub mt-3">
        {kept
          ? `Lösenfras: ${PASSPHRASE_KEEPING_LABEL[status.backups.passphrase].toLowerCase()}.`
          : status.desktop
            ? 'Lösenfrasen sparas krypterat på den här datorn (Windows DPAPI) så att den dagliga exporten kan gå utan dig. Den loggas aldrig.'
            : 'Utanför skrivbordsappen hålls lösenfrasen bara i den här sessionen.'}
      </p>
      {error && <p className="mt-3 text-[12.5px] text-negative">{error}</p>}
      <PanelActions
        primary="Exportera"
        disabled={!canSubmit}
        busy={busy}
        onSubmit={() => void submit()}
        onClose={onClose}
      />
    </ActPanel>
  )
}

function RestorePanel({
  status,
  mode,
  onClose,
}: {
  status: SystemStatus
  mode: 'settings' | 'recovery'
  onClose: () => void
}) {
  const desktop = useDesktopBridge()
  const [path, setPath] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [inspection, setInspection] = useState<Awaited<
    ReturnType<typeof inspectBundleFn>
  > | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState<'inspect' | 'restore' | null>(null)
  const [result, setResult] = useState<RestoreResponse | null>(null)

  async function pick() {
    if (!desktop) return
    const chosen = await desktop.chooseFile({
      title: 'Välj backupfil',
      filters: [{ name: 'Financial OS-backup', extensions: ['financialos'] }],
    })
    if (chosen) {
      setPath(chosen)
      setInspection(null)
    }
  }

  async function inspect() {
    setBusy('inspect')
    setResult(null)
    try {
      setInspection(await inspectBundleFn({ data: { path, passphrase } }))
    } finally {
      setBusy(null)
    }
  }

  /* The outcome stays on screen: the summary and its door lead on; the status is re-read when the reader leaves. */
  async function restore() {
    setBusy('restore')
    try {
      setResult(await restoreFromBundleFn({ data: { path, passphrase } }))
    } finally {
      setBusy(null)
    }
  }

  if (result?.ok) return <RestoredSummary result={result} status={status} />

  return (
    <ActPanel
      title="Återställ från backup"
      icon={RotateCcw}
      onClose={onClose}
      lede={
        mode === 'recovery'
          ? 'Välj en krypterad backupfil och ange lösenfrasen. Innehållet granskas innan något ändras; den nuvarande databasen skrivs aldrig över utan flyttas åt sidan.'
          : 'Den nuvarande databasen och dokumenten ersätts av backupens. En ögonblicksbild av det nuvarande tas först, och filerna flyttas åt sidan — inget skrivs över.'
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Backupfil (.financialos)" required className="md:col-span-2">
          <div className="flex gap-2">
            <input
              className="hq-field w-full py-1 text-[13px]"
              value={path}
              onChange={(e) => {
                setPath(e.target.value)
                setInspection(null)
              }}
              placeholder={desktop ? 'välj fil, eller klistra in sökvägen' : 'sökväg till filen'}
            />
            {desktop && (
              <button type="button" onClick={() => void pick()} className="jarvis-ghost-btn dossier-cta shrink-0">
                Välj fil
              </button>
            )}
          </div>
        </Field>
        <Field label="Lösenfras" required>
          <input
            type="password"
            autoComplete="current-password"
            className="hq-field w-full py-1 text-[13px]"
            value={passphrase}
            onChange={(e) => {
              setPassphrase(e.target.value)
              setInspection(null)
            }}
          />
        </Field>
      </div>
      {inspection && !inspection.ok && (
        <p className="mt-3 text-[12.5px] text-negative">
          {systemCodeText(inspection.code, inspection.detail)}
        </p>
      )}
      {inspection?.ok && (
        <div className="mt-4 rounded-lg border border-line bg-surface-2/60 px-4 py-3">
          <p className="type-section text-institution">Backupens innehåll</p>
          <dl className="mt-2 grid gap-x-6 gap-y-3 md:grid-cols-3">
            <Fact label="Skapad">{formatMoment(inspection.inspection.manifest.createdAt)}</Fact>
            <Fact label="Innehåll">{countsText(inspection.inspection.manifest.counts)}</Fact>
            <Fact label="Schema">
              v{inspection.inspection.manifest.schemaVersion}
              {inspection.inspection.manifest.schemaVersion < status.schemaVersion
                ? ` · uppgraderas till v${status.schemaVersion} vid återställning`
                : ''}
            </Fact>
            <Fact label="Program">{inspection.inspection.manifest.appVersion}</Fact>
            <Fact label="Filer">
              {inspection.inspection.documents} dokument · {formatBytes(inspection.inspection.sizeBytes)}
            </Fact>
            <Fact label="Kontroll">
              {inspection.inspection.ok
                ? 'Alla kontrollsummor stämmer · databasen hel'
                : inspection.inspection.issues.map((i) => systemCodeText(i.code, i.path)).join(' ')}
            </Fact>
          </dl>
          {inspection.inspection.ok && (
            <label className="mt-3 flex items-start gap-2 text-[13px] text-content">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>
                Jag förstår att det nuvarande innehållet ersätts av backupens från{' '}
                {formatMoment(inspection.inspection.manifest.createdAt)}. Det nuvarande flyttas
                åt sidan och skrivs inte över.
              </span>
            </label>
          )}
        </div>
      )}
      {result && !result.ok && (
        <p className="mt-3 text-[12.5px] text-negative">
          {systemCodeText(result.code, result.detail)}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!inspection?.ok ? (
          <button
            type="button"
            disabled={busy !== null || !path || !passphrase}
            onClick={() => void inspect()}
            className={cn('jarvis-gold-btn dossier-cta', (busy || !path || !passphrase) && 'opacity-50')}
          >
            {busy === 'inspect' ? 'Granskar …' : 'Granska backup'}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy !== null || !confirmed || !inspection.inspection.ok}
            onClick={() => void restore()}
            className={cn('jarvis-gold-btn dossier-cta', (busy || !confirmed) && 'opacity-50')}
          >
            {busy === 'restore' ? 'Återställer …' : 'Återställ'}
          </button>
        )}
        <button type="button" onClick={onClose} className="jarvis-ghost-btn dossier-cta">
          Avbryt
        </button>
      </div>
    </ActPanel>
  )
}

/** After a restore: what came back, and the way on — a relaunch in the desktop, the book otherwise. */
function RestoredSummary({
  result,
  status,
}: {
  result: Extract<RestoreResponse, { ok: true }>
  status: SystemStatus
}) {
  const desktop = useDesktopBridge()
  const s = result.summary
  return (
    <div className="mx-5 mb-5 rounded-lg border border-institution/40 bg-surface-2/60 px-5 py-4">
      <p className="type-section text-institution">Återställt</p>
      <p className="mt-1 font-display text-[20px] leading-snug text-content">
        Financial OS är återställt från {s.source === 'bundle' ? 'backupen' : 'ögonblicksbilden'}{' '}
        {formatMoment(s.sourceCreatedAt)}.
      </p>
      <dl className="mt-3 grid gap-x-6 gap-y-3 md:grid-cols-3">
        <Fact label="Innehåll">{countsText(s.counts)}</Fact>
        <Fact label="Dokument">{s.documentsRestored} återställda</Fact>
        <Fact label="Schema">
          v{s.schema.from} → v{s.schema.to}
        </Fact>
        <Fact label="Säkerhetskopia av det tidigare">
          {s.safetySnapshot ? 'ögonblicksbild tagen' : 'ingen (gick inte att läsa)'}
        </Fact>
        <Fact label="Tidigare databas">
          {s.replacedDatabase ? 'flyttad åt sidan' : 'ingen fanns'}
        </Fact>
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {desktop ? (
          <button
            type="button"
            onClick={() => void desktop.relaunch()}
            className="jarvis-gold-btn dossier-cta"
          >
            Starta om Financial OS
          </button>
        ) : (
          <Link to="/clients" className="jarvis-gold-btn dossier-cta" reloadDocument>
            Öppna Klienter
          </Link>
        )}
        <span className="type-inst-sub">
          {status.desktop
            ? 'Programmet startas om och öppnar det återställda registret.'
            : 'Nästa läsning öppnar det återställda registret.'}
        </span>
      </div>
    </div>
  )
}

function DestinationPanel({
  status,
  onClose,
  onDone,
}: {
  status: SystemStatus
  onClose: () => void
  onDone: (text: string) => Promise<void>
}) {
  const desktop = useDesktopBridge()
  const [path, setPath] = useState(status.backups.config?.external?.path ?? '')
  const [daily, setDaily] = useState(status.backups.config?.dailyExport ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pick() {
    if (!desktop) return
    const chosen = await desktop.chooseFolder('Välj mapp för extern backup')
    if (chosen) setPath(chosen)
  }

  async function save(clear = false) {
    setBusy(true)
    setError(null)
    try {
      const result = await setBackupDestinationFn({
        data: { path: clear ? null : path, dailyExport: daily },
      })
      if (result.ok)
        await onDone(
          result.external
            ? `Extern backupmapp: ${result.external.path}. Daglig export ${result.dailyExport ? 'på' : 'av'}.`
            : 'Ingen extern backupmapp vald.',
        )
      else setError(systemCodeText(result.code))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ActPanel
      title="Extern backupmapp"
      icon={HardDrive}
      onClose={onClose}
      lede="En mapp utanför datorn eller på en annan enhet: ett USB-minne, en nätverksmapp, en mapp som en tjänst du själv valt synkroniserar. Financial OS namnger ingen leverantör och laddar aldrig upp något självt."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Mapp" required className="md:col-span-2">
          <div className="flex gap-2">
            <input
              className="hq-field w-full py-1 text-[13px]"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder={desktop ? 'välj mapp …' : 'sökväg till mappen'}
            />
            {desktop && (
              <button type="button" onClick={() => void pick()} className="jarvis-ghost-btn dossier-cta shrink-0">
                Välj mapp
              </button>
            )}
          </div>
        </Field>
        <label className="flex items-start gap-2 text-[13px] text-content md:col-span-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={daily}
            onChange={(e) => setDaily(e.target.checked)}
          />
          <span>
            Daglig krypterad export till mappen när programmet är igång — kräver en sparad
            lösenfras. En mapp som inte finns när det är dags rapporteras här, aldrig tyst.
          </span>
        </label>
      </div>
      {error && <p className="mt-3 text-[12.5px] text-negative">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || path.trim().length === 0}
          onClick={() => void save()}
          className={cn('jarvis-gold-btn dossier-cta', (busy || !path.trim()) && 'opacity-50')}
        >
          Spara
        </button>
        {status.backups.config?.external && (
          <button type="button" disabled={busy} onClick={() => void save(true)} className="jarvis-ghost-btn dossier-cta">
            Ta bort extern mapp
          </button>
        )}
        <button type="button" onClick={onClose} className="jarvis-ghost-btn dossier-cta">
          Avbryt
        </button>
      </div>
    </ActPanel>
  )
}

function PassphrasePanel({
  status,
  onClose,
  onDone,
}: {
  status: SystemStatus
  onClose: () => void
  onDone: (text: string) => Promise<void>
}) {
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canSubmit = !busy && passphrase.length >= 8 && passphrase === confirm

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const result = await setBackupPassphraseFn({ data: { passphrase } })
      if (result.ok) await onDone(`Lösenfras sparad: ${PASSPHRASE_KEEPING_LABEL[result.keeping].toLowerCase()}.`)
      else setError(systemCodeText(result.code))
    } finally {
      setBusy(false)
    }
  }

  async function clear() {
    setBusy(true)
    try {
      const result = await clearBackupPassphraseFn()
      if (result.ok) await onDone('Lösenfrasen är borttagen. Den dagliga exporten står stilla tills en ny anges.')
      else setError(systemCodeText(result.code))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ActPanel
      title="Lösenfras för backup"
      icon={KeyRound}
      onClose={onClose}
      lede="Samma lösenfras krypterar varje export och krävs för varje återställning. Den finns inte hos oss och går inte att återskapa: skriv ner den och förvara den på ett annat ställe än datorn."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Lösenfras" required>
          <input
            type="password"
            autoComplete="new-password"
            className="hq-field w-full py-1 text-[13px]"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="minst 8 tecken"
          />
        </Field>
        <Field label="Bekräfta" required>
          <input
            type="password"
            autoComplete="new-password"
            className="hq-field w-full py-1 text-[13px]"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
      </div>
      <p className="type-inst-sub mt-3">
        Nu: {PASSPHRASE_KEEPING_LABEL[status.backups.passphrase].toLowerCase()}.
        {status.desktop
          ? ' Sparas krypterat med Windows DPAPI, läsbar bara av ditt konto på den här datorn.'
          : ' Utanför skrivbordsappen hålls den bara i den här sessionen.'}
      </p>
      {error && <p className="mt-3 text-[12.5px] text-negative">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void save()}
          className={cn('jarvis-gold-btn dossier-cta', !canSubmit && 'opacity-50')}
        >
          Spara lösenfras
        </button>
        {status.backups.passphrase !== 'none' && (
          <button type="button" disabled={busy} onClick={() => void clear()} className="jarvis-ghost-btn dossier-cta">
            Ta bort sparad lösenfras
          </button>
        )}
        <button type="button" onClick={onClose} className="jarvis-ghost-btn dossier-cta">
          Avbryt
        </button>
      </div>
    </ActPanel>
  )
}

/* ------------------------------------------------------------------ lists */

function VerificationList({ result }: { result: Extract<VerifyBackupsResponse, { ok: true }> }) {
  return (
    <div className="mx-5 mb-4">
      <p className="type-section">Verifiering</p>
      <ul className="mt-1.5 flex flex-col">
        {result.snapshots.map(({ snapshot, verification }) => (
          <li key={snapshot.id} className="dossier-row flex items-baseline gap-3 py-2">
            <span className={cn('type-section w-16 shrink-0', verification.ok ? 'text-positive' : 'text-negative')}>
              {verification.ok ? 'OK' : 'FEL'}
            </span>
            <span className="min-w-0 flex-1 text-[13px] text-content">
              {formatMoment(snapshot.createdAt)} · {TRIGGER_LABEL[snapshot.trigger]}
              {!verification.ok && (
                <span className="block text-negative">
                  {verification.checksum === 'mismatch' ? 'kontrollsumman stämmer inte' : verification.quickCheck}
                </span>
              )}
            </span>
            <span className="type-machine shrink-0">{formatBytes(snapshot.sizeBytes)}</span>
          </li>
        ))}
        {result.lastExport && (
          <li className="dossier-row flex items-baseline gap-3 py-2">
            <span
              className={cn(
                'type-section w-16 shrink-0',
                result.lastExport.inspection?.ok ? 'text-positive' : 'text-negative',
              )}
            >
              {result.lastExport.inspection?.ok ? 'OK' : 'FEL'}
            </span>
            <span className="min-w-0 flex-1 text-[13px] text-content">
              Export {formatMoment(result.lastExport.record.at)} ·{' '}
              <span className="type-machine break-all">{result.lastExport.record.path}</span>
              {result.lastExport.error && (
                <span className="block text-negative">{systemCodeText(result.lastExport.error)}</span>
              )}
              {result.lastExport.inspection && !result.lastExport.inspection.ok && (
                <span className="block text-negative">
                  {result.lastExport.inspection.issues.map((i) => systemCodeText(i.code, i.path)).join(' ')}
                </span>
              )}
            </span>
          </li>
        )}
      </ul>
    </div>
  )
}

function SnapshotRows({
  snapshots,
  allowRestore,
}: {
  snapshots: readonly SnapshotMeta[]
  allowRestore: boolean
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<{ id: string; result: RestoreResponse } | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const desktop = useDesktopBridge()
  if (snapshots.length === 0)
    return <p className="type-inst-sub px-5 pb-5">Inga lokala ögonblicksbilder ännu.</p>

  async function restore(id: string) {
    setBusy(id)
    try {
      setOutcome({ id, result: await restoreFromSnapshotFn({ data: { id } }) })
      setConfirming(null)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="px-5 pb-5">
      <p className="type-section">Lokala ögonblicksbilder</p>
      <ul className="mt-1.5 flex flex-col" aria-label="Lokala ögonblicksbilder">
        {snapshots.slice(0, 12).map((snapshot) => (
          <li key={snapshot.id} className="dossier-row flex flex-wrap items-center gap-3 py-2">
            <span className="min-w-0 flex-1 text-[13px] text-content">
              {formatMoment(snapshot.createdAt)}
              <span className="text-content-muted">
                {' '}
                · {TRIGGER_LABEL[snapshot.trigger]} · {snapshot.verified ? 'verifierad' : 'ej verifierad'}
                {snapshot.counts ? ` · ${countsText(snapshot.counts)}` : ''}
              </span>
            </span>
            <span className="type-machine shrink-0">{formatBytes(snapshot.sizeBytes)}</span>
            {allowRestore &&
              (confirming === snapshot.id ? (
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void restore(snapshot.id)}
                    className="jarvis-gold-btn dossier-cta"
                  >
                    {busy === snapshot.id ? 'Återställer …' : 'Bekräfta återställning'}
                  </button>
                  <button type="button" onClick={() => setConfirming(null)} className="jarvis-ghost-btn dossier-cta">
                    Avbryt
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  disabled={busy !== null || !snapshot.verified}
                  onClick={() => setConfirming(snapshot.id)}
                  className={cn('jarvis-ghost-btn dossier-cta', !snapshot.verified && 'opacity-50')}
                >
                  Återställ
                </button>
              ))}
            {outcome?.id === snapshot.id && (
              <span className={cn('basis-full text-[12.5px]', outcome.result.ok ? 'text-positive' : 'text-negative')}>
                {outcome.result.ok
                  ? `Återställt från ögonblicksbilden. ${desktop ? 'Starta om Financial OS för att öppna det återställda registret.' : 'Nästa läsning öppnar det återställda registret.'}`
                  : systemCodeText(outcome.result.code, outcome.result.detail)}
                {outcome.result.ok &&
                  (desktop ? (
                    <button
                      type="button"
                      onClick={() => void desktop.relaunch()}
                      className="jarvis-gold-btn dossier-cta ml-3"
                    >
                      Starta om Financial OS
                    </button>
                  ) : (
                    <Link to="/clients" className="jarvis-gold-btn dossier-cta ml-3" reloadDocument>
                      Öppna Klienter
                    </Link>
                  ))}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** "Starta med Windows" — only on the desktop, only when the person says so. */
function AutostartRow() {
  const desktop = useDesktopBridge()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    void desktop?.autostart.get().then((value) => {
      if (alive) setEnabled(value)
    })
    return () => {
      alive = false
    }
  }, [desktop])
  if (!desktop) return null
  return (
    <div className="border-t border-hairline px-5 py-4">
      <label className="flex items-start gap-2 text-[13px] text-content">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={enabled === true}
          disabled={enabled === null}
          onChange={(e) => void desktop.autostart.set(e.target.checked).then(setEnabled)}
        />
        <span>
          Starta Financial OS med Windows
          <span className="block text-content-muted">
            Av tills du väljer det. Programmet startar då tillsammans med datorn.
          </span>
        </span>
      </label>
    </div>
  )
}

/* ------------------------------------------------------------------ bits */

function ActPanel({
  title,
  icon,
  lede,
  onClose,
  children,
}: {
  title: string
  icon: typeof Archive
  lede: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <section
      aria-label={title}
      className="mx-5 mb-5 rounded-lg border border-line bg-surface-2/50 px-5 py-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <ModuleIcon icon={icon} />
          <h3 className="type-section text-content">{title}</h3>
        </div>
        <button type="button" onClick={onClose} className="type-section text-content-muted hover:text-content">
          Stäng
        </button>
      </div>
      <p className="type-inst-sub mt-2 mb-4">{lede}</p>
      {children}
    </section>
  )
}

function PanelActions({
  primary,
  disabled,
  busy,
  onSubmit,
  onClose,
}: {
  primary: string
  disabled: boolean
  busy: boolean
  onSubmit: () => void
  onClose: () => void
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={disabled}
        onClick={onSubmit}
        className={cn('jarvis-gold-btn dossier-cta', disabled && 'opacity-50')}
      >
        {busy ? `${primary} …` : primary}
      </button>
      <button type="button" onClick={onClose} className="jarvis-ghost-btn dossier-cta">
        Avbryt
      </button>
    </div>
  )
}

function Ghost({
  children,
  onClick,
  disabled = false,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn('jarvis-ghost-btn dossier-cta', disabled && 'opacity-50')}
    >
      {children}
    </button>
  )
}

function Field({
  label,
  required = false,
  children,
  className,
}: {
  label: string
  required?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn('block min-w-0', className)}>
      <span className="type-section block">
        {label}
        {required && <span className="ml-1 text-institution">·</span>}
      </span>
      <span className="mt-1 block">{children}</span>
    </label>
  )
}

export { FolderOpen }

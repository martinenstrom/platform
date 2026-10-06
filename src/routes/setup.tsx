import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { FolderPlus, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { PlatformShell } from '~/components/platform/PlatformShell'
import { RecoveryCenter } from '~/components/platform/RecoveryCenter'
import { ModuleIcon } from '~/components/clients/dossier/Module'
import { cn } from '~/lib/cn'
import { getSystemStatusFn, initialiseFinancialOsFn } from '~/infrastructure/platform/serverFns'
import { systemCodeText } from '~/presentation/platform/systemText'

/**
 * The first launch: no database exists, and nothing is written until the
 * person chooses — a new Financial OS (an empty record, never a demo), or
 * an existing one restored from a backup.
 */
export const Route = createFileRoute('/setup')({
  loader: () => getSystemStatusFn(),
  staleTime: 0,
  component: SetupPage,
})

function SetupPage() {
  const status = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const [choice, setChoice] = useState<'create' | 'restore' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = status.database.state === 'OK' || status.database.state === 'SYNTHETIC'

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const result = await initialiseFinancialOsFn()
      if (!result.ok) {
        setError(systemCodeText(result.code))
        return
      }
      await router.invalidate()
      await navigate({ to: '/clients' })
    } finally {
      setBusy(false)
    }
  }

  if (ready)
    return (
      <PlatformShell
        kicker="Financial OS"
        title="Financial OS är igång"
        lede="Det finns redan ett register på den här datorn. Säkerhet & backup finns under Inställningar."
      >
        <div className="flex gap-3 px-1">
          <Link to="/clients" className="jarvis-gold-btn dossier-cta">
            Öppna Klienter
          </Link>
          <Link to="/settings" className="jarvis-ghost-btn dossier-cta">
            Inställningar
          </Link>
        </div>
      </PlatformShell>
    )

  return (
    <PlatformShell
      kicker="Välkommen"
      title="Ditt Financial OS"
      lede={
        <>
          Ett personligt operativsystem för en rådgivare. Allt du registrerar lagras lokalt på den
          här datorn{status.dataRoot ? <> i <span className="type-machine">{status.dataRoot}</span></> : ''}
          , aldrig i molnet. Börja med ett tomt register, eller hämta tillbaka ett befintligt från
          en krypterad backup.
        </>
      }
      wide
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Choice
          icon={FolderPlus}
          title="Skapa nytt Financial OS"
          body="En tom databas skapas i din datamapp. Inga exempelklienter läggs in — det första du ser är en tom bok och dörren till din första PB-relation."
          selected={choice === 'create'}
          onClick={() => setChoice('create')}
        />
        <Choice
          icon={RotateCcw}
          title="Återställ befintligt Financial OS"
          body="Välj en krypterad backupfil (.financialos) och ange lösenfrasen. Innehållet granskas — datum, klienter, kontor, dokument — innan något återställs."
          selected={choice === 'restore'}
          onClick={() => setChoice('restore')}
        />
      </div>
      {choice === 'create' && (
        <section className="ref-panel px-5 py-4" aria-label="Skapa nytt Financial OS">
          <p className="type-section text-institution">Skapa nytt</p>
          <p className="mt-1 text-[13px] leading-snug text-content">
            Databasen skapas nu, tom, med programmets aktuella schema. Säkerhet & backup —
            ögonblicksbilder, krypterad export, extern mapp — finns sedan under Inställningar.
          </p>
          {error && <p className="mt-3 text-[12.5px] text-negative">{error}</p>}
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void create()}
              className={cn('jarvis-gold-btn dossier-cta', busy && 'opacity-50')}
            >
              {busy ? 'Skapar …' : 'Skapa nytt Financial OS'}
            </button>
            <button type="button" onClick={() => setChoice(null)} className="jarvis-ghost-btn dossier-cta">
              Avbryt
            </button>
          </div>
        </section>
      )}
      {choice === 'restore' && (
        <RecoveryCenter status={status} mode="recovery" onChanged={() => router.invalidate()} />
      )}
    </PlatformShell>
  )
}

function Choice({
  icon,
  title,
  body,
  selected,
  onClick,
}: {
  icon: typeof FolderPlus
  title: string
  body: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'ref-panel flex min-w-0 flex-col items-start gap-3 px-5 py-5 text-left transition-colors',
        selected ? 'border-institution/60' : 'hover:border-line',
      )}
    >
      <ModuleIcon icon={icon} size={16} />
      <span className="font-display text-[22px] leading-snug text-content">{title}</span>
      <span className="text-[13px] leading-snug text-content-muted">{body}</span>
    </button>
  )
}

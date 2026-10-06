import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { PlatformShell } from '~/components/platform/PlatformShell'
import { RecoveryCenter } from '~/components/platform/RecoveryCenter'
import { getSystemStatusFn } from '~/infrastructure/platform/serverFns'
import { STORE_FAILURE_TEXT } from '~/presentation/platform/systemText'

/**
 * Recovery Mode: the record refused to open, and the application says why
 * in words, offers the newest verified snapshot and a restore from a
 * backup, and never touches the primary file until the person chooses.
 */
export const Route = createFileRoute('/recovery')({
  loader: () => getSystemStatusFn(),
  staleTime: 0,
  component: RecoveryPage,
})

function RecoveryPage() {
  const status = Route.useLoaderData()
  const router = useRouter()
  const failure =
    status.database.code && status.database.code !== 'NOT_INITIALISED'
      ? STORE_FAILURE_TEXT[status.database.code]
      : null
  const healthy = status.database.state === 'OK' || status.database.state === 'SYNTHETIC'
  return (
    <PlatformShell
      kicker="Återställningsläge"
      title={healthy ? 'Registret är öppet' : (failure?.title ?? 'Databasen kunde inte öppnas')}
      lede={
        healthy
          ? 'Databasen öppnades och kontrollerades. Härifrån kan du gå tillbaka till arbetet, eller återställa från en backup om du behöver.'
          : failure?.body
      }
      wide
    >
      <div className="flex flex-wrap items-center gap-3 px-1 pb-2">
        {healthy ? (
          <Link to="/clients" className="jarvis-gold-btn dossier-cta">
            Öppna Klienter
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => void router.invalidate()}
            className="jarvis-ghost-btn dossier-cta"
          >
            Försök öppna igen
          </button>
        )}
        <Link to="/setup" className="jarvis-ghost-btn dossier-cta">
          Börja om från början
        </Link>
      </div>
      <RecoveryCenter status={status} mode="recovery" onChanged={() => router.invalidate()} />
    </PlatformShell>
  )
}

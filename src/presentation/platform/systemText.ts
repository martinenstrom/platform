/**
 * The system in the product's words: what a refusal to open means and
 * what to do, what a backup code says, how a byte count and a moment read.
 * Codes come from the platform doors; the sentences are here, once.
 */

import type {
  DatabaseState,
  PassphraseKeeping,
  SnapshotTrigger,
  StoreFailureCode,
  SystemStatus,
} from '~/infrastructure/platform/serverFns'
import { formatLongDate } from '~/presentation/advisory/format'

export const STORE_FAILURE_TEXT: Record<StoreFailureCode, { title: string; body: string }> = {
  NOT_INITIALISED: {
    title: 'Ingen databas ännu',
    body: 'Skapa ett nytt Financial OS eller återställ ett befintligt från en backup.',
  },
  SCHEMA_TOO_NEW: {
    title: 'Databasen är nyare än programmet',
    body: 'Databasen skapades av en nyare version av Financial OS. Uppdatera programmet, eller återställ en backup som den här versionen kan läsa. Databasen är orörd.',
  },
  CHECKSUM_MISMATCH: {
    title: 'Databasens schemahistorik stämmer inte',
    body: 'En registrerad migrering matchar inte programmets. Återställ från en verifierad ögonblicksbild eller en krypterad backup. Databasen är orörd.',
  },
  MIGRATION_FAILED: {
    title: 'Uppgraderingen av databasen misslyckades',
    body: 'Databasen lämnades som den var och en ögonblicksbild togs före försöket. Försök igen, eller återställ från en backup.',
  },
  VERIFICATION_FAILED: {
    title: 'Databasen klarade inte kontrollen efter uppgradering',
    body: 'Återställ från ögonblicksbilden som togs före uppgraderingen, eller från en krypterad backup.',
  },
  INTEGRITY_FAILED: {
    title: 'Databasen är skadad',
    body: 'Integritetskontrollen vid start misslyckades. Återställ från den senaste verifierade ögonblicksbilden eller en krypterad backup. Den skadade filen skrivs aldrig över: den flyttas åt sidan vid återställning.',
  },
  CANNOT_OPEN: {
    title: 'Databasen kunde inte öppnas',
    body: 'Kontrollera att datamappen är åtkomlig och inte används av ett annat program, eller återställ från en backup.',
  },
}

export const DATABASE_STATE_LABEL: Record<DatabaseState, string> = {
  SYNTHETIC: 'Syntetiskt register i minnet',
  NOT_INITIALISED: 'Ingen databas ännu',
  OK: 'Öppen och kontrollerad',
  RECOVERY: 'Återställningsläge',
}

/** What a backup, bundle, restore or platform code says. */
export const SYSTEM_CODE_TEXT: Record<string, string> = {
  NOT_A_BUNDLE: 'Filen är inte en Financial OS-backup.',
  UNSUPPORTED_VERSION: 'Backupformatet stöds inte av den här versionen av programmet.',
  WRONG_PASSPHRASE: 'Fel lösenfras — eller så är filen skadad. De två går inte att skilja åt, avsiktligt.',
  CORRUPT: 'Backupfilen är skadad.',
  MISSING_ENTRY: 'Backupfilen saknar en del av innehållet.',
  CHECKSUM_MISMATCH: 'En fil i backupen stämmer inte med sin kontrollsumma.',
  SCHEMA_TOO_NEW: 'Backupen kommer från en nyare version av Financial OS än den här.',
  DATABASE_INVALID: 'Databasen i backupen klarade inte integritetskontrollen.',
  VERIFY_FAILED: 'Kontrollen misslyckades.',
  MIGRATION_FAILED: 'Databasen kunde inte uppgraderas till programmets version. Inget ändrades.',
  SWAP_FAILED: 'Filerna kunde inte bytas. Den tidigare databasen är orörd.',
  SNAPSHOT_INVALID: 'Ögonblicksbilden är skadad eller saknas.',
  NOT_SQLITE: 'Säkerhet & backup gäller den lokala databasen; den här miljön kör registret i minnet.',
  NOT_OPEN: 'Databasen är inte öppen.',
  NO_PASSPHRASE: 'Ange en lösenfras för backupen.',
  PASSPHRASE_TOO_SHORT: 'Lösenfrasen behöver minst 8 tecken.',
  DESTINATION_UNAVAILABLE: 'Mappen finns inte eller går inte att skriva till.',
  EXPORT_FAILED: 'Exporten misslyckades.',
  NOT_FOUND: 'Hittades inte.',
  INVALID: 'Kontrollera uppgifterna.',
  SERVICE_UNAVAILABLE: 'Systemet svarar inte just nu.',
}

export function systemCodeText(code: string, detail?: string | null): string {
  const text = SYSTEM_CODE_TEXT[code] ?? `Åtgärden kunde inte utföras (${code}).`
  return detail ? `${text} ${detail}` : text
}

export const TRIGGER_LABEL: Record<SnapshotTrigger, string> = {
  startup: 'vid start',
  interval: 'schemalagd',
  'post-migration': 'efter uppgradering',
  'post-act': 'efter ändring',
  shutdown: 'vid avslut',
  manual: 'manuell',
  'pre-restore': 'före återställning',
  bundle: 'för backupfil',
}

export const PASSPHRASE_KEEPING_LABEL: Record<PassphraseKeeping, string> = {
  'sealed-on-this-computer': 'Sparad krypterat på den här datorn',
  'this-session-only': 'Endast i den här sessionen',
  none: 'Ingen lösenfras sparad',
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toLocaleString('sv-SE', { maximumFractionDigits: 0 })} kB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toLocaleString('sv-SE', { maximumFractionDigits: 1 })} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toLocaleString('sv-SE', { maximumFractionDigits: 2 })} GB`
}

/** "4 okt 2026 10:12", in the reader's own time. */
export function formatMoment(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const local = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return `${formatLongDate(local)} ${time}`
}

/** "7 klienter · 3 kontor · 2 dokument" — counts, never a percentage. */
export function countsText(
  counts: { clients: number; offices: number; documents: number } | null,
): string {
  if (!counts) return 'Data saknas'
  const one = (n: number, singular: string, plural: string) =>
    `${n} ${n === 1 ? singular : plural}`
  return [
    one(counts.clients, 'klient', 'klienter'),
    one(counts.offices, 'kontor', 'kontor'),
    one(counts.documents, 'dokument', 'dokument'),
  ].join(' · ')
}

/**
 * Where the shell sends the reader before anything else: the first-run page
 * when there is no record, Recovery Mode when the record refused to open.
 * Null where the page may stand.
 */
export function systemGate(
  status: Pick<SystemStatus, 'database'>,
  pathname: string,
): '/setup' | '/recovery' | null {
  const state = status.database.state
  if (state === 'NOT_INITIALISED' && !pathname.startsWith('/setup')) return '/setup'
  if (
    state === 'RECOVERY' &&
    !pathname.startsWith('/recovery') &&
    !pathname.startsWith('/setup')
  )
    return '/recovery'
  return null
}

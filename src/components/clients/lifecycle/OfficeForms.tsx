import { Link } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import type { OfficeActResult } from '~/application/advisory/officeLifecycle'
import type { Office } from '~/domain/advisory'
import { cn } from '~/lib/cn'
import type { Unavailable } from '../clientActions'
import { ModuleHead } from '../dossier/Module'

export interface OfficeFormValues {
  displayName: string
  shortName: string
  city: string
  description: string
}

const REFUSAL: Record<string, string> = {
  INVALID: 'Kontrollera namn och ort.',
  NOT_FOUND: 'Kontoret finns inte.',
  NOT_ALLOWED: 'Inget har ändrats.',
  SERVICE_UNAVAILABLE: 'Relationsminnet svarar inte just nu.',
}

/**
 * Nytt kontor / Redigera kontor: name, short name, city, description. The
 * id is minted by the record and never changes; the presentation image
 * mapping stays in presentation — an office without one shows the
 * fallback material, and that is fine.
 */
export function OfficeForm({
  office,
  onSubmit,
  onDone,
  onCancel,
}: {
  /** The office being edited; none for a new one. */
  office?: Office
  onSubmit: (values: OfficeFormValues) => Promise<OfficeActResult | Unavailable>
  onDone: (office: Office) => void
  onCancel?: () => void
}) {
  const [displayName, setDisplayName] = useState(office?.displayName ?? '')
  const [shortName, setShortName] = useState(office?.shortName ?? '')
  const [city, setCity] = useState(office?.city ?? '')
  const [description, setDescription] = useState(office?.description ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canSubmit = !busy && displayName.trim().length >= 2 && city.trim().length >= 1

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const result = await onSubmit({ displayName, shortName, city, description })
      if (result.ok) onDone(result.office)
      else setError(REFUSAL[result.code] ?? 'Kontoret kunde inte sparas.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSubmit) void submit()
      }}
    >
      <section className="ref-panel">
        <ModuleHead title={office ? 'Redigera kontor' : 'Nytt kontor'} />
        <div className="grid gap-4 px-5 pb-5 md:grid-cols-2">
          <Field label="Namn" required>
            <input
              className="hq-field w-full py-1 text-[13px]"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="t.ex. Stureplan"
              autoFocus
            />
          </Field>
          <Field label="Kortnamn">
            <input
              className="hq-field w-full py-1 text-[13px]"
              value={shortName}
              onChange={(e) => setShortName(e.target.value)}
              placeholder="som en tät rad säger det"
            />
          </Field>
          <Field label="Ort" required>
            <input
              className="hq-field w-full py-1 text-[13px]"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </Field>
          <Field label="Beskrivning" className="md:col-span-2">
            <input
              className="hq-field w-full py-1 text-[13px]"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="valfritt"
            />
          </Field>
          {office && (
            <p className="type-machine md:col-span-2">
              id {office.id} · ändras aldrig · bild:{' '}
              {office.id in PLATE_NOTE ? 'kopplad' : 'fallback-material'}
            </p>
          )}
        </div>
      </section>
      {error && <p className="px-1 text-[12.5px] text-negative">{error}</p>}
      <div className="flex items-center gap-3 px-1 pb-4">
        <button
          type="submit"
          disabled={!canSubmit}
          className={cn('jarvis-gold-btn dossier-cta', !canSubmit && 'opacity-50')}
        >
          {office ? 'Spara kontor' : 'Skapa kontor'}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="jarvis-ghost-btn dossier-cta"
          >
            Avbryt
          </button>
        ) : (
          <Link to="/clients" className="jarvis-ghost-btn dossier-cta">
            Avbryt
          </Link>
        )}
      </div>
    </form>
  )
}

/* The offices the presentation holds a plate for; every other office shows the fallback material. */
const PLATE_NOTE: Record<string, true> = {
  'of-strandvagen': true,
  'of-arbetargatan': true,
  'of-avenyn': true,
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

import { Link } from '@tanstack/react-router'
import { Archive, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { OfficeActResult } from '~/application/advisory/officeLifecycle'
import type { Office } from '~/domain/advisory'
import { cn } from '~/lib/cn'
import { formatLongDate } from '~/presentation/advisory/format'
import type { Unavailable } from '../clientActions'
import { Fact, ModuleIcon } from '../dossier/Module'
import { OfficeForm, type OfficeFormValues } from './OfficeForms'

export interface OfficeActions {
  update(values: OfficeFormValues): Promise<OfficeActResult | Unavailable>
  archiveReview(): Promise<
    | { ok: true; activeClients: readonly { id: string; displayName: string }[] }
    | Unavailable
  >
  archive(input: {
    effectiveDate: string
    transferToOfficeId: string | null
    note: string | null
  }): Promise<OfficeActResult | Unavailable>
  reactivate(input: { effectiveDate: string }): Promise<OfficeActResult | Unavailable>
  /** The other active offices a transfer may go to. */
  destinations(): Promise<readonly Office[]>
}

export type OfficeAct = 'edit' | 'archive' | 'reactivate'

/** The office book's restrained menu: edit, archive; for an archived office, reopen. */
export function OfficeActionsMenu({
  office,
  onChoose,
}: {
  office: Office
  onChoose: (act: OfficeAct) => void
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node))
        ref.current.open = false
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  const items: readonly { act: OfficeAct; label: string; grave?: boolean }[] =
    office.status === 'archived'
      ? [{ act: 'reactivate', label: 'Återöppna kontor' }]
      : [
          { act: 'edit', label: 'Redigera kontor' },
          { act: 'archive', label: 'Arkivera kontor', grave: true },
        ]
  return (
    <details ref={ref} className="dossier-menu relative">
      <summary
        role="button"
        className="jarvis-ghost-btn dossier-cta list-none"
        aria-label="Kontorsåtgärder"
      >
        Kontor
        <ChevronDown className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />
      </summary>
      <ul className="dossier-menu-list" role="menu">
        {items.map((item) => (
          <li key={item.act} role="none">
            <button
              type="button"
              role="menuitem"
              className={cn('dossier-menu-item', item.grave && 'is-grave')}
              onClick={() => {
                if (ref.current) ref.current.open = false
                onChoose(item.act)
              }}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}

/** An archived office says so at the head of its book; the book beneath is history. */
export function ArchivedOfficeModule({ office }: { office: Office }) {
  return (
    <section
      aria-label="Arkiverat kontor"
      className="ref-panel flex min-w-0 flex-col px-5 pt-4 pb-4"
    >
      <div className="flex items-center gap-2.5">
        <ModuleIcon icon={Archive} />
        <h2 className="type-section text-content">Arkiverat kontor</h2>
      </div>
      <p className="mt-3 font-display text-[22px] leading-snug text-content">
        Kontoret arkiverades {office.archivedAt ? formatLongDate(office.archivedAt) : '—'}
      </p>
      <p className="type-inst-sub mt-1.5">
        Kontoret räknas inte in bland aktiva kontor och tar inte emot nya relationer. Dess
        historik och tidigare relationer finns kvar.
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 border-t border-hairline pt-3">
        <Fact label="Arkiverat">
          {office.archivedAt ? formatLongDate(office.archivedAt) : '—'}
        </Fact>
        <Fact label="Ort">{office.city}</Fact>
      </dl>
    </section>
  )
}

/**
 * One office act, opened under the office's head: edit (the form), archive
 * (the review of active relationships — blocked while any remain unless a
 * destination is chosen, every one of them shown), reopen.
 */
export function OfficeActPanel({
  act,
  office,
  today,
  actions,
  onDone,
  onClose,
}: {
  act: OfficeAct
  office: Office
  today: string
  actions: OfficeActions
  onDone: () => Promise<void>
  onClose: () => void
}) {
  const [review, setReview] = useState<
    readonly { id: string; displayName: string }[] | null
  >(null)
  const [destinations, setDestinations] = useState<readonly Office[]>([])
  const [transferTo, setTransferTo] = useState<string>('')
  const [effectiveDate, setEffectiveDate] = useState(today)
  const [note, setNote] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    if (act === 'archive') {
      void actions.archiveReview().then((r) => {
        if (alive && r.ok) setReview(r.activeClients)
      })
      void actions.destinations().then((d) => {
        if (alive)
          setDestinations(d.filter((o) => o.id !== office.id && o.status === 'active'))
      })
    }
    return () => {
      alive = false
    }
  }, [act, actions, office.id])

  if (act === 'edit') {
    return (
      <OfficeForm
        office={office}
        onSubmit={actions.update}
        onDone={async () => {
          await onDone()
          onClose()
        }}
        onCancel={onClose}
      />
    )
  }

  const blocked = act === 'archive' && (review?.length ?? 0) > 0 && transferTo === ''
  const canSubmit = !busy && confirmed && !blocked

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const result =
        act === 'archive'
          ? await actions.archive({
              effectiveDate,
              transferToOfficeId: transferTo || null,
              note: note || null,
            })
          : await actions.reactivate({ effectiveDate })
      if (result.ok) {
        await onDone()
        onClose()
      } else {
        setError(
          result.code === 'HAS_ACTIVE_CLIENTS'
            ? 'Kontoret har aktiva klienter. Flytta eller avsluta dem först.'
            : result.code === 'SERVICE_UNAVAILABLE'
              ? 'Relationsminnet svarar inte just nu.'
              : 'Åtgärden kunde inte utföras.',
        )
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className={cn(
        'ref-panel',
        act === 'archive'
          ? 'shadow-[inset_2px_0_0_0_var(--color-negative)]'
          : 'shadow-[inset_2px_0_0_0_var(--color-institution-line)]',
      )}
      aria-label={act === 'archive' ? 'Arkivera kontor' : 'Återöppna kontor'}
    >
      <header className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
        <h2 className="type-section text-content">
          {act === 'archive' ? 'Arkivera kontor' : 'Återöppna kontor'}
        </h2>
        <button type="button" onClick={onClose} className="dossier-link">
          Stäng
        </button>
      </header>
      <form
        className="grid gap-4 px-5 pb-5 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (canSubmit) void submit()
        }}
      >
        {act === 'archive' && (
          <div className="md:col-span-2">
            {review === null ? (
              <p className="type-inst-sub">Läser kontorets aktiva relationer …</p>
            ) : review.length === 0 ? (
              <p className="type-inst-sub">
                Kontoret har inga aktiva klienter. Det kan arkiveras; historiken behålls.
              </p>
            ) : (
              <>
                <p className="type-section text-warning">
                  Kontoret har {review.length} aktiva{' '}
                  {review.length === 1 ? 'klient' : 'klienter'}
                </p>
                <p className="type-inst-sub mt-1">
                  De måste flyttas eller avslutas innan kontoret arkiveras — eller flyttas
                  i samma steg till ett annat kontor. Varje flytt får sin egen händelse.
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {review.map((c) => (
                    <li key={c.id}>
                      <Link
                        to="/clients/$clientId"
                        params={{ clientId: c.id }}
                        className="dossier-pill hover:text-content"
                      >
                        {c.displayName}
                      </Link>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Link
                    to="/clients/office/$officeId"
                    params={{ officeId: office.id }}
                    className="dossier-link"
                  >
                    Visa klienter →
                  </Link>
                  <label className="flex items-center gap-2 text-[12.5px] text-content">
                    <span className="type-section">Flytta alla till</span>
                    <select
                      className="hq-field py-1 text-[13px]"
                      value={transferTo}
                      onChange={(e) => setTransferTo(e.target.value)}
                    >
                      <option value="">— välj kontor —</option>
                      {destinations.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </>
            )}
          </div>
        )}
        <Field label="Gäller från">
          <input
            type="date"
            className="hq-field w-full py-1 text-[13px]"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
          />
        </Field>
        {act === 'archive' && (
          <Field label="Intern notering">
            <input
              className="hq-field w-full py-1 text-[13px]"
              value={note}
              placeholder="valfritt"
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        )}
        <label className="flex items-center gap-2 text-[12.5px] text-content md:col-span-2">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          {act === 'archive'
            ? `Jag bekräftar att ${office.displayName} arkiveras${transferTo && (review?.length ?? 0) > 0 ? ` och att ${review!.length} relationer flyttas` : ''}.`
            : `Jag bekräftar att ${office.displayName} återöppnas.`}
        </label>
        {error && <p className="text-[12.5px] text-negative md:col-span-2">{error}</p>}
        <div className="flex items-center gap-2 md:col-span-2">
          <button
            type="submit"
            disabled={!canSubmit}
            className={cn('jarvis-gold-btn dossier-cta', !canSubmit && 'opacity-50')}
          >
            {act === 'archive' ? 'Arkivera kontor' : 'Återöppna kontor'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="jarvis-ghost-btn dossier-cta"
          >
            Avbryt
          </button>
        </div>
      </form>
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="type-section block">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  )
}

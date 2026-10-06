import { useEffect, useState, type ReactNode } from 'react'
import type { Client360 } from '~/application/advisory/client360'
import type { ClosureReason, ClosureReview, RiskProfile } from '~/domain/advisory'
import { cn } from '~/lib/cn'
import { formatLongDate } from '~/presentation/advisory/format'
import {
  CHANNEL_LABEL,
  CLOSURE_REASON_LABEL,
  SEGMENT_LABEL,
} from '~/presentation/advisory/text'
import type {
  LifecycleAct,
  LifecycleActions,
  LifecycleRegister,
} from './lifecycleActions'

const SEGMENTS = [
  'private-banking',
  'wealth-management',
  'entrepreneur',
  'family-office',
] as const
const CHANNELS = ['phone', 'email', 'teams', 'in-person'] as const
const REASONS: readonly ClosureReason[] = [
  'CLIENT_CHOICE',
  'COMPETITOR',
  'NO_LONGER_ELIGIBLE',
  'DECEASED_OR_ESTATE',
  'MOVED_OR_REASSIGNED',
  'OTHER',
]

const TITLE: Record<LifecycleAct, string> = {
  activate: 'Aktivera PB-relation',
  edit: 'Redigera relation',
  move: 'Flytta till annat kontor',
  advisor: 'Ändra ansvarig rådgivare',
  close: 'Avsluta PB-relation',
  reactivate: 'Återaktivera PB-relation',
}

/**
 * One lifecycle act, opened under the cover like the update flow: the
 * facts the act needs, the record's own choices (offices, advisors), what
 * a closure would leave open, and one confirming button in the gold. A
 * refusal is a sentence; a success closes the panel and the dossier
 * re-reads itself.
 */
export function LifecycleActPanel({
  act,
  view,
  actions,
  onDone,
  onClose,
}: {
  act: LifecycleAct
  view: Client360
  actions: LifecycleActions
  onDone: () => Promise<void>
  onClose: () => void
}) {
  const [register, setRegister] = useState<LifecycleRegister | null>(null)
  const [review, setReview] = useState<ClosureReview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { client } = view

  useEffect(() => {
    let alive = true
    void actions.register().then((r) => {
      if (alive && r.ok) setRegister({ offices: r.offices, advisors: r.advisors })
    })
    if (act === 'close')
      void actions.closureReview(client.id).then((r) => {
        if (alive && r.ok) setReview(r.review)
      })
    return () => {
      alive = false
    }
  }, [act, client.id, actions])

  const [effectiveDate, setEffectiveDate] = useState(view.today)
  const [note, setNote] = useState('')
  const [officeId, setOfficeId] = useState(client.officeId)
  const [advisorId, setAdvisorId] = useState(client.primaryAdvisorId)
  const [reason, setReason] = useState<ClosureReason>('CLIENT_CHOICE')
  const [displayName, setDisplayName] = useState(client.displayName)
  const [segment, setSegment] = useState(client.segment)
  const [relationshipSince, setRelationshipSince] = useState(client.relationshipSince)
  const [dateOfBirth, setDateOfBirth] = useState(client.dateOfBirth ?? '')
  const [riskProfile, setRiskProfile] = useState<string>(
    client.riskProfile === null ? '' : String(client.riskProfile),
  )
  const [channel, setChannel] = useState(client.preferredChannel)
  const [annualIncome, setAnnualIncome] = useState(
    client.annualIncome === null ? '' : String(client.annualIncome),
  )
  const [confirmed, setConfirmed] = useState(false)

  const activeOffices = (register?.offices ?? []).filter((o) => o.status === 'active')

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const result = await run()
      if (result.ok) {
        await onDone()
        onClose()
      } else {
        setError(REFUSAL[result.code] ?? 'Åtgärden kunde inte utföras.')
      }
    } finally {
      setBusy(false)
    }
  }

  function run() {
    const base = { clientId: client.id, effectiveDate, note: note || null }
    switch (act) {
      case 'activate':
        return actions.activate({ clientId: client.id, effectiveDate })
      case 'move':
        return actions.move({ ...base, toOfficeId: officeId })
      case 'advisor':
        return actions.changeAdvisor({ ...base, advisorId })
      case 'close':
        return actions.close({ ...base, reason })
      case 'reactivate':
        return actions.reactivate({ ...base, officeId, advisorId })
      case 'edit':
        return actions.edit({
          clientId: client.id,
          displayName,
          segment,
          relationshipSince,
          dateOfBirth: dateOfBirth || null,
          riskProfile: riskProfile === '' ? null : (Number(riskProfile) as RiskProfile),
          preferredChannel: channel,
          annualIncome: annualIncome === '' ? null : Number(annualIncome),
        })
    }
  }

  const canSubmit =
    !busy &&
    (act !== 'close' || confirmed) &&
    (act !== 'move' || officeId !== client.officeId) &&
    (act !== 'advisor' || advisorId !== client.primaryAdvisorId)

  return (
    <section
      className={cn(
        'ref-panel',
        act === 'close'
          ? 'shadow-[inset_2px_0_0_0_var(--color-negative)]'
          : 'shadow-[inset_2px_0_0_0_var(--color-institution-line)]',
      )}
      aria-label={TITLE[act]}
    >
      <header className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
        <h2 className="type-section text-content">{TITLE[act]}</h2>
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
        {act === 'move' && (
          <>
            <Field label="Från">
              <p className="text-[13px] text-content">
                {register?.offices.find((o) => o.id === client.officeId)?.displayName ??
                  client.officeId}
              </p>
            </Field>
            <Field label="Till">
              <select
                className="hq-field w-full py-1 text-[13px]"
                value={officeId}
                onChange={(e) => setOfficeId(e.target.value)}
              >
                {activeOffices.map((o) => (
                  <option key={o.id} value={o.id} disabled={o.id === client.officeId}>
                    {o.displayName}
                    {o.id === client.officeId ? ' (nuvarande)' : ''}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
        {act === 'advisor' && (
          <Field label="Ansvarig rådgivare">
            <select
              className="hq-field w-full py-1 text-[13px]"
              value={advisorId}
              onChange={(e) => setAdvisorId(e.target.value)}
            >
              {(register?.advisors ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName}
                  {a.id === client.primaryAdvisorId ? ' (nuvarande)' : ''}
                </option>
              ))}
            </select>
          </Field>
        )}
        {act === 'reactivate' && (
          <>
            <Field label="Kontor">
              <select
                className="hq-field w-full py-1 text-[13px]"
                value={officeId}
                onChange={(e) => setOfficeId(e.target.value)}
              >
                {activeOffices.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.displayName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ansvarig rådgivare">
              <select
                className="hq-field w-full py-1 text-[13px]"
                value={advisorId}
                onChange={(e) => setAdvisorId(e.target.value)}
              >
                {(register?.advisors ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
        {act === 'close' && (
          <>
            <div className="md:col-span-2">
              <p className="type-section">Innan relationen avslutas</p>
              {review ? (
                <ul className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-content-muted">
                  <li>
                    <span className="tabular text-content">{review.openCommitments}</span>{' '}
                    öppna åtaganden
                  </li>
                  <li>
                    <span className="tabular text-content">{review.bookedMeetings}</span>{' '}
                    bokade möten
                  </li>
                  <li>
                    <span className="tabular text-content">
                      {review.futureFinancingEvents}
                    </span>{' '}
                    kommande finansieringshändelser
                  </li>
                  <li>
                    <span className="tabular text-content">
                      {review.futureImportantEvents}
                    </span>{' '}
                    kommande viktiga händelser
                  </li>
                  <li>
                    <span className="tabular text-content">
                      {review.openOpportunities}
                    </span>{' '}
                    öppna möjligheter
                  </li>
                </ul>
              ) : (
                <p className="type-inst-sub mt-1.5">Läser det öppna …</p>
              )}
              <p className="type-inst-sub mt-2 leading-[1.05rem]">
                Öppna åtaganden och bokade händelser markeras som avbrutna; möjligheter,
                mål, tidslinje, klientminne, finansiella ögonblicksbilder och
                mötesunderlag behålls i sin helhet. Relationen flyttas till Tidigare
                klienter.
              </p>
            </div>
            <Field label="Orsak">
              <select
                className="hq-field w-full py-1 text-[13px]"
                value={reason}
                onChange={(e) => setReason(e.target.value as ClosureReason)}
              >
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {CLOSURE_REASON_LABEL[r]}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
        {act === 'edit' && (
          <>
            <Field label="Namn">
              <input
                className="hq-field w-full py-1 text-[13px]"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </Field>
            <Field label="Relationstyp">
              <select
                className="hq-field w-full py-1 text-[13px]"
                value={segment}
                onChange={(e) => setSegment(e.target.value as typeof segment)}
              >
                {SEGMENTS.map((s) => (
                  <option key={s} value={s}>
                    {SEGMENT_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="PB-start">
              <input
                type="date"
                className="hq-field w-full py-1 text-[13px]"
                value={relationshipSince}
                onChange={(e) => setRelationshipSince(e.target.value)}
              />
            </Field>
            <Field label="Född">
              <input
                type="date"
                className="hq-field w-full py-1 text-[13px]"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
              />
            </Field>
            <Field label="Riskprofil">
              <select
                className="hq-field w-full py-1 text-[13px]"
                value={riskProfile}
                onChange={(e) => setRiskProfile(e.target.value)}
              >
                <option value="">Ej fastställd</option>
                {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <option key={n} value={n}>
                    {n}/7
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Föredragen kanal">
              <select
                className="hq-field w-full py-1 text-[13px]"
                value={channel}
                onChange={(e) => setChannel(e.target.value as typeof channel)}
              >
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {CHANNEL_LABEL[c]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Årsinkomst (SEK)">
              <input
                type="number"
                className="hq-field w-full py-1 text-[13px]"
                value={annualIncome}
                onChange={(e) => setAnnualIncome(e.target.value)}
              />
            </Field>
          </>
        )}
        {act !== 'edit' && (
          <Field label="Gäller från">
            <input
              type="date"
              className="hq-field w-full py-1 text-[13px]"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
          </Field>
        )}
        {act !== 'edit' && act !== 'activate' && (
          <Field label="Intern notering" className="md:col-span-2">
            <input
              className="hq-field w-full py-1 text-[13px]"
              value={note}
              placeholder="valfritt"
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        )}
        {act === 'close' && (
          <label className="flex items-center gap-2 text-[12.5px] text-content md:col-span-2">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Jag bekräftar att PB-relationen med {client.displayName} avslutas{' '}
            {formatLongDate(effectiveDate)}.
          </label>
        )}
        {error && <p className="text-[12.5px] text-negative md:col-span-2">{error}</p>}
        <div className="flex items-center gap-2 md:col-span-2">
          <button
            type="submit"
            disabled={!canSubmit}
            className={cn('jarvis-gold-btn dossier-cta', !canSubmit && 'opacity-50')}
          >
            {TITLE[act]}
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

const REFUSAL: Record<string, string> = {
  NOT_FOUND: 'Relationen finns inte längre i registret.',
  NOT_ALLOWED: 'Åtgärden är inte möjlig i relationens nuvarande status.',
  INVALID: 'Kontrollera datum och fält.',
  OFFICE_NOT_FOUND: 'Kontoret finns inte.',
  OFFICE_ARCHIVED: 'Kontoret är arkiverat; välj ett aktivt kontor.',
  ADVISOR_NOT_FOUND: 'Rådgivaren finns inte.',
  SERVICE_UNAVAILABLE: 'Relationsminnet svarar inte just nu.',
}

function Field({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn('block min-w-0', className)}>
      <span className="type-section block">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  )
}

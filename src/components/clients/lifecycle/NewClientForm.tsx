import { Link } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import type {
  CreateClientResult,
  SimilarRelationship,
} from '~/application/advisory/lifecycle'
import type { Advisor, GoalKind, Office, RiskProfile } from '~/domain/advisory'
import { cn } from '~/lib/cn'
import { formatLongDate } from '~/presentation/advisory/format'
import {
  CHANNEL_LABEL,
  GOAL_KIND_LABEL,
  LIFECYCLE_STATUS_LABEL,
  SEGMENT_LABEL,
} from '~/presentation/advisory/text'
import type { Unavailable } from '../clientActions'
import { ModuleHead } from '../dossier/Module'

const SEGMENTS = [
  'private-banking',
  'wealth-management',
  'entrepreneur',
  'family-office',
] as const
const CHANNELS = ['phone', 'email', 'teams', 'in-person'] as const
const GOAL_KINDS: readonly GoalKind[] = [
  'capital-preservation',
  'long-term-growth',
  'retirement-income',
  'property-purchase',
  'generational-wealth',
  'liquidity-reserve',
  'childrens-future',
  'company-sale-proceeds',
  'lifestyle-spending',
]

export interface NewClientRequest {
  displayName: string
  householdName: string | null
  segment: (typeof SEGMENTS)[number]
  officeId: string
  advisorId: string
  relationshipSince: string
  status: 'onboarding' | 'active'
  dateOfBirth: string | null
  riskProfile: RiskProfile | null
  preferredChannel: (typeof CHANNELS)[number]
  annualIncome: number | null
  initialFinancial: {
    aum: number | null
    totalWealth: number | null
    liquidity: number | null
    externalAssets: number | null
    debt: {
      amount: number
      ratePercent: number
      interestType: 'fixed' | 'variable'
    } | null
  }
  initialContext: {
    goal: { kind: GoalKind; title: string } | null
    nextMeeting: string | null
    importantEvent: { title: string; date: string } | null
    concern: string | null
    note: string | null
  }
  acknowledgeSimilar: boolean
}

/**
 * Ny PB-klient: identity, relation, and — optional — what is known of the
 * finances and the context at the start. The minimum is small: a name, an
 * office, an advisor, a start date and a status. Nothing missing is
 * estimated; the dossier shows it as data saknas. A relationship that
 * looks like one already in the book is warned about, with the door to
 * reactivate a former one instead.
 */
export function NewClientForm({
  offices,
  advisors,
  today,
  defaultAdvisorId,
  onCreate,
  onCreated,
}: {
  offices: readonly Office[]
  advisors: readonly Advisor[]
  today: string
  defaultAdvisorId: string
  onCreate: (request: NewClientRequest) => Promise<CreateClientResult | Unavailable>
  onCreated: (clientId: string) => void
}) {
  const activeOffices = offices.filter((o) => o.status === 'active')
  const [displayName, setDisplayName] = useState('')
  const [householdName, setHouseholdName] = useState('')
  const [segment, setSegment] = useState<(typeof SEGMENTS)[number]>('private-banking')
  const [officeId, setOfficeId] = useState(activeOffices[0]?.id ?? '')
  const [advisorId, setAdvisorId] = useState(
    advisors.some((a) => a.id === defaultAdvisorId)
      ? defaultAdvisorId
      : (advisors[0]?.id ?? ''),
  )
  const [relationshipSince, setRelationshipSince] = useState(today)
  const [status, setStatus] = useState<'onboarding' | 'active'>('onboarding')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [riskProfile, setRiskProfile] = useState('')
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>('email')
  const [annualIncome, setAnnualIncome] = useState('')
  const [aum, setAum] = useState('')
  const [totalWealth, setTotalWealth] = useState('')
  const [liquidity, setLiquidity] = useState('')
  const [externalAssets, setExternalAssets] = useState('')
  const [debt, setDebt] = useState('')
  const [debtRate, setDebtRate] = useState('')
  const [debtType, setDebtType] = useState<'fixed' | 'variable'>('variable')
  const [goalKind, setGoalKind] = useState<GoalKind>('long-term-growth')
  const [goalTitle, setGoalTitle] = useState('')
  const [nextMeeting, setNextMeeting] = useState('')
  const [eventTitle, setEventTitle] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [concern, setConcern] = useState('')
  const [note, setNote] = useState('')
  const [similar, setSimilar] = useState<readonly SimilarRelationship[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const number = (text: string) => (text.trim() === '' ? null : Number(text))
  const canSubmit =
    !busy &&
    displayName.trim().length >= 2 &&
    officeId !== '' &&
    advisorId !== '' &&
    relationshipSince !== ''
  const debtAmount = number(debt)
  const debtInvalid = debtAmount !== null && debtAmount > 0 && number(debtRate) === null

  async function submit(acknowledgeSimilar: boolean) {
    if (debtInvalid) {
      setError('Ange räntan för skulden, eller lämna skulden tom.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await onCreate({
        displayName: displayName.trim(),
        householdName: householdName.trim() || null,
        segment,
        officeId,
        advisorId,
        relationshipSince,
        status,
        dateOfBirth: dateOfBirth || null,
        riskProfile: riskProfile === '' ? null : (Number(riskProfile) as RiskProfile),
        preferredChannel: channel,
        annualIncome: number(annualIncome),
        initialFinancial: {
          aum: number(aum),
          totalWealth: number(totalWealth),
          liquidity: number(liquidity),
          externalAssets: number(externalAssets),
          debt:
            debtAmount !== null && debtAmount > 0
              ? {
                  amount: debtAmount,
                  ratePercent: Number(debtRate),
                  interestType: debtType,
                }
              : null,
        },
        initialContext: {
          goal: goalTitle.trim() ? { kind: goalKind, title: goalTitle.trim() } : null,
          nextMeeting: nextMeeting || null,
          importantEvent:
            eventTitle.trim() && eventDate
              ? { title: eventTitle.trim(), date: eventDate }
              : null,
          concern: concern.trim() || null,
          note: note.trim() || null,
        },
        acknowledgeSimilar,
      })
      if (result.ok) {
        onCreated(result.clientId)
        return
      }
      if (result.code === 'SIMILAR_EXISTS') {
        setSimilar(result.similar)
        return
      }
      setError(
        result.code === 'INVALID'
          ? `Kontrollera fältet ${result.field}.`
          : result.code === 'OFFICE_ARCHIVED'
            ? 'Kontoret är arkiverat; välj ett aktivt kontor.'
            : result.code === 'SERVICE_UNAVAILABLE'
              ? 'Relationsminnet svarar inte just nu.'
              : 'Relationen kunde inte skapas.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSubmit) void submit(false)
      }}
    >
      <Section title="Identitet">
        <Field label="Namn" required>
          <input
            className="hq-field w-full py-1 text-[13px]"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="För- och efternamn, eller hushållets namn"
            autoFocus
          />
        </Field>
        <Field label="Hushållets namn">
          <input
            className="hq-field w-full py-1 text-[13px]"
            value={householdName}
            onChange={(e) => setHouseholdName(e.target.value)}
            placeholder="om det skiljer sig från namnet"
          />
        </Field>
        <Field label="Relationstyp">
          <select
            className="hq-field w-full py-1 text-[13px]"
            value={segment}
            onChange={(e) => setSegment(e.target.value as (typeof SEGMENTS)[number])}
          >
            {SEGMENTS.map((s) => (
              <option key={s} value={s}>
                {SEGMENT_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Född">
          <input
            type="date"
            className="hq-field w-full py-1 text-[13px]"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
          />
        </Field>
      </Section>

      <Section title="Relation">
        <Field label="Kontor" required>
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
        <Field label="Ansvarig rådgivare" required>
          <select
            className="hq-field w-full py-1 text-[13px]"
            value={advisorId}
            onChange={(e) => setAdvisorId(e.target.value)}
          >
            {advisors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="PB-start" required>
          <input
            type="date"
            className="hq-field w-full py-1 text-[13px]"
            value={relationshipSince}
            onChange={(e) => setRelationshipSince(e.target.value)}
          />
        </Field>
        <Field label="Status" required>
          <select
            className="hq-field w-full py-1 text-[13px]"
            value={status}
            onChange={(e) => setStatus(e.target.value as 'onboarding' | 'active')}
          >
            <option value="onboarding">{LIFECYCLE_STATUS_LABEL.onboarding}</option>
            <option value="active">{LIFECYCLE_STATUS_LABEL.active}</option>
          </select>
        </Field>
        <Field label="Föredragen kanal">
          <select
            className="hq-field w-full py-1 text-[13px]"
            value={channel}
            onChange={(e) => setChannel(e.target.value as (typeof CHANNELS)[number])}
          >
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABEL[c]}
              </option>
            ))}
          </select>
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
      </Section>

      <Section
        title="Inledande ekonomi"
        hint="Valfritt. Det som anges registreras som klientens egen uppgift, daterad i dag. Inget uppskattas."
      >
        <Money label="AUM hos banken" value={aum} onChange={setAum} />
        <Money label="Total förmögenhet" value={totalWealth} onChange={setTotalWealth} />
        <Money label="Likviditet" value={liquidity} onChange={setLiquidity} />
        <Money
          label="Externa tillgångar"
          value={externalAssets}
          onChange={setExternalAssets}
        />
        <Money label="Skulder" value={debt} onChange={setDebt} />
        <Field label="Ränta på skulden (%)">
          <span className="flex gap-2">
            <input
              type="number"
              step="0.01"
              className={cn(
                'hq-field w-full py-1 text-[13px]',
                debtInvalid && 'border-negative',
              )}
              value={debtRate}
              onChange={(e) => setDebtRate(e.target.value)}
            />
            <select
              className="hq-field py-1 text-[13px]"
              value={debtType}
              onChange={(e) => setDebtType(e.target.value as 'fixed' | 'variable')}
            >
              <option value="variable">rörlig</option>
              <option value="fixed">bunden</option>
            </select>
          </span>
        </Field>
        <Money label="Årsinkomst" value={annualIncome} onChange={setAnnualIncome} />
      </Section>

      <Section title="Inledande kontext" hint="Valfritt.">
        <Field label="Mål">
          <span className="flex gap-2">
            <select
              className="hq-field py-1 text-[13px]"
              value={goalKind}
              onChange={(e) => setGoalKind(e.target.value as GoalKind)}
            >
              {GOAL_KINDS.map((k) => (
                <option key={k} value={k}>
                  {GOAL_KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <input
              className="hq-field w-full py-1 text-[13px]"
              value={goalTitle}
              onChange={(e) => setGoalTitle(e.target.value)}
              placeholder="målet i klientens ord"
            />
          </span>
        </Field>
        <Field label="Nästa möte">
          <input
            type="date"
            className="hq-field w-full py-1 text-[13px]"
            value={nextMeeting}
            onChange={(e) => setNextMeeting(e.target.value)}
          />
        </Field>
        <Field label="Viktig händelse">
          <span className="flex gap-2">
            <input
              className="hq-field w-full py-1 text-[13px]"
              value={eventTitle}
              onChange={(e) => setEventTitle(e.target.value)}
              placeholder="vad"
            />
            <input
              type="date"
              className="hq-field py-1 text-[13px]"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
            />
          </span>
        </Field>
        <Field label="Känd oro">
          <input
            className="hq-field w-full py-1 text-[13px]"
            value={concern}
            onChange={(e) => setConcern(e.target.value)}
          />
        </Field>
        <Field label="Inledande notering" className="md:col-span-2">
          <textarea
            className="hq-field w-full resize-y text-[13px] leading-relaxed"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </Section>

      {similar && similar.length > 0 && (
        <section
          aria-label="Liknande relation finns"
          className="ref-panel px-5 pt-4 pb-4 shadow-[inset_2px_0_0_0_var(--color-warning)]"
        >
          <h2 className="type-section text-warning">Liknande relation finns redan</h2>
          <ul className="mt-2 flex flex-col">
            {similar.map((s) => (
              <li
                key={s.id}
                className="dossier-row flex items-center justify-between gap-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block text-[13px] text-content">{s.displayName}</span>
                  <span className="type-inst-sub block">
                    {LIFECYCLE_STATUS_LABEL[s.status]} · {s.officeName}
                    {s.closedOn ? ` · avslutad ${formatLongDate(s.closedOn)}` : ''}
                  </span>
                </span>
                {s.status === 'former' ? (
                  <Link
                    to="/clients/$clientId"
                    params={{ clientId: s.id }}
                    className="jarvis-ghost-btn dossier-cta"
                  >
                    Återaktivera befintlig relation
                  </Link>
                ) : (
                  <Link
                    to="/clients/$clientId"
                    params={{ clientId: s.id }}
                    className="dossier-link"
                  >
                    Öppna
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit(true)}
              className="jarvis-gold-btn dossier-cta"
            >
              Skapa ändå
            </button>
            <button
              type="button"
              onClick={() => setSimilar(null)}
              className="jarvis-ghost-btn dossier-cta"
            >
              Ändra namn
            </button>
          </div>
        </section>
      )}

      {error && <p className="px-1 text-[12.5px] text-negative">{error}</p>}

      <div className="flex items-center gap-3 px-1 pb-4">
        <button
          type="submit"
          disabled={!canSubmit}
          className={cn('jarvis-gold-btn dossier-cta', !canSubmit && 'opacity-50')}
        >
          Skapa PB-relation
        </button>
        <Link to="/clients" className="jarvis-ghost-btn dossier-cta">
          Avbryt
        </Link>
        <span className="type-inst-sub">
          Minsta uppgift: namn, kontor, rådgivare, PB-start och status.
        </span>
      </div>
    </form>
  )
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: ReactNode
}) {
  return (
    <section className="ref-panel">
      <ModuleHead title={title} meta={hint} />
      <div className="grid gap-4 px-5 pb-5 md:grid-cols-2">{children}</div>
    </section>
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

function Money({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Field label={`${label} (SEK)`}>
      <input
        type="number"
        min={0}
        step={1000}
        className="hq-field w-full py-1 text-[13px]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="data saknas"
      />
    </Field>
  )
}

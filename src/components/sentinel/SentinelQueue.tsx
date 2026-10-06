import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { DispositionStatus } from '~/domain/advisory'
import type { SentinelBrief, SentinelEntry } from '~/application/advisory/sentinel'
import { HealthScore } from '~/components/clients/HealthIndicator'
import { Panel } from '~/components/ui/Panel'
import { cn } from '~/lib/cn'
import { formatLongDate, formatMsek } from '~/presentation/advisory/format'
import {
  driverText,
  dueText,
  preparation,
  priorityTitle,
  SEVERITY_LABEL,
  STRENGTHENED_BY_MARKET,
  whyItMatters,
  whyNow,
} from '~/presentation/advisory/sentinelText'
import { SEGMENT_SHORT } from '~/presentation/advisory/text'
import { SentinelMark } from './SentinelBrief'
import type { SentinelActions } from './sentinelActions'

/**
 * The cross-client work queue: what needs action now, what is coming, what
 * to watch, and where the openings are — one priority per client, each
 * with its reasons on request and the advisor's word on it.
 */

const SEVERITY_TONE = {
  critical: 'text-negative',
  high: 'text-warning',
  normal: 'text-content',
  low: 'text-content-muted',
} as const

const SEVERITY_EDGE = {
  critical: 'shadow-[inset_2px_0_0_0_var(--color-negative)]',
  high: 'shadow-[inset_2px_0_0_0_var(--color-warning)]',
  normal: '',
  low: '',
} as const

interface Section {
  key: string
  title: string
  entries: readonly SentinelEntry[]
  empty: string
}

export function SentinelQueue({
  brief,
  actions,
  onChanged,
}: {
  brief: SentinelBrief
  actions: SentinelActions
  onChanged: () => Promise<void>
}) {
  /*
   * The queue office by office, on request. Sentinel decides nothing per
   * office: the same entries, grouped by the office each relationship
   * belongs to. "Alla kontor" is the queue as ranked.
   */
  const [officeFilter, setOfficeFilter] = useState<string>('all')
  const offices = [
    ...new Map(
      brief.entries.flatMap((e) =>
        e.client.office ? [[e.client.office.id, e.client.office]] : [],
      ),
    ).values(),
  ].sort((a, b) => a.displayName.localeCompare(b.displayName, 'sv'))
  const inOffice = (e: SentinelEntry) =>
    officeFilter === 'all' || e.client.office?.id === officeFilter
  const visible = brief.entries.filter(
    (e) => (e.status === 'active' || e.status === 'reviewed') && inOffice(e),
  )
  const setAside = brief.entries.filter(
    (e) => (e.status === 'snoozed' || e.status === 'dismissed') && inOffice(e),
  )
  const sections: Section[] = [
    {
      key: 'today',
      title: 'Behöver åtgärd nu',
      entries: visible.filter((e) => e.priority.horizon === 'today'),
      empty: 'Inget kräver åtgärd i dag.',
    },
    {
      key: 'upcoming',
      title: 'Kommande',
      entries: visible.filter((e) => e.priority.horizon === 'upcoming'),
      empty: 'Inget att förbereda den närmaste tiden.',
    },
    {
      key: 'watch',
      title: 'Bevaka',
      entries: visible.filter(
        (e) => e.priority.horizon === 'watch' && e.priority.theme !== 'opportunity',
      ),
      empty: 'Inget att bevaka.',
    },
    {
      key: 'opportunity',
      title: 'Möjligheter',
      entries: visible.filter((e) => e.priority.theme === 'opportunity'),
      empty:
        'Inga möjligheter vars tidpunkt är nära. Möjligheter som hör till en annan prioritet står under den.',
    },
  ]
  const { metrics } = brief
  const tiles: {
    label: string
    value: number
    tone?: 'warning' | 'negative' | 'accent'
  }[] = [
    {
      label: 'Att agera på i dag',
      value: metrics.actToday,
      tone: metrics.actToday > 0 ? 'warning' : undefined,
    },
    { label: 'Kommande 7 dagar', value: metrics.meetingsWithin7Days },
    {
      label: 'Försenade åtaganden',
      value: metrics.overdueCommitments,
      tone: metrics.overdueCommitments > 0 ? 'negative' : undefined,
    },
    {
      label: 'Relationsrisker',
      value: metrics.relationshipRisks,
      tone: metrics.relationshipRisks > 0 ? 'warning' : undefined,
    },
    { label: 'Möjligheter', value: metrics.opportunities, tone: 'accent' },
    { label: 'Utan prioritet', value: metrics.quietClients },
  ]

  return (
    <div className="flex flex-col gap-2">
      <header className="ref-panel px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <SentinelMark />
            <h1 className="mt-1 text-[22px] font-semibold leading-tight tracking-[-0.01em] text-content">
              Klientprioriteringar
            </h1>
            <p className="type-inst-sub mt-1">
              {metrics.clientsNeedingAttention === 1
                ? '1 klient behöver din uppmärksamhet i dag'
                : `${metrics.clientsNeedingAttention} klienter behöver din uppmärksamhet i dag`}
              {' · '}en prioritet per klient, med sina skäl
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            {offices.length > 1 && (
              <label className="flex items-center gap-2">
                <span className="type-section">Kontor</span>
                <select
                  value={officeFilter}
                  onChange={(e) => setOfficeFilter(e.target.value)}
                  className="hq-field h-7 py-0.5 text-[12px]"
                >
                  <option value="all">Alla kontor</option>
                  {offices.map((office) => (
                    <option key={office.id} value={office.id}>
                      {office.displayName}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="type-machine">
              derivat per {formatLongDate(brief.today)} · {brief.method} · syntetiska
              klienter
            </p>
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-y-2 border-t border-line pt-3 md:grid-cols-6">
          {tiles.map((tile) => (
            <div key={tile.label} className="min-w-0 pr-3">
              <dt className="type-section truncate">{tile.label}</dt>
              <dd
                className={cn(
                  'type-figure mt-0.5',
                  tile.tone === 'warning' && 'text-warning',
                  tile.tone === 'negative' && 'text-negative',
                  tile.tone === 'accent' && 'text-accent',
                )}
              >
                {tile.value}
              </dd>
            </div>
          ))}
        </dl>
      </header>

      {sections.map((section) => (
        <Panel
          key={section.key}
          title={section.title}
          meta={String(section.entries.length)}
          bodyClassName="p-0"
        >
          {section.entries.length === 0 ? (
            <p className="type-inst-sub px-3 py-3">{section.empty}</p>
          ) : (
            <ol>
              {section.entries.map((entry) => (
                <PriorityRow
                  key={entry.priority.id}
                  entry={entry}
                  today={brief.today}
                  actions={actions}
                  onChanged={onChanged}
                />
              ))}
            </ol>
          )}
        </Panel>
      ))}

      {(setAside.length > 0 || brief.quiet.length > 0) && (
        <section className="ref-panel">
          <header className="ref-head">
            <h2 className="type-section">Vilande, avfärdade och utan prioritet</h2>
            <span className="type-machine">
              {setAside.length} vilande · {brief.quiet.length} utan prioritet
            </span>
          </header>
          <div className="p-3">
            {setAside.length > 0 && (
              <ul className="space-y-1">
                {setAside.map((entry) => (
                  <li
                    key={entry.priority.id}
                    className="flex flex-wrap items-baseline gap-x-3 text-[12px]"
                  >
                    <Link
                      to="/clients/$clientId"
                      params={{ clientId: entry.client.id }}
                      className="text-content hover:text-institution"
                    >
                      {entry.client.displayName}
                    </Link>
                    <span className="text-content-muted">{priorityTitle(entry)}</span>
                    <span className="type-machine">
                      {entry.status === 'snoozed'
                        ? `vilande till ${entry.disposition?.until ? formatLongDate(entry.disposition.until) : '—'}`
                        : 'avfärdad tills fakta ändras'}
                      {entry.disposition?.reason ? ` · ${entry.disposition.reason}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {brief.quiet.length > 0 && (
              <p
                className={cn(
                  'type-inst-sub',
                  setAside.length > 0 && 'mt-2 border-t border-line pt-2',
                )}
              >
                Utan prioritet i dag:{' '}
                {brief.quiet.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && ', '}
                    <Link
                      to="/clients/$clientId"
                      params={{ clientId: c.id }}
                      className="hover:text-content"
                    >
                      {c.displayName}
                    </Link>
                  </span>
                ))}
                . Sentinel hittar ingen anledning att kontakta dem.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

function PriorityRow({
  entry,
  today,
  actions,
  onChanged,
}: {
  entry: SentinelEntry
  today: string
  actions: SentinelActions
  onChanged: () => Promise<void>
}) {
  const { priority, client } = entry
  const [open, setOpen] = useState(false)
  const [snoozing, setSnoozing] = useState(false)
  const [until, setUntil] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function dispose(status: DispositionStatus) {
    setBusy(true)
    setError(null)
    try {
      const result = await actions.dispose({
        priorityId: priority.id,
        status,
        until: status === 'snoozed' ? until : null,
        reason: status === 'snoozed' ? reason : null,
      })
      if (!result.ok) {
        setError(
          result.code === 'INVALID_UNTIL'
            ? 'Ange ett datum efter i dag.'
            : result.code === 'NOT_FOUND'
              ? 'Prioriteringen finns inte längre – fakta har ändrats.'
              : 'Kunde inte spara just nu.',
        )
        return
      }
      setSnoozing(false)
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <li
      className={cn(
        'grid gap-x-4 gap-y-2 border-b border-line px-3 py-2.5 last:border-b-0 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,3fr)_minmax(150px,1.1fr)_minmax(200px,1.4fr)]',
        SEVERITY_EDGE[priority.severity],
        entry.status === 'reviewed' && 'opacity-80',
      )}
    >
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className={cn('type-section', SEVERITY_TONE[priority.severity])}>
            {SEVERITY_LABEL[priority.severity]}
          </span>
          {entry.status === 'reviewed' && <span className="type-machine">granskad</span>}
          {priority.strengthenedByMarket && (
            <span className="type-machine text-accent">{STRENGTHENED_BY_MARKET}</span>
          )}
        </div>
        <Link
          to="/clients/$clientId"
          params={{ clientId: client.id }}
          className="type-inst-lg mt-0.5 block truncate hover:text-institution"
        >
          {client.displayName}
        </Link>
        <p className="type-inst-sub truncate">
          {SEGMENT_SHORT[client.segment]} · {client.advisorName} · AUM{' '}
          {formatMsek(client.aum)}
        </p>
        <div className="mt-1.5 flex items-center gap-3">
          <HealthScore health={client.health} size="sm" />
        </div>
      </div>

      <div className="min-w-0">
        <p className="text-[14px] font-medium leading-snug text-content">
          {priorityTitle(entry)}
        </p>
        <dl className="mt-1 space-y-0.5 text-[12px] leading-snug">
          <div className="flex gap-1.5">
            <dt className="type-section shrink-0 pt-0.5">Varför nu</dt>
            <dd className="text-content-muted">{whyNow(priority)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="type-section shrink-0 pt-0.5">Underlag</dt>
            <dd className="text-content-muted">{whyItMatters(entry)}</dd>
          </div>
        </dl>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="type-machine mt-1.5 underline decoration-dotted underline-offset-2 hover:text-content"
        >
          Varför ser jag detta?
        </button>
        {open && (
          <ul
            className="mt-1.5 space-y-1 border-l border-line pl-2 text-[12px] text-content-muted"
            aria-label="Underlag för prioriteringen"
          >
            {priority.drivers.map((driver, index) => (
              <li key={`${driver.kind}-${index}`}>{driverText(driver)}</li>
            ))}
            <li className="type-machine">
              källor{' '}
              {priority.sourceIds.length > 0 ? priority.sourceIds.join(', ') : 'härledda'}{' '}
              · {priority.method}
            </li>
          </ul>
        )}
      </div>

      <div className="min-w-0 text-[12px]">
        <p className="type-section">Nästa datum</p>
        <p className="tabular mt-0.5 text-content">{dueText(priority, today)}</p>
        <p className="type-section mt-2">Förberedelse</p>
        <p className="mt-0.5 leading-snug text-content">{preparation(priority)}</p>
      </div>

      <div className="flex min-w-0 flex-col items-start gap-1.5 lg:items-end">
        <Link
          to="/clients/$clientId"
          params={{ clientId: client.id }}
          className="type-section rounded-module border border-institution-line bg-institution-soft/60 px-3 py-1.5 text-institution transition-colors hover:bg-institution-soft"
        >
          Öppna klient
        </Link>
        <div className="flex flex-wrap gap-1.5 lg:justify-end">
          {entry.status !== 'reviewed' && (
            <RowButton
              disabled={busy}
              onClick={() => void dispose('reviewed')}
              label={`Markera ${client.displayName} som granskad`}
            >
              Granskad
            </RowButton>
          )}
          <RowButton
            disabled={busy}
            onClick={() => setSnoozing((v) => !v)}
            label={`Snooza ${client.displayName}`}
            pressed={snoozing}
          >
            Snooza
          </RowButton>
          <RowButton
            disabled={busy}
            onClick={() => void dispose('dismissed')}
            label={`Avfärda prioriteringen för ${client.displayName}`}
          >
            Avfärda
          </RowButton>
        </div>
        {snoozing && (
          <form
            className="flex flex-wrap items-end gap-2 lg:justify-end"
            onSubmit={(event) => {
              event.preventDefault()
              void dispose('snoozed')
            }}
          >
            <label className="flex flex-col gap-0.5">
              <span className="type-section">Till</span>
              <input
                type="date"
                value={until}
                min={today}
                onChange={(e) => setUntil(e.target.value)}
                className="hq-field py-0.5 text-[12px]"
                required
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="type-section">Skäl</span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="valfritt"
                className="hq-field w-36 py-0.5 text-[12px]"
              />
            </label>
            <button
              type="submit"
              disabled={busy || !until}
              className="type-machine rounded-chip border border-line px-2 py-1 text-content-muted hover:text-content disabled:opacity-40"
            >
              Bekräfta
            </button>
          </form>
        )}
        {error && (
          <p role="alert" className="type-metadata text-warning">
            {error}
          </p>
        )}
      </div>
    </li>
  )
}

function RowButton({
  children,
  onClick,
  label,
  disabled,
  pressed,
}: {
  children: string
  onClick: () => void
  label: string
  disabled: boolean
  pressed?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        'type-machine rounded-chip border px-2 py-1 transition-colors disabled:opacity-40',
        pressed
          ? 'border-hud-line text-accent'
          : 'border-line text-content-subtle hover:text-content',
      )}
    >
      {children}
    </button>
  )
}

import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import type { DailyAction } from '~/domain/advisory'
import type {
  DailyCommandView,
  DailyMarketItem,
  DailyMeeting,
  DailyTimeWindow,
} from '~/application/advisory/dailyCommand'
import { ClientPortrait } from '~/components/clients/ClientPortrait'
import { Panel } from '~/components/ui/Panel'
import { cn } from '~/lib/cn'
import {
  ACTION_TYPE_LABEL,
  ACTION_TYPE_SHORT,
  actionContextLine,
  actionHeadline,
  actionReasons,
  actionWhyNow,
  attentionHeadline,
  BAND_LABEL,
  GAP_LABEL,
  greeting,
  HORIZON_LABEL,
  marketClientAction,
  marketClientRelevance,
  marketItemCounts,
  marketItemFact,
  OBJECTIVE_TEXT,
  pulseLines,
  SIGNAL_LABEL,
  sinceText,
  timeText,
} from '~/presentation/advisory/dailyCommandText'
import {
  formatDayMonth,
  formatDaysFromToday,
  formatLongDate,
} from '~/presentation/advisory/format'
import { observedAtText } from '~/presentation/advisory/marketImpactText'
import { HEALTH_BAND_LABEL, LIFECYCLE_EVENT_LABEL, SEGMENT_SHORT } from '~/presentation/advisory/text'
import { READINESS_LABEL } from '~/presentation/documents/meetingPackText'
import { CHANGE_LABEL } from '~/presentation/jarvis/advisoryAnswerText'

/**
 * Idag — Daily Command. One dominant relationship briefing, the next
 * priorities beneath it in their horizons, what a window of time is best
 * spent on, the week's meetings with their readiness, the market where it
 * reaches a client, what changed since yesterday, and the book's pulse.
 *
 * Everything here is the view the server composed from Sentinel,
 * Market-to-Client, the Meeting Pack's readiness and the record; the page
 * groups and names, and decides nothing. A client appears once, with one
 * action and several reasons — never as several alerts.
 */

const BAND_TONE = {
  high: 'text-warning',
  medium: 'text-content',
  watch: 'text-content-muted',
} as const

const BAND_EDGE = {
  high: 'shadow-[inset_2px_0_0_0_var(--color-warning)]',
  medium: '',
  watch: '',
} as const

const READINESS_TONE = {
  REDO: 'border-positive/40 text-positive',
  GRANSKA: 'border-warning/40 text-warning',
  BLOCKERAD: 'border-negative/40 text-negative',
} as const

export function DailyCommand({
  view,
  onOfficeChange,
}: {
  view: DailyCommandView
  /** The route narrows the day to an office through its search; '' is every office. */
  onOfficeChange: (officeId: string) => void
}) {
  const ranked = [...view.now, ...view.week, ...view.watch]
  const [lead, ...rest] = ranked
  return (
    <div className="flex flex-col gap-2" data-daily-command>
      <DailyHero view={view} count={ranked.length} onOfficeChange={onOfficeChange} />

      <div className="grid gap-2 xl:grid-cols-[minmax(0,1.9fr)_minmax(320px,1fr)]">
        <div className="flex min-w-0 flex-col gap-2">
          {lead ? (
            <PrimaryBriefing action={lead} today={view.today} />
          ) : (
            <section className="ref-panel px-4 py-6">
              <p className="font-display text-[20px] text-content">
                Ingen relation kräver dig just nu.
              </p>
              <p className="type-inst-sub mt-1">
                {view.quiet === 1
                  ? '1 relation är i ordning'
                  : `${view.quiet} relationer är i ordning`}
                {view.setAside > 0 ? ` · ${view.setAside} vilande eller avfärdade i Sentinel` : ''}.
              </p>
            </section>
          )}
          <NextPriorities view={view} rest={rest} />
          <TimeWindows windows={view.timeWindows} />
          {view.onboarding.length > 0 && <OnboardingPanel actions={view.onboarding} />}
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <MeetingsPanel meetings={view.meetings} today={view.today} />
          <MarketPanel view={view} />
          <ChangesPanel view={view} />
          <PulsePanel view={view} />
          <OverduePanel view={view} />
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------- hero */

function DailyHero({
  view,
  count,
  onOfficeChange,
}: {
  view: DailyCommandView
  count: number
  onOfficeChange: (officeId: string) => void
}) {
  const { pulse } = view
  const facts = [
    pulse.actNow === 1 ? '1 kräver dig nu' : `${pulse.actNow} kräver dig nu`,
    pulse.meetingsThisWeek === 1
      ? '1 möte inom sju dagar'
      : `${pulse.meetingsThisWeek} möten inom sju dagar`,
    ...(pulse.overdueCommitments > 0
      ? [
          pulse.overdueCommitments === 1
            ? '1 försenat åtagande'
            : `${pulse.overdueCommitments} försenade åtaganden`,
        ]
      : []),
  ]
  return (
    <header className="flex flex-col gap-4 px-2 pt-3 pb-2 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <p className="type-section text-institution">
          Idag · {formatLongDate(view.today)}
          {view.office ? ` · ${view.office.displayName}` : ''}
        </p>
        <h1 className="type-display-name mt-1.5 text-[44px] leading-none">
          {greeting(view.hour, view.advisor.displayName)}
        </h1>
        <p className="mt-3 font-display text-[19px] leading-snug text-content">
          {attentionHeadline(count)}
        </p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-content-muted">
          {facts.map((fact, index) => (
            <span key={fact} className="flex items-center gap-x-2.5">
              {index > 0 && <span aria-hidden="true" className="h-0.5 w-0.5 rounded-full bg-current opacity-60" />}
              {fact}
            </span>
          ))}
          {view.quiet > 0 && (
            <span className="flex items-center gap-x-2.5 text-content-subtle">
              <span aria-hidden="true" className="h-0.5 w-0.5 rounded-full bg-current opacity-60" />
              {view.quiet === 1 ? '1 relation i ordning' : `${view.quiet} relationer i ordning`}
            </span>
          )}
        </p>
      </div>
      <div className="flex flex-col items-start gap-1.5 lg:items-end lg:pb-1">
        {view.offices.length > 1 && (
          <label className="flex items-center gap-2">
            <span className="type-section">Kontor</span>
            <select
              value={view.office?.id ?? ''}
              onChange={(e) => onOfficeChange(e.target.value)}
              className="hq-field h-7 py-0.5 text-[12px]"
            >
              <option value="">Alla kontor</option>
              {view.offices.map((office) => (
                <option key={office.id} value={office.id}>
                  {office.displayName}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="type-machine">
          derivat per {formatLongDate(view.today)} · {view.method} · marknad{' '}
          {view.freshness.marketObservedAt
            ? observedAtText(view.freshness.marketObservedAt)
            : 'ej observerad'}
        </p>
      </div>
    </header>
  )
}

/* -------------------------------------------------------- the one briefing */

function PrimaryBriefing({ action, today }: { action: DailyAction; today: string }) {
  const reasons = actionReasons(action)
  const [sources, setSources] = useState(false)
  return (
    <section
      className={cn('ref-panel inst-edge', BAND_EDGE[action.band])}
      aria-label={`Prioritet 1: ${action.clientName}`}
      data-primary-briefing
    >
      <header className="ref-head">
        <div className="flex items-center gap-3">
          <span className="tabular type-machine text-institution">01</span>
          <h2 className="type-section">Relationen som kräver dig först</h2>
        </div>
        <ActionChips action={action} />
      </header>
      <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(260px,1fr)]">
        <div className="min-w-0">
          <div className="flex items-start gap-4">
            <ClientPortrait clientId={action.clientId} displayName={action.clientName} size="md" />
            <div className="min-w-0">
              <Link
                to="/clients/$clientId"
                params={{ clientId: action.clientId }}
                className="font-display text-[26px] leading-tight text-content hover:text-institution"
              >
                {action.clientName}
              </Link>
              <p className="type-inst-sub mt-0.5">
                {SEGMENT_SHORT[action.segment]} · {action.officeName} · Relationen{' '}
                {HEALTH_BAND_LABEL[action.health].toLowerCase()} · {actionContextLine(action, today)}
              </p>
            </div>
          </div>
          <p className="mt-4 font-display text-[21px] leading-snug text-content">
            {actionHeadline(action)}
          </p>
          <dl className="mt-3 space-y-2 text-[13px] leading-snug">
            <div>
              <dt className="type-section text-institution">Varför nu</dt>
              <dd className="mt-0.5 text-content">{actionWhyNow(action)}</dd>
            </div>
            {reasons.length > 1 && (
              <div>
                <dt className="type-section">Underlag</dt>
                <dd>
                  <ul className="mt-0.5 space-y-1 border-l border-line pl-2.5 text-content-muted">
                    {reasons.slice(1).map((reason, index) => (
                      <li key={index}>{reason}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
            {action.gaps.length > 0 && (
              <div>
                <dt className="type-section">Data saknas</dt>
                <dd className="mt-0.5 text-content-muted">
                  {action.gaps.map((gap) => GAP_LABEL[gap]).join(' · ')}
                </dd>
              </div>
            )}
          </dl>
          <button
            type="button"
            onClick={() => setSources((v) => !v)}
            aria-expanded={sources}
            className="type-machine mt-2 underline decoration-dotted underline-offset-2 hover:text-content"
          >
            Varför ser jag detta?
          </button>
          {sources && (
            <p className="type-machine mt-1 text-content-subtle">
              källor {action.sourceIds.length > 0 ? action.sourceIds.join(', ') : 'härledda'} ·{' '}
              {action.priorityId ?? 'ingen Sentinel-prioritet'} · {action.method} · rangordning
              Sentinels, aldrig AUM
            </p>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3 border-t border-line pt-3 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
          <div>
            <p className="type-section">Mål med samtalet</p>
            <p className="mt-0.5 text-[13px] leading-snug text-content">
              {OBJECTIVE_TEXT[action.objective]}
            </p>
          </div>
          <div>
            <p className="type-section">Beräknad tid</p>
            <p className="type-figure mt-0.5 font-display">{timeText(action.time)}</p>
          </div>
          <div className="mt-auto flex flex-wrap gap-2">
            <Link
              to="/today/call/$clientId"
              params={{ clientId: action.clientId }}
              className="jarvis-gold-btn dossier-cta"
            >
              Förbered samtal
              <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />
            </Link>
            {action.meetingId && (
              <Link
                to="/clients/$clientId/meeting-prep"
                params={{ clientId: action.clientId }}
                className="jarvis-ghost-btn dossier-cta"
              >
                Förbered möte
              </Link>
            )}
            <Link
              to="/clients/$clientId"
              params={{ clientId: action.clientId }}
              className="jarvis-ghost-btn dossier-cta"
            >
              Öppna klient
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}

function ActionChips({ action }: { action: DailyAction }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={cn('type-section', BAND_TONE[action.band])}>{BAND_LABEL[action.band]}</span>
      <span className="type-machine rounded-chip border border-line px-1.5 py-0.5">
        {HORIZON_LABEL[action.horizon]}
      </span>
      {action.signals.slice(0, 4).map((signal) => (
        <span key={signal} className="type-machine text-content-subtle">
          {SIGNAL_LABEL[signal]}
        </span>
      ))}
    </div>
  )
}

/* -------------------------------------------------------- next priorities */

function NextPriorities({ view, rest }: { view: DailyCommandView; rest: readonly DailyAction[] }) {
  const groups: { key: string; title: string; actions: readonly DailyAction[] }[] = [
    { key: 'now', title: 'Kräver dig nu', actions: rest.filter((a) => a.horizon === 'now') },
    { key: 'week', title: 'Den här veckan', actions: rest.filter((a) => a.horizon === 'week') },
    { key: 'watch', title: 'Bevaka', actions: rest.filter((a) => a.horizon === 'watch') },
  ].filter((g) => g.actions.length > 0)
  return (
    <Panel title="Nästa prioriteringar" meta={`${rest.length} · en åtgärd per relation`} bodyClassName="p-0">
      {groups.length === 0 ? (
        <p className="type-inst-sub px-3 py-3">
          Inget mer kräver dig i dag.
          {view.setAside > 0 ? ` ${view.setAside} prioriteringar är vilande eller avfärdade i Sentinel.` : ''}
        </p>
      ) : (
        groups.map((group) => (
          <div key={group.key}>
            <p className="type-section border-b border-line px-3 py-1.5 text-content-subtle">
              {group.title}
            </p>
            <ol>
              {group.actions.map((action) => (
                <PriorityRow
                  key={action.id}
                  action={action}
                  index={[...view.now, ...view.week, ...view.watch].indexOf(action) + 1}
                />
              ))}
            </ol>
          </div>
        ))
      )}
    </Panel>
  )
}

function PriorityRow({ action, index }: { action: DailyAction; index: number }) {
  const [open, setOpen] = useState(false)
  const reasons = actionReasons(action)
  return (
    <li
      className={cn(
        'grid gap-x-4 gap-y-1.5 border-b border-line px-3 py-2.5 last:border-b-0 lg:grid-cols-[28px_minmax(0,1.3fr)_minmax(0,2fr)_auto]',
        BAND_EDGE[action.band],
      )}
    >
      <span className="tabular type-machine pt-0.5 text-content-subtle">
        {String(index).padStart(2, '0')}
      </span>
      <div className="min-w-0">
        <Link
          to="/clients/$clientId"
          params={{ clientId: action.clientId }}
          className="type-inst-lg block truncate hover:text-institution"
        >
          {action.clientName}
        </Link>
        <p className="type-inst-sub truncate">
          {SEGMENT_SHORT[action.segment]} · {action.officeName}
        </p>
        <div className="mt-1">
          <ActionChips action={action} />
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-[13.5px] font-medium leading-snug text-content">{actionHeadline(action)}</p>
        <p className="mt-0.5 text-[12px] leading-snug text-content-muted">{actionWhyNow(action)}</p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="type-machine mt-1 underline decoration-dotted underline-offset-2 hover:text-content"
        >
          Varför ser jag detta?
        </button>
        {open && (
          <ul className="mt-1 space-y-0.5 border-l border-line pl-2 text-[12px] text-content-muted">
            {reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
            <li className="type-machine">
              källor {action.sourceIds.length > 0 ? action.sourceIds.join(', ') : 'härledda'} ·{' '}
              {action.method}
            </li>
          </ul>
        )}
      </div>
      <div className="flex min-w-0 flex-col items-start gap-1 lg:items-end">
        <span className="type-machine">{timeText(action.time)}</span>
        <Link
          to="/today/call/$clientId"
          params={{ clientId: action.clientId }}
          className="type-section rounded-module border border-institution-line bg-institution-soft/60 px-2.5 py-1 text-institution transition-colors hover:bg-institution-soft"
        >
          {ACTION_TYPE_SHORT[action.actionType]}
        </Link>
      </div>
    </li>
  )
}

/* ------------------------------------------------------------ time windows */

function TimeWindows({ windows }: { windows: readonly DailyTimeWindow[] }) {
  return (
    <Panel title="Har du en stund?" meta="rangordningen gäller · det som inte ryms namnges" bodyClassName="p-0">
      <div className="grid divide-y divide-line md:grid-cols-3 md:divide-x md:divide-y-0">
        {windows.map(({ minutes, fit }) => (
          <div key={minutes} className="min-w-0 px-3 py-2.5">
            <p className="font-display text-[18px] text-content">{minutes} minuter</p>
            {fit.best ? (
              <ol className="mt-1.5 space-y-1.5 text-[12.5px]">
                {[fit.best, ...(fit.second ? [fit.second] : [])].map((slot) => (
                  <li key={slot.action.id}>
                    <Link
                      to="/today/call/$clientId"
                      params={{ clientId: slot.action.clientId }}
                      className="text-content hover:text-institution"
                    >
                      {ACTION_TYPE_LABEL[slot.action.actionType]} · {slot.action.clientName}
                    </Link>
                    <span className="type-machine ml-1.5">{timeText(slot.action.time)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="type-inst-sub mt-1.5">Ingen åtgärd ryms – de som väntar behöver mer tid.</p>
            )}
            {fit.skipped.length > 0 && (
              <p className="type-inst-sub mt-1.5 text-content-subtle">
                Ryms inte: {fit.skipped.map((a) => a.clientName).join(', ')}
              </p>
            )}
          </div>
        ))}
      </div>
    </Panel>
  )
}

/* ---------------------------------------------------------------- meetings */

function MeetingsPanel({ meetings, today }: { meetings: readonly DailyMeeting[]; today: string }) {
  const todays = meetings.filter((m) => m.date === today)
  return (
    <Panel
      title={todays.length > 0 ? 'Möten i dag' : 'Möten inom sju dagar'}
      meta={String(meetings.length)}
      bodyClassName="p-0"
    >
      {meetings.length === 0 ? (
        <p className="type-inst-sub px-3 py-3">Inga möten inom sju dagar.</p>
      ) : (
        <ol>
          {meetings.map((m) => (
            <li key={m.eventId} className="border-b border-line px-3 py-2 last:border-b-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="tabular type-machine text-content">
                  {formatDayMonth(m.date)} · {formatDaysFromToday(m.daysAhead)}
                </span>
                {m.readiness && (
                  <span
                    className={cn(
                      'type-machine rounded-chip border px-1.5 py-0.5',
                      READINESS_TONE[m.readiness],
                    )}
                  >
                    {READINESS_LABEL[m.readiness].toUpperCase()}
                  </span>
                )}
              </div>
              <Link
                to="/clients/$clientId"
                params={{ clientId: m.clientId }}
                className="type-inst-lg mt-0.5 block truncate hover:text-institution"
              >
                {m.clientName}
              </Link>
              <p className="type-inst-sub truncate">{m.title}</p>
              <Link
                to="/clients/$clientId/meeting-prep"
                params={{ clientId: m.clientId }}
                className="type-section mt-1 inline-flex items-center gap-1 text-institution hover:text-content"
              >
                Förbered möte
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}

/* ------------------------------------------------------- market → client */

function MarketPanel({ view }: { view: DailyCommandView }) {
  return (
    <Panel
      title="Marknad → Klient"
      meta={view.freshness.marketObservedAt ? observedAtText(view.freshness.marketObservedAt) : 'ej observerad'}
      bodyClassName="p-0"
    >
      {view.market.length === 0 ? (
        <p className="type-inst-sub px-3 py-3">
          Inga klientrelevanta marknadsrörelser i dag
          {view.freshness.marketEvents > 0
            ? ` · ${view.freshness.marketEvents} ${view.freshness.marketEvents === 1 ? 'episod' : 'episoder'} öppna, ingen når en klient meningsfullt`
            : ''}
          .
        </p>
      ) : (
        <ol>
          {view.market.map((item) => (
            <MarketRow key={item.episodeId} item={item} />
          ))}
        </ol>
      )}
      <p className="type-machine border-t border-line px-3 py-1.5 text-content-subtle">
        fakta · klientrelevans · föreslagen åtgärd — kontakten är rådgivarens beslut
      </p>
    </Panel>
  )
}

function MarketRow({ item }: { item: DailyMarketItem }) {
  return (
    <li className="border-b border-line px-3 py-2 last:border-b-0">
      <p className="type-section text-institution">Fakta</p>
      <p className="mt-0.5 text-[12.5px] leading-snug text-content">{marketItemFact(item)}</p>
      <p className="type-machine mt-0.5">{marketItemCounts(item)}</p>
      <ul className="mt-1.5 space-y-1.5">
        {item.clients.slice(0, 3).map((client) => (
          <li key={client.clientId} className="text-[12px] leading-snug">
            <Link
              to="/clients/$clientId"
              params={{ clientId: client.clientId }}
              className="font-medium text-content hover:text-institution"
            >
              {client.clientName}
            </Link>
            <span className="block text-content-muted">
              <span className="type-section mr-1">Klientrelevans</span>
              {marketClientRelevance(client)}
            </span>
            <span className="block text-content-muted">
              <span className="type-section mr-1">Föreslagen åtgärd</span>
              {marketClientAction(client)}
            </span>
          </li>
        ))}
      </ul>
    </li>
  )
}

/* ---------------------------------------------------------------- changes */

function ChangesPanel({ view }: { view: DailyCommandView }) {
  const { changes } = view
  const rows = [
    ...changes.newlyOverdue.map((c) => ({ ...c, change: 'newly-overdue' as const })),
    ...changes.completedCommitments.map((c) => ({ ...c, change: 'completed-commitment' as const })),
    ...changes.meetingsBooked.map((c) => ({ ...c, change: 'meeting-booked' as const })),
    ...changes.contactsRecorded.map((c) => ({ ...c, change: 'contact-recorded' as const })),
    ...changes.concernsRaised.map((c) => ({ ...c, change: 'concern-raised' as const })),
    ...changes.concernsEased.map((c) => ({ ...c, change: 'concern-eased' as const })),
  ]
  const title = `Förändringar ${sinceText(changes.since, view.today)}`
  return (
    <Panel title={title} meta={String(changes.total)} bodyClassName="p-0">
      {changes.total === 0 ? (
        <p className="type-inst-sub px-3 py-3">Inget har förändrats i registret sedan dess.</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={`${row.change}-${row.sourceId}`} className="border-b border-line px-3 py-1.5 text-[12px] last:border-b-0">
              <span className="type-section mr-1.5">{CHANGE_LABEL[row.change]}</span>
              <Link
                to="/clients/$clientId"
                params={{ clientId: row.clientId }}
                className="text-content hover:text-institution"
              >
                {row.clientName}
              </Link>
              <span className="block text-content-muted">
                {row.label} · {formatDayMonth(row.date)}
              </span>
            </li>
          ))}
          {changes.marketOpened.map((m) => (
            <li key={m.eventId} className="border-b border-line px-3 py-1.5 text-[12px] last:border-b-0">
              <span className="type-section mr-1.5">{CHANGE_LABEL['market-opened']}</span>
              <span className="text-content">{m.label}</span>
              <span className="block text-content-muted">
                {m.meaningful === 1 ? '1 klient berörs' : `${m.meaningful} klienter berörs`}
              </span>
            </li>
          ))}
          {changes.lifecycle.map((entry) => (
            <li key={entry.event.id} className="border-b border-line px-3 py-1.5 text-[12px] last:border-b-0">
              <span className="type-section mr-1.5">{LIFECYCLE_EVENT_LABEL[entry.event.kind]}</span>
              <span className="text-content">{entry.subjectName}</span>
              <span className="block text-content-muted">{formatDayMonth(entry.event.effectiveDate)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/* ------------------------------------------------------------------ pulse */

function PulsePanel({ view }: { view: DailyCommandView }) {
  return (
    <Panel title="Bokens puls" meta={`${view.pulse.activeClients} aktiva relationer`}>
      <dl className="grid grid-cols-3 gap-y-2.5 px-1 py-1">
        {pulseLines(view.pulse).map((line) => (
          <div key={line.label} className="min-w-0 pr-2">
            <dt className="type-section truncate">{line.label}</dt>
            <dd className="type-figure mt-0.5 font-display">{line.value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}

/* ---------------------------------------------------------------- overdue */

function OverduePanel({ view }: { view: DailyCommandView }) {
  if (view.overdue.length === 0) return null
  return (
    <Panel title="Försenade åtaganden" meta={String(view.overdue.length)} bodyClassName="p-0">
      <ol>
        {view.overdue.map((o) => (
          <li key={o.commitmentId} className="border-b border-line px-3 py-1.5 text-[12px] last:border-b-0">
            <Link
              to="/clients/$clientId"
              params={{ clientId: o.clientId }}
              className="font-medium text-content hover:text-institution"
            >
              {o.clientName}
            </Link>
            <span className="block text-content-muted">{o.title}</span>
            <span className="type-machine text-negative">
              försenat {o.daysOverdue} {o.daysOverdue === 1 ? 'dag' : 'dagar'} · förföll{' '}
              {formatDayMonth(o.dueDate)}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  )
}

/* ------------------------------------------------------------- onboarding */

function OnboardingPanel({ actions }: { actions: readonly DailyAction[] }) {
  return (
    <Panel title="Under onboarding" meta={`${actions.length} · aldrig rangordnade mot boken`} bodyClassName="p-0">
      <ol>
        {actions.map((action) => (
          <li key={action.id} className="border-b border-line px-3 py-2 text-[12.5px] last:border-b-0">
            <Link
              to="/clients/$clientId"
              params={{ clientId: action.clientId }}
              className="type-inst-lg hover:text-institution"
            >
              {action.clientName}
            </Link>
            <span className="block text-content-muted">
              {ACTION_TYPE_LABEL[action.actionType]}
              {action.gaps.length > 0 ? ` · ${action.gaps.map((g) => GAP_LABEL[g]).join(' · ')}` : ''}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  )
}

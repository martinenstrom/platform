import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { MeetingCockpit as MeetingCockpitModel } from '~/application/advisory/meetingCockpit'
import type { ChangeCategory, MeetingChange } from '~/domain/advisory'
import { ClientPortrait } from '~/components/clients/ClientPortrait'
import { ClientUpdateFlow } from '~/components/clients/ClientUpdateFlow'
import { HealthScore } from '~/components/clients/HealthIndicator'
import { JarvisMark } from '~/components/clients/JarvisBlock'
import { Panel } from '~/components/ui/Panel'
import { cn } from '~/lib/cn'
import {
  formatDayMonth,
  formatDaysFromToday,
  formatLongDate,
  formatMsek,
  formatPoints,
  formatRiskProfile,
} from '~/presentation/advisory/format'
import {
  advisorQuestionText,
  advisorQuestionWhy,
  briefItemText,
  CHANGE_CATEGORY_LABEL,
  changesWindowText,
  changeText,
  clientQuestionText,
  clientQuestionTriggerText,
  comparisonGapText,
  CONFIDENCE_LABEL_SV,
  CONTEXT_REASON_LABEL,
  dataQualityText,
  FEW_CHANGES,
  financingQuestionText,
  financingStatusText,
  focusHeadline,
  focusReasonText,
  marketBasisText,
  marketDiscussionText,
  marketHeadline,
  marketRelevanceLines,
  materialLabel,
  objectiveText,
  opportunityText,
  PROMISE_BUCKET_LABEL,
  riskText,
  strategyObservationText,
} from '~/presentation/advisory/meetingCockpitText'
import {
  driverText,
  preparation,
  priorityTitle,
  SEVERITY_LABEL,
  whyNow,
} from '~/presentation/advisory/sentinelText'
import {
  ASSET_CLASS_LABEL,
  EVENT_LABEL,
  GOAL_STATUS_LABEL,
  INTERACTION_LABEL,
} from '~/presentation/advisory/text'
import { AgendaEditor } from './AgendaEditor'
import { AskJarvisMeeting } from './AskJarvisMeeting'
import type { MeetingActions } from './meetingActions'
import { SourcesNote } from './SourcesNote'

/**
 * Meeting Cockpit — a mission briefing, not a database profile.
 *
 * The first viewport carries who the client is, when the meeting is, the
 * one focus, the thirty-second brief, what changed since the last meeting
 * and what is owed; the rest follows in meeting order. The rail keeps the
 * objectives, the promises, the safety check and the materials in view.
 * Everything rendered arrives as typed state from the read model; the
 * surface derives nothing. 90 % institutional Private Banking, 10 % JARVIS.
 */
export function MeetingCockpit({
  cockpit,
  actions,
  onChanged,
}: {
  cockpit: MeetingCockpitModel
  actions: MeetingActions
  /** Called after the record changed — the meeting was recorded — so the route re-reads. */
  onChanged: () => Promise<void>
}) {
  const [closing, setClosing] = useState(false)
  const [closed, setClosed] = useState(false)
  const { titles } = cockpit

  return (
    <div className="flex flex-col gap-2">
      <Hero cockpit={cockpit} />

      <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_minmax(300px,30%)]">
        <div className="flex min-w-0 flex-col gap-2">
          <Brief cockpit={cockpit} />
          <Changes cockpit={cockpit} />
          <Market cockpit={cockpit} />
          <Strategy cockpit={cockpit} />
          <Financing cockpit={cockpit} />
          <ClientContext cockpit={cockpit} />
          {cockpit.sentinelEntry && <SentinelContext cockpit={cockpit} />}
          <ClientQuestions cockpit={cockpit} />
          <AdvisorQuestions cockpit={cockpit} />
          <Opportunities cockpit={cockpit} />
          <DataQuality cockpit={cockpit} />
          <AgendaEditor agenda={cockpit.agenda} titles={titles} />
          <AskJarvisMeeting actions={actions} titles={titles} />

          <section className="ref-panel inst-edge" aria-label="Avsluta mötet">
            <header className="ref-head">
              <h2 className="type-section text-institution">Avsluta möte</h2>
              <span className="type-machine">
                samma klientuppdatering som på klientsidan
              </span>
            </header>
            <div className="p-3">
              {closed ? (
                <p className="type-inst">
                  Mötesanteckningen är registrerad. Registrerades den som ett möte är
                  baslinjen för nästa förberedelse sparad; tidslinje, åtaganden, händelser
                  och klientkontext är uppdaterade.
                </p>
              ) : (
                <>
                  <p className="type-inst-sub">
                    Skriv vad som hände. JARVIS föreslår struktur, du bekräftar, och nästa
                    mötesförberedelse jämför mot det som gällde när det här mötet
                    stängdes.
                  </p>
                  {!closing && (
                    <button
                      type="button"
                      onClick={() => setClosing(true)}
                      className="type-section mt-2 rounded-[4px] border border-institution-line bg-institution-soft/60 px-3.5 py-2 text-institution transition-colors hover:bg-institution-soft"
                    >
                      Registrera mötesanteckning
                    </button>
                  )}
                </>
              )}
            </div>
          </section>
          {closing && !closed && (
            <ClientUpdateFlow
              today={cockpit.today}
              actions={actions.client}
              onConfirmed={async () => {
                setClosed(true)
                setClosing(false)
                await onChanged()
              }}
              onClose={() => setClosing(false)}
            />
          )}

          <p className="type-machine px-1 pb-2">
            Syntetisk relation · derivat per {cockpit.today} · {cockpit.method} ·{' '}
            {cockpit.sources.length} källposter · inget genererat av en modell
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-2 xl:sticky xl:top-14 xl:self-start">
          <Objectives cockpit={cockpit} />
          <Promises cockpit={cockpit} />
          <DontForget cockpit={cockpit} />
          <Materials cockpit={cockpit} />
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------- hero */

function Hero({ cockpit }: { cockpit: MeetingCockpitModel }) {
  const { identity, meeting, lastMeeting, health, balanceSheet, focus, titles } = cockpit
  const { client, advisor } = identity
  return (
    <header className="ref-panel inst-edge px-4 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <ClientPortrait
            clientId={client.id}
            displayName={client.displayName}
            size="md"
          />
          <div className="min-w-0">
            <p className="type-section text-institution">Förbered möte</p>
            <h1
              className="type-display-name mt-1 text-[30px]"
              style={{ viewTransitionName: `client-${client.id}` }}
            >
              {client.displayName}
            </h1>
            <p className="type-inst-sub mt-1">
              {meeting.event ? (
                <>
                  {EVENT_LABEL[meeting.event.type]} · {meeting.event.title} ·{' '}
                  {formatLongDate(meeting.event.occursOn)}
                  {meeting.daysAhead !== null &&
                    ` · ${formatDaysFromToday(meeting.daysAhead)}`}
                  {meeting.event.notes && ` · ${meeting.event.notes}`}
                </>
              ) : (
                <>
                  Oplanerad avstämning · ingen mötestid bokad · underlaget gäller nästa
                  kontakt
                </>
              )}
            </p>
            <dl className="mt-3 flex flex-wrap gap-x-7 gap-y-2">
              <div>
                <dt className="type-section">Senaste möte</dt>
                <dd className="mt-0.5 text-[15px] font-semibold text-content">
                  {lastMeeting ? (
                    <>
                      {formatDayMonth(lastMeeting.date)}
                      <span className="type-inst-sub ml-1.5">
                        {INTERACTION_LABEL[lastMeeting.type]} · {lastMeeting.title}
                      </span>
                    </>
                  ) : (
                    <span className="type-inst-sub">Inget möte registrerat</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="type-section">Relationshälsa</dt>
                <dd className="mt-0.5">
                  <HealthScore health={health} />
                </dd>
              </div>
              <div>
                <dt className="type-section">AUM</dt>
                <dd className="tabular mt-0.5 text-[15px] font-semibold text-content">
                  {formatMsek(balanceSheet.assetsWithBank)}
                  <span className="type-inst-sub ml-1.5">
                    av {formatMsek(balanceSheet.totalAssets)}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="type-section">Rådgivare</dt>
                <dd className="mt-0.5 text-[15px] font-semibold text-content">
                  {advisor?.displayName ?? client.primaryAdvisorId}
                </dd>
              </div>
            </dl>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:flex-col lg:items-stretch">
          <Link
            to="/clients/$clientId"
            params={{ clientId: client.id }}
            className="type-section rounded-[4px] border border-line px-3.5 py-2 text-center text-content-muted transition-colors hover:border-line-strong hover:text-content"
          >
            Öppna Klient 360
          </Link>
        </div>
      </div>

      <section
        aria-label="Mötets huvudfokus"
        className="mt-3 rounded-[4px] border border-institution-line bg-institution-soft/35 px-3.5 py-2.5 shadow-[inset_2px_0_0_0_var(--color-institution)]"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="type-section text-institution">Mötets huvudfokus</span>
          <JarvisMark kind="recommends" />
        </div>
        <p className="mt-1 text-[18px] font-medium leading-snug text-content">
          {focusHeadline(focus)}
        </p>
        <ul className="mt-1.5 flex flex-wrap gap-x-5 gap-y-0.5 text-[12.5px] text-content-muted">
          {[focus.primary, ...focus.supporting].map((topic) => (
            <li key={topic.kind}>{focusReasonText(topic)}</li>
          ))}
        </ul>
        <SourcesNote
          ids={[focus.primary, ...focus.supporting].flatMap((x) => x.sourceIds)}
          titles={titles}
        />
      </section>
    </header>
  )
}

/* ------------------------------------------------------------------- brief */

function Brief({ cockpit }: { cockpit: MeetingCockpitModel }) {
  return (
    <Panel title="Klienten på 30 sekunder" bodyClassName="p-3">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {cockpit.brief.map((item) => {
          const t = briefItemText(item)
          return (
            <div key={item.kind} className="min-w-0">
              <dt className="type-section">{t.label}</dt>
              <dd className="mt-0.5 text-[13px] leading-snug text-content">{t.value}</dd>
            </div>
          )
        })}
      </dl>
    </Panel>
  )
}

/* ----------------------------------------------------------------- changes */

const CATEGORY_ORDER: readonly ChangeCategory[] = [
  'portfolio',
  'liquidity',
  'wealth',
  'financing',
  'goals',
  'relationship',
  'commitments',
  'events',
  'context',
]

function Changes({ cockpit }: { cockpit: MeetingCockpitModel }) {
  const { changes, market, titles, today } = cockpit
  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    items: changes.changes.filter((c) => c.category === category),
  })).filter((g) => g.items.length > 0)
  const substantive = changes.changes.filter((c) => c.kind !== 'contacts')
  const quiet = substantive.length === 0 && market.length === 0
  return (
    <Panel
      title="Sedan senaste mötet"
      meta={changesWindowText(changes, today)}
      bodyClassName="p-3"
    >
      {changes.gaps.map((gap) => (
        <p key={gap} className="type-inst-sub mb-2">
          {comparisonGapText(gap)}
        </p>
      ))}
      {quiet ? (
        <p className="type-inst">{FEW_CHANGES}</p>
      ) : (
        <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
          {groups.map((group) => (
            <section
              key={group.category}
              aria-label={CHANGE_CATEGORY_LABEL[group.category]}
            >
              <h3 className="type-section">{CHANGE_CATEGORY_LABEL[group.category]}</h3>
              <ul className="mt-1 space-y-1">
                {group.items.map((c, i) => (
                  <ChangeRow key={`${c.kind}-${i}`} change={c} titles={titles} />
                ))}
              </ul>
            </section>
          ))}
          {market.length > 0 && (
            <section aria-label="Marknad">
              <h3 className="type-section">Marknad</h3>
              <ul className="mt-1 space-y-1">
                {market.slice(0, 3).map((m) => (
                  <li key={m.item.impact.id} className="text-[12.5px] leading-snug">
                    <span className="text-content">{marketHeadline(m)}</span>
                    <span className="type-machine ml-1.5">
                      {marketRelevanceLines(m).conversation.toLowerCase()} samtalsrelevans
                    </span>
                  </li>
                ))}
                {market.length > 3 && (
                  <li className="type-machine">+{market.length - 3} till nedan</li>
                )}
              </ul>
            </section>
          )}
        </div>
      )}
      <SourcesNote ids={changes.changes.flatMap((c) => c.sourceIds)} titles={titles} />
    </Panel>
  )
}

function ChangeRow({
  change,
  titles,
}: {
  change: MeetingChange
  titles: Readonly<Record<string, string>>
}) {
  const t = changeText(change, titles)
  return (
    <li className="text-[12.5px] leading-snug">
      <span className="text-content">{t.label}</span>
      <span className="ml-1.5 text-content-muted">{t.value}</span>
    </li>
  )
}

/* ------------------------------------------------------------------ market */

function Market({ cockpit }: { cockpit: MeetingCockpitModel }) {
  const { market, titles } = cockpit
  return (
    <Panel
      title="Marknad sedan senaste mötet"
      meta={
        market.length === 0
          ? 'inga klientrelevanta rörelser'
          : `${market.length} klientrelevanta ${market.length === 1 ? 'rörelse' : 'rörelser'}`
      }
      bodyClassName="p-3"
    >
      {market.length === 0 ? (
        <p className="type-inst-sub">
          Inga marknadsrörelser i fönstret möter en registrerad exponering eller kontext
          hos klienten. Allmänna marknadsnyheter visas inte här.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {market.map((m) => {
            const lines = marketRelevanceLines(m)
            return (
              <li key={m.item.impact.id} className="py-2 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="text-[13px] font-medium text-content">
                    {marketHeadline(m)}
                  </p>
                  <p className="type-machine">{lines.status}</p>
                </div>
                <dl className="mt-1 grid gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-2">
                  <Row label="Finansiell relevans" value={lines.financial} />
                  <Row label="Samtalsrelevans" value={lines.conversation} />
                  <Row label="Varför" value={lines.why} wide />
                  <Row label="Diskussionspunkt" value={marketDiscussionText(m)} wide />
                </dl>
                <p className="type-machine mt-1">{marketBasisText(m)}</p>
              </li>
            )
          })}
        </ul>
      )}
      <SourcesNote ids={market.flatMap((m) => m.sourceIds)} titles={titles} />
    </Panel>
  )
}

function Row({
  label,
  value,
  wide = false,
}: {
  label: string
  value: string
  wide?: boolean
}) {
  return (
    <div className={cn('flex gap-1.5', wide && 'sm:col-span-2')}>
      <dt className="type-section shrink-0 pt-0.5">{label}</dt>
      <dd className="text-content-muted">{value}</dd>
    </div>
  )
}

/* ---------------------------------------------------------------- strategy */

function Strategy({ cockpit }: { cockpit: MeetingCockpitModel }) {
  const { strategy, titles } = cockpit
  return (
    <Panel
      title="Strategin"
      meta={`risk ${formatRiskProfile(strategy.riskProfile)}`}
      bodyClassName="p-3"
    >
      {strategy.noPortfolio ? (
        <p className="type-inst-sub">Ingen portfölj hos banken är registrerad.</p>
      ) : (
        <div className="grid gap-x-6 gap-y-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="type-section text-left">
                  <th className="pb-1 font-medium">Tillgångsslag</th>
                  <th className="pb-1 text-right font-medium">Strategi</th>
                  <th className="pb-1 text-right font-medium">Nu</th>
                  <th className="pb-1 text-right font-medium">Avvikelse</th>
                </tr>
              </thead>
              <tbody>
                {strategy.rows.map((r) => (
                  <tr key={r.assetClass} className="border-t border-line">
                    <td className="py-1 text-content">
                      {ASSET_CLASS_LABEL[r.assetClass]}
                    </td>
                    <td className="tabular py-1 text-right text-content-muted">
                      {r.strategicPercent} %
                    </td>
                    <td className="tabular py-1 text-right text-content">
                      {r.currentPercent} %
                    </td>
                    <td
                      className={cn(
                        'tabular py-1 text-right',
                        r.meaningful ? 'text-warning' : 'text-content-subtle',
                      )}
                    >
                      {formatPoints(r.deviationPoints)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="type-machine mt-2">
              Likvida medel {formatMsek(strategy.liquidity.amount)} ·{' '}
              {strategy.liquidity.shareOfFinancialPercent} % av finansiella tillgångar
              {strategy.liquidity.strategicCashPercent !== null &&
                ` · strategi ${strategy.liquidity.strategicCashPercent} % likviditet i portföljen`}
            </p>
            {strategy.goalsAffected.length > 0 && (
              <p className="type-machine mt-1">
                Mål efter plan:{' '}
                {strategy.goalsAffected
                  .map((g) => `${g.title} (${GOAL_STATUS_LABEL[g.status].toLowerCase()})`)
                  .join(' · ')}
              </p>
            )}
          </div>
          <div>
            {strategy.observations.length === 0 ? (
              <p className="type-inst-sub">
                Portföljen ligger inom mandatet. Inget att ta upp om strategin.
              </p>
            ) : (
              <ul className="space-y-2">
                {strategy.observations.map((o, i) => {
                  const t = strategyObservationText(o)
                  return (
                    <li
                      key={`${o.kind}-${i}`}
                      className="rounded-[3px] border border-line px-2.5 py-2 text-[12.5px]"
                    >
                      <dl className="space-y-0.5">
                        <Row label="Observation" value={t.observation} />
                        <Row label="Varför det spelar roll" value={t.whyItMatters} />
                        <Row label="Diskussionspunkt" value={t.discussionPoint} />
                      </dl>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
      <SourcesNote
        ids={strategy.observations.flatMap((o) => o.sourceIds)}
        titles={titles}
      />
    </Panel>
  )
}

/* --------------------------------------------------------------- financing */

function Financing({ cockpit }: { cockpit: MeetingCockpitModel }) {
  const { financing, titles } = cockpit
  return (
    <Panel
      title="Finansiering"
      meta={financing.length === 0 ? 'inget aktuellt' : `${financing.length} att ta upp`}
      bodyClassName="p-3"
    >
      {financing.length === 0 ? (
        <p className="type-inst-sub">
          Ingen finansieringshändelse inom 180 dagar och ingen rörlig skuld av vikt.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {financing.map((f, i) => (
            <li
              key={`${f.loan?.id ?? 'loan'}-${f.event?.id ?? i}`}
              className="py-2 first:pt-0 last:pb-0"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-[13px] font-medium text-content">
                  {f.loan
                    ? `${f.loan.title} · ${formatMsek(f.loan.outstandingBalance)}`
                    : (f.event?.title ?? 'Lån')}
                </p>
                {f.daysAhead !== null && (
                  <p className="type-machine">
                    {f.event
                      ? `${EVENT_LABEL[f.event.type]} ${formatDayMonth(f.event.occursOn)} · `
                      : ''}
                    {f.daysAhead} dagar kvar
                  </p>
                )}
              </div>
              <dl className="mt-1 space-y-0.5 text-[12.5px]">
                {f.loan && (
                  <Row
                    label="Villkor"
                    value={`${f.loan.interestType === 'fixed' ? 'bunden' : 'rörlig'} ${f.loan.ratePercent} %${f.loan.maturityDate ? ` · löper till ${formatDayMonth(f.loan.maturityDate)}` : ''}`}
                  />
                )}
                <Row label="Status" value={financingStatusText(f)} />
                <Row label="Möjlig fråga" value={financingQuestionText(f)} />
              </dl>
            </li>
          ))}
        </ul>
      )}
      <p className="type-machine mt-1">
        Ingen automatisk rekommendation om bunden eller rörlig ränta.
      </p>
      <SourcesNote ids={financing.flatMap((f) => f.sourceIds)} titles={titles} />
    </Panel>
  )
}

/* ----------------------------------------------------------------- context */

function ClientContext({ cockpit }: { cockpit: MeetingCockpitModel }) {
  const { context, titles } = cockpit
  return (
    <Panel
      title="Detta är viktigt för klienten"
      meta={`${context.length} bekräftade fakta`}
      bodyClassName="p-3"
    >
      {context.length === 0 ? (
        <p className="type-inst-sub">
          Ingen klientkontext med bäring på mötet är registrerad.
        </p>
      ) : (
        <ul className="grid gap-x-6 gap-y-1.5 md:grid-cols-2">
          {context.map((c) => (
            <li key={c.fact.id} className="text-[12.5px] leading-snug">
              <span className="type-section mr-1.5">
                {CONTEXT_REASON_LABEL[c.reason]}
              </span>
              <span className="text-content">{c.fact.statement}</span>
              <span className="type-machine ml-1.5">
                {formatDayMonth(c.fact.provenance.sourceDate)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <SourcesNote ids={context.map((c) => c.fact.id)} titles={titles} />
    </Panel>
  )
}

/* ---------------------------------------------------------------- sentinel */

function SentinelContext({ cockpit }: { cockpit: MeetingCockpitModel }) {
  const entry = cockpit.sentinelEntry!
  const { priority } = entry
  return (
    <Panel
      title="Varför klienten är prioriterad"
      meta={`Sentinel · ${SEVERITY_LABEL[priority.severity]}`}
      bodyClassName="p-3"
    >
      <p className="text-[13px] font-medium text-content">{priorityTitle(entry)}</p>
      <dl className="mt-1 space-y-0.5 text-[12.5px]">
        <Row label="Varför nu" value={whyNow(priority)} />
        <Row label="Förberedelse" value={preparation(priority)} />
      </dl>
      {priority.drivers.length > 1 && (
        <ul className="mt-1.5 space-y-0.5 border-l border-line pl-2 text-[12px] text-content-muted">
          {priority.drivers.slice(1, 5).map((d, i) => (
            <li key={`${d.kind}-${i}`}>{driverText(d)}</li>
          ))}
        </ul>
      )}
      <SourcesNote ids={priority.sourceIds} titles={cockpit.titles} />
    </Panel>
  )
}

/* --------------------------------------------------------------- questions */

function ClientQuestions({ cockpit }: { cockpit: MeetingCockpitModel }) {
  const { clientQuestions, titles } = cockpit
  return (
    <Panel
      title="Klienten kan fråga"
      meta="möjliga frågor · inte förutsägelser"
      bodyClassName="p-3"
    >
      {clientQuestions.length === 0 ? (
        <p className="type-inst-sub">
          Inget i registret pekar på en särskild fråga från klienten.
        </p>
      ) : (
        <ul className="space-y-2">
          {clientQuestions.map((q) => (
            <li key={q.kind} className="text-[12.5px]">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="type-section">Möjlig fråga</span>
                <span className="type-machine">{CONFIDENCE_LABEL_SV[q.confidence]}</span>
              </div>
              <p className="text-[13.5px] text-content">”{clientQuestionText(q)}”</p>
              <p className="type-machine mt-0.5">
                Grund: {clientQuestionTriggerText(q, titles)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function AdvisorQuestions({ cockpit }: { cockpit: MeetingCockpitModel }) {
  const { advisorQuestions, titles } = cockpit
  return (
    <Panel
      title="Frågor att ställa"
      meta={`${advisorQuestions.length} grundade i registret`}
      bodyClassName="p-3"
    >
      <ol className="space-y-2">
        {advisorQuestions.map((q, i) => (
          <li key={`${q.kind}-${i}`} className="flex gap-2 text-[12.5px]">
            <span className="type-machine w-4 shrink-0 pt-0.5 text-content-subtle">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-[13.5px] text-content">”{advisorQuestionText(q)}”</p>
              <details className="mt-0.5">
                <summary className="type-machine cursor-pointer list-none underline decoration-dotted underline-offset-2 hover:text-content">
                  Varför ställa frågan?
                </summary>
                <p className="type-machine mt-0.5">
                  {advisorQuestionWhy(q, titles)}
                  {q.sourceIds.length > 0 &&
                    ` · källor: ${[...new Set(q.sourceIds)].map((id) => titles[id] ?? id).join(', ')}`}
                </p>
              </details>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  )
}

/* ----------------------------------------------------------- opportunities */

function Opportunities({ cockpit }: { cockpit: MeetingCockpitModel }) {
  const { opportunities, titles } = cockpit
  return (
    <Panel
      title="Möjligheter att utforska"
      meta="klientens perspektiv först"
      bodyClassName="p-3"
    >
      {opportunities.length === 0 ? (
        <p className="type-inst-sub">
          Inget i registret pekar på något att utforska just nu.
        </p>
      ) : (
        <ul className="grid gap-x-6 gap-y-2 md:grid-cols-2">
          {opportunities.map((o) => {
            const t = opportunityText(o)
            return (
              <li
                key={o.kind}
                className="rounded-[3px] border border-line px-2.5 py-2 text-[12.5px]"
              >
                <p className="type-section">{t.title}</p>
                <dl className="mt-0.5 space-y-0.5">
                  <Row label="Varför relevant" value={t.whyRelevant} />
                  {o.evidence.length > 0 && (
                    <Row label="Underlag" value={o.evidence.join(' · ')} />
                  )}
                  <Row label="Möjlig fråga" value={`”${t.question}”`} />
                </dl>
              </li>
            )
          })}
        </ul>
      )}
      <SourcesNote ids={opportunities.flatMap((o) => o.sourceIds)} titles={titles} />
    </Panel>
  )
}

/* ------------------------------------------------------------ data quality */

function DataQuality({ cockpit }: { cockpit: MeetingCockpitModel }) {
  const { dataQuality, titles } = cockpit
  return (
    <Panel
      title="Data att verifiera"
      meta={`${dataQuality.length} poster`}
      bodyClassName="p-3"
    >
      {dataQuality.length === 0 ? (
        <p className="type-inst-sub">Inga kända luckor i underlaget.</p>
      ) : (
        <ul className="space-y-1 text-[12.5px] text-content">
          {dataQuality.map((d, i) => (
            <li key={`${d.kind}-${i}`}>{dataQualityText(d)}</li>
          ))}
        </ul>
      )}
      <p className="type-machine mt-1">
        Saknad eller gammal uppgift behandlas inte som fakta.
      </p>
      <SourcesNote ids={dataQuality.flatMap((d) => d.sourceIds)} titles={titles} />
    </Panel>
  )
}

/* -------------------------------------------------------------------- rail */

function Objectives({ cockpit }: { cockpit: MeetingCockpitModel }) {
  return (
    <Panel
      title="Mål med mötet"
      meta={`${cockpit.objectives.length} mål`}
      bodyClassName="p-3"
    >
      <ol className="space-y-1 text-[12.5px] text-content">
        {cockpit.objectives.map((o, i) => (
          <li key={`${o.kind}-${i}`} className="flex gap-2">
            <span className="type-machine w-4 shrink-0 pt-0.5 text-content-subtle">
              {i + 1}
            </span>
            <span>{objectiveText(o)}</span>
          </li>
        ))}
      </ol>
    </Panel>
  )
}

function Promises({ cockpit }: { cockpit: MeetingCockpitModel }) {
  const { promises } = cockpit
  const groups = (['overdue', 'due-before-meeting', 'later', 'completed-since'] as const)
    .map((bucket) => ({ bucket, items: promises.filter((p) => p.bucket === bucket) }))
    .filter((g) => g.items.length > 0)
  const overdue = promises.filter((p) => p.bucket === 'overdue').length
  return (
    <Panel
      title="Du lovade"
      meta={
        overdue > 0
          ? `${overdue} försenat`
          : `${promises.filter((p) => p.bucket !== 'completed-since').length} öppna`
      }
      bodyClassName="p-3"
    >
      {groups.length === 0 ? (
        <p className="type-inst-sub">Inga åtaganden är registrerade.</p>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => (
            <section key={g.bucket} aria-label={PROMISE_BUCKET_LABEL[g.bucket]}>
              <h3
                className={cn(
                  'type-section',
                  g.bucket === 'overdue' && 'text-negative',
                  g.bucket === 'completed-since' && 'text-positive',
                )}
              >
                {PROMISE_BUCKET_LABEL[g.bucket]}
              </h3>
              <ul className="mt-0.5 space-y-0.5">
                {g.items.map((p) => (
                  <li key={p.commitment.id} className="text-[12.5px] leading-snug">
                    <span
                      className={cn(
                        g.bucket === 'completed-since'
                          ? 'text-content-muted'
                          : 'text-content',
                      )}
                    >
                      {p.commitment.title}
                    </span>
                    {p.commitment.dueDate && g.bucket !== 'completed-since' && (
                      <span className="type-machine ml-1.5">
                        senast {formatDayMonth(p.commitment.dueDate)}
                        {p.daysToDue !== null && ` · ${formatDaysFromToday(p.daysToDue)}`}
                      </span>
                    )}
                    {g.bucket === 'completed-since' && p.commitment.completedAt && (
                      <span className="type-machine ml-1.5">
                        klart {formatDayMonth(p.commitment.completedAt)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Panel>
  )
}

function DontForget({ cockpit }: { cockpit: MeetingCockpitModel }) {
  const { risks, titles } = cockpit
  return (
    <Panel title="Glöm inte" meta="säkerhetskontroll" bodyClassName="p-3">
      {risks.length === 0 ? (
        <p className="type-inst-sub">Inget som riskerar att glömmas.</p>
      ) : (
        <ul className="space-y-1 text-[12.5px] text-content">
          {risks.map((r, i) => (
            <li key={`${r.kind}-${i}`} className="flex gap-2">
              <span
                aria-hidden="true"
                className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-warning"
              />
              <span>{riskText(r)}</span>
            </li>
          ))}
        </ul>
      )}
      <SourcesNote ids={risks.flatMap((r) => r.sourceIds)} titles={titles} />
    </Panel>
  )
}

function Materials({ cockpit }: { cockpit: MeetingCockpitModel }) {
  const { materials } = cockpit
  const [done, setDone] = useState<Record<string, boolean>>({})
  return (
    <Panel title="Förbered material" meta="checklista" bodyClassName="p-3">
      {materials.length === 0 ? (
        <p className="type-inst-sub">Inget material som registret motiverar.</p>
      ) : (
        <ul className="space-y-1">
          {materials.map((m) => (
            <li key={m.kind}>
              <label className="flex items-start gap-2 text-[12.5px] text-content">
                <input
                  type="checkbox"
                  checked={done[m.kind] ?? false}
                  onChange={(e) => setDone((d) => ({ ...d, [m.kind]: e.target.checked }))}
                  className="mt-0.5"
                />
                <span className={cn(done[m.kind] && 'text-content-subtle line-through')}>
                  {materialLabel(m)}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <p className="type-machine mt-1">Ingen dokumentgenerering i V1 – en checklista.</p>
    </Panel>
  )
}

/** Exported so a test can render one section's structure without the page. */
export type MeetingSection = ReactNode

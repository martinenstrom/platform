import type { ReactNode } from 'react'
import type { MeetingPrep } from '~/domain/advisory'
import { cn } from '~/lib/cn'
import {
  formatDayMonth,
  formatDaysFromToday,
  formatLongDate,
  formatMsek,
  formatPoints,
} from '~/presentation/advisory/format'
import { signalText } from '~/presentation/advisory/intelligenceText'
import {
  ASSET_CLASS_LABEL,
  EVENT_LABEL,
  GOAL_STATUS_LABEL,
  INTERACTION_LABEL,
  SUGGESTED_TOPIC_LABEL,
} from '~/presentation/advisory/text'
import { JarvisMark } from './JarvisBlock'

/**
 * Prepare the meeting: the briefing the rules assemble over the record —
 * the last meeting, what has changed since, what is owed, what is coming,
 * where the portfolio stands, what the client worries about, the goals,
 * and the topics those facts suggest. A briefing, not the Meeting Cockpit.
 */
export function MeetingPrepPanel({
  prep,
  loading,
  error,
  onClose,
}: {
  prep: MeetingPrep | null
  loading: boolean
  error: string | null
  onClose: () => void
}) {
  return (
    <section className="ref-panel inst-edge" aria-label="Mötesförberedelse">
      <header className="ref-head">
        <h2 className="type-section text-institution">Förbered möte</h2>
        <div className="flex items-center gap-3">
          {prep && (
            <span className="type-machine">
              förberett för {formatLongDate(prep.preparedFor)} · {prep.method}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="type-machine hover:text-content"
          >
            Stäng
          </button>
        </div>
      </header>
      <div className="p-3">
        {loading && (
          <p className="type-machine text-accent" role="status">
            JARVIS sammanställer underlaget…
          </p>
        )}
        {error && (
          <p className="type-metadata text-warning" role="alert">
            {error}
          </p>
        )}
        {prep && (
          <div className="grid gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
            <Block title="Mötet">
              {prep.meeting ? (
                <p className="type-inst">
                  {prep.meeting.title} · {formatLongDate(prep.meeting.occursOn)}{' '}
                  <span className="type-inst-sub">
                    (
                    {formatDaysFromToday(
                      daysAhead(prep.preparedFor, prep.meeting.occursOn),
                    )}
                    )
                  </span>
                </p>
              ) : (
                <p className="type-inst-sub">
                  Inget möte bokat. Underlaget gäller nästa kontakt.
                </p>
              )}
            </Block>
            <Block title="Senaste mötet">
              {prep.lastMeeting ? (
                <>
                  <p className="type-inst">
                    {formatLongDate(prep.lastMeeting.date)} · {prep.lastMeeting.title}
                  </p>
                  {prep.lastMeeting.keyPoints.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-[12px] text-content-muted">
                      {prep.lastMeeting.keyPoints.map((p) => (
                        <li key={p}>– {p}</li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="type-inst-sub">Inget tidigare möte registrerat.</p>
              )}
            </Block>
            <Block title="Förändringar sedan senaste mötet">
              {prep.changesSince.length === 0 && prep.factsSince.length === 0 ? (
                <p className="type-inst-sub">Inga händelser sedan mötet.</p>
              ) : (
                <ul className="space-y-0.5 text-[12px]">
                  {prep.changesSince.map((i) => (
                    <li key={i.id} className="text-content-muted">
                      <span className="type-machine mr-1.5 text-content">
                        {formatDayMonth(i.date)}
                      </span>
                      {INTERACTION_LABEL[i.type]} · {i.title}
                    </li>
                  ))}
                  {prep.factsSince.map((f) => (
                    <li key={f.id} className="text-content-muted">
                      <span className="type-machine mr-1.5 text-content">
                        {formatDayMonth(f.provenance.sourceDate)}
                      </span>
                      Nytt: {f.statement}
                    </li>
                  ))}
                </ul>
              )}
            </Block>
            <Block
              title="Öppna åtaganden"
              tone={prep.overdueCommitments.length > 0 ? 'alert' : undefined}
            >
              {prep.openCommitments.length === 0 ? (
                <p className="type-inst-sub">Inga öppna åtaganden.</p>
              ) : (
                <ul className="space-y-0.5 text-[12px]">
                  {prep.openCommitments.map((c) => {
                    const overdue = prep.overdueCommitments.some((o) => o.id === c.id)
                    return (
                      <li
                        key={c.id}
                        className={cn(overdue ? 'text-content' : 'text-content-muted')}
                      >
                        {c.title}
                        {c.dueDate && (
                          <span
                            className={cn(
                              'type-machine ml-1.5',
                              overdue && 'text-negative',
                            )}
                          >
                            {overdue ? 'försenat' : 'senast'} {formatDayMonth(c.dueDate)}
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </Block>
            <Block title="Viktiga kommande händelser">
              {prep.upcomingEvents.length === 0 ? (
                <p className="type-inst-sub">Inget inom 90 dagar.</p>
              ) : (
                <ul className="space-y-0.5 text-[12px] text-content-muted">
                  {prep.upcomingEvents.map((e) => (
                    <li key={e.id}>
                      <span className="type-machine mr-1.5 text-content">
                        {formatDayMonth(e.occursOn)}
                      </span>
                      {EVENT_LABEL[e.type]} · {e.title}
                    </li>
                  ))}
                </ul>
              )}
            </Block>
            <Block title="Portföljavvikelser">
              {prep.portfolioDeviations.length === 0 ? (
                <p className="type-inst-sub">Ingen portfölj hos banken.</p>
              ) : (
                <ul className="space-y-0.5 text-[12px] text-content-muted">
                  {prep.portfolioDeviations.map((d) => (
                    <li key={d.assetClass} className="flex justify-between gap-2">
                      <span>{ASSET_CLASS_LABEL[d.assetClass]}</span>
                      <span
                        className={cn(
                          'tabular',
                          Math.abs(d.deviationPoints) >= 5
                            ? 'text-warning'
                            : 'text-content-subtle',
                        )}
                      >
                        {d.currentPercent} % mot {d.strategicPercent} % ·{' '}
                        {formatPoints(d.deviationPoints)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Block>
            <Block title="Signaler">
              {prep.alerts.length === 0 ? (
                <p className="type-inst-sub">Inga signaler.</p>
              ) : (
                <ul className="space-y-0.5 text-[12px] text-content-muted">
                  {prep.alerts.map((s, i) => (
                    <li key={`${s.kind}-${i}`}>{signalText(s).signal}</li>
                  ))}
                </ul>
              )}
            </Block>
            <Block
              title="Klientens oro"
              tone={prep.concerns.length > 0 ? 'warning' : undefined}
            >
              {prep.concerns.length === 0 ? (
                <p className="type-inst-sub">Ingen aktiv oro.</p>
              ) : (
                <ul className="space-y-0.5 text-[12px] text-content">
                  {prep.concerns.map((c) => (
                    <li key={c.id}>{c.statement}</li>
                  ))}
                </ul>
              )}
            </Block>
            <Block title="Mål">
              <ul className="space-y-0.5 text-[12px] text-content-muted">
                {prep.goals.map((g) => (
                  <li key={g.id} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate">{g.title}</span>
                    <span className="type-machine shrink-0">
                      {g.progressPercent} % · {GOAL_STATUS_LABEL[g.status]}
                    </span>
                  </li>
                ))}
              </ul>
            </Block>
            <Block title="Föreslagna samtalsämnen" tone="jarvis" wide>
              {prep.suggestedTopics.length === 0 ? (
                <p className="type-inst-sub">Inget särskilt att ta upp.</p>
              ) : (
                <ol className="grid gap-x-6 gap-y-0.5 text-[12px] md:grid-cols-2">
                  {prep.suggestedTopics.map((t, i) => (
                    <li
                      key={`${t.kind}-${t.referenceId ?? i}`}
                      className="flex gap-2 text-content"
                    >
                      <span className="type-machine w-4 shrink-0 text-content-subtle">
                        {i + 1}
                      </span>
                      <span>
                        <span className="type-machine mr-1.5">
                          {SUGGESTED_TOPIC_LABEL[t.kind]}
                        </span>
                        {t.kind === 'allocation-drift'
                          ? ASSET_CLASS_LABEL[
                              t.reference as keyof typeof ASSET_CLASS_LABEL
                            ]
                          : t.kind === 'excess-cash'
                            ? formatMsek(Number(t.reference))
                            : t.kind === 'contact-gap'
                              ? `${t.reference} dagar`
                              : t.reference}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Block>
            <Block title="Möjligheter">
              {prep.opportunities.length === 0 ? (
                <p className="type-inst-sub">Inga aktiva möjligheter.</p>
              ) : (
                <ul className="space-y-0.5 text-[12px] text-content-muted">
                  {prep.opportunities.map((o) => (
                    <li key={o.id} className="flex justify-between gap-2">
                      <span className="min-w-0 truncate">{o.title}</span>
                      <span className="tabular shrink-0 text-content">
                        {formatMsek(o.potentialValue)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Block>
          </div>
        )}
      </div>
    </section>
  )
}

function Block({
  title,
  tone,
  wide = false,
  children,
}: {
  title: string
  tone?: 'alert' | 'warning' | 'jarvis'
  wide?: boolean
  children: ReactNode
}) {
  return (
    <section className={cn(wide && 'md:col-span-2 xl:col-span-3')}>
      {tone === 'jarvis' ? (
        <JarvisMark kind="recommends" />
      ) : (
        <h3
          className={cn(
            'type-section',
            tone === 'alert' && 'text-negative',
            tone === 'warning' && 'text-warning',
          )}
        >
          {title}
        </h3>
      )}
      {tone === 'jarvis' && <h3 className="type-section mt-0.5">{title}</h3>}
      <div className="mt-1">{children}</div>
    </section>
  )
}

/** Days between two ISO dates, for the one distance the briefing does not carry. */
function daysAhead(from: string, to: string): number {
  return Math.round(
    (Date.UTC(
      Number(to.slice(0, 4)),
      Number(to.slice(5, 7)) - 1,
      Number(to.slice(8, 10)),
    ) -
      Date.UTC(
        Number(from.slice(0, 4)),
        Number(from.slice(5, 7)) - 1,
        Number(from.slice(8, 10)),
      )) /
      86_400_000,
  )
}

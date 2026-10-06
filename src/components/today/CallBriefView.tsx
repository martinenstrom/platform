import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import type { ConfirmClientUpdateResult } from '~/application/advisory/confirmClientUpdate'
import type { CallBrief } from '~/application/advisory/dailyCommand'
import type { DailyAction } from '~/domain/advisory'
import type { ClientActions } from '~/components/clients/clientActions'
import { ClientPortrait } from '~/components/clients/ClientPortrait'
import { ClientUpdateFlow } from '~/components/clients/ClientUpdateFlow'
import { Panel } from '~/components/ui/Panel'
import { cn } from '~/lib/cn'
import {
  ACTION_TYPE_LABEL,
  actionContextLine,
  actionHeadline,
  actionReasons,
  BAND_LABEL,
  HORIZON_LABEL,
  OBJECTIVE_TEXT,
  timeText,
} from '~/presentation/advisory/dailyCommandText'
import { formatDayMonth, formatDaysFromToday, formatLongDate } from '~/presentation/advisory/format'
import {
  advisorQuestionText,
  advisorQuestionWhy,
  clientQuestionText,
  marketDiscussionText,
  marketHeadline,
  riskText,
} from '~/presentation/advisory/meetingCockpitText'
import {
  CONTEXT_LABEL,
  HEALTH_BAND_LABEL,
  INTERACTION_LABEL,
  SEGMENT_SHORT,
} from '~/presentation/advisory/text'

/**
 * The call brief — one page, before the call: why call now in Sentinel's
 * words, the last contact, the concerns, the open promises, the market
 * where it reaches the client, three questions, what to watch out for, and
 * the objective. After the call, what happened goes in through the same
 * Client Memory flow Client 360 uses: the note is kept as written, JARVIS
 * proposes the structure, the advisor confirms — and the page re-reads the
 * record and says what changed for the relationship's priority. That is
 * the closed loop: a state transition in the record, never a checkbox.
 */
export function CallBriefView({
  brief,
  actions,
  onChanged,
}: {
  brief: CallBrief
  actions: ClientActions
  onChanged: () => Promise<void>
}) {
  const [updating, setUpdating] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  /* The action as it stood when the page opened — what the record held before the call was recorded. */
  const before = useRef<DailyAction | null>(brief.action)
  /* The brief as it stood when the act was made; the outcome waits for the re-read to replace it. */
  const awaiting = useRef<CallBrief | null>(null)
  const flow = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!updating) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    flow.current?.scrollIntoView?.({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
  }, [updating])

  /*
   * Once the record moved and the route re-read it, the brief prop is a new
   * object: compare its action with what stood before. Until the re-read
   * lands, the brief in hand is the old one and says nothing yet.
   */
  useEffect(() => {
    if (outcome?.pending !== true || brief === awaiting.current) return
    awaiting.current = null
    setOutcome(outcomeOf(before.current, brief.action, brief.client.displayName, outcome.created))
    before.current = brief.action
  }, [brief, outcome])

  async function confirmed(result: Extract<ConfirmClientUpdateResult, { ok: true }>) {
    awaiting.current = brief
    setOutcome({ pending: true, created: result.created })
    await onChanged()
  }

  async function completeCommitment(commitmentId: string) {
    const result = await actions.completeCommitment(commitmentId)
    if (!result.ok) return
    awaiting.current = brief
    setOutcome({ pending: true, created: { ...NOTHING_CREATED, completedCommitments: 1 } })
    await onChanged()
  }

  const { client, action } = brief
  return (
    <div className="flex flex-col gap-2" data-call-brief>
      <header className="flex flex-col gap-4 px-2 pt-3 pb-2 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-center gap-5">
          <ClientPortrait clientId={client.id} displayName={client.displayName} size="lg" />
          <div className="min-w-0">
            <p className="type-section text-institution">Förbered samtal · {formatLongDate(brief.today)}</p>
            <h1 className="type-display-name mt-1.5 text-[40px] leading-none">{client.displayName}</h1>
            <p className="mt-2.5 font-display text-[15px] leading-snug text-content-muted">
              {SEGMENT_SHORT[client.segment]}
              {client.officeName ? ` · ${client.officeName}` : ''} · Relationen{' '}
              {HEALTH_BAND_LABEL[brief.health].toLowerCase()}
              {action ? ` · ${actionContextLine(action, brief.today)}` : ''}
            </p>
            {action && (
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="Prioritet">
                <li className="dossier-pill dossier-pill-gold">{BAND_LABEL[action.band]}</li>
                <li className="dossier-pill">{HORIZON_LABEL[action.horizon]}</li>
                <li className="dossier-pill">{ACTION_TYPE_LABEL[action.actionType]}</li>
                <li className="dossier-pill">{timeText(action.time)}</li>
              </ul>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:justify-end lg:pb-2">
          <button
            type="button"
            onClick={() => setUpdating((v) => !v)}
            aria-pressed={updating}
            className="jarvis-gold-btn dossier-cta"
          >
            Lägg till klientuppdatering
          </button>
          {brief.nextMeeting && (
            <Link
              to="/clients/$clientId/meeting-prep"
              params={{ clientId: client.id }}
              className="jarvis-ghost-btn dossier-cta"
            >
              Förbered möte
            </Link>
          )}
          <Link
            to="/clients/$clientId"
            params={{ clientId: client.id }}
            className="jarvis-ghost-btn dossier-cta"
          >
            Öppna klient
          </Link>
        </div>
      </header>

      {outcome && !outcome.pending && <OutcomeBand outcome={outcome} />}

      {updating && (
        <div ref={flow}>
          <ClientUpdateFlow
            today={brief.today}
            actions={actions}
            onConfirmed={confirmed}
            onClose={() => setUpdating(false)}
          />
        </div>
      )}

      <div className="grid gap-2 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
        <div className="flex min-w-0 flex-col gap-2">
          <Panel title="Varför ringa nu" governance bodyClassName="p-3">
            {action ? (
              <>
                <p className="font-display text-[20px] leading-snug text-content">{actionHeadline(action)}</p>
                <ul className="mt-2 space-y-1 text-[13px] leading-snug text-content">
                  {actionReasons(action).map((reason, index) => (
                    <li key={index} className={cn(index > 0 && 'text-content-muted')}>
                      {reason}
                    </li>
                  ))}
                </ul>
                <p className="type-machine mt-2 text-content-subtle">
                  källor {action.sourceIds.join(', ') || 'härledda'} · {action.method}
                </p>
              </>
            ) : (
              <p className="type-inst-sub">
                Sentinel kallar inte på ett samtal just nu – det som står här är klientens egen bild ur registret.
              </p>
            )}
          </Panel>

          <Panel title="Senaste kontakt" bodyClassName="p-3">
            {brief.lastInteraction ? (
              <>
                <p className="text-[13px] text-content">
                  {formatLongDate(brief.lastInteraction.date)} · {INTERACTION_LABEL[brief.lastInteraction.type]} ·{' '}
                  {brief.lastInteraction.title}
                </p>
                {brief.lastInteraction.keyPoints.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 border-l border-line pl-2.5 text-[12.5px] text-content-muted">
                    {brief.lastInteraction.keyPoints.slice(0, 4).map((point, index) => (
                      <li key={index}>{point}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="type-inst-sub">Ingen kontakt är dokumenterad.</p>
            )}
          </Panel>

          <Panel title="Oro och kontext" meta={String(brief.concerns.length)} bodyClassName="p-3">
            {brief.concerns.length === 0 ? (
              <p className="type-inst-sub">Ingen aktiv oro är registrerad.</p>
            ) : (
              <ul className="space-y-1.5">
                {brief.concerns.map((fact) => (
                  <li key={fact.id} className="text-[13px] leading-snug">
                    <span className="text-content">{fact.statement}</span>
                    <span className="block text-[11.5px] text-content-muted">
                      {CONTEXT_LABEL[fact.category]} · {formatLongDate(fact.provenance.sourceDate)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Öppna åtaganden" meta={String(brief.openCommitments.length)} bodyClassName="p-0">
            {brief.openCommitments.length === 0 ? (
              <p className="type-inst-sub px-3 py-3">Inga öppna åtaganden – allt som lovats är levererat.</p>
            ) : (
              <ul>
                {brief.openCommitments.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line px-3 py-2 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="text-[13px] text-content">{c.title}</p>
                      <p className={cn('type-machine', c.overdue ? 'text-negative' : 'text-content-subtle')}>
                        {c.overdue && c.daysToDue !== null
                          ? `försenat ${Math.abs(c.daysToDue)} dagar · förföll ${formatDayMonth(c.dueDate!)}`
                          : c.dueDate
                            ? `senast ${formatDayMonth(c.dueDate)}${c.daysToDue !== null ? ` · ${formatDaysFromToday(c.daysToDue)}` : ''}`
                            : 'inget datum'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void completeCommitment(c.id)}
                      aria-label={`Markera "${c.title}" som klart`}
                      className="type-machine rounded-chip border border-line px-2 py-1 text-content-subtle hover:text-content"
                    >
                      Markera klart
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Marknadsrelevans" meta={String(brief.market.length)} bodyClassName="p-3">
            {brief.market.length === 0 ? (
              <p className="type-inst-sub">Inga klientrelevanta marknadsrörelser i fönstret.</p>
            ) : (
              <ul className="space-y-2">
                {brief.market.slice(0, 3).map((m, index) => (
                  <li key={index} className="text-[13px] leading-snug">
                    <span className="text-content">{marketHeadline(m)}</span>
                    <span className="block text-[12px] text-content-muted">{marketDiscussionText(m)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <Panel title="Tre frågor" governance bodyClassName="p-3">
            {brief.questions.length === 0 ? (
              <p className="type-inst-sub">Inga frågor att föreslå utifrån registret.</p>
            ) : (
              <ol className="space-y-2">
                {brief.questions.map((q, index) => (
                  <li key={index} className="text-[13px] leading-snug">
                    <span className="tabular type-machine mr-1.5 text-institution">{index + 1}</span>
                    <span className="text-content">{advisorQuestionText(q)}</span>
                    <span className="block pl-5 text-[12px] text-content-muted">
                      {advisorQuestionWhy(q, brief.titles)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <Panel title="Mål med samtalet" bodyClassName="p-3">
            <p className="text-[13.5px] leading-snug text-content">{OBJECTIVE_TEXT[brief.objective]}</p>
            <p className="type-machine mt-1.5">beräknad tid {timeText(brief.time)}</p>
          </Panel>

          <Panel title="Se upp med" meta={String(brief.watchOut.length)} bodyClassName="p-3">
            {brief.watchOut.length === 0 ? (
              <p className="type-inst-sub">Inget att flagga just nu.</p>
            ) : (
              <ul className="space-y-1 text-[12.5px] leading-snug text-content">
                {brief.watchOut.slice(0, 4).map((risk, index) => (
                  <li key={index}>{riskText(risk)}</li>
                ))}
              </ul>
            )}
          </Panel>

          {brief.clientMayAsk.length > 0 && (
            <Panel title="Klienten kan fråga" bodyClassName="p-3">
              <ul className="space-y-1 text-[12.5px] leading-snug text-content-muted">
                {brief.clientMayAsk.map((q, index) => (
                  <li key={index}>{clientQuestionText(q)}</li>
                ))}
              </ul>
            </Panel>
          )}

          {brief.nextMeeting && (
            <Panel title="Nästa möte" bodyClassName="p-3">
              <p className="text-[13px] text-content">
                {formatLongDate(brief.nextMeeting.date)} · {brief.nextMeeting.title}
              </p>
            </Panel>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- outcome */

type Created = Extract<ConfirmClientUpdateResult, { ok: true }>['created']

const NOTHING_CREATED: Created = {
  contextFacts: 0,
  commitments: 0,
  events: 0,
  completedCommitments: 0,
  easedConcerns: 0,
}

interface Outcome {
  pending: boolean
  created: Created
  kind?: 'handled' | 'changed' | 'unchanged' | 'none'
  text?: string
}

/** What the record's re-read says about the priority, compared with what stood before. */
function outcomeOf(
  before: DailyAction | null,
  after: DailyAction | null,
  name: string,
  created: Created,
): Outcome {
  const base = { pending: false, created }
  if (!before && !after)
    return { ...base, kind: 'none', text: `Uppdateringen är sparad. Sentinel kallar fortfarande inte på något för ${name}.` }
  if (before && !after)
    return { ...base, kind: 'handled', text: `Relationen hanterad: ${name} har lämnat dagens kö.` }
  if (before && after && before.horizon === 'now' && after.horizon !== 'now')
    return {
      ...base,
      kind: 'handled',
      text: `Relationen hanterad: ${name} står inte längre under NU – nu ${HORIZON_LABEL[after.horizon].toLowerCase()}, ${ACTION_TYPE_LABEL[after.actionType].toLowerCase()}.`,
    }
  if (before && after && (before.actionType !== after.actionType || before.band !== after.band))
    return {
      ...base,
      kind: 'changed',
      text: `Prioriteringen har ändrats: ${actionHeadline(after)} · ${BAND_LABEL[after.band]} · ${HORIZON_LABEL[after.horizon]}.`,
    }
  if (after)
    return {
      ...base,
      kind: 'unchanged',
      text: `Prioriteringen kvarstår: ${actionHeadline(after)} · ${BAND_LABEL[after.band]} · ${HORIZON_LABEL[after.horizon]}.`,
    }
  return { ...base, kind: 'changed', text: `${name} har nu en prioritet i dagens kö.` }
}

function OutcomeBand({ outcome }: { outcome: Outcome }) {
  return (
    <section
      role="status"
      data-outcome={outcome.kind}
      className={cn(
        'ref-panel flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3',
        outcome.kind === 'handled' && 'inst-edge',
      )}
    >
      <div className="min-w-0">
        <p className="type-section text-institution">
          {outcome.kind === 'handled' ? 'Relationen hanterad' : 'Registret uppdaterat'}
        </p>
        <p className="mt-0.5 text-[13.5px] leading-snug text-content">{outcome.text}</p>
        <p className="type-machine mt-1 text-content-subtle">
          läst om ur registret · {outcome.created.contextFacts} kontextfakta · {outcome.created.commitments} nya
          åtaganden · {outcome.created.events} händelser · {outcome.created.completedCommitments} löften levererade ·{' '}
          {outcome.created.easedConcerns} oro avtagit
        </p>
      </div>
      <Link
        to="/today"
        className="type-section inline-flex items-center gap-1 text-institution hover:text-content"
      >
        Tillbaka till Idag – omrankad
        <ArrowRight className="h-3 w-3" aria-hidden="true" />
      </Link>
    </section>
  )
}

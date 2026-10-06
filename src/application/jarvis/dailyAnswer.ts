/**
 * JARVIS answers about the day: who needs the advisor, the best use of a
 * window of time, who can wait, the week's meetings, the overdue promises,
 * the financing ahead, what changed since a day — and the brief for one
 * call. Everything comes from Daily Command and the call brief, which
 * themselves only translate what Sentinel, Market-to-Client, the cockpit
 * and the record already hold; nothing here derives a fact, and every
 * item carries the record ids it rests on.
 */

import { bestUseOfTime, type DailyAction, type SentinelDriver } from '~/domain/advisory'
import { client360 } from '~/application/advisory/client360'
import {
  callBrief,
  dailyCommand,
  type CallBrief,
  type DailyChanges,
} from '~/application/advisory/dailyCommand'
import type { AdvisoryContext } from '~/application/advisory/ports'
import { sourceIndex, titlesOf } from '~/application/advisory/sources'
import type { AdvisoryIntent, DailySince } from './advisoryIntent'
import type {
  DailyChangeKind,
  JarvisAbout,
  JarvisAction,
  JarvisAnswer,
  JarvisItem,
  JarvisSection,
  JarvisSource,
} from './answer'
import type { JarvisContext } from './context'
import { item, note, section } from './items'

const MAX_ITEMS = 6
const TITLE_PRIORITY = 'Sentinel-prioritet'

/* ------------------------------------------------------------------ since */

/** The ISO date a "what changed" window starts: yesterday, last Friday, last Monday, this week's Monday. */
export function sinceDateOf(since: DailySince | undefined, today: string): string {
  const date = new Date(`${today}T00:00:00.000Z`)
  switch (since) {
    case 'friday':
    case 'monday': {
      const target = since === 'friday' ? 5 : 1
      let back = (date.getUTCDay() - target + 7) % 7
      if (back === 0) back = 7
      date.setUTCDate(date.getUTCDate() - back)
      return date.toISOString().slice(0, 10)
    }
    case 'week':
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
      return date.toISOString().slice(0, 10)
    case 'yesterday':
    default:
      date.setUTCDate(date.getUTCDate() - 1)
      return date.toISOString().slice(0, 10)
  }
}

/* -------------------------------------------------------------- the day */

export async function dailyAnswer(
  context: AdvisoryContext,
  jarvis: JarvisContext,
  intent: AdvisoryIntent,
): Promise<JarvisAnswer> {
  const today = context.clock.isoNow().slice(0, 10)
  const officeId =
    intent.office?.id ?? (jarvis.scope === 'OFFICE' ? jarvis.officeId : undefined)
  const since = intent.kind === 'DAILY_CHANGES' ? sinceDateOf(intent.since, today) : undefined
  const view = await dailyCommand(context, {
    ...(officeId ? { officeId } : {}),
    ...(since ? { since } : {}),
  })
  const about: JarvisAbout = view.office
    ? {
        kind: 'office',
        id: view.office.id,
        label: view.office.displayName,
        href: `/clients/office/${view.office.id}`,
        switched: intent.office !== undefined && intent.office.id !== jarvis.officeId,
      }
    : { kind: 'daily', id: null, label: 'Idag', href: '/today', switched: false }
  const doors: JarvisAction[] = [
    { kind: 'open-today', href: '/today' },
    ...(view.office
      ? [{ kind: 'open-office' as const, href: `/clients/office/${view.office.id}` }]
      : []),
  ]
  const titles: Record<string, string> = {}
  const sources = new Map<string, JarvisSource>()
  const ranked = [...view.now, ...view.week, ...view.watch]
  for (const action of ranked) addAction(action, titles, sources)

  const finish = (
    sections: JarvisSection[],
    over: Partial<JarvisAnswer> = {},
  ): JarvisAnswer => {
    const kept = sections.filter((s) => s.items.length > 0)
    return {
      scope: jarvis.scope,
      intent: intent.kind,
      about,
      sections: kept,
      sources: collect(kept, sources),
      actions: doors,
      titles,
      today: view.today,
      confidence: 'high',
      method: 'advisory-rules-v1',
      askedAt: view.generatedAt,
      ...over,
    }
  }
  const actionItem = (action: DailyAction, fit?: { remainingMinutes: number }): JarvisItem =>
    item('daily-action', { action, ...(fit ? { fit } : {}) }, 'assessment', actionSourceIds(action))
  const actionItems = (actions: readonly DailyAction[]): JarvisItem[] =>
    actions.slice(0, MAX_ITEMS).map((a) => actionItem(a))

  switch (intent.kind) {
    case 'DAILY_PRIORITIES':
      return finish([
        section('now', view.now.length === 0 ? [note('nobody-needs-attention')] : actionItems(view.now)),
        section('this-week', actionItems(view.week)),
        section('can-wait', actionItems(view.watch)),
        section('onboarding', actionItems(view.onboarding)),
      ])

    case 'DAILY_TIME_WINDOW': {
      const minutes = intent.minutes ?? 30
      const fit = bestUseOfTime([...view.now, ...view.week], minutes)
      const best: JarvisItem[] = []
      if (fit.best)
        best.push(actionItem(fit.best.action, { remainingMinutes: fit.best.remainingMinutes }))
      if (fit.second)
        best.push(actionItem(fit.second.action, { remainingMinutes: fit.second.remainingMinutes }))
      return finish(
        [
          section('best-use', best.length === 0 ? [note('nothing-fits')] : best.map(asSuggestion)),
          section('deferred', actionItems(fit.skipped)),
        ],
        { window: { minutes } },
      )
    }

    case 'DAILY_CAN_WAIT': {
      const waiting = [...view.week, ...view.watch]
      return finish([
        section('this-week', actionItems(view.week)),
        section('can-wait', waiting.length === 0 ? [note('nobody-can-wait')] : actionItems(view.watch)),
      ])
    }

    case 'DAILY_MEETINGS': {
      for (const m of view.meetings) {
        titles[m.eventId] = m.title
        titles[m.clientId] = m.clientName
        sources.set(m.eventId, { id: m.eventId, type: 'event', label: m.title, date: m.date })
      }
      return finish([
        section(
          'meetings',
          view.meetings.length === 0
            ? [note('no-meetings-soon')]
            : view.meetings
                .slice(0, MAX_ITEMS)
                .map((meeting) =>
                  item('daily-meeting', { meeting }, 'fact', [meeting.eventId, meeting.clientId]),
                ),
        ),
      ])
    }

    case 'DAILY_OVERDUE': {
      for (const o of view.overdue) {
        titles[o.commitmentId] = o.title
        titles[o.clientId] = o.clientName
        sources.set(o.commitmentId, {
          id: o.commitmentId,
          type: 'commitment',
          label: o.title,
          date: o.dueDate,
        })
      }
      return finish([
        section(
          'overdue',
          view.overdue.length === 0
            ? [note('no-overdue')]
            : view.overdue
                .slice(0, MAX_ITEMS)
                .map((overdue) =>
                  item('daily-overdue', { overdue }, 'fact', [overdue.commitmentId, overdue.clientId]),
                ),
        ),
      ])
    }

    case 'DAILY_FINANCING': {
      for (const f of view.financing) {
        titles[f.eventId] = f.title
        titles[f.clientId] = f.clientName
        sources.set(f.eventId, { id: f.eventId, type: 'event', label: f.title, date: f.date })
        if (f.liabilityId) titles[f.liabilityId] = f.title
      }
      return finish([
        section(
          'financing',
          view.financing.length === 0
            ? [note('no-financing-soon')]
            : view.financing
                .slice(0, MAX_ITEMS)
                .map((financing) =>
                  item('daily-financing', { financing }, 'fact', [
                    financing.eventId,
                    ...(financing.liabilityId ? [financing.liabilityId] : []),
                    financing.clientId,
                  ]),
                ),
        ),
      ])
    }

    case 'DAILY_CHANGES': {
      const items = changeItems(view.changes, titles, sources)
      return finish(
        [
          section('changes', items.length === 0 ? [note('no-changes-since')] : items),
          section(
            'book-changes',
            view.changes.lifecycle
              .slice(0, MAX_ITEMS)
              .map((entry) => item('lifecycle-entry', { entry }, 'fact', [entry.event.id])),
          ),
        ],
        { since: view.changes.since },
      )
    }

    default:
      return finish([section('now', actionItems(view.now))])
  }
}

function asSuggestion(entry: JarvisItem): JarvisItem {
  return { ...entry, nature: 'suggestion' }
}

/* --------------------------------------------------------------- changes */

function changeItems(
  changes: DailyChanges,
  titles: Record<string, string>,
  sources: Map<string, JarvisSource>,
): JarvisItem[] {
  const out: JarvisItem[] = []
  const push = (
    change: DailyChangeKind,
    rows: readonly { clientId: string; clientName: string; sourceId: string; label: string; date: string }[],
    type: JarvisSource['type'],
  ) => {
    for (const row of rows) {
      titles[row.sourceId] = row.label
      titles[row.clientId] = row.clientName
      sources.set(row.sourceId, { id: row.sourceId, type, label: row.label, date: row.date })
      out.push(
        item(
          'changed-client',
          {
            change,
            clientId: row.clientId,
            clientName: row.clientName,
            label: row.label,
            date: row.date,
          },
          'fact',
          [row.sourceId, row.clientId],
        ),
      )
    }
  }
  push('newly-overdue', changes.newlyOverdue, 'commitment')
  push('completed-commitment', changes.completedCommitments, 'commitment')
  push('meeting-booked', changes.meetingsBooked, 'event')
  push('contact-recorded', changes.contactsRecorded, 'interaction')
  push('concern-raised', changes.concernsRaised, 'context')
  push('concern-eased', changes.concernsEased, 'context')
  for (const m of changes.marketOpened) {
    titles[m.eventId] = m.label
    sources.set(m.eventId, {
      id: m.eventId,
      type: 'market-event',
      label: m.label,
      date: m.firstSeenAt.slice(0, 10),
    })
    out.push(
      item(
        'changed-client',
        {
          change: 'market-opened',
          clientId: '',
          clientName: '',
          label: `${m.label} · ${m.meaningful === 1 ? '1 klient berörs' : `${m.meaningful} klienter berörs`}`,
          date: m.firstSeenAt.slice(0, 10),
        },
        'fact',
        [m.eventId],
      ),
    )
  }
  return out.slice(0, MAX_ITEMS * 2)
}

/* -------------------------------------------------------------- the call */

/**
 * The brief for one call: why now, in Sentinel's words; the last contact;
 * the concerns; the open promises; the market where it reaches the client;
 * three questions; what to watch out for; the objective and the time.
 */
export async function prepareCallAnswer(
  context: AdvisoryContext,
  jarvis: JarvisContext,
  intent: AdvisoryIntent,
  clientId: string,
): Promise<JarvisAnswer | null> {
  const [brief, view] = await Promise.all([callBrief(context, clientId), client360(context, clientId)])
  if (!brief || !view) return null
  const switched = intent.namedClient !== undefined && intent.namedClient.id !== jarvis.clientId
  const index = sourceIndex(view)
  const titles: Record<string, string> = { ...titlesOf(view), ...brief.titles }
  if (brief.action?.priorityId) titles[brief.action.priorityId] = TITLE_PRIORITY
  const sections: JarvisSection[] = [
    section('why-now', whyNowItems(brief)),
    section(
      'discussed',
      brief.lastInteraction
        ? [item('interaction', { interaction: brief.lastInteraction }, 'fact', [brief.lastInteraction.id])]
        : [note('no-recorded-contact')],
    ),
    section(
      'concerns',
      brief.concerns.slice(0, 3).map((fact) => item('context-fact', { fact }, 'fact', [fact.id])),
    ),
    section(
      'promises',
      brief.openCommitments
        .slice(0, MAX_ITEMS)
        .map((c) =>
          item(
            'commitment',
            { commitment: c, overdue: c.overdue, daysToDue: c.daysToDue },
            'fact',
            [c.id],
          ),
        ),
    ),
    section(
      'market',
      brief.market.slice(0, 2).map((m) => item('market', { item: m }, 'assessment', m.sourceIds)),
    ),
    section(
      'questions-to-ask',
      brief.questions.map((question) =>
        item('advisor-question', { question }, 'suggestion', question.sourceIds),
      ),
    ),
    section(
      'dont-forget',
      brief.watchOut.slice(0, 3).map((risk) => item('risk', { risk }, 'assessment', risk.sourceIds)),
    ),
    section('next-step', [
      item(
        'daily-objective',
        { objective: brief.objective, time: brief.time },
        'suggestion',
        brief.action?.sourceIds ?? [],
      ),
    ]),
  ].filter((s) => s.items.length > 0)
  const sources = collect(sections, index, brief.action)
  return {
    scope: jarvis.scope,
    intent: 'PREPARE_CALL',
    about: {
      kind: 'client',
      id: brief.client.id,
      label: brief.client.displayName,
      href: `/clients/${brief.client.id}`,
      switched,
    },
    sections,
    sources,
    actions: [
      { kind: 'prepare-call', href: `/today/call/${brief.client.id}` },
      ...(switched ? [{ kind: 'open-client' as const, href: `/clients/${brief.client.id}` }] : []),
    ],
    titles,
    today: brief.today,
    confidence: brief.action ? 'high' : 'medium',
    method: 'advisory-rules-v1',
    askedAt: brief.generatedAt,
  }
}

function whyNowItems(brief: CallBrief): JarvisItem[] {
  const action = brief.action
  if (!action) return [note('no-call-reason')]
  return [
    item('daily-action', { action }, 'assessment', actionSourceIds(action)),
    ...action.reasons
      .slice(0, 4)
      .map((driver) => item('sentinel-driver', { driver }, 'fact', driverSourceIds(driver, action))),
  ]
}

/* ---------------------------------------------------------------- sources */

/** The priority the action translates, then every record the priority rests on. */
function actionSourceIds(action: DailyAction): string[] {
  return action.priorityId ? [action.priorityId, ...action.sourceIds] : [...action.sourceIds]
}

/**
 * The record ids a driver names, the way the cockpit's answers list them; a
 * driver that names no record of its own — a health band, a liquidity share,
 * an undiscussed topic — rests on the priority that carries it.
 */
function driverSourceIds(driver: SentinelDriver, action: DailyAction): string[] {
  const ids: string[] = []
  const record = driver as unknown as Record<string, unknown>
  for (const key of [
    'commitmentId',
    'eventId',
    'liabilityId',
    'contextFactId',
    'opportunityId',
    'lastInteractionId',
    'impactId',
  ]) {
    const value = record[key]
    if (typeof value === 'string') ids.push(value)
  }
  if (ids.length === 0 && action.priorityId) ids.push(action.priorityId)
  return ids
}

/** A driver as a source with the record's own title and date, where it names one record. */
function driverSource(driver: SentinelDriver): JarvisSource | null {
  switch (driver.kind) {
    case 'overdue-commitment':
    case 'commitment-due':
    case 'open-commitment':
      return {
        id: driver.commitmentId,
        type: 'commitment',
        label: driver.title,
        date: driver.dueDate,
      }
    case 'meeting':
    case 'event':
      return { id: driver.eventId, type: 'event', label: driver.title, date: driver.date }
    case 'concern':
      return {
        id: driver.contextFactId,
        type: 'context',
        label: driver.statement,
        date: driver.sourceDate,
      }
    case 'silence':
      return driver.lastInteractionId
        ? {
            id: driver.lastInteractionId,
            type: 'interaction',
            label: 'Senaste kontakt',
            date: driver.lastDate,
          }
        : null
    case 'market':
      return {
        id: driver.eventId,
        type: 'market-event',
        label: driver.label,
        date: null,
      }
    case 'opportunity':
      return {
        id: driver.opportunityId,
        type: 'opportunity',
        label: driver.title,
        date: driver.expectedDate,
      }
    case 'stale-valuation':
    case 'allocation-drift':
    case 'excess-cash':
    case 'health':
    case 'birthday':
    case 'large-withdrawal':
    case 'complaint':
    case 'undiscussed':
      return null
  }
}

/** The action's priority and every reason's record become sources and titles. */
function addAction(
  action: DailyAction,
  titles: Record<string, string>,
  sources: Map<string, JarvisSource>,
) {
  titles[action.clientId] = action.clientName
  if (action.priorityId) {
    titles[action.priorityId] = TITLE_PRIORITY
    sources.set(action.priorityId, {
      id: action.priorityId,
      type: 'sentinel-priority',
      label: `${action.clientName} · ${action.theme ?? action.actionType}`,
      date: action.dueAt,
    })
  }
  for (const reason of action.reasons) {
    const source = driverSource(reason)
    if (!source) continue
    titles[source.id] = source.label
    sources.set(source.id, source)
  }
}

/** Every source an item names, once, in reading order; an id nobody indexed is left out rather than invented. */
function collect(
  sections: readonly JarvisSection[],
  index: ReadonlyMap<string, JarvisSource>,
  action?: DailyAction | null,
): JarvisSource[] {
  const extra = new Map<string, JarvisSource>()
  if (action) addAction(action, {}, extra)
  const seen = new Set<string>()
  const out: JarvisSource[] = []
  for (const s of sections)
    for (const it of s.items)
      for (const id of it.sourceIds) {
        if (seen.has(id)) continue
        seen.add(id)
        const source = index.get(id) ?? extra.get(id)
        if (source) out.push(source)
      }
  return out
}

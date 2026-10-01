/**
 * JARVIS answers about the relationship record: the intent, the context and
 * the evidence services already built — Client 360, the Meeting Cockpit,
 * the relationship memory, Sentinel, the office book, the directory and
 * Market-to-Client — composed into one typed answer. Nothing here derives a
 * fact of its own: every item is a record, or a typed item one of those
 * read models already produced, with the ids it rests on.
 *
 * The line's subject is the screen's unless the line named another client;
 * then the answer says so and the screen does not move.
 */

import { daysBetween, type Interaction, type InteractionType } from '~/domain/advisory'
import { askAboutClient } from '~/application/advisory/askAboutClient'
import { client360, type Client360 } from '~/application/advisory/client360'
import {
  clientDirectory,
  type ClientDirectoryRow,
} from '~/application/advisory/clientDirectory'
import { marketImpactBrief } from '~/application/advisory/marketImpact'
import {
  meetingCockpit,
  type MeetingCockpit,
} from '~/application/advisory/meetingCockpit'
import { meetingPack } from '~/application/advisory/meetingPack'
import { officeBook } from '~/application/advisory/officeBook'
import type { AdvisoryContext } from '~/application/advisory/ports'
import { sentinelBrief, type SentinelEntry } from '~/application/advisory/sentinel'
import { fallbackSource, sourceIndex, titlesOf } from '~/application/advisory/sources'
import {
  recognizeAdvisoryIntent,
  type AdvisoryIntent,
  type NamedClient,
} from './advisoryIntent'
import type {
  AdvisoryIntentKind,
  JarvisAbout,
  JarvisAction,
  JarvisAnswer,
  JarvisItem,
  JarvisSection,
  JarvisSource,
  NoteKind,
  RowReason,
  SectionKey,
} from './answer'
import { isAdvisoryScope, type JarvisContext } from './context'

const MAX_ITEMS = 6
const MEETING_SOON_DAYS = 7
const CONVERSATION_TYPES: readonly InteractionType[] = [
  'meeting',
  'phone',
  'email',
  'teams',
  'portfolio-discussion',
  'financing-discussion',
  'follow-up',
  'complaint',
  'investment-proposal',
]

/* ---------------------------------------------------------------- the door */

export interface AdvisoryTurn {
  answer: JarvisAnswer
  intent: AdvisoryIntent
  context: JarvisContext
}

/**
 * Answer a line from the record, or return null when the line is not the
 * record's to answer here — then the one router takes it.
 */
export async function answerAdvisoryLine(
  context: AdvisoryContext,
  jarvis: JarvisContext,
  text: string,
): Promise<AdvisoryTurn | null> {
  const clients: NamedClient[] = (await context.repositories.clients.list()).map((c) => ({
    id: c.id,
    displayName: c.displayName,
  }))
  const intent = recognizeAdvisoryIntent(text, jarvis, clients)
  if (!intent) return null
  if (!intent.namedClient && !isAdvisoryScope(jarvis.scope)) return null
  const answer = await answerIntent(context, jarvis, intent, text)
  if (!answer) return null
  return { answer, intent, context: withMeeting(jarvis, answer) }
}

/** The meeting id, once the client's record resolved it. */
function withMeeting(jarvis: JarvisContext, answer: JarvisAnswer): JarvisContext {
  if (jarvis.scope !== 'MEETING' || !answer.about.meetingId) return jarvis
  return { ...jarvis, meetingId: answer.about.meetingId }
}

async function answerIntent(
  context: AdvisoryContext,
  jarvis: JarvisContext,
  intent: AdvisoryIntent,
  text: string,
): Promise<JarvisAnswer | null> {
  const clientId = intent.namedClient?.id ?? jarvis.clientId
  switch (intent.kind) {
    case 'OFFICE_PRIORITIES':
    case 'OFFICE_MEETINGS':
    case 'OFFICE_OVERDUE':
    case 'OFFICE_OPPORTUNITIES':
      return jarvis.officeId
        ? officeAnswer(context, jarvis, intent.kind, jarvis.officeId)
        : null
    case 'DIRECTORY_CALL_TODAY':
    case 'DIRECTORY_MEETINGS':
    case 'DIRECTORY_OVERDUE':
    case 'DIRECTORY_EXTERNAL_ASSETS':
      return directoryAnswer(context, jarvis, intent.kind)
    case 'SENTINEL_TODAY':
      return sentinelAnswer(context, jarvis)
    case 'MARKET_IMPACT_CLIENTS':
      return marketImpactAnswer(context, jarvis)
    default:
      return clientId ? clientAnswer(context, jarvis, intent, clientId, text) : null
  }
}

/* --------------------------------------------------------------- clients */

async function clientAnswer(
  context: AdvisoryContext,
  jarvis: JarvisContext,
  intent: AdvisoryIntent,
  clientId: string,
  text: string,
): Promise<JarvisAnswer | null> {
  const view = await client360(context, clientId)
  if (!view) return null
  const switched =
    intent.namedClient !== undefined && intent.namedClient.id !== jarvis.clientId
  const index = sourceIndex(view)
  const titles = titlesOf(view)
  const askedAt = context.clock.isoNow()
  const base = {
    scope: jarvis.scope,
    intent: intent.kind,
    today: view.today,
    method: 'advisory-rules-v1' as const,
    askedAt,
  }
  const about = (meetingDate?: string): JarvisAbout => ({
    kind: jarvis.scope === 'MEETING' && !switched ? 'meeting' : 'client',
    id: view.client.id,
    label: view.client.displayName,
    href: `/clients/${view.client.id}`,
    switched,
    ...(meetingDate && view.nextMeeting
      ? { meetingDate, meetingId: view.nextMeeting.id }
      : {}),
  })
  const actions = (...extra: JarvisAction[]): JarvisAction[] => [
    ...(switched
      ? [{ kind: 'open-client' as const, href: `/clients/${view.client.id}` }]
      : []),
    ...extra,
  ]
  const finish = (
    sections: JarvisSection[],
    over: Partial<JarvisAnswer> = {},
  ): JarvisAnswer => {
    const kept = sections.filter((s) => s.items.length > 0)
    return {
      ...base,
      about: about(over.about?.meetingDate),
      sections: kept,
      sources: collectSources(kept, index),
      actions: actions(...(over.actions ?? [])),
      titles: { ...titles, ...(over.titles ?? {}) },
      confidence: over.confidence ?? 'high',
      ...(over.opens ? { opens: over.opens } : {}),
    }
  }
  const prep = (kind: 'open-meeting-prep'): JarvisAction => ({
    kind,
    href: `/clients/${view.client.id}/meeting-prep`,
  })

  /* The cockpit, only for the intents that read it. */
  const needsCockpit: readonly AdvisoryIntentKind[] = [
    'MEETING_PREP',
    'CHANGES_SINCE_LAST_MEETING',
    'WHY_PRIORITY',
    'MARKET_RELEVANCE',
    'FINANCING',
    'OPPORTUNITIES',
    'RISKS',
    'QUESTIONS_TO_ASK',
    'CLIENT_QUESTIONS',
    'KEY_FIGURES',
    'CLIENT_SUMMARY',
  ]
  const cockpit = needsCockpit.includes(intent.kind)
    ? await meetingCockpit(context, clientId)
    : null
  const cockpitTitles = cockpit ? cockpit.titles : {}
  const meetingDate = view.nextMeeting?.occursOn

  switch (intent.kind) {
    case 'MEETING_PREP': {
      if (!cockpit) return null
      return finish(
        [
          section('focus', [
            item(
              'focus',
              { focus: cockpit.focus },
              'assessment',
              cockpit.focus.primary.sourceIds,
            ),
          ]),
          section(
            'bring-up',
            [cockpit.focus.primary, ...cockpit.focus.supporting].map((topic) =>
              item('focus-topic', { topic }, 'fact', topic.sourceIds),
            ),
          ),
          section('since-last', sinceLast(cockpit)),
          section('promises', promises(cockpit, 'open')),
          section(
            'questions-to-ask',
            cockpit.advisorQuestions
              .slice(0, 3)
              .map((question) =>
                item('advisor-question', { question }, 'suggestion', question.sourceIds),
              ),
          ),
          section(
            'client-may-ask',
            cockpit.clientQuestions
              .slice(0, 3)
              .map((question) =>
                item('client-question', { question }, 'assessment', question.sourceIds),
              ),
          ),
          section(
            'dont-forget',
            cockpit.risks
              .slice(0, 3)
              .map((risk) => item('risk', { risk }, 'assessment', risk.sourceIds)),
          ),
          section(
            'data-quality',
            cockpit.dataQuality
              .slice(0, 3)
              .map((dq) => item('data-quality', { item: dq }, 'fact', dq.sourceIds)),
          ),
          section(
            'objectives',
            cockpit.objectives
              .slice(0, 4)
              .map((objective) =>
                item('objective', { objective }, 'suggestion', objective.sourceIds),
              ),
          ),
        ],
        {
          about: about(meetingDate),
          actions: [prep('open-meeting-prep')],
          titles: cockpitTitles,
        },
      )
    }
    case 'LAST_INTERACTION': {
      const latest = view.interactions.find(
        (i) => CONVERSATION_TYPES.includes(i.type) && i.source !== 'system',
      )
      if (!latest) return finish([section('discussed', [note('no-recorded-contact')])])
      const fromIt = (sourceId: string | null | undefined) => sourceId === latest.id
      const expressed = view.contextFacts.filter(
        (f) =>
          fromIt(f.provenance.sourceInteractionId) &&
          ['concern', 'preference', 'objective', 'behaviour'].includes(f.category),
      )
      const promised = view.commitments.filter((c) =>
        fromIt(c.provenance.sourceInteractionId),
      )
      const decided = view.interactions
        .filter((i) => i.id === latest.id)
        .flatMap((i) =>
          i.keyPoints.map((point) =>
            item('record-text', { text: point, date: i.date }, 'fact', [i.id]),
          ),
        )
      const nextSteps = [
        ...view.upcomingEvents
          .filter((e) => fromIt(e.provenance.sourceInteractionId))
          .slice(0, 2)
          .map((e) =>
            item(
              'event',
              { event: e, occursOn: e.occursOn, daysAhead: e.daysAhead },
              'fact',
              [e.id],
            ),
          ),
        ...(view.nextMeeting &&
        !view.upcomingEvents.some((e) => fromIt(e.provenance.sourceInteractionId))
          ? [
              item(
                'event',
                {
                  event: view.nextMeeting,
                  occursOn: view.nextMeeting.occursOn,
                  daysAhead: view.nextMeeting.daysAhead,
                },
                'fact',
                [view.nextMeeting.id],
              ),
            ]
          : []),
      ]
      return finish([
        section('discussed', [
          item('interaction', { interaction: latest }, 'fact', [latest.id]),
          ...decided,
        ]),
        section(
          'client-expressed',
          expressed.map((fact) => item('context-fact', { fact }, 'fact', [fact.id])),
        ),
        section(
          'promises',
          promised.map((commitment) =>
            item(
              'commitment',
              {
                commitment,
                overdue: isOverdue(commitment, view.today),
                daysToDue: daysToDue(commitment, view.today),
              },
              'fact',
              [commitment.id],
            ),
          ),
        ),
        section('next-step', nextSteps),
      ])
    }
    case 'OPEN_COMMITMENTS': {
      const open = [...view.openCommitments].sort(
        (a, b) => Number(b.overdue) - Number(a.overdue),
      )
      const done = view.commitments.filter((c) => c.status === 'done').slice(0, 3)
      return finish([
        section(
          'promises',
          open.length === 0
            ? [note('no-open-commitments')]
            : open.map((c) =>
                item(
                  'commitment',
                  { commitment: c, overdue: c.overdue, daysToDue: c.daysToDue },
                  'fact',
                  [c.id],
                ),
              ),
        ),
        section(
          'completed',
          done.map((c) =>
            item(
              'commitment',
              { commitment: c, overdue: false, daysToDue: null },
              'fact',
              [c.id],
            ),
          ),
        ),
      ])
    }
    case 'CHANGES_SINCE_LAST_MEETING': {
      if (!cockpit) return null
      const items = sinceLast(cockpit)
      return finish(
        [
          section('since-last', items.length === 0 ? [note('few-changes')] : items),
          section(
            'data-quality',
            cockpit.changes.gaps.includes('no-baseline') ? [note('no-baseline')] : [],
          ),
        ],
        { titles: cockpitTitles },
      )
    }
    case 'WHY_PRIORITY': {
      if (!cockpit) return null
      const entry = cockpit.sentinelEntry
      if (!entry)
        return finish([section('why-now', [note('no-priority')])], {
          titles: cockpitTitles,
        })
      return finish(
        [
          section('why-now', [
            item('sentinel-entry', { entry }, 'assessment', entry.priority.sourceIds),
          ]),
          section(
            'drivers',
            entry.priority.drivers.map((driver) =>
              item('sentinel-driver', { driver }, 'fact', driverSources(driver)),
            ),
          ),
          section('preparation', [
            item('sentinel-entry', { entry }, 'suggestion', entry.priority.sourceIds),
          ]),
        ],
        {
          actions: [{ kind: 'open-sentinel', href: '/sentinel' }],
          titles: { ...cockpitTitles, [entry.priority.id]: 'Sentinel-prioritet' },
        },
      )
    }
    case 'MARKET_RELEVANCE': {
      if (!cockpit) return null
      return finish(
        [
          section(
            'market',
            cockpit.market.length === 0
              ? [note('no-market-moves')]
              : cockpit.market
                  .slice(0, 5)
                  .map((m) => item('market', { item: m }, 'assessment', m.sourceIds)),
          ),
        ],
        { titles: cockpitTitles },
      )
    }
    case 'FINANCING': {
      if (!cockpit) return null
      const loans = view.liabilities.map((liability) =>
        item(
          'liability',
          {
            liability,
            daysToMaturity: liability.maturityDate
              ? daysBetween(view.today, liability.maturityDate)
              : null,
          },
          'fact',
          [liability.id],
        ),
      )
      return finish(
        [
          section('financing', loans.length === 0 ? [note('no-loans')] : loans),
          section(
            'upcoming',
            cockpit.financing.map((f) =>
              item('financing', { item: f }, 'assessment', f.sourceIds),
            ),
          ),
        ],
        { titles: cockpitTitles },
      )
    }
    case 'GOALS':
      return finish([
        section(
          'goals',
          view.goals.length === 0
            ? [note('no-goals')]
            : view.goals.map((goal) => item('goal', { goal }, 'fact', [goal.id])),
        ),
      ])
    case 'OPPORTUNITIES': {
      const live = view.opportunities.filter((o) => !['won', 'lost'].includes(o.status))
      const explore = cockpit?.opportunities ?? []
      return finish(
        [
          section(
            'opportunities',
            live.length === 0 && explore.length === 0
              ? [note('no-opportunities')]
              : [
                  ...live.map((opportunity) =>
                    item('opportunity-record', { opportunity }, 'fact', [opportunity.id]),
                  ),
                  ...explore
                    .slice(0, 3)
                    .map((opportunity) =>
                      item(
                        'opportunity',
                        { opportunity },
                        'assessment',
                        opportunity.sourceIds,
                      ),
                    ),
                ],
          ),
        ],
        { titles: cockpitTitles },
      )
    }
    case 'RISKS': {
      const risks = cockpit?.risks ?? []
      const alerts = view.signals.filter((s) => s.priority === 'high').slice(0, 3)
      return finish(
        [
          section(
            'risks',
            risks.length === 0 && alerts.length === 0
              ? [note('no-risks')]
              : [
                  ...risks.map((risk) =>
                    item('risk', { risk }, 'assessment', risk.sourceIds),
                  ),
                  ...alerts.map((signal) =>
                    item('signal', { signal }, 'assessment', signalSources(signal)),
                  ),
                ],
          ),
        ],
        { titles: cockpitTitles },
      )
    }
    case 'QUESTIONS_TO_ASK': {
      if (!cockpit) return null
      return finish(
        [
          section(
            'questions-to-ask',
            cockpit.advisorQuestions.length === 0
              ? [note('no-questions')]
              : cockpit.advisorQuestions
                  .slice(0, 5)
                  .map((question) =>
                    item(
                      'advisor-question',
                      { question },
                      'suggestion',
                      question.sourceIds,
                    ),
                  ),
          ),
        ],
        { titles: cockpitTitles },
      )
    }
    case 'CLIENT_QUESTIONS': {
      if (!cockpit) return null
      return finish(
        [
          section(
            'client-may-ask',
            cockpit.clientQuestions.length === 0
              ? [note('no-questions')]
              : cockpit.clientQuestions
                  .slice(0, 5)
                  .map((question) =>
                    item(
                      'client-question',
                      { question },
                      'assessment',
                      question.sourceIds,
                    ),
                  ),
          ),
        ],
        { titles: cockpitTitles },
      )
    }
    case 'KEY_FIGURES':
      return finish(
        [
          section('figures', figures(view)),
          section(
            'data-quality',
            (cockpit?.dataQuality ?? [])
              .slice(0, 3)
              .map((dq) => item('data-quality', { item: dq }, 'fact', dq.sourceIds)),
          ),
        ],
        { titles: cockpitTitles },
      )
    case 'CLIENT_SUMMARY': {
      const concerns = view.contextFacts
        .filter((f) => f.category === 'concern' && f.status === 'active')
        .slice(0, 2)
      const issue: JarvisItem[] = cockpit?.sentinelEntry
        ? [
            item(
              'sentinel-entry',
              { entry: cockpit.sentinelEntry },
              'assessment',
              cockpit.sentinelEntry.priority.sourceIds,
            ),
          ]
        : view.nextBestAction
          ? [
              item(
                'signal',
                { signal: view.nextBestAction.signal },
                'assessment',
                signalSources(view.nextBestAction.signal),
              ),
            ]
          : []
      return finish(
        [
          section('figures', figures(view).slice(0, 5)),
          section('relationship', [
            item(
              'health',
              { health: view.health, daysSinceContact: view.daysSinceContact },
              'assessment',
              [],
            ),
            view.nextMeeting
              ? item(
                  'event',
                  {
                    event: view.nextMeeting,
                    occursOn: view.nextMeeting.occursOn,
                    daysAhead: view.nextMeeting.daysAhead,
                  },
                  'fact',
                  [view.nextMeeting.id],
                )
              : note('no-upcoming-meeting'),
          ]),
          section('issue', issue),
          section(
            'promises',
            view.openCommitments
              .slice(0, 2)
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
            'upcoming',
            view.upcomingEvents
              .filter((e) => e.type !== 'client-meeting')
              .slice(0, 2)
              .map((e) =>
                item(
                  'event',
                  { event: e, occursOn: e.occursOn, daysAhead: e.daysAhead },
                  'fact',
                  [e.id],
                ),
              ),
          ),
          section(
            'concerns',
            concerns.map((fact) => item('context-fact', { fact }, 'fact', [fact.id])),
          ),
        ],
        {
          titles: {
            ...cockpitTitles,
            ...(cockpit?.sentinelEntry
              ? { [cockpit.sentinelEntry.priority.id]: 'Sentinel-prioritet' }
              : {}),
          },
        },
      )
    }
    case 'MEETING_PACK_FULL':
    case 'MEETING_PACK_EXECUTIVE':
    case 'MEETING_PACK_PPTX':
    case 'MEETING_PACK_PDF':
    case 'MEETING_PACK_UPDATE': {
      /*
       * The pack's own read model says whether it is ready and what it will
       * contain; the preview is where it is reviewed and generated. JARVIS
       * opens that door itself for the screen's client; for another client it
       * offers the door and leaves the screen where it is.
       */
      const depth = intent.kind === 'MEETING_PACK_EXECUTIVE' ? 'executive' : 'full'
      const pack = await meetingPack(context, clientId, depth)
      if (!pack) return null
      const format =
        intent.kind === 'MEETING_PACK_PDF'
          ? 'pdf'
          : intent.kind === 'MEETING_PACK_PPTX'
            ? 'pptx'
            : 'both'
      const href = `/clients/${clientId}/meeting-pack?depth=${depth}&format=${format}`
      const refreshed =
        intent.kind === 'MEETING_PACK_UPDATE'
          ? pack.changesSinceLastMeeting.changes
              .filter((c) => c.kind !== 'contacts')
              .slice(0, MAX_ITEMS)
              .map((change) => item('change', { change }, 'fact', change.sourceIds))
          : []
      return finish(
        [
          section('readiness', [
            item('pack-readiness', { readiness: pack.readiness }, 'assessment', []),
            ...pack.readiness.reasons.map((reason) =>
              item('readiness-reason', { reason }, 'fact', reason.sourceIds),
            ),
          ]),
          section('contents', [
            item(
              'pack-outline',
              {
                depth,
                core: pack.outline.core.length,
                appendix: pack.outline.appendix.length,
                meetingDate: pack.meeting.date,
              },
              'fact',
              [],
            ),
          ]),
          section(
            'since-last',
            intent.kind === 'MEETING_PACK_UPDATE' && refreshed.length === 0
              ? [note('few-changes')]
              : refreshed,
          ),
        ],
        {
          about: about(meetingDate),
          actions: [{ kind: 'open-meeting-pack', href }],
          titles: pack.titles,
          ...(switched ? {} : { opens: href }),
          confidence: pack.readiness.state === 'BLOCKERAD' ? 'low' : 'high',
        },
      )
    }
    case 'GENERAL_CLIENT_QUERY': {
      const result = await askAboutClient(context, { clientId, question: text })
      /*
       * The memory's `unknown` is the most recent record "said as such" — not
       * evidence about what was asked. JARVIS says nothing is documented rather
       * than pass a recent note off as the answer.
       */
      const hits = result.ok && result.answer.kind !== 'unknown' ? result.answer.hits : []
      return finish(
        [
          section(
            'memory',
            hits.length === 0
              ? [note('nothing-documented')]
              : hits
                  .slice(0, MAX_ITEMS)
                  .map((hit) => item('memory-hit', { hit }, 'fact', [hit.id])),
          ),
        ],
        { confidence: hits.length === 0 ? 'low' : 'medium' },
      )
    }
    default:
      return null
  }
}

/* ------------------------------------------------------------ the book */

async function officeAnswer(
  context: AdvisoryContext,
  jarvis: JarvisContext,
  kind: Extract<AdvisoryIntentKind, `OFFICE_${string}`>,
  officeId: string,
): Promise<JarvisAnswer | null> {
  const book = await officeBook(context, officeId)
  if (!book) return null
  const about: JarvisAbout = {
    kind: 'office',
    id: book.office.id,
    label: book.office.displayName,
    href: `/clients/office/${book.office.id}`,
    switched: false,
  }
  return rowsAnswer(context, jarvis, kind, book.rows, book.today, about, [
    { kind: 'open-office', href: about.href! },
  ])
}

async function directoryAnswer(
  context: AdvisoryContext,
  jarvis: JarvisContext,
  kind: Extract<AdvisoryIntentKind, `DIRECTORY_${string}`>,
): Promise<JarvisAnswer | null> {
  const directory = await clientDirectory(context)
  const about: JarvisAbout = {
    kind: 'directory',
    id: null,
    label: 'Klienter',
    href: '/clients?view=alla',
    switched: false,
  }
  if (kind === 'DIRECTORY_CALL_TODAY') {
    const brief = await sentinelBrief(context)
    const today = brief.entries.filter(
      (e) =>
        (e.status === 'active' || e.status === 'reviewed') &&
        e.priority.horizon === 'today',
    )
    return {
      scope: jarvis.scope,
      intent: kind,
      about,
      sections: [
        {
          key: 'clients',
          items:
            today.length === 0
              ? [note('nobody-needs-attention')]
              : today
                  .slice(0, MAX_ITEMS)
                  .map((entry) =>
                    item(
                      'sentinel-entry',
                      { entry },
                      'assessment',
                      entry.priority.sourceIds,
                    ),
                  ),
        },
      ],
      sources: today.slice(0, MAX_ITEMS).map((e) => sentinelSource(e)),
      actions: [{ kind: 'open-sentinel', href: '/sentinel' }],
      titles: Object.fromEntries(today.map((e) => [e.priority.id, 'Sentinel-prioritet'])),
      today: brief.today,
      confidence: 'high',
      method: 'advisory-rules-v1',
      askedAt: context.clock.isoNow(),
    }
  }
  return rowsAnswer(context, jarvis, kind, directory.rows, directory.today, about, [])
}

function rowsAnswer(
  context: AdvisoryContext,
  jarvis: JarvisContext,
  kind: AdvisoryIntentKind,
  rows: readonly ClientDirectoryRow[],
  today: string,
  about: JarvisAbout,
  actions: JarvisAction[],
): JarvisAnswer {
  let picked: { row: ClientDirectoryRow; because: RowReason }[] = []
  let key: SectionKey = 'clients'
  let empty: NoteKind = 'nobody-needs-attention'
  switch (kind) {
    case 'OFFICE_PRIORITIES':
      picked = rows
        .filter((r) => r.flags.needsAttention)
        .sort(
          (a, b) =>
            (a.nextBestAction?.urgency ?? 6) - (b.nextBestAction?.urgency ?? 6) ||
            b.highPrioritySignals - a.highPrioritySignals,
        )
        .map((row) => ({ row, because: 'needs-attention' as const }))
      break
    case 'OFFICE_MEETINGS':
    case 'DIRECTORY_MEETINGS':
      key = 'meetings'
      empty = 'no-meetings-soon'
      picked = rows
        .filter(
          (r) =>
            r.nextMeeting !== null &&
            daysBetween(today, r.nextMeeting) <= MEETING_SOON_DAYS,
        )
        .sort((a, b) => a.nextMeeting!.localeCompare(b.nextMeeting!))
        .map((row) => ({ row, because: 'meeting-soon' as const }))
      break
    case 'OFFICE_OVERDUE':
    case 'DIRECTORY_OVERDUE':
      key = 'overdue'
      empty = 'no-overdue'
      picked = rows
        .filter((r) => r.overdueCommitments > 0)
        .sort((a, b) => b.overdueCommitments - a.overdueCommitments)
        .map((row) => ({ row, because: 'overdue-commitment' as const }))
      break
    case 'OFFICE_OPPORTUNITIES':
      key = 'opportunities'
      empty = 'no-opportunities'
      picked = rows
        .filter((r) => r.opportunityValue > 0)
        .sort((a, b) => b.opportunityValue - a.opportunityValue)
        .map((row) => ({ row, because: 'opportunity' as const }))
      break
    case 'DIRECTORY_EXTERNAL_ASSETS':
      key = 'clients'
      empty = 'no-external-assets'
      picked = rows
        .filter((r) => r.estimatedWealth - r.aum > 0)
        .sort((a, b) => b.estimatedWealth - b.aum - (a.estimatedWealth - a.aum))
        .map((row) => ({ row, because: 'external-assets' as const }))
      break
    default:
      break
  }
  const shown = picked.slice(0, MAX_ITEMS)
  return {
    scope: jarvis.scope,
    intent: kind,
    about,
    sections: [
      {
        key,
        items:
          shown.length === 0
            ? [note(empty)]
            : shown.map(({ row, because }) =>
                item(
                  'client-row',
                  { row, because },
                  because === 'needs-attention' ? 'assessment' : 'fact',
                  [row.id],
                ),
              ),
      },
    ],
    sources: shown.map(({ row }) => ({
      id: row.id,
      type: 'client',
      label: row.displayName,
      date: null,
    })),
    actions,
    titles: Object.fromEntries(shown.map(({ row }) => [row.id, row.displayName])),
    today,
    confidence: 'high',
    method: 'advisory-rules-v1',
    askedAt: context.clock.isoNow(),
  }
}

async function sentinelAnswer(
  context: AdvisoryContext,
  jarvis: JarvisContext,
): Promise<JarvisAnswer> {
  const brief = await sentinelBrief(context)
  const active = brief.entries.filter(
    (e) => e.status === 'active' || e.status === 'reviewed',
  )
  const today = active.filter((e) => e.priority.horizon === 'today')
  const shown = (today.length > 0 ? today : active).slice(0, MAX_ITEMS)
  return {
    scope: jarvis.scope,
    intent: 'SENTINEL_TODAY',
    about: {
      kind: 'sentinel',
      id: null,
      label: 'Sentinel',
      href: '/sentinel',
      switched: false,
    },
    sections: [
      {
        key: 'clients',
        items:
          shown.length === 0
            ? [note('nobody-needs-attention')]
            : shown.map((entry) =>
                item('sentinel-entry', { entry }, 'assessment', entry.priority.sourceIds),
              ),
      },
    ],
    sources: shown.map(sentinelSource),
    actions: [],
    titles: Object.fromEntries(shown.map((e) => [e.priority.id, 'Sentinel-prioritet'])),
    today: brief.today,
    confidence: 'high',
    method: 'advisory-rules-v1',
    askedAt: context.clock.isoNow(),
  }
}

async function marketImpactAnswer(
  context: AdvisoryContext,
  jarvis: JarvisContext,
): Promise<JarvisAnswer> {
  const brief = await marketImpactBrief(context)
  const touching = brief.episodes.filter((e) => e.meaningful > 0).slice(0, 3)
  const items: JarvisItem[] = touching.flatMap((episode) => [
    item(
      'episode',
      { episode },
      'fact',
      episode.events.map((e) => e.event.id),
    ),
    ...episode.events
      .flatMap((entry) =>
        entry.affected
          .filter((a) => a.impact.relevance !== 'low')
          .slice(0, 3)
          .map((affected) => ({ affected, event: entry.event })),
      )
      .slice(0, 4)
      .map(({ affected, event }) =>
        item('affected-client', { affected, event }, 'assessment', [
          event.id,
          affected.client.id,
        ]),
      ),
  ])
  const sources: JarvisSource[] = touching.flatMap((episode) =>
    episode.events.map((e) => ({
      id: e.event.id,
      type: 'market-event' as const,
      label: e.event.label,
      date: e.event.firstSeenAt,
    })),
  )
  return {
    scope: jarvis.scope,
    intent: 'MARKET_IMPACT_CLIENTS',
    about: {
      kind: 'market-impact',
      id: null,
      label: 'Marknadspåverkan',
      href: '/market-impact',
      switched: false,
    },
    sections: [
      {
        key: 'episodes',
        items: items.length === 0 ? [note('no-affected-clients')] : items,
      },
    ],
    sources,
    actions: [{ kind: 'open-market-impact', href: '/market-impact' }],
    titles: Object.fromEntries(sources.map((s) => [s.id, s.label])),
    today: brief.today,
    confidence: 'high',
    method: 'advisory-rules-v1',
    askedAt: context.clock.isoNow(),
  }
}

/* ---------------------------------------------------------------- helpers */

function section(key: SectionKey, items: JarvisItem[]): JarvisSection {
  return { key, items }
}

function note(kind: NoteKind): JarvisItem {
  return { kind: 'note', note: kind, nature: 'fact', sourceIds: [] }
}

/** A typed item with its nature and sources; the shape is the union's, checked at the call. */
function item<K extends JarvisItem['kind']>(
  kind: K,
  fields: Omit<Extract<JarvisItem, { kind: K }>, 'kind' | 'nature' | 'sourceIds'>,
  nature: JarvisItem['nature'],
  sourceIds: readonly string[],
): JarvisItem {
  return { kind, ...fields, nature, sourceIds } as unknown as JarvisItem
}

function sinceLast(cockpit: MeetingCockpit): JarvisItem[] {
  return [
    ...cockpit.changes.changes
      .slice(0, MAX_ITEMS)
      .map((change) => item('change', { change }, 'fact', change.sourceIds)),
    ...cockpit.market
      .slice(0, 3)
      .map((m) => item('market', { item: m }, 'assessment', m.sourceIds)),
  ]
}

function promises(cockpit: MeetingCockpit, which: 'open'): JarvisItem[] {
  return cockpit.promises
    .filter((p) => (which === 'open' ? p.bucket !== 'completed-since' : true))
    .slice(0, MAX_ITEMS)
    .map((view) => item('promise', { view }, 'fact', [view.commitment.id]))
}

function figures(view: Client360): JarvisItem[] {
  const { balanceSheet } = view
  const property = balanceSheet.buckets.find((b) => b.kind === 'property')?.value ?? 0
  const out: JarvisItem[] = [
    item(
      'figure',
      {
        figure: 'total-wealth',
        amount: balanceSheet.totalAssets,
        ...(balanceSheet.oldestValuationAt
          ? { asOf: balanceSheet.oldestValuationAt }
          : {}),
      },
      'fact',
      [],
    ),
    item('figure', { figure: 'aum', amount: balanceSheet.assetsWithBank }, 'fact', []),
    item(
      'figure',
      { figure: 'debt', amount: balanceSheet.totalLiabilities },
      'fact',
      view.liabilities.map((l) => l.id),
    ),
    item('figure', { figure: 'net-worth', amount: balanceSheet.netWorth }, 'fact', []),
    item('figure', { figure: 'liquidity', amount: balanceSheet.liquidity }, 'fact', []),
  ]
  if (balanceSheet.totalAssets > 0 && property > 0)
    out.push(
      item(
        'figure',
        {
          figure: 'property-share',
          amount: property,
          percent: Math.round((property / balanceSheet.totalAssets) * 100),
        },
        'fact',
        view.assets.filter((a) => a.kind === 'property').map((a) => a.id),
      ),
    )
  if (view.portfolio) {
    out.push(
      item(
        'figure',
        {
          figure: 'portfolio-value',
          amount: view.portfolio.totalValue,
          asOf: view.portfolio.valuedAt,
        },
        'fact',
        [view.portfolio.id],
      ),
    )
    out.push(
      item(
        'figure',
        {
          figure: 'portfolio-ytd',
          amount: 0,
          percent: view.portfolio.performanceYtdPercent,
          asOf: view.portfolio.valuedAt,
        },
        'fact',
        [view.portfolio.id],
      ),
    )
  }
  return out
}

function isOverdue(
  commitment: { dueDate: string | null; status: string },
  today: string,
): boolean {
  return (
    commitment.status === 'open' &&
    commitment.dueDate !== null &&
    daysBetween(commitment.dueDate, today) > 0
  )
}

function daysToDue(commitment: { dueDate: string | null }, today: string): number | null {
  return commitment.dueDate === null ? null : daysBetween(today, commitment.dueDate)
}

function signalSources(signal: { kind: string } & Record<string, unknown>): string[] {
  const ids: string[] = []
  for (const key of [
    'commitmentId',
    'eventId',
    'liabilityId',
    'contextFactId',
    'opportunityId',
    'goalId',
    'interactionId',
  ]) {
    const value = signal[key]
    if (typeof value === 'string') ids.push(value)
  }
  return ids
}

function driverSources(driver: { kind: string } & Record<string, unknown>): string[] {
  return signalSources(driver)
}

function sentinelSource(entry: SentinelEntry): JarvisSource {
  return {
    id: entry.priority.id,
    type: 'sentinel-priority',
    label: `${entry.client.displayName} · ${entry.priority.theme}`,
    date: entry.priority.dueAt,
  }
}

function collectSources(
  sections: readonly JarvisSection[],
  index: Map<string, JarvisSource>,
): JarvisSource[] {
  const seen = new Set<string>()
  const out: JarvisSource[] = []
  for (const s of sections)
    for (const it of s.items)
      for (const id of it.sourceIds) {
        if (seen.has(id)) continue
        seen.add(id)
        const source = index.get(id) ?? fallbackSource(id)
        if (source) out.push(source)
      }
  return out
}

export type { Interaction }

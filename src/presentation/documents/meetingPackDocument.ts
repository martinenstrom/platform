/**
 * From the Meeting Pack to the document: which slides, what each says,
 * in what order, with which notes — composed once, consumed by the
 * screen, the PowerPoint and the PDF alike.
 *
 * Senior-first writing: every headline is the conclusion the slide
 * supports, never its topic. Every sentence about the record comes from
 * the cockpit's own text functions, so the deck says exactly what the
 * cockpit says. Each page has an archetype and its own composition — an
 * executive brief with the figures that run the meeting, a snapshot with
 * a summary table and a composition chart, a change page with the
 * previous and current figures side by side, a balance sheet with
 * totals, a portfolio analysis, a financing page with the maturity
 * structure, a market page, an open-issues page, a questions page, a
 * plan, an action list and data appendices with sums. Placement rules
 * keep a fact from being repeated mechanically. Nothing is invented to
 * fill a page: a missing figure is omitted or marked DATA SAKNAS; a
 * stale one carries its date.
 */

import {
  concernTopicsOf,
  daysBetween,
  type AdvisorQuestion,
  type Asset,
  type ClientQuestion,
  type FocusTopic,
  type Goal,
  type Holding,
  type Liability,
  type MeetingChange,
  type PromiseView,
} from '~/domain/advisory'
import type {
  ExecutivePoint,
  MeetingPack,
  NextStep,
  PackSlideKind,
  PriorityItem,
} from '~/application/advisory/meetingPack'
import {
  formatDayMonth,
  formatDaysFromToday,
  formatLongDate,
  formatMsek,
  formatPct,
  formatPoints,
  formatRiskProfile,
  formatSignedPct,
  yearOf,
} from '~/presentation/advisory/format'
import { RELEVANCE_LABEL } from '~/presentation/advisory/marketImpactText'
import {
  advisorQuestionText,
  advisorQuestionWhy,
  agendaLabel,
  briefItemText,
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
import { preparation, priorityTitle, whyNow } from '~/presentation/advisory/sentinelText'
import {
  ASSET_CLASS_LABEL,
  ASSET_KIND_LABEL,
  CHANNEL_LABEL,
  COMMITMENT_STATUS_LABEL,
  CONTEXT_LABEL,
  EVENT_LABEL,
  GOAL_STATUS_LABEL,
  HEALTH_BAND_LABEL,
  IMPORTANCE_LABEL,
  INTERACTION_LABEL,
  LIABILITY_KIND_LABEL,
  RISK_PROFILE_LABEL,
  SEGMENT_LABEL,
  STRATEGIC_ROLE_LABEL,
} from '~/presentation/advisory/text'
import { SOURCE_TYPE_LABEL } from '~/presentation/jarvis/advisoryAnswerText'
import {
  CONFIDENTIALITY,
  DATA_MISSING,
  fileBaseNameOf,
  INTERNAL_MARK,
  NO_MARKET_MOVES,
  NOTE_ORDER,
  OWNER_LABEL,
  readinessReasonText,
  STEP_STATUS_LABEL,
} from './meetingPackText'
import {
  ASSET_KIND_DOC_COLOR,
  COMPARISON_DOC_COLOR,
  DOCUMENT_PALETTE,
  type ActionRow,
  type CalloutItem,
  type ChangeRow,
  type ListItem,
  type NoteLine,
  type PackBlock,
  type PackDocument,
  type PackSlide,
  type SlideArchetype,
  type TimelineItem,
  type Tone,
} from './packDocument'

/* ---------------------------------------------------------------- limits */

const LIMITS = Object.freeze({
  priorities: 3,
  goals: 3,
  context: 2,
  /** Previous-against-current bars need at least this many figures to say something a table does not. */
  comparedForChart: 2,
  changes: 8,
  comparedChanges: 5,
  marketOnChanges: 3,
  assets: 8,
  holdings: 5,
  promises: 5,
  concerns: 3,
  events: 4,
  goalsOnRelationship: 4,
  questions: 5,
  materials: 5,
  nextStepsOnPlan: 4,
  sourcesPerNote: 8,
  marketItems: 3,
  timelineItems: 5,
  /** Maturities within this horizon are compared with the liquidity. */
  maturityHorizonDays: 365,
})

/* ------------------------------------------------------------ composition */

interface Ctx {
  pack: MeetingPack
  /** Record ids already carried in detail on an earlier slide. */
  placed: Set<string>
}

export function composePackDocument(pack: MeetingPack): PackDocument {
  if (pack.audience !== 'INTERNAL_ADVISOR') {
    throw new Error(`No document is composed for audience ${pack.audience} in V1`)
  }
  const ctx: Ctx = { pack, placed: new Set() }
  const core = pack.outline.core.map((kind) => slideOf(ctx, kind, 'core'))
  const appendix = pack.outline.appendix.map((kind) => slideOf(ctx, kind, 'appendix'))
  const slides = [...core, ...appendix]
  const meetingLabel = pack.meeting.date
    ? `Möte ${formatLongDate(pack.meeting.date)}${pack.meeting.title ? ` · ${pack.meeting.title}` : ''}`
    : 'Nästa kontakt · ingen mötestid bokad'
  return {
    audience: 'INTERNAL_ADVISOR',
    depth: pack.depth,
    language: 'sv',
    title: `Mötesunderlag · ${pack.identity.clientName}`,
    client: pack.identity.clientName,
    advisor: pack.identity.advisorName,
    office: pack.identity.officeName,
    meetingLabel,
    meetingDate: pack.meeting.date,
    dataAsOf: pack.dataAsOf,
    generatedAt: pack.generatedAt,
    provenance: {
      portfolioValuedAt: pack.provenance.portfolioValuedAt,
      oldestValuationAt: pack.provenance.oldestValuationAt,
      marketDataAsOf: pack.provenance.marketDataAsOf,
      baselineMeetingDate: pack.provenance.baseline?.meetingDate ?? null,
      sourceCount: pack.provenance.sourceCount,
    },
    confidentiality: CONFIDENTIALITY,
    internalMark: INTERNAL_MARK,
    slides,
    coreCount: core.length,
    appendixCount: appendix.length,
    fileBaseName: fileBaseNameOf(
      pack.identity.clientName,
      pack.depth,
      pack.meeting.date ?? pack.dataAsOf,
    ),
  }
}

function slideOf(ctx: Ctx, kind: PackSlideKind, section: 'core' | 'appendix'): PackSlide {
  const built = BUILDERS[kind](ctx)
  return {
    ...built,
    kind,
    section,
    archetype: ARCHETYPE[kind],
    notes: orderNotes(built.notes),
  }
}

type Built = Omit<PackSlide, 'kind' | 'section' | 'archetype'>

const BUILDERS: Record<PackSlideKind, (ctx: Ctx) => Built> = {
  executive: executiveSlide,
  glance: glanceSlide,
  'since-last': sinceLastSlide,
  wealth: wealthSlide,
  portfolio: portfolioSlide,
  financing: financingSlide,
  market: marketSlide,
  relationship: relationshipSlide,
  questions: questionsSlide,
  plan: planSlide,
  'next-steps': nextStepsSlide,
  'appendix-holdings': appendixHoldings,
  'appendix-loans': appendixLoans,
  'appendix-timeline': appendixTimeline,
  'appendix-commitments': appendixCommitments,
  'appendix-market': appendixMarket,
  'appendix-baseline': appendixBaseline,
  'appendix-data-quality': appendixDataQuality,
  'appendix-sources': appendixSources,
}

const ARCHETYPE: Record<PackSlideKind, SlideArchetype> = {
  executive: 'executive',
  glance: 'snapshot',
  'since-last': 'change',
  wealth: 'balance-sheet',
  portfolio: 'portfolio',
  financing: 'financing',
  market: 'market',
  relationship: 'issues',
  questions: 'questions',
  plan: 'plan',
  'next-steps': 'actions',
  'appendix-holdings': 'appendix-data',
  'appendix-loans': 'appendix-data',
  'appendix-timeline': 'appendix-data',
  'appendix-commitments': 'appendix-data',
  'appendix-market': 'appendix-data',
  'appendix-baseline': 'appendix-data',
  'appendix-data-quality': 'appendix-data',
  'appendix-sources': 'appendix-data',
}

/** The notes in reading order: the point, why, what to mind, what to check, what comes next, the basis. */
function orderNotes(notes: readonly NoteLine[]): NoteLine[] {
  return [...notes].sort(
    (a, b) => NOTE_ORDER.indexOf(a.kind) - NOTE_ORDER.indexOf(b.kind),
  )
}

/* ------------------------------------------------------------- slide 1 */

/** What the meeting is about, as a conclusion: the fact, then the point it makes. */
function executiveHeadline(topic: FocusTopic): string {
  switch (topic.kind) {
    case 'loan-maturity':
      return `${loanName(topic.label)} förfaller om ${topic.daysAhead ?? 0} dagar; finansieringen är mötets huvudpunkt.`
    case 'refinancing':
      return `Bolånet läggs om om ${topic.daysAhead ?? 0} dagar${topic.amount ? ` (${formatMsek(topic.amount)})` : ''}; omläggningen är mötets huvudpunkt.`
    case 'liquidity-event':
      return `${topic.label ?? 'En likviditetshändelse'}${topic.date ? ` ${formatDayMonth(topic.date)}` : ''}; planen för likviden är mötets huvudpunkt.`
    case 'strategy-drift':
      return `${ASSET_CLASS_LABEL[topic.assetClass ?? 'equities']} ligger på ${topic.currentPercent ?? 0} % mot strategi ${topic.strategicPercent ?? 0} %; risknivån är mötets huvudpunkt.`
    case 'concern-with-market':
      return `Klienten har uttryckt oro – ”${topic.label ?? ''}” – och marknaden har rört sig i ämnet; oron är mötets huvudpunkt.`
    case 'concern':
      return `Klienten har uttryckt oro – ”${topic.label ?? ''}”; oron är mötets huvudpunkt.`
    case 'excess-liquidity':
      return `Likviditeten ${formatMsek(topic.amount ?? 0)} ligger över behovet; avsikten med den är mötets huvudpunkt.`
    case 'goal-at-risk':
      return `Målet ”${topic.label ?? ''}” ligger efter plan; målet är mötets huvudpunkt.`
    case 'next-generation':
      return `${topic.label ?? 'Nästa generation'}; strukturen för nästa generation är mötets huvudpunkt.`
    case 'overdue-promise':
      return `Åtagandet ”${topic.label ?? ''}” är försenat; det är mötets första punkt.`
    case 'relationship-risk':
      return 'Relationshälsan är i riskzonen; relationen är mötets huvudpunkt.'
    case 'follow-up':
      return 'Inget brådskar i registret; uppföljningen sedan senaste mötet är mötets huvudpunkt.'
  }
}

/** The loan behind a maturity topic: the event's title says "förfaller" itself. */
function loanName(label: string | undefined): string {
  return (label ?? 'Lånet').replace(/\s+förfaller$/iu, '')
}

function executiveSlide(ctx: Ctx): Built {
  const { pack } = ctx
  const { identity, meeting, clientSnapshot, relationshipHealth } = pack
  const changes = pack.changesSinceLastMeeting.changes.filter(
    (c) => c.kind !== 'contacts',
  )
  const open = pack.commitments.filter((p) => p.bucket !== 'completed-since')
  const overdue = open.filter((p) => p.bucket === 'overdue')
  const criticalItem = pack.financing.find((f) => f.event !== null) ?? null
  const critical = criticalItem?.event ?? null
  const bankShare =
    clientSnapshot.totalAssets > 0
      ? Math.round((clientSnapshot.assetsWithBank / clientSnapshot.totalAssets) * 100)
      : 0
  const objectives = pack.meetingObjectives
  const outcome = objectives
    .slice(0, 2)
    .map((o) => lowerFirst(objectiveText(o).replace(/\.$/u, '')))
    .join(' och ')
  const blocks: PackBlock[] = [
    {
      kind: 'kpis',
      lead: true,
      items: [
        {
          label: 'Klient',
          value: identity.clientName,
          ...(identity.householdName ? { detail: identity.householdName } : {}),
        },
        {
          label: 'Möte',
          value: meeting.date ? formatLongDate(meeting.date) : 'Ej bokat',
          ...(meeting.daysAhead !== null
            ? {
                detail: `${formatDaysFromToday(meeting.daysAhead)}${meeting.title ? ` · ${meeting.title}` : ''}`,
              }
            : {}),
        },
        { label: 'Rådgivare', value: identity.advisorName ?? DATA_MISSING },
        {
          label: 'Kontor',
          value: identity.officeName ?? DATA_MISSING,
          detail: `${SEGMENT_LABEL[identity.segment]} · sedan ${yearOf(identity.relationshipSince)}`,
        },
      ],
    },
    {
      kind: 'kpis',
      items: [
        {
          label: 'Total förmögenhet',
          value: formatMsek(clientSnapshot.totalAssets),
          tone: 'gold',
          ...(pack.wealth.oldestValuationAt
            ? {
                detail: `äldsta värdering ${formatDayMonth(pack.wealth.oldestValuationAt)}`,
              }
            : {}),
        },
        {
          label: 'Hos banken',
          value: formatMsek(clientSnapshot.assetsWithBank),
          detail: `${bankShare} % av förmögenheten`,
        },
        {
          label: 'Nettoförmögenhet',
          value: formatMsek(clientSnapshot.netWorth),
          detail:
            clientSnapshot.totalLiabilities > 0
              ? `skulder ${formatMsek(clientSnapshot.totalLiabilities)}`
              : 'skuldfri',
        },
        { label: 'Likviditet', value: formatMsek(clientSnapshot.liquidity) },
        {
          label: 'Riskprofil',
          value: formatRiskProfile(clientSnapshot.riskProfile),
          detail: RISK_PROFILE_LABEL[clientSnapshot.riskProfile],
        },
        {
          label: 'Relationshälsa',
          value: `${relationshipHealth.score}/100`,
          detail: HEALTH_BAND_LABEL[relationshipHealth.band],
          tone:
            relationshipHealth.band === 'at-risk'
              ? 'negative'
              : relationshipHealth.band === 'watch'
                ? 'warning'
                : 'neutral',
        },
      ],
    },
    {
      kind: 'columns',
      weights: [7, 5],
      columns: [
        [
          {
            kind: 'statement',
            label: 'Mötets huvudfokus',
            text: focusHeadline(pack.meetingFocus),
            addendum: {
              label: 'Önskat utfall',
              text: outcome
                ? `${cap(outcome)}.`
                : 'Enas om nästa kontakt och vad som ska vara klart till dess.',
            },
          },
        ],
        [
          {
            kind: 'list',
            title: 'Topp 3 prioriteringar',
            numbered: true,
            items: pack.topPriorities.slice(0, LIMITS.priorities).map(priorityItem),
          },
          ...(pack.dontForget
            ? [
                {
                  kind: 'callout' as const,
                  title: 'Glöm inte',
                  text: riskText(pack.dontForget),
                  tone: 'gold' as const,
                  compact: true,
                },
              ]
            : []),
        ],
      ],
    },
    {
      kind: 'kpis',
      items: [
        {
          label: 'Sedan sist',
          value:
            changes.length === 0
              ? 'Få väsentliga förändringar'
              : `${changes.length} ${changes.length === 1 ? 'väsentlig förändring' : 'väsentliga förändringar'}`,
          detail: `sedan ${formatDayMonth(pack.changesSinceLastMeeting.since)}`,
        },
        {
          label: 'Åtaganden',
          value:
            open.length === 0
              ? 'Inga öppna'
              : `${overdue.length} ${overdue.length === 1 ? 'försenat' : 'försenade'} · ${open.length} öppna`,
          tone: overdue.length > 0 ? 'negative' : 'neutral',
          ...(overdue[0] ? { detail: overdue[0].commitment.title } : {}),
        },
        {
          label: 'Kritiskt datum',
          value: critical ? formatLongDate(critical.occursOn) : 'Inget inom 180 dagar',
          ...(critical
            ? {
                detail: `${critical.title}${criticalItem?.daysAhead !== null && criticalItem?.daysAhead !== undefined ? ` · ${formatDaysFromToday(criticalItem.daysAhead)}` : ''}`,
              }
            : {}),
          tone: critical ? 'gold' : 'neutral',
        },
        {
          label: 'Marknad',
          value:
            pack.marketContext.length === 0
              ? 'Inga väsentliga rörelser'
              : `${pack.marketContext.length} ${pack.marketContext.length === 1 ? 'relevant rörelse' : 'relevanta rörelser'}`,
          ...(pack.marketContext[0]
            ? { detail: marketHeadline(pack.marketContext[0]) }
            : {}),
        },
      ],
    },
  ]
  for (const p of pack.topPriorities) for (const id of p.sourceIds) ctx.placed.add(id)

  const followUp = pack.advisorQuestions[0]
  const notes: NoteLine[] = [
    { kind: 'talking-point', text: focusHeadline(pack.meetingFocus) },
    ...pack.executiveSummary
      .filter((point) => point.kind !== 'focus')
      .map<NoteLine>((point) => ({
        kind: 'talking-point',
        text: executivePointText(point, pack),
      })),
    { kind: 'why-it-matters', text: `${focusReasonText(pack.meetingFocus.primary)}.` },
    ...pack.readiness.reasons.map<NoteLine>((reason) => ({
      kind: 'verify',
      text: readinessReasonText(reason),
    })),
    ...(followUp
      ? [{ kind: 'follow-up' as const, text: `”${advisorQuestionText(followUp)}”` }]
      : []),
    sourceNote(pack, [
      ...pack.meetingFocus.primary.sourceIds,
      ...pack.topPriorities.flatMap((p) => p.sourceIds),
    ]),
  ]
  return {
    kicker: 'Executive meeting brief',
    headline: executiveHeadline(pack.meetingFocus.primary),
    blocks,
    notes,
    sourceIds: unique([
      ...pack.meetingFocus.primary.sourceIds,
      ...pack.topPriorities.flatMap((p) => p.sourceIds),
      ...(pack.dontForget?.sourceIds ?? []),
    ]),
  }
}

const PRIORITY_VERB: Record<FocusTopic['kind'], string> = {
  'relationship-risk': 'Stabilisera relationen',
  refinancing: 'Förbered omläggningen',
  'loan-maturity': 'Förbered förfallet',
  'liquidity-event': 'Planera likviden',
  'strategy-drift': 'Bekräfta risknivån',
  'concern-with-market': 'Bemöt oron med underlag',
  concern: 'Bemöt oron',
  'excess-liquidity': 'Klargör likviditeten',
  'goal-at-risk': 'Bekräfta målet',
  'next-generation': 'Ta upp nästa generation',
  'overdue-promise': 'Stäng det försenade åtagandet',
  'follow-up': 'Följ upp sedan senaste mötet',
}

function priorityItem(p: PriorityItem): ListItem {
  switch (p.kind) {
    case 'focus-topic':
      return {
        text: PRIORITY_VERB[p.topic.kind],
        detail: focusReasonText(p.topic),
        marker: 'assessment',
      }
    case 'promise':
      return {
        text: `Stäng åtagandet ”${p.view.commitment.title}”`,
        detail: promiseWhen(p.view),
        marker: 'fact',
      }
    case 'objective':
      return { text: objectiveText(p.objective), marker: 'suggestion' }
  }
}

/** "försenat 6 dagar · förföll 17 sep 2026" — the promise's standing, without its bucket repeated. */
function promiseWhen(p: PromiseView): string {
  const c = p.commitment
  if (p.bucket === 'overdue' && p.daysToDue !== null) {
    return `försenat ${Math.abs(p.daysToDue)} dagar · förföll ${formatLongDate(c.dueDate!)}`
  }
  return c.dueDate
    ? `senast ${formatLongDate(c.dueDate)}`
    : `lovat ${formatLongDate(c.createdAt)}`
}

function executivePointText(point: ExecutivePoint, pack: MeetingPack): string {
  switch (point.kind) {
    case 'focus':
      return focusHeadline(point.focus)
    case 'change': {
      const row = changeRow(point.change, pack)
      return `${row.label}: ${row.before === '–' ? row.after : `från ${row.before} till ${row.after}`}${row.note ? ` (${row.note})` : ''}.`
    }
    case 'promise':
      return `Åtagande ”${point.view.commitment.title}”: ${promiseDetail(point.view)}.`
    case 'financing':
      return `${financingLine(point.item)}. ${financingStatusText(point.item)}`
    case 'market':
      return `${marketHeadline(point.item)} · ${marketRelevanceLines(point.item).why}`
    case 'concern':
      return `Klienten har uttryckt: ”${point.fact.statement}”.`
    case 'health':
      return `Relationshälsan är ${HEALTH_BAND_LABEL[point.health.band].toLowerCase()} (${point.health.score}/100).`
    case 'quiet':
      return 'Registret kallar på lite: en uppföljning, ingen brådskande fråga.'
  }
}

/* ------------------------------------------------------------- slide 2 */

function glanceSlide(ctx: Ctx): Built {
  const { pack } = ctx
  const s = pack.clientSnapshot
  const w = pack.wealth
  const share = (value: number) =>
    s.totalAssets > 0 ? Math.round((value / s.totalAssets) * 100) : 0
  const bankShare = share(s.assetsWithBank)
  const debtRatio = share(s.totalLiabilities)
  const goals = [...pack.goals]
    .sort((a, b) => (a.priority === 'primary' ? -1 : b.priority === 'primary' ? 1 : 0))
    .slice(0, LIMITS.goals)
  const context = pack.relationshipContext
    .filter((c) => c.reason !== 'concern')
    .slice(0, LIMITS.context)
  const next = s.nextEvent
  const observation = pack.strategy.observations[0]
  const stale = pack.dataQuality.filter(
    (d) => d.kind === 'stale-valuation' || d.kind === 'external-not-updated',
  )
  const callouts: CalloutItem[] = [
    ...(observation
      ? [
          {
            kind: 'observation' as const,
            text: strategyObservationText(observation).observation,
            detail: strategyObservationText(observation).whyItMatters,
          },
        ]
      : []),
    {
      kind: 'why-it-matters' as const,
      text: `${bankShare} % av förmögenheten finns hos banken; ${formatMsek(s.externalAssets)} ligger utanför.`,
      detail: `Andel av plånboken ${s.shareOfWalletPercent} %.`,
    },
    ...(stale.length > 0
      ? [{ kind: 'verify' as const, text: stale.map(dataQualityText).join(' ') }]
      : []),
  ]
  const blocks: PackBlock[] = [
    {
      kind: 'columns',
      weights: [7, 5],
      columns: [
        [
          {
            kind: 'table',
            title: 'Finansiell översikt',
            columns: ['Post', 'Belopp', 'Andel', 'Per'],
            align: ['left', 'right', 'right', 'right'],
            widths: [2.6, 1.3, 1, 1.2],
            rows: [
              [
                'Total förmögenhet',
                formatMsek(s.totalAssets),
                '100 %',
                w.oldestValuationAt ? formatDayMonth(w.oldestValuationAt) : '–',
              ],
              [
                'varav hos banken',
                formatMsek(s.assetsWithBank),
                `${bankShare} %`,
                pack.provenance.portfolioValuedAt
                  ? formatDayMonth(pack.provenance.portfolioValuedAt)
                  : '–',
              ],
              [
                'varav utanför banken',
                formatMsek(s.externalAssets),
                `${100 - bankShare} %`,
                '–',
              ],
              [
                'Skulder',
                formatMsek(-s.totalLiabilities),
                s.totalLiabilities > 0 ? `${debtRatio} %` : '–',
                w.liabilities.length > 0
                  ? `${w.liabilities.length} ${w.liabilities.length === 1 ? 'lån' : 'lån'}`
                  : '–',
              ],
              ['Nettoförmögenhet', formatMsek(s.netWorth), '', ''],
              [
                'Likviditet',
                formatMsek(s.liquidity),
                `${pack.liquidity.shareOfFinancialPercent} %`,
                '',
              ],
              ['Andel av plånboken', `${s.shareOfWalletPercent} %`, '', ''],
            ],
            totals: [4],
            footnote:
              'Andel av tillgångarna; likviditetens andel avser de finansiella tillgångarna',
          },
        ],
        [
          {
            kind: 'chart',
            title: 'Förmögenhetens sammansättning',
            chart: 'donut',
            categories: w.buckets.map((b) => ASSET_KIND_LABEL[b.kind]),
            series: w.buckets.map((b) => ({
              name: ASSET_KIND_LABEL[b.kind],
              values: w.buckets.map((x) => (x.kind === b.kind ? msek(b.value) : 0)),
              color: ASSET_KIND_DOC_COLOR[b.kind],
            })),
            unit: 'MSEK',
            asOf: w.oldestValuationAt ?? pack.dataAsOf,
            source: 'Balansräkningen, äldsta värdering angiven',
            centre: formatMsek(s.totalAssets),
          },
        ],
      ],
    },
    {
      kind: 'columns',
      columns: [
        [
          {
            kind: 'list',
            title: 'Primära mål',
            items:
              goals.length === 0
                ? [{ text: 'Inga mål är registrerade.' }]
                : goals.map(goalItem),
          },
        ],
        [
          {
            kind: 'list',
            title: 'Relationskontext',
            items: [
              {
                text: `${SEGMENT_LABEL[pack.identity.segment]} · relation sedan ${yearOf(pack.identity.relationshipSince)} · ${CHANNEL_LABEL[pack.identity.preferredChannel].toLowerCase()} · riskprofil ${formatRiskProfile(s.riskProfile)}`,
              },
              ...context.map<ListItem>((c) => ({
                text: c.fact.statement,
                detail: CONTEXT_REASON_LABEL[c.reason],
              })),
            ],
          },
        ],
        [
          {
            kind: 'list',
            title: 'Nästa viktiga händelse',
            items: next
              ? [
                  {
                    text: next.title,
                    detail: `${EVENT_LABEL[next.type]} · ${formatLongDate(next.occursOn)} · ${formatDaysFromToday(next.daysAhead)}`,
                  },
                ]
              : [{ text: 'Ingen daterad händelse inom 180 dagar.' }],
          },
        ],
      ],
    },
    { kind: 'callouts', items: callouts.slice(0, 2) },
  ]
  const external = pack.opportunities.find((o) => o.kind === 'external-assets')
  const notes: NoteLine[] = [
    {
      kind: 'talking-point',
      text: `${formatMsek(s.totalAssets)} i total förmögenhet, ${formatMsek(s.assetsWithBank)} hos banken; nettoförmögenhet ${formatMsek(s.netWorth)}.`,
    },
    {
      kind: 'why-it-matters',
      text: `${100 - bankShare} % av förmögenheten ligger utanför banken; den totala risken kan inte bedömas utan den.`,
    },
    ...stale.map<NoteLine>((d) => ({ kind: 'verify', text: dataQualityText(d) })),
    ...(external
      ? [{ kind: 'follow-up' as const, text: opportunityText(external).question }]
      : []),
    ...pack.clientSnapshot.brief.map<NoteLine>((item) => {
      const t = briefItemText(item)
      return { kind: 'evidence', text: `${t.label}: ${t.value}` }
    }),
    sourceNote(pack, [
      ...goals.map((g) => g.id),
      ...context.map((c) => c.fact.id),
      ...(next ? [next.id] : []),
    ]),
  ]
  return {
    kicker: 'Klienten i korthet',
    headline: `${formatMsek(s.totalAssets)} i total förmögenhet, ${bankShare} % hos banken; nettoförmögenhet ${formatMsek(s.netWorth)}${s.totalLiabilities > 0 ? `, skuldkvot ${debtRatio} %` : ', skuldfri'}.`,
    blocks,
    notes,
    sourceIds: unique([...goals.map((g) => g.id), ...context.map((c) => c.fact.id)]),
  }
}

function goalItem(goal: Goal): ListItem {
  return {
    text: goal.title,
    detail: `${GOAL_STATUS_LABEL[goal.status]} · ${goal.progressPercent} %${goal.priority === 'primary' ? ' · primärt' : ''}${goal.targetDate ? ` · mål ${formatLongDate(goal.targetDate)}` : ''}`,
  }
}

/* ------------------------------------------------------------- slide 3 */

function sinceLastSlide(ctx: Ctx): Built {
  const { pack } = ctx
  const changes = pack.changesSinceLastMeeting
  const selected = changes.changes
    .filter((c) => c.kind !== 'contacts')
    .slice(0, LIMITS.changes)
  const composed = selected.map((c) => changeRow(c, pack))
  const rows = composed.map(stripPhrase)
  const market = pack.marketContext.slice(0, LIMITS.marketOnChanges)
  const baseline = changes.baseline
  const compared = selected
    .filter(
      (c): c is Extract<MeetingChange, { before: number; after: number }> =>
        (c.kind === 'portfolio-value' ||
          c.kind === 'liquidity' ||
          c.kind === 'wealth' ||
          c.kind === 'loan-balance') &&
        typeof c.before === 'number' &&
        typeof c.after === 'number',
    )
    .slice(0, LIMITS.comparedChanges)
  const changesTable: PackBlock =
    rows.length > 0
      ? { kind: 'changes', title: 'Väsentliga förändringar', rows }
      : { kind: 'statement', text: FEW_CHANGES }
  const marketList: PackBlock = {
    kind: 'list',
    title: 'Marknad sedan senaste mötet',
    items:
      market.length === 0
        ? [{ text: NO_MARKET_MOVES }]
        : market.map<ListItem>((m) => ({
            text: `${marketHeadline(m)} · ${RELEVANCE_LABEL[m.item.impact.relevance].toLowerCase()} relevans`,
            detail: marketRelevanceLines(m).status,
            marker: 'assessment',
          })),
  }
  const blocks: PackBlock[] = [
    {
      kind: 'caption',
      text: baseline
        ? `Jämfört med baslinjen från mötet ${formatLongDate(baseline.meetingDate)} · fönster ${formatDayMonth(changes.since)} till ${formatDayMonth(pack.dataAsOf)}`
        : `Jämfört med vad registret daterar sedan ${formatLongDate(changes.since)}`,
    },
  ]
  if (compared.length >= LIMITS.comparedForChart) {
    blocks.push({
      kind: 'columns',
      weights: [7, 5],
      columns: [
        [changesTable],
        [
          {
            kind: 'chart',
            title: 'Före mot nu',
            chart: 'paired-bar',
            categories: compared.map((c) => changeText(c, pack.titles).label),
            series: [
              {
                name: `Före (${formatDayMonth(changes.since)})`,
                values: compared.map((c) => msek(c.before)),
                color: COMPARISON_DOC_COLOR.before,
              },
              {
                name: `Nu (${formatDayMonth(pack.dataAsOf)})`,
                values: compared.map((c) => msek(c.after)),
                color: COMPARISON_DOC_COLOR.after,
              },
            ],
            unit: 'MSEK',
            asOf: pack.dataAsOf,
            source: baseline
              ? `Baslinjen ${formatDayMonth(baseline.meetingDate)} mot registret i dag`
              : 'Registrets egna datum mot i dag',
          },
          marketList,
        ],
      ],
    })
  } else {
    blocks.push(changesTable, marketList)
  }
  const callouts: CalloutItem[] = [
    ...(market[0]
      ? [
          {
            kind: 'why-it-matters' as const,
            text: cap(relevanceBody(marketRelevanceLines(market[0]).why)),
            detail: marketHeadline(market[0]),
          },
        ]
      : []),
    ...(composed[0]
      ? [
          {
            kind: 'implication' as const,
            text: `${composed[0].label}: ${composed[0].before === '–' ? composed[0].after : `från ${composed[0].before} till ${composed[0].after}`}${composed[0].note ? ` (${composed[0].note})` : ''}.`,
            detail: 'Den största förändringen sedan baslinjen; ta den först.',
          },
        ]
      : []),
    ...changes.gaps.map((gap) => ({
      kind: 'verify' as const,
      text: comparisonGapText(gap),
    })),
  ]
  if (callouts.length > 0) blocks.push({ kind: 'callouts', items: callouts.slice(0, 3) })
  const general = pack.advisorQuestions.find((q) => q.kind === 'general')
  const notes: NoteLine[] = [
    ...rows.map<NoteLine>((row) => ({
      kind: 'talking-point',
      text: `${row.label}: ${row.before === '–' ? row.after : `från ${row.before} till ${row.after}`}${row.note ? ` (${row.note})` : ''}.`,
    })),
    ...(market[0]
      ? [{ kind: 'why-it-matters' as const, text: marketRelevanceLines(market[0]).why }]
      : []),
    ...changes.gaps.map<NoteLine>((gap) => ({
      kind: 'verify',
      text: comparisonGapText(gap),
    })),
    ...(general
      ? [{ kind: 'follow-up' as const, text: `”${advisorQuestionText(general)}”` }]
      : []),
    ...market.map<NoteLine>((m) => ({ kind: 'evidence', text: marketBasisText(m) })),
    sourceNote(pack, [
      ...changes.changes.flatMap((c) => c.sourceIds),
      ...market.flatMap((m) => m.sourceIds),
    ]),
  ]
  return {
    kicker: 'Sedan senaste mötet',
    headline: changesHeadline(pack, composed),
    blocks,
    notes,
    sourceIds: unique([
      ...changes.changes.flatMap((c) => c.sourceIds),
      ...market.flatMap((m) => m.sourceIds),
    ]),
  }
}

/** "direkt exponering (…), förstärkt av …" — the relevance sentence without its verdict prefix. */
function relevanceBody(why: string): string {
  return why.replace(/^[^:]*relevans:\s*/iu, '').replace(/\.$/u, '')
}

function changesHeadline(pack: MeetingPack, rows: readonly ComposedChangeRow[]): string {
  const since = formatDayMonth(pack.changesSinceLastMeeting.since)
  const n = pack.marketContext.length
  const marketPart =
    n === 0
      ? ''
      : `; ${n === 1 ? 'en klientrelevant marknadsrörelse' : `${n} klientrelevanta marknadsrörelser`}`
  if (rows.length === 0) {
    return `Få väsentliga förändringar sedan ${since}${marketPart}.`
  }
  const phrases = rows.slice(0, 2).map((r) => r.headlinePhrase)
  return `${cap(phrases.join(' och '))} sedan ${since}${marketPart}.`
}

interface ComposedChangeRow extends ChangeRow {
  headlinePhrase: string
}

function stripPhrase(row: ComposedChangeRow): ChangeRow {
  const { headlinePhrase: _phrase, ...rest } = row
  return rest
}

function changeRow(change: MeetingChange, pack: MeetingPack): ComposedChangeRow {
  const label = changeText(change, pack.titles).label
  const title = (id: string) => pack.titles[id] ?? ''
  switch (change.kind) {
    case 'portfolio-value':
      return {
        label,
        before: formatMsek(change.before),
        after: formatMsek(change.after),
        note: formatSignedPct(change.percent),
        tone: change.percent >= 0 ? 'positive' : 'negative',
        headlinePhrase: `portföljvärdet ${formatSignedPct(change.percent)}`,
      }
    case 'allocation':
      return {
        label,
        before: `${change.before} %`,
        after: `${change.after} %`,
        note: `${formatPoints(change.points)} · strategi ${change.strategicPercent} %`,
        headlinePhrase: `${label.toLowerCase()} ${formatPoints(change.points)}`,
      }
    case 'liquidity':
      return {
        label,
        before: formatMsek(change.before),
        after: formatMsek(change.after),
        note: formatSignedPct(change.percent),
        tone: change.percent >= 0 ? 'positive' : 'negative',
        headlinePhrase: `likviditeten ${formatSignedPct(change.percent)}`,
      }
    case 'wealth':
      return {
        label,
        before: formatMsek(change.before),
        after: formatMsek(change.after),
        note: formatSignedPct(change.percent),
        tone: change.percent >= 0 ? 'positive' : 'negative',
        headlinePhrase: `förmögenheten ${formatSignedPct(change.percent)}`,
      }
    case 'loan-new':
      return {
        label,
        before: '–',
        after: `${title(change.loanId)} · ${formatMsek(change.balance)}`,
        headlinePhrase: 'ett nytt lån',
      }
    case 'loan-closed':
      return {
        label,
        before: `${title(change.loanId)} · ${formatMsek(change.balance)}`,
        after: '–',
        headlinePhrase: 'ett löst lån',
      }
    case 'loan-balance':
      return {
        label,
        before: formatMsek(change.before),
        after: formatMsek(change.after),
        headlinePhrase: `${label.toLowerCase()} ${formatMsek(change.before)} till ${formatMsek(change.after)}`,
      }
    case 'financing-approaching':
      return {
        label,
        before: 'utanför 60 dagar',
        after: `${title(change.eventId)} · om ${change.daysAhead} dagar`,
        tone: 'gold',
        headlinePhrase: `${EVENT_LABEL[change.eventType].toLowerCase()} inom ${change.daysAhead} dagar`,
      }
    case 'goal-status':
      return {
        label,
        before: GOAL_STATUS_LABEL[change.before],
        after: GOAL_STATUS_LABEL[change.after],
        headlinePhrase: `målet ”${title(change.goalId)}” ${GOAL_STATUS_LABEL[change.after].toLowerCase()}`,
      }
    case 'goal-progress':
      return {
        label,
        before: `${change.before} %`,
        after: `${change.after} %`,
        headlinePhrase: `målet ”${title(change.goalId)}” ${change.after} %`,
      }
    case 'health':
      return {
        label,
        before: `${change.before} (${HEALTH_BAND_LABEL[change.bandBefore].toLowerCase()})`,
        after: `${change.after} (${HEALTH_BAND_LABEL[change.bandAfter].toLowerCase()})`,
        tone: change.after >= change.before ? 'positive' : 'negative',
        headlinePhrase: `relationshälsan ${change.before} till ${change.after}`,
      }
    case 'commitments': {
      const parts = [
        change.createdIds.length > 0 ? `${change.createdIds.length} skapade` : null,
        change.completedIds.length > 0 ? `${change.completedIds.length} klara` : null,
        change.overdueIds.length > 0 ? `${change.overdueIds.length} försenade` : null,
        `${change.openIds.length} öppna`,
      ].filter((p): p is string => p !== null)
      return {
        label,
        before: '–',
        after: parts.join(' · '),
        tone: change.overdueIds.length > 0 ? 'negative' : 'neutral',
        headlinePhrase:
          change.overdueIds.length > 0
            ? `${change.overdueIds.length} ${change.overdueIds.length === 1 ? 'försenat åtagande' : 'försenade åtaganden'}`
            : `${change.createdIds.length} nya åtaganden`,
      }
    }
    case 'event-new':
      return {
        label,
        before: '–',
        after: `${title(change.eventId)} · ${formatDayMonth(change.date)}`,
        headlinePhrase: `en ny händelse (${EVENT_LABEL[change.eventType].toLowerCase()})`,
      }
    case 'concern-new':
      return {
        label,
        before: '–',
        after: change.statement,
        tone: 'warning',
        headlinePhrase: 'en ny oro registrerad',
      }
    case 'context-new':
      return {
        label,
        before: '–',
        after: change.statement,
        headlinePhrase: `ny ${CONTEXT_LABEL[change.contextCategory].toLowerCase()} registrerad`,
      }
    case 'contacts':
      return {
        label,
        before: '–',
        after: `${change.interactionIds.length} kontakter`,
        headlinePhrase: `${change.interactionIds.length} kontakter`,
      }
  }
}

/* ------------------------------------------------------------- slide 4 */

function wealthSlide(ctx: Ctx): Built {
  const { pack } = ctx
  const w = pack.wealth
  const share = (value: number) =>
    w.totalAssets > 0 ? Math.round((value / w.totalAssets) * 100) : 0
  const largest = w.buckets[0]
  const debtRatio = share(w.totalLiabilities)
  const bankShare = share(w.assetsWithBank)
  const stale = pack.dataQuality.filter(
    (d) => d.kind === 'stale-valuation' || d.kind === 'external-not-updated',
  )
  const assets = w.assets.slice(0, LIMITS.assets)
  const loans = w.liabilities
  const rows: string[][] = [
    ...assets.map((a) => assetRow(a, share)),
    ['Summa tillgångar', '', formatMsek(w.totalAssets), '100 %', ''],
    ...loans.map((l) => [
      l.title,
      LIABILITY_KIND_LABEL[l.kind],
      formatMsek(-l.outstandingBalance),
      `${share(l.outstandingBalance)} %`,
      formatDayMonth(l.valuedAt),
    ]),
    ...(loans.length > 0
      ? [['Summa skulder', '', formatMsek(-w.totalLiabilities), `${debtRatio} %`, '']]
      : []),
    ['Nettoförmögenhet', '', formatMsek(w.netWorth), '', ''],
  ]
  const totals = [
    assets.length,
    ...(loans.length > 0 ? [assets.length + 1 + loans.length] : []),
    rows.length - 1,
  ]
  const blocks: PackBlock[] = [
    {
      kind: 'columns',
      weights: [5, 7],
      columns: [
        [
          {
            kind: 'chart',
            title: 'Tillgångar och skulder',
            chart: 'stacked-bar',
            categories: ['Tillgångar', 'Skulder'],
            series: [
              ...w.buckets.map((b) => ({
                name: ASSET_KIND_LABEL[b.kind],
                values: [msek(b.value), 0],
                color: ASSET_KIND_DOC_COLOR[b.kind],
              })),
              {
                name: 'Skulder',
                values: [0, msek(w.totalLiabilities)],
                color: DOCUMENT_PALETTE.negative,
              },
            ],
            unit: 'MSEK',
            asOf: w.oldestValuationAt ?? pack.dataAsOf,
            source: 'Balansräkningen, äldsta värdering angiven',
          },
          {
            kind: 'kpis',
            items: [
              {
                label: 'Hos banken',
                value: formatMsek(w.assetsWithBank),
                detail: `${bankShare} % av förmögenheten`,
                tone: 'gold',
              },
              {
                label: 'Skuldkvot',
                value: w.totalLiabilities > 0 ? `${debtRatio} %` : 'skuldfri',
                ...(w.totalLiabilities > 0 ? { detail: 'av tillgångarna' } : {}),
              },
            ],
          },
        ],
        [
          {
            kind: 'table',
            title: 'Balansräkning',
            columns: ['Post', 'Slag', 'Värde', 'Andel', 'Per'],
            align: ['left', 'left', 'right', 'right', 'right'],
            widths: [3, 2, 1.4, 0.9, 1.1],
            rows,
            totals,
            footnote: `Andel av tillgångarna · värden per angivet datum${w.oldestValuationAt ? ` · äldsta värdering ${formatLongDate(w.oldestValuationAt)}` : ''}`,
          },
        ],
      ],
    },
  ]
  const callouts: CalloutItem[] = [
    ...(largest
      ? [
          {
            kind: 'observation' as const,
            text: `${ASSET_KIND_LABEL[largest.kind]} är ${share(largest.value)} % av tillgångarna; ${formatMsek(w.externalAssets)} ligger utanför banken.`,
          },
        ]
      : []),
    ...(w.totalLiabilities > 0
      ? [
          {
            kind: 'why-it-matters' as const,
            text: `Skulderna är ${debtRatio} % av tillgångarna; ${loans.filter((l) => l.interestType === 'variable').length} av ${loans.length} lån löper med rörlig ränta.`,
          },
        ]
      : []),
    ...(stale.length > 0
      ? [{ kind: 'verify' as const, text: stale.map(dataQualityText).join(' ') }]
      : []),
  ]
  if (callouts.length > 0) blocks.push({ kind: 'callouts', items: callouts.slice(0, 3) })
  for (const a of assets) ctx.placed.add(a.id)
  const notes: NoteLine[] = [
    {
      kind: 'talking-point',
      text: largest
        ? `${ASSET_KIND_LABEL[largest.kind]} är ${share(largest.value)} % av tillgångarna; ${bankShare} % av förmögenheten finns hos banken.`
        : 'Inga tillgångar är registrerade.',
    },
    ...(w.totalLiabilities > 0
      ? [
          {
            kind: 'why-it-matters' as const,
            text: `Skuldkvoten ${debtRatio} % bärs av ${loans.length} ${loans.length === 1 ? 'lån' : 'lån'}; en ränterörelse slår mot ${loans.filter((l) => l.interestType === 'variable').length} av dem.`,
          },
        ]
      : []),
    ...stale.map<NoteLine>((d) => ({ kind: 'verify', text: dataQualityText(d) })),
    sourceNote(pack, [...assets.map((a) => a.id), ...w.liabilities.map((l) => l.id)]),
  ]
  return {
    kicker: 'Förmögenhet & balansräkning',
    headline: largest
      ? `Nettoförmögenhet ${formatMsek(w.netWorth)}: ${ASSET_KIND_LABEL[largest.kind].toLowerCase()} är ${share(largest.value)} % av tillgångarna${w.totalLiabilities > 0 ? ` och skulderna ${debtRatio} % av dem` : ''}.`
      : 'Inga värderade tillgångar finns i registret.',
    blocks,
    notes,
    sourceIds: unique([...assets.map((a) => a.id), ...w.liabilities.map((l) => l.id)]),
  }
}

function assetRow(a: Asset, share: (v: number) => number): string[] {
  return [
    a.title,
    ASSET_KIND_LABEL[a.kind],
    formatMsek(a.value),
    `${share(a.value)} %`,
    formatDayMonth(a.valuedAt),
  ]
}

/* ------------------------------------------------------------- slide 5 */

function portfolioSlide(ctx: Ctx): Built {
  const { pack } = ctx
  const p = pack.portfolio.portfolio
  if (!p) {
    return {
      kicker: 'Portfölj & strategi',
      headline: 'Ingen portfölj hos banken är registrerad; strategin kan inte jämföras.',
      blocks: [
        {
          kind: 'statement',
          text: 'Ingen portfölj hos banken är registrerad. Frågan om en förvaltad portfölj hör hemma i samtalet om tillgångarna utanför banken.',
        },
      ],
      notes: [sourceNote(pack, [])],
      sourceIds: [],
    }
  }
  const s = pack.strategy
  const observation = s.observations[0]
  const deviation = s.observations.find((o) => o.kind === 'allocation-deviation')
  const holdings = pack.portfolio.topHoldings.slice(0, LIMITS.holdings)
  const concentration = pack.portfolio.concentrated
    ? `Största innehav ${pack.portfolio.largestHoldingPercent} % av portföljen: en koncentration att nämna.`
    : null
  const callouts: CalloutItem[] = [
    {
      kind: 'observation',
      text: observation
        ? strategyObservationText(observation).observation
        : 'Portföljen ligger inom mandatet; ingen omallokering indikeras av reglerna.',
      ...(observation
        ? { detail: strategyObservationText(observation).whyItMatters }
        : {}),
    },
    ...(concentration ? [{ kind: 'watch-out' as const, text: concentration }] : []),
    ...(pack.provenance.portfolioValuedAt &&
    daysBetween(pack.provenance.portfolioValuedAt, pack.dataAsOf) > 30
      ? [
          {
            kind: 'verify' as const,
            text: `Portföljen värderades senast ${formatLongDate(pack.provenance.portfolioValuedAt)}.`,
          },
        ]
      : []),
  ]
  const blocks: PackBlock[] = [
    {
      kind: 'kpis',
      items: [
        {
          label: 'Portföljvärde',
          value: formatMsek(p.totalValue),
          detail: `värderad ${formatLongDate(p.valuedAt)}`,
          tone: 'gold',
        },
        {
          label: 'Utveckling i år',
          value: formatSignedPct(p.performanceYtdPercent),
          tone: p.performanceYtdPercent >= 0 ? 'positive' : 'negative',
        },
        { label: 'Jämförelseindex', value: p.benchmarkName || DATA_MISSING },
        {
          label: 'Likviditet',
          value: formatMsek(pack.liquidity.amount),
          detail: `${pack.liquidity.shareOfFinancialPercent} % av finansiella tillgångar`,
        },
        {
          label: 'Riskprofil',
          value: formatRiskProfile(s.riskProfile),
          detail: RISK_PROFILE_LABEL[s.riskProfile],
        },
      ],
    },
    {
      kind: 'columns',
      weights: [7, 5],
      columns: [
        [
          {
            kind: 'chart',
            title: 'Allokering mot strategi',
            chart: 'grouped-bar',
            categories: s.rows.map((r) => ASSET_CLASS_LABEL[r.assetClass]),
            series: [
              {
                name: 'Faktisk',
                values: s.rows.map((r) => r.currentPercent),
                color: DOCUMENT_PALETTE.gold,
              },
              {
                name: 'Strategi',
                values: s.rows.map((r) => r.strategicPercent),
                color: DOCUMENT_PALETTE.blueGrey,
              },
            ],
            unit: '%',
            asOf: p.valuedAt,
            source: 'Portföljen mot det överenskomna mandatet',
            note: 'Strategi = klientens överenskomna allokering',
          },
          { kind: 'callouts', items: callouts.slice(0, 2) },
        ],
        [
          {
            kind: 'table',
            title: 'Största innehav',
            columns: ['Innehav', 'Slag', 'Värde', 'Andel'],
            align: ['left', 'left', 'right', 'right'],
            widths: [3, 1.6, 1.3, 0.9],
            rows: [
              ...holdings.map((h) => holdingRow(h)),
              [
                `Summa ${holdings.length} största`,
                '',
                formatMsek(holdings.reduce((sum, h) => sum + h.marketValue, 0)),
                `${holdings.reduce((sum, h) => sum + h.weightPercent, 0)} %`,
              ],
            ],
            totals: [holdings.length],
          },
          {
            kind: 'table',
            title: 'Avvikelser mot strategi',
            columns: ['Tillgångsslag', 'Faktisk', 'Strategi', 'Avvikelse'],
            align: ['left', 'right', 'right', 'right'],
            widths: [2.2, 1, 1.1, 1.3],
            rows: s.rows.map((r) => [
              ASSET_CLASS_LABEL[r.assetClass],
              `${r.currentPercent} %`,
              `${r.strategicPercent} %`,
              formatPoints(r.deviationPoints),
            ]),
            emphasis: s.rows.flatMap((r, i) => (r.meaningful ? [i] : [])),
            rowTones: s.rows.map((r) => (r.meaningful ? 'warning' : undefined)),
            toneColumn: 3,
            footnote: 'Fet stil: avvikelse utanför den överenskomna toleransen',
          },
        ],
      ],
    },
  ]
  const riskQuestion = pack.advisorQuestions.find((q) => q.kind === 'risk-intention')
  const notes: NoteLine[] = [
    ...s.observations.map<NoteLine>((o) => ({
      kind: 'talking-point',
      text: strategyObservationText(o).discussionPoint,
    })),
    ...(observation
      ? [
          {
            kind: 'why-it-matters' as const,
            text: strategyObservationText(observation).whyItMatters,
          },
        ]
      : [
          {
            kind: 'why-it-matters' as const,
            text: `Portföljen ${formatMsek(p.totalValue)} är ${pack.clientSnapshot.totalAssets > 0 ? Math.round((p.totalValue / pack.clientSnapshot.totalAssets) * 100) : 0} % av den totala förmögenheten; strategin gäller den delen.`,
          },
        ]),
    ...(concentration ? [{ kind: 'watch-out' as const, text: concentration }] : []),
    {
      kind: 'do-not-claim',
      text: 'Inga transaktionsförslag: en avvikelse är en faktisk förändring av den risk klienten sagt ja till; frågan på mötet är om den är avsiktlig.',
    },
    ...(riskQuestion
      ? [{ kind: 'follow-up' as const, text: `”${advisorQuestionText(riskQuestion)}”` }]
      : []),
    sourceNote(pack, [p.id, ...holdings.map((h) => h.id)]),
  ]
  return {
    kicker: 'Portfölj & strategi',
    headline: deviation
      ? `${ASSET_CLASS_LABEL[deviation.assetClass]} ligger ${formatPoints(deviation.points)} mot strategin (${deviation.currentPercent} % mot ${deviation.strategicPercent} %); avsikten bör bekräftas.`
      : `Portföljen ligger inom mandatet; ${pack.liquidity.excess ? `likviditeten ${formatMsek(pack.liquidity.excess.amount)} ligger över behovet` : `likviditeten ${formatMsek(pack.liquidity.amount)} är ${pack.liquidity.shareOfFinancialPercent} % av de finansiella tillgångarna`}.`,
    blocks,
    notes,
    sourceIds: unique([p.id, ...holdings.map((h) => h.id)]),
  }
}

function holdingRow(h: Holding): string[] {
  return [
    h.name,
    ASSET_CLASS_LABEL[h.assetClass],
    formatMsek(h.marketValue),
    `${h.weightPercent} %`,
  ]
}

/* ------------------------------------------------------------- slide 6 */

const FINANCING_PATTERN = /finansier|lån|bolån|brygg|ränt|refinanc|loan|mortgage/iu

function financingLine(item: MeetingPack['financing'][number]): string {
  /* The loan's own name first; an event title already says "förfaller", and the sentence says it once. */
  const label = (item.loan?.title ?? item.event?.title ?? 'Finansieringen').replace(
    /\s+(?:förfaller|läggs om)$/iu,
    '',
  )
  const when = item.daysAhead !== null ? ` om ${item.daysAhead} dagar` : ''
  switch (item.questionKind) {
    case 'maturity-plan':
      return `${label} förfaller${when}`
    case 'flexibility-vs-certainty':
      return `${label} läggs om${when}`
    case 'variable-rate-sensitivity':
      return `${label} löper med rörlig ränta${item.loan ? ` · ${formatMsek(item.loan.outstandingBalance)}` : ''}`
  }
}

function financingSlide(ctx: Ctx): Built {
  const { pack } = ctx
  const first = pack.financing[0]!
  const today = pack.dataAsOf
  const loans = pack.wealth.liabilities
  const promises = pack.commitments.filter(
    (p) => p.bucket !== 'completed-since' && FINANCING_PATTERN.test(p.commitment.title),
  )
  const concerns = pack.clientConcerns.filter((c) =>
    concernTopicsOf(c.statement).includes('rates'),
  )
  const eventOf = (loan: Liability) =>
    pack.financing.find((f) => f.loan?.id === loan.id)?.event ?? null
  const rows = loans.map((l) => {
    const event = eventOf(l)
    return [
      l.title,
      formatMsek(l.outstandingBalance),
      formatPct(l.ratePercent, 2),
      l.interestType === 'fixed' ? 'Bunden' : 'Rörlig',
      event
        ? `${EVENT_LABEL[event.type]} ${formatLongDate(event.occursOn)}`
        : l.maturityDate
          ? formatLongDate(l.maturityDate)
          : '–',
      l.collateralAssetId ? (pack.titles[l.collateralAssetId] ?? '–') : '–',
      l.loanToValuePercent !== undefined ? `${l.loanToValuePercent} %` : DATA_MISSING,
    ]
  })
  const total = loans.reduce((sum, l) => sum + l.outstandingBalance, 0)
  const variable = loans.filter((l) => l.interestType === 'variable')
  rows.push(['Summa', formatMsek(total), '', `${variable.length} rörliga`, '', '', ''])
  const timeline: TimelineItem[] = [
    ...loans
      .filter((l) => l.maturityDate && daysBetween(today, l.maturityDate) >= 0)
      .map<TimelineItem>((l) => {
        const event = eventOf(l)
        const days = daysBetween(today, l.maturityDate!)
        return {
          label: l.title,
          date: l.maturityDate!,
          daysAhead: days,
          detail: `${event ? EVENT_LABEL[event.type] : 'Förfall'} · ${formatMsek(l.outstandingBalance)}`,
          tone: days <= 60 ? 'gold' : 'neutral',
        }
      }),
    ...loans
      .filter((l) => l.nextReviewDate && daysBetween(today, l.nextReviewDate) >= 0)
      .map<TimelineItem>((l) => ({
        label: `Översyn ${l.title}`,
        date: l.nextReviewDate!,
        daysAhead: daysBetween(today, l.nextReviewDate!),
        detail: 'Planerad översyn',
      })),
  ]
    .sort((a, b) => a.daysAhead - b.daysAhead)
    .slice(0, LIMITS.timelineItems)
  const maturingWithinYear = loans
    .filter(
      (l) =>
        l.maturityDate &&
        daysBetween(today, l.maturityDate) <= LIMITS.maturityHorizonDays,
    )
    .reduce((sum, l) => sum + l.outstandingBalance, 0)
  const blocks: PackBlock[] = [
    {
      kind: 'table',
      title: 'Lånestruktur',
      columns: [
        'Lån',
        'Saldo',
        'Ränta',
        'Bindning',
        'Förfall / omläggning',
        'Säkerhet',
        'Belåningsgrad',
      ],
      align: ['left', 'right', 'right', 'left', 'left', 'left', 'right'],
      widths: [2.3, 1.1, 0.9, 1, 2.1, 1.8, 1.1],
      rows,
      totals: [rows.length - 1],
    },
    {
      kind: 'columns',
      weights: [7, 5],
      columns: [
        [
          timeline.length > 0
            ? {
                kind: 'timeline',
                title: 'Förfallostruktur',
                from: today,
                items: timeline,
                asOf: today,
                source: 'Lånens förfall och planerade översyner',
              }
            : {
                kind: 'caption',
                text: 'Inga daterade förfall eller översyner är registrerade.',
              },
        ],
        [
          {
            kind: 'chart',
            title: 'Likviditet mot förfall',
            chart: 'horizontal-bar',
            categories: ['Likvida medel', 'Förfall inom 12 mån', 'Skulder totalt'],
            series: [
              {
                name: 'MSEK',
                values: [
                  msek(pack.liquidity.amount),
                  msek(maturingWithinYear),
                  msek(total),
                ],
                color: DOCUMENT_PALETTE.gold,
              },
            ],
            unit: 'MSEK',
            asOf: today,
            source: 'Likvida medel mot lån som förfaller inom tolv månader',
          },
        ],
      ],
    },
  ]
  const callouts: CalloutItem[] = [
    {
      kind: 'implication',
      text: financingQuestionText(first),
      detail: financingStatusText(first),
    },
    ...(concerns[0]
      ? [
          {
            kind: 'watch-out' as const,
            text: `Klienten har uttryckt: ”${concerns[0].statement}”.`,
            detail: `Registrerad ${formatLongDate(concerns[0].provenance.sourceDate)}.`,
          },
        ]
      : promises[0]
        ? [
            {
              kind: 'watch-out' as const,
              text: `Åtagandet ”${promises[0].commitment.title}” är ${PROMISE_BUCKET_LABEL[promises[0].bucket].toLowerCase()}.`,
              detail: promiseDetail(promises[0]),
            },
          ]
        : []),
  ]
  const rateWarnings = pack.readiness.reasons.filter(
    (r) => r.kind === 'loan-rate-unverified',
  )
  const loanDates = `Uppgifter per ${unique(loans.map((l) => formatLongDate(l.valuedAt))).join(', ')}; räntor verifieras före mötet.`
  if (rateWarnings[0]) {
    /* A rate to verify outranks a known concern in the margin; the concern stays in the notes. */
    callouts.splice(1, 1, {
      kind: 'verify',
      text: readinessReasonText(rateWarnings[0]),
      detail: loanDates,
    })
  } else if (callouts[1]) {
    callouts[1] = {
      ...callouts[1],
      detail: `${callouts[1].detail ? `${callouts[1].detail} ` : ''}${loanDates}`,
    }
  } else {
    callouts.push({ kind: 'verify', text: loanDates })
  }
  blocks.push({ kind: 'callouts', items: callouts.slice(0, 2) })
  for (const f of pack.financing) for (const id of f.sourceIds) ctx.placed.add(id)
  for (const p of promises) ctx.placed.add(p.commitment.id)
  const notes: NoteLine[] = [
    ...(concerns.length > 0
      ? [
          {
            kind: 'talking-point' as const,
            text: 'Klienten har uttryckt oro om finansieringen: inled med finansieringen snarare än med portföljens utveckling.',
          },
        ]
      : []),
    {
      kind: 'talking-point',
      text: `${financingLine(first)}. ${financingStatusText(first)}`,
    },
    {
      kind: 'why-it-matters',
      text: `Likvida medel ${formatMsek(pack.liquidity.amount)} mot ${formatMsek(maturingWithinYear)} som förfaller inom tolv månader; ${variable.length} av ${loans.length} lån löper med rörlig ränta.`,
    },
    ...(promises[0]
      ? [
          {
            kind: 'watch-out' as const,
            text: `Åtagandet ”${promises[0].commitment.title}”: ${promiseDetail(promises[0])}.`,
          },
        ]
      : []),
    {
      kind: 'do-not-claim',
      text: 'Ange ingen ny ränta eller nya villkor förrän aktuell prissättning är verifierad; inga produktrekommendationer.',
    },
    ...rateWarnings.map<NoteLine>((r) => ({
      kind: 'verify',
      text: readinessReasonText(r),
    })),
    { kind: 'follow-up', text: financingQuestionText(first) },
    sourceNote(pack, [
      ...pack.financing.flatMap((f) => f.sourceIds),
      ...loans.map((l) => l.id),
      ...promises.map((p) => p.commitment.id),
      ...concerns.map((c) => c.id),
    ]),
  ]
  return {
    kicker: 'Finansiering & likviditet',
    headline: `${financingLine(first)} och kräver ett tydligt nästa steg.`,
    blocks,
    notes,
    sourceIds: unique([
      ...pack.financing.flatMap((f) => f.sourceIds),
      ...loans.map((l) => l.id),
      ...promises.map((p) => p.commitment.id),
      ...concerns.map((c) => c.id),
    ]),
  }
}

/* ------------------------------------------------------------- slide 7 */

function marketSlide(ctx: Ctx): Built {
  const { pack } = ctx
  const items = pack.marketContext.slice(0, LIMITS.marketItems)
  const first = items[0]!
  const discussion = unique(items.map(marketDiscussionText))
  const blocks: PackBlock[] = [
    {
      kind: 'table',
      title: 'Rörelser sedan senaste mötet',
      columns: ['Vad hände', 'Finansiell relevans', 'Samtalsrelevans', 'Status'],
      widths: [2.6, 1.3, 1.3, 2.8],
      rows: items.map((m) => {
        const lines = marketRelevanceLines(m)
        return [marketHeadline(m), lines.financial, lines.conversation, lines.status]
      }),
      footnote: marketBasisText(first),
    },
    {
      kind: 'callouts',
      items: [
        {
          kind: 'why-it-matters',
          text: cap(relevanceBody(marketRelevanceLines(first).why)),
          detail: marketHeadline(first),
        },
        ...discussion
          .slice(0, 2)
          .map<CalloutItem>((text) => ({ kind: 'implication', text })),
      ],
    },
  ]
  const notes: NoteLine[] = [
    ...items.map<NoteLine>((m) => ({
      kind: 'talking-point',
      text: `${marketHeadline(m)}: status ${marketRelevanceLines(m).status}.`,
    })),
    { kind: 'why-it-matters', text: marketRelevanceLines(first).why },
    {
      kind: 'do-not-claim',
      text: 'Ingen marknadsprognos: rörelsen beskrivs som den registrerats och bedöms mot klientens nuvarande registrerade exponering.',
    },
    ...discussion.map<NoteLine>((text) => ({ kind: 'follow-up', text })),
    sourceNote(
      pack,
      items.flatMap((m) => m.sourceIds),
    ),
  ]
  return {
    kicker: 'Marknadskontext relevant för klienten',
    headline: `${marketHeadline(first)} spelar roll: ${relevanceBody(marketRelevanceLines(first).why)}${items.length > 1 ? `; ${items.length - 1} ${items.length - 1 === 1 ? 'rörelse till' : 'rörelser till'}` : ''}.`,
    blocks,
    notes,
    sourceIds: unique(items.flatMap((m) => m.sourceIds)),
  }
}

/* ------------------------------------------------------------- slide 8 */

function relationshipSlide(ctx: Ctx): Built {
  const { pack } = ctx
  const promises = pack.commitments
    .filter((p) => p.bucket !== 'completed-since')
    .slice(0, LIMITS.promises)
  const concerns = pack.clientConcerns.slice(0, LIMITS.concerns)
  const events = pack.importantEvents
    .filter((e) => !ctx.placed.has(e.id))
    .slice(0, LIMITS.events)
  const goals = pack.goals.slice(0, LIMITS.goalsOnRelationship)
  const family = pack.relationshipContext
    .filter((c) => c.reason === 'family' || c.reason === 'business')
    .slice(0, 3)
  const overdue = promises.filter((p) => p.bucket === 'overdue')
  const behind = pack.goals.filter((g) => g.status === 'at-risk' || g.status === 'behind')
  const promiseTone = (p: PromiseView): Tone | undefined =>
    p.bucket === 'overdue'
      ? 'negative'
      : p.bucket === 'due-before-meeting'
        ? 'gold'
        : undefined
  const blocks: PackBlock[] = [
    {
      kind: 'columns',
      weights: [7, 5],
      columns: [
        [
          {
            kind: 'table',
            title: 'Öppna åtaganden',
            columns: ['Åtagande', 'Lovat', 'Förfaller', 'Status'],
            align: ['left', 'right', 'right', 'left'],
            widths: [3.4, 1.1, 1.1, 1.6],
            rows:
              promises.length === 0
                ? [['Inga öppna åtaganden.', '', '', '']]
                : promises.map((p) => [
                    p.commitment.title,
                    formatDayMonth(p.commitment.createdAt),
                    p.commitment.dueDate ? formatDayMonth(p.commitment.dueDate) : '–',
                    p.bucket === 'overdue' && p.daysToDue !== null
                      ? `Försenat ${Math.abs(p.daysToDue)} dagar`
                      : PROMISE_BUCKET_LABEL[p.bucket],
                  ]),
            rowTones: promises.map(promiseTone),
            toneColumn: 3,
          },
          {
            kind: 'table',
            title: 'Viktiga datum',
            columns: ['Datum', 'Händelse', 'Om'],
            align: ['left', 'left', 'right'],
            widths: [1.3, 3.6, 1.2],
            rows:
              events.length === 0
                ? [['–', 'Inga fler daterade händelser inom 180 dagar.', '']]
                : events.map((e) => [
                    formatLongDate(e.occursOn),
                    e.title === EVENT_LABEL[e.type]
                      ? e.title
                      : `${e.title} · ${EVENT_LABEL[e.type]}`,
                    formatDaysFromToday(e.daysAhead),
                  ]),
          },
        ],
        [
          {
            kind: 'list',
            title: 'Klientens oro',
            items:
              concerns.length === 0
                ? [{ text: 'Ingen aktiv oro registrerad.' }]
                : concerns.map<ListItem>((c) => ({
                    text: `”${c.statement}”`,
                    detail: `registrerad ${formatLongDate(c.provenance.sourceDate)}`,
                  })),
          },
          {
            kind: 'list',
            title: 'Mål',
            items:
              goals.length === 0
                ? [{ text: 'Inga mål registrerade.' }]
                : goals.map(goalItem),
          },
          ...(family.length > 0
            ? [
                {
                  kind: 'list' as const,
                  title: 'Familj & bolag',
                  items: family.map<ListItem>((c) => ({
                    text: c.fact.statement,
                    detail: CONTEXT_REASON_LABEL[c.reason],
                  })),
                },
              ]
            : []),
        ],
      ],
    },
  ]
  const callouts: CalloutItem[] = [
    ...(overdue[0]
      ? [
          {
            kind: 'implication' as const,
            text: `Åtagandet ”${overdue[0].commitment.title}” är försenat: ta det först, innan klienten gör det.`,
          },
        ]
      : []),
    ...(pack.sentinelContext
      ? [
          {
            kind: 'observation' as const,
            text: priorityTitle(pack.sentinelContext),
            detail: whyNow(pack.sentinelContext.priority),
          },
        ]
      : []),
    {
      kind: 'why-it-matters' as const,
      text: `Relationshälsan är ${HEALTH_BAND_LABEL[pack.relationshipHealth.band].toLowerCase()} (${pack.relationshipHealth.score}/100)${behind.length > 0 ? `; ${behind.length} ${behind.length === 1 ? 'mål ligger' : 'mål ligger'} efter plan` : ''}.`,
    },
  ]
  blocks.push({ kind: 'callouts', items: callouts.slice(0, 3) })
  const parts = [
    overdue.length > 0
      ? `${overdue.length} ${overdue.length === 1 ? 'åtagande är försenat' : 'åtaganden är försenade'}`
      : promises.length > 0
        ? `${promises.length} ${promises.length === 1 ? 'åtagande är öppet' : 'åtaganden är öppna'}`
        : null,
    concerns.length > 0
      ? `${concerns.length} ${concerns.length === 1 ? 'oro är obesvarad' : 'orosmoment är obesvarade'}`
      : null,
    behind.length > 0
      ? `${behind.length} ${behind.length === 1 ? 'mål ligger efter plan' : 'mål ligger efter plan'}`
      : null,
  ].filter((p): p is string => p !== null)
  const concernQuestion = pack.advisorQuestions.find((q) => q.kind === 'concern-nature')
  const notes: NoteLine[] = [
    ...overdue.map<NoteLine>((p) => ({
      kind: 'talking-point',
      text: `Åtagandet ”${p.commitment.title}” är försenat: ta det först, innan klienten gör det.`,
    })),
    {
      kind: 'why-it-matters',
      text: `Relationshälsan är ${HEALTH_BAND_LABEL[pack.relationshipHealth.band].toLowerCase()} (${pack.relationshipHealth.score}/100); ${pack.relationshipHealth.drivers.length} ${pack.relationshipHealth.drivers.length === 1 ? 'drivkraft' : 'drivkrafter'} bakom.`,
    },
    ...(concernQuestion
      ? [
          {
            kind: 'follow-up' as const,
            text: `”${advisorQuestionText(concernQuestion)}”`,
          },
        ]
      : []),
    ...(pack.sentinelContext
      ? [{ kind: 'evidence' as const, text: preparation(pack.sentinelContext.priority) }]
      : []),
    sourceNote(pack, [
      ...promises.map((p) => p.commitment.id),
      ...concerns.map((c) => c.id),
      ...events.map((e) => e.id),
      ...goals.map((g) => g.id),
    ]),
  ]
  return {
    kicker: 'Relation & öppna frågor',
    headline:
      parts.length === 0
        ? 'Inga öppna åtaganden eller aktiva orosmoment; relationen är i ordning.'
        : `${cap(parts.join(', '))}.`,
    blocks,
    notes,
    sourceIds: unique([
      ...promises.map((p) => p.commitment.id),
      ...concerns.map((c) => c.id),
      ...events.map((e) => e.id),
      ...goals.map((g) => g.id),
    ]),
  }
}

/* ------------------------------------------------------------- slide 9 */

const CLIENT_QUESTION_TOPIC: Record<ClientQuestion['kind'], string> = {
  fee: 'avgiften',
  'energy-holding': 'energifonden',
  mortgage: 'bolånet',
  'reduce-risk': 'risknivån',
  cash: 'kontanterna',
  proceeds: 'likviden',
  performance: 'portföljens utveckling',
  pension: 'pensionen',
  gifts: 'gåvorna',
}

const ADVISOR_QUESTION_TOPIC: Record<AdvisorQuestion['kind'], string> = {
  'liquidity-intention': 'avsikten med likviditeten',
  'retirement-timeline': 'tidsplanen för pensionen',
  'refinancing-view': 'synen på omläggningen',
  'concern-nature': 'orons karaktär',
  'external-assets': 'tillgångarna utanför banken',
  'proceeds-plan': 'planen för likviden',
  'next-generation': 'nästa generation',
  'goal-priority': 'målets prioritet',
  'risk-intention': 'om risknivån är avsiktlig',
  'valuation-update': 'värderingen',
  general: 'vad som har ändrats',
}

function questionsSlide(ctx: Ctx): Built {
  const { pack } = ctx
  const client = pack.possibleClientQuestions.slice(0, LIMITS.questions)
  const advisor = pack.advisorQuestions.slice(0, LIMITS.questions)
  const risk = pack.risks[0]
  const blocks: PackBlock[] = [
    {
      kind: 'columns',
      weights: [6, 6],
      columns: [
        [
          {
            kind: 'table',
            title: 'Klienten kan fråga',
            columns: ['Fråga', 'Sannolikhet', 'Underlag'],
            widths: [3, 1.5, 2.5],
            rows:
              client.length === 0
                ? [
                    [
                      'Inget i registret pekar på en specifik fråga från klienten.',
                      '',
                      '',
                    ],
                  ]
                : client.map((q) => [
                    `”${clientQuestionText(q)}”`,
                    cap(CONFIDENCE_LABEL_SV[q.confidence]),
                    cap(clientQuestionTriggerText(q, pack.titles)),
                  ]),
          },
        ],
        [
          {
            kind: 'list',
            title: 'Frågor du bör ställa',
            numbered: true,
            items:
              advisor.length === 0
                ? [{ text: 'Inget i registret pekar på en specifik fråga att ställa.' }]
                : advisor.map<ListItem>((q) => ({
                    text: `”${advisorQuestionText(q)}”`,
                    detail: advisorQuestionWhy(q, pack.titles),
                    marker: 'suggestion',
                  })),
          },
        ],
      ],
    },
  ]
  const callouts: CalloutItem[] = [
    ...(client[0]
      ? [
          {
            kind: 'implication' as const,
            text: `Ha svaret på ”${clientQuestionText(client[0])}” klart innan mötet börjar.`,
            detail: cap(clientQuestionTriggerText(client[0], pack.titles)),
          },
        ]
      : []),
    ...(risk ? [{ kind: 'watch-out' as const, text: riskText(risk) }] : []),
  ]
  if (callouts.length > 0) blocks.push({ kind: 'callouts', items: callouts.slice(0, 3) })
  const notes: NoteLine[] = [
    ...(client[0]
      ? [
          {
            kind: 'talking-point' as const,
            text: `Klienten lär fråga om ${CLIENT_QUESTION_TOPIC[client[0].kind]}; ha svaret klart.`,
          },
        ]
      : []),
    ...client.map<NoteLine>((q) => ({
      kind: 'evidence',
      text: `”${clientQuestionText(q)}” · underlag: ${clientQuestionTriggerText(q, pack.titles)}`,
    })),
    ...(risk ? [{ kind: 'watch-out' as const, text: riskText(risk) }] : []),
    ...advisor.map<NoteLine>((q) => ({
      kind: 'follow-up',
      text: `Varför fråga ”${advisorQuestionText(q)}”: ${advisorQuestionWhy(q, pack.titles)}`,
    })),
    sourceNote(pack, [
      ...client.flatMap((q) => q.sourceIds),
      ...advisor.flatMap((q) => q.sourceIds),
    ]),
  ]
  const headline =
    client[0] && advisor[0]
      ? `Klienten lär fråga om ${CLIENT_QUESTION_TOPIC[client[0].kind]}; ställ frågan om ${ADVISOR_QUESTION_TOPIC[advisor[0].kind]}.`
      : client[0]
        ? `Klienten lär fråga om ${CLIENT_QUESTION_TOPIC[client[0].kind]}.`
        : advisor[0]
          ? `Ställ frågan om ${ADVISOR_QUESTION_TOPIC[advisor[0].kind]}.`
          : 'Inget i registret pekar på en specifik fråga.'
  return {
    kicker: 'Frågor & samtalspunkter',
    headline,
    blocks,
    notes,
    sourceIds: unique([
      ...client.flatMap((q) => q.sourceIds),
      ...advisor.flatMap((q) => q.sourceIds),
    ]),
  }
}

/* ------------------------------------------------------------ slide 10 */

function planSlide(ctx: Ctx): Built {
  const { pack } = ctx
  const objectives = pack.meetingObjectives
  const materials = pack.materialsToPrepare.slice(0, LIMITS.materials)
  const outcome = objectives
    .slice(0, 2)
    .map((o) => lowerFirst(objectiveText(o).replace(/\.$/u, '')))
    .join(' och ')
  const blocks: PackBlock[] = [
    {
      kind: 'columns',
      weights: [6, 6],
      columns: [
        [
          {
            kind: 'list',
            title: 'Mål med mötet',
            numbered: true,
            items: objectives.map<ListItem>((o) => ({
              text: objectiveText(o),
              marker: 'suggestion',
            })),
          },
          {
            kind: 'callout',
            title: 'Önskat utfall',
            text: outcome
              ? `${cap(outcome)}.`
              : 'Enas om nästa kontakt och vad som ska vara klart till dess.',
            detail: 'Föreslagna mål; de bekräftas i mötet.',
            tone: 'gold',
          },
        ],
        [
          {
            kind: 'table',
            title: 'Förslag på agenda',
            columns: ['#', 'Punkt', 'Underlag i det här dokumentet'],
            widths: [0.4, 3, 2.6],
            rows: pack.agenda.map((a, i) => [
              String(i + 1),
              agendaLabel(a),
              AGENDA_REFERENCE[a.kind],
            ]),
          },
          ...(materials.length > 0
            ? [
                {
                  kind: 'list' as const,
                  title: 'Förbered material · internt',
                  items: materials.map<ListItem>((m) => ({ text: materialLabel(m) })),
                },
              ]
            : []),
        ],
      ],
    },
  ]
  if (pack.depth === 'executive') {
    blocks.push({
      kind: 'actions',
      rows: pack.nextSteps
        .slice(0, LIMITS.nextStepsOnPlan)
        .map((s) => actionRow(s, pack)),
    })
  }
  const opportunity = pack.opportunities[0]
  const planCallouts: CalloutItem[] = [
    ...(opportunity
      ? [
          {
            kind: 'implication' as const,
            text: opportunityText(opportunity).question,
            detail: `${opportunityText(opportunity).title}: ${opportunityText(opportunity).whyRelevant}`,
          },
        ]
      : []),
    ...(pack.risks[0]
      ? [{ kind: 'watch-out' as const, text: riskText(pack.risks[0]) }]
      : []),
  ]
  if (planCallouts.length > 0) blocks.push({ kind: 'callouts', items: planCallouts })
  const notes: NoteLine[] = [
    {
      kind: 'talking-point',
      text: `Gå in i mötet med en tydlig destination: ${outcome || 'nästa kontakt och vad som ska vara klart till dess'}.`,
    },
    ...pack.risks.map<NoteLine>((r) => ({ kind: 'watch-out', text: riskText(r) })),
    ...pack.opportunities.slice(0, 3).map<NoteLine>((o) => {
      const t = opportunityText(o)
      return { kind: 'follow-up', text: `${t.title}: ${t.whyRelevant} ${t.question}` }
    }),
    sourceNote(pack, [
      ...objectives.flatMap((o) => o.sourceIds),
      ...pack.agenda.flatMap((a) => a.sourceIds),
    ]),
  ]
  return {
    kicker: 'Mötesplan',
    headline: outcome
      ? `Mötet ska ${outcome}.`
      : 'Mötet ska enas om nästa kontakt och vad som ska vara klart till dess.',
    blocks,
    notes,
    sourceIds: unique([
      ...objectives.flatMap((o) => o.sourceIds),
      ...pack.agenda.flatMap((a) => a.sourceIds),
    ]),
  }
}

/** Where in the pack each agenda point's basis sits. */
const AGENDA_REFERENCE: Record<MeetingPack['agenda'][number]['kind'], string> = {
  'follow-up': 'Sedan senaste mötet · Relation & öppna frågor',
  strategy: 'Portfölj & strategi',
  'concern-market': 'Marknadskontext · Relation & öppna frågor',
  financing: 'Finansiering & likviditet',
  liquidity: 'Portfölj & strategi',
  proceeds: 'Finansiering & likviditet',
  opportunities: 'Frågor & samtalspunkter',
  promises: 'Relation & öppna frågor · Nästa steg',
  'next-steps': 'Nästa steg',
}

/* ------------------------------------------------------------ slide 11 */

function nextStepsSlide(ctx: Ctx): Built {
  const { pack } = ctx
  const rows = pack.nextSteps.map((s) => actionRow(s, pack))
  const open = rows.filter((r) => r.status !== STEP_STATUS_LABEL.proposed).length
  return {
    kicker: 'Nästa steg',
    headline: `${open} ${open === 1 ? 'åtagande gäller' : 'åtaganden gäller'} redan; ${rows.length - open} ${rows.length - open === 1 ? 'föreslagen åtgärd bekräftas' : 'föreslagna åtgärder bekräftas'} i mötet.`,
    blocks: [
      { kind: 'actions', rows },
      {
        kind: 'callouts',
        items: [
          {
            kind: 'implication',
            text: 'Föreslagna åtgärder är inte överenskomna förrän mötet har bekräftat dem; öppna åtaganden gäller redan.',
          },
          ...(rows.find((r) => r.tone === 'negative')
            ? [
                {
                  kind: 'watch-out' as const,
                  text: `Försenat: ${rows.find((r) => r.tone === 'negative')!.action}.`,
                },
              ]
            : []),
        ],
      },
    ],
    notes: [
      {
        kind: 'talking-point',
        text: 'Stäng mötet med ägare och datum per åtgärd; inget lämnas odaterat.',
      },
      {
        kind: 'do-not-claim',
        text: 'Presentera inte en föreslagen åtgärd som redan överenskommen.',
      },
      sourceNote(
        pack,
        pack.nextSteps.flatMap((s) => s.sourceIds),
      ),
    ],
    sourceIds: unique(pack.nextSteps.flatMap((s) => s.sourceIds)),
  }
}

function actionRow(step: NextStep, pack: MeetingPack): ActionRow {
  void pack
  const action =
    step.kind === 'commitment'
      ? step.view.commitment.title
      : step.kind === 'objective'
        ? objectiveText(step.objective)
        : materialLabel(step.material)
  return {
    action,
    owner: OWNER_LABEL[step.owner],
    date: step.date ? formatLongDate(step.date) : '–',
    status: STEP_STATUS_LABEL[step.status],
    ...(step.status === 'overdue'
      ? { tone: 'negative' as const }
      : step.status === 'open'
        ? { tone: 'gold' as const }
        : {}),
  }
}

/* ------------------------------------------------------------- appendix */

function appendixHoldings(ctx: Ctx): Built {
  const { pack } = ctx
  const p = pack.portfolio.portfolio
  const holdings = pack.appendix.holdings
  const rows = holdings.map((h) => [
    h.name,
    ASSET_CLASS_LABEL[h.assetClass],
    STRATEGIC_ROLE_LABEL[h.role],
    cap(h.region),
    h.currency,
    formatMsek(h.marketValue),
    `${h.weightPercent} %`,
    formatSignedPct(h.performanceYtdPercent),
  ])
  rows.push([
    'Summa',
    '',
    '',
    '',
    '',
    formatMsek(holdings.reduce((sum, h) => sum + h.marketValue, 0)),
    `${holdings.reduce((sum, h) => sum + h.weightPercent, 0)} %`,
    p ? formatSignedPct(p.performanceYtdPercent) : '',
  ])
  return {
    kicker: 'Bilaga · innehav',
    headline: p
      ? `Innehav per ${formatLongDate(p.valuedAt)} · ${holdings.length} poster · ${formatMsek(p.totalValue)}`
      : 'Innehav',
    blocks: [
      {
        kind: 'table',
        columns: [
          'Innehav',
          'Slag',
          'Roll',
          'Region',
          'Valuta',
          'Värde',
          'Andel',
          'I år',
        ],
        align: ['left', 'left', 'left', 'left', 'left', 'right', 'right', 'right'],
        widths: [2.6, 1.3, 1.3, 1, 0.8, 1.2, 0.8, 0.9],
        rows,
        totals: [rows.length - 1],
        ...(p
          ? {
              footnote: `Källa: ${p.source === 'synthetic' ? 'syntetisk portfölj' : p.source} · jämförelseindex ${p.benchmarkName || DATA_MISSING} · summan avser portföljens utveckling i år`,
            }
          : {}),
      },
    ],
    notes: [
      sourceNote(
        pack,
        holdings.map((h) => h.id),
      ),
    ],
    sourceIds: holdings.map((h) => h.id),
  }
}

function appendixLoans(ctx: Ctx): Built {
  const { pack } = ctx
  const loans = pack.appendix.loans
  const rows = loans.map((l) => [
    l.title,
    LIABILITY_KIND_LABEL[l.kind],
    formatMsek(l.outstandingBalance),
    formatPct(l.ratePercent, 2),
    l.interestType === 'fixed' ? 'Bunden' : 'Rörlig',
    l.maturityDate ? formatLongDate(l.maturityDate) : '–',
    l.loanToValuePercent !== undefined ? `${l.loanToValuePercent} %` : DATA_MISSING,
    l.nextReviewDate ? formatLongDate(l.nextReviewDate) : '–',
  ])
  rows.push([
    'Summa',
    '',
    formatMsek(pack.wealth.totalLiabilities),
    '',
    `${loans.filter((l) => l.interestType === 'variable').length} rörliga`,
    '',
    '',
    '',
  ])
  return {
    kicker: 'Bilaga · lån',
    headline: `${loans.length} ${loans.length === 1 ? 'lån' : 'lån'} · ${formatMsek(pack.wealth.totalLiabilities)} i skulder`,
    blocks: [
      {
        kind: 'table',
        columns: [
          'Lån',
          'Typ',
          'Saldo',
          'Ränta',
          'Bindning',
          'Förfall',
          'Belåningsgrad',
          'Nästa översyn',
        ],
        align: ['left', 'left', 'right', 'right', 'left', 'left', 'right', 'left'],
        widths: [2.4, 1.4, 1.2, 0.8, 0.9, 1.2, 1, 1.2],
        rows,
        totals: [rows.length - 1],
        footnote: `Uppgifter per ${unique(loans.map((l) => formatLongDate(l.valuedAt))).join(', ')}`,
      },
    ],
    notes: [
      sourceNote(
        pack,
        loans.map((l) => l.id),
      ),
    ],
    sourceIds: loans.map((l) => l.id),
  }
}

function appendixTimeline(ctx: Ctx): Built {
  const { pack } = ctx
  const timeline = pack.appendix.timeline
  return {
    kicker: 'Bilaga · relationstidslinje',
    headline: `De senaste ${timeline.length} kontakterna`,
    blocks: [
      {
        kind: 'table',
        columns: ['Datum', 'Typ', 'Ämne', 'Nyckelpunkt', 'Vikt'],
        widths: [1.1, 1.4, 2.6, 3.2, 0.8],
        rows: timeline.map((i) => [
          formatLongDate(i.date),
          INTERACTION_LABEL[i.type],
          i.title,
          i.keyPoints[0] ?? '–',
          IMPORTANCE_LABEL[i.importance],
        ]),
      },
    ],
    notes: [
      ...timeline.slice(0, 3).flatMap<NoteLine>((i) =>
        i.keyPoints.map((point) => ({
          kind: 'evidence',
          text: `${formatDayMonth(i.date)}: ${point}`,
        })),
      ),
      sourceNote(
        pack,
        timeline.map((i) => i.id),
      ),
    ],
    sourceIds: timeline.map((i) => i.id),
  }
}

function appendixCommitments(ctx: Ctx): Built {
  const { pack } = ctx
  const history = pack.appendix.commitmentHistory
  const open = history.filter((c) => c.status === 'open').length
  return {
    kicker: 'Bilaga · åtagandehistorik',
    headline: `${history.length} ${history.length === 1 ? 'åtagande' : 'åtaganden'} · ${open} ${open === 1 ? 'öppet' : 'öppna'}`,
    blocks: [
      {
        kind: 'table',
        columns: ['Åtagande', 'Lovat', 'Förfaller', 'Status', 'Klart'],
        widths: [3.6, 1.2, 1.2, 1, 1.2],
        rows: history.map((c) => [
          c.title,
          formatLongDate(c.createdAt),
          c.dueDate ? formatLongDate(c.dueDate) : '–',
          COMMITMENT_STATUS_LABEL[c.status],
          c.completedAt ? formatLongDate(c.completedAt) : '–',
        ]),
        rowTones: history.map((c) =>
          c.status === 'open' && c.dueDate && c.dueDate < pack.dataAsOf
            ? 'negative'
            : undefined,
        ),
        toneColumn: 3,
      },
    ],
    notes: [
      sourceNote(
        pack,
        history.map((c) => c.id),
      ),
    ],
    sourceIds: history.map((c) => c.id),
  }
}

function appendixMarket(ctx: Ctx): Built {
  const { pack } = ctx
  const items = pack.appendix.marketEpisodes
  return {
    kicker: 'Bilaga · marknadsepisoder',
    headline: `${items.length} ${items.length === 1 ? 'klientrelevant marknadsepisod' : 'klientrelevanta marknadsepisoder'} i fönstret från ${formatDayMonth(pack.provenance.marketWindowStart)}`,
    blocks: [
      {
        kind: 'table',
        columns: [
          'Episod',
          'Finansiell relevans',
          'Samtalsrelevans',
          'Status',
          'Varför det spelar roll',
        ],
        widths: [2, 1.2, 1.2, 2, 3.4],
        rows: items.map((m) => {
          const lines = marketRelevanceLines(m)
          return [
            marketHeadline(m),
            lines.financial,
            lines.conversation,
            lines.status,
            lines.why,
          ]
        }),
      },
      {
        kind: 'list',
        title: 'Diskussionspunkter',
        items: unique(items.map(marketDiscussionText)).map<ListItem>((text) => ({
          text,
          marker: 'suggestion',
        })),
      },
      { kind: 'caption', text: items[0] ? marketBasisText(items[0]) : '' },
    ],
    notes: [
      sourceNote(
        pack,
        items.flatMap((m) => m.sourceIds),
      ),
    ],
    sourceIds: unique(items.flatMap((m) => m.sourceIds)),
  }
}

function appendixBaseline(ctx: Ctx): Built {
  const { pack } = ctx
  const baseline = pack.appendix.baseline!
  return {
    kicker: 'Bilaga · baslinje',
    headline: `Jämförelsen utgår från baslinjen som fångades vid mötet ${formatLongDate(baseline.meetingDate)}.`,
    blocks: [
      {
        kind: 'meta',
        items: [
          { label: 'Baslinjens möte', value: formatLongDate(baseline.meetingDate) },
          { label: 'Fångad', value: formatLongDate(baseline.capturedAt.slice(0, 10)) },
          {
            label: 'Jämförelsefönster',
            value: `${formatDayMonth(pack.changesSinceLastMeeting.since)} till ${formatDayMonth(pack.dataAsOf)}`,
          },
          {
            label: 'Marknadsfönster från',
            value: formatDayMonth(pack.provenance.marketWindowStart),
          },
        ],
      },
      ...(pack.appendix.gaps.length > 0
        ? [
            {
              kind: 'list' as const,
              title: 'Vad som inte kunde jämföras',
              items: pack.appendix.gaps.map<ListItem>((g) => ({
                text: comparisonGapText(g),
              })),
            },
          ]
        : []),
      {
        kind: 'caption',
        text: 'Baslinjen är klientens strukturerade läge när mötet stängdes: balansräkning, portfölj och allokering, lån, mål, relationshälsa samt vad som var öppet, kommande och oroande.',
      },
    ],
    notes: [sourceNote(pack, [])],
    sourceIds: [],
  }
}

function appendixDataQuality(ctx: Ctx): Built {
  const { pack } = ctx
  const items = pack.appendix.dataQuality
  return {
    kicker: 'Bilaga · data att verifiera',
    headline: `${items.length} ${items.length === 1 ? 'uppgift' : 'uppgifter'} bör verifieras innan de citeras.`,
    blocks: [
      {
        kind: 'table',
        columns: ['Uppgift', 'Datum', 'Ålder', 'Vad som bör göras'],
        widths: [2.4, 1.2, 0.9, 3.6],
        align: ['left', 'left', 'right', 'left'],
        rows: items.map((d) => [
          d.label ?? dataQualityText(d),
          d.valuedAt ? formatLongDate(d.valuedAt) : '–',
          d.daysOld !== undefined ? `${d.daysOld} dagar` : '–',
          dataQualityText(d),
        ]),
      },
      ...(pack.readiness.reasons.length > 0
        ? [
            {
              kind: 'list' as const,
              title: 'Granskningspunkter för underlaget',
              items: pack.readiness.reasons.map<ListItem>((r) => ({
                text: readinessReasonText(r),
              })),
            },
          ]
        : []),
    ],
    notes: [
      sourceNote(
        pack,
        items.flatMap((d) => d.sourceIds),
      ),
    ],
    sourceIds: unique(items.flatMap((d) => d.sourceIds)),
  }
}

function appendixSources(ctx: Ctx): Built {
  const { pack } = ctx
  return {
    kicker: 'Bilaga · underlag',
    headline: `${pack.sources.length} poster i registret bär underlaget · data per ${formatLongDate(pack.dataAsOf)}`,
    blocks: [
      {
        kind: 'meta',
        items: [
          { label: 'Data per', value: formatLongDate(pack.dataAsOf) },
          {
            label: 'Portfölj värderad',
            value: pack.provenance.portfolioValuedAt
              ? formatLongDate(pack.provenance.portfolioValuedAt)
              : DATA_MISSING,
          },
          {
            label: 'Äldsta värdering',
            value: pack.provenance.oldestValuationAt
              ? formatLongDate(pack.provenance.oldestValuationAt)
              : DATA_MISSING,
          },
          {
            label: 'Marknadsdata',
            value: pack.provenance.marketDataAsOf
              ? formatLongDate(pack.provenance.marketDataAsOf.slice(0, 10))
              : 'Inga rörelser',
          },
          {
            label: 'Baslinje',
            value: pack.provenance.baseline
              ? formatLongDate(pack.provenance.baseline.meetingDate)
              : 'Saknas',
          },
          { label: 'Genererad', value: pack.generatedAt.slice(0, 16).replace('T', ' ') },
        ],
      },
      {
        kind: 'table',
        columns: ['Typ', 'Post', 'Datum'],
        widths: [1.4, 5, 1.4],
        rows: pack.sources.map((s) => [
          SOURCE_TYPE_LABEL[s.type],
          s.label,
          s.date ? formatLongDate(s.date.slice(0, 10)) : '–',
        ]),
        footnote: `Metod ${pack.method} · regler, inte genererad text · syntetiskt register`,
      },
    ],
    notes: [],
    sourceIds: [],
  }
}

/* ----------------------------------------------------------------- helpers */

function promiseDetail(p: PromiseView): string {
  const c = p.commitment
  const when =
    p.bucket === 'overdue' && p.daysToDue !== null
      ? `försenat ${Math.abs(p.daysToDue)} dagar · förföll ${formatLongDate(c.dueDate!)}`
      : c.dueDate
        ? `senast ${formatLongDate(c.dueDate)}`
        : 'inget datum'
  return `${PROMISE_BUCKET_LABEL[p.bucket]} · ${when} · lovat ${formatLongDate(c.createdAt)}`
}

function sourceNote(pack: MeetingPack, ids: readonly string[]): NoteLine {
  const names = unique(ids)
    .map((id) => pack.titles[id])
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
    .slice(0, LIMITS.sourcesPerNote)
  return {
    kind: 'source',
    text:
      names.length === 0
        ? 'Registret som helhet; ingen enskild post.'
        : names.join(' · '),
  }
}

function msek(value: number): number {
  return Math.round((value / 1_000_000) * 10) / 10
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)]
}

function cap(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1)
}

function lowerFirst(text: string): string {
  return text.length === 0 ? text : text[0]!.toLowerCase() + text.slice(1)
}

/**
 * What JARVIS says about the record, in the product's own words.
 *
 * Every typed item becomes one line, composed by the same presentation
 * functions the cockpit, Client 360 and Sentinel already use, so the same
 * fact reads the same everywhere. Facts, assessments and suggestions keep
 * their nature; an empty section says what is absent rather than nothing.
 */

import { daysBetween } from '~/domain/advisory'
import type {
  AdvisoryIntentKind,
  ItemNature,
  JarvisAnswer,
  JarvisItem,
  JarvisSource,
  NoteKind,
  SectionKey,
  SourceType,
} from '~/application/jarvis/answer'
import {
  formatDayMonth,
  formatDaysFromToday,
  formatLongDate,
  formatMsek,
  formatPct,
  formatSignedPct,
} from '~/presentation/advisory/format'
import { nextBestActionText, signalText } from '~/presentation/advisory/intelligenceText'
import {
  episodeCountsText,
  episodeHeadline,
  marketMoveText,
  RELEVANCE_LABEL,
} from '~/presentation/advisory/marketImpactText'
import {
  advisorQuestionText,
  advisorQuestionWhy,
  agendaLabel,
  changeText,
  clientQuestionText,
  CONFIDENCE_LABEL_SV,
  dataQualityText,
  FEW_CHANGES,
  financingQuestionText,
  financingStatusText,
  focusHeadline,
  focusReasonText,
  marketDiscussionText,
  marketHeadline,
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
  whyNow,
} from '~/presentation/advisory/sentinelText'
import {
  CONTEXT_LABEL,
  EVENT_LABEL,
  GOAL_STATUS_LABEL,
  HEALTH_BAND_LABEL,
  INTERACTION_LABEL,
  OPPORTUNITY_STATUS_LABEL,
} from '~/presentation/advisory/text'

/* --------------------------------------------------------------- headline */

export function answerHeadline(answer: JarvisAnswer): string {
  const name = answer.about.label
  const HEAD: Record<AdvisoryIntentKind, string> = {
    CLIENT_SUMMARY: `${name} på 30 sekunder`,
    LAST_INTERACTION: 'Senaste kontakten',
    OPEN_COMMITMENTS: 'Du lovade',
    MEETING_PREP: `Inför mötet med ${name}`,
    CHANGES_SINCE_LAST_MEETING: 'Sedan senaste mötet',
    WHY_PRIORITY: `Varför ${name} är prioriterad`,
    MARKET_RELEVANCE: 'Marknaden och klienten',
    FINANCING: 'Finansiering',
    GOALS: 'Mål',
    OPPORTUNITIES: 'Möjligheter att utforska',
    RISKS: 'Risker och sådant att inte glömma',
    QUESTIONS_TO_ASK: 'Frågor att ställa',
    CLIENT_QUESTIONS: 'Klienten kan fråga',
    KEY_FIGURES: `Nyckeltal · ${name}`,
    OFFICE_PRIORITIES: `${name}: klienter som behöver dig`,
    OFFICE_MEETINGS: `${name}: möten inom sju dagar`,
    OFFICE_OVERDUE: `${name}: försenade åtaganden`,
    OFFICE_OPPORTUNITIES: `${name}: största möjligheterna`,
    DIRECTORY_CALL_TODAY: 'Att ringa i dag',
    DIRECTORY_MEETINGS: 'Möten inom sju dagar',
    DIRECTORY_OVERDUE: 'Försenade åtaganden',
    DIRECTORY_EXTERNAL_ASSETS: 'Störst tillgångar utanför banken',
    SENTINEL_TODAY: 'Behöver dig i dag',
    MARKET_IMPACT_CLIENTS: 'Klienter som berörs',
    GENERAL_CLIENT_QUERY: 'Ur relationsminnet',
  }
  return HEAD[answer.intent]
}

export const SECTION_TITLE: Record<SectionKey, string> = {
  focus: 'Huvudfokus',
  'bring-up': 'Ta upp',
  'since-last': 'Sedan sist',
  promises: 'Du lovade',
  completed: 'Klart sedan sist',
  'questions-to-ask': 'Frågor att ställa',
  'client-may-ask': 'Klienten kan fråga',
  'dont-forget': 'Glöm inte',
  'data-quality': 'Data att verifiera',
  discussed: 'Ni diskuterade',
  'client-expressed': 'Klienten uttryckte',
  'next-step': 'Nästa steg',
  figures: 'Siffror',
  relationship: 'Relationen',
  issue: 'Aktuell fråga',
  upcoming: 'Kommande',
  concerns: 'Oro',
  'why-now': 'Varför nu',
  drivers: 'Underlag',
  preparation: 'Förberedelse',
  market: 'Marknad',
  financing: 'Finansiering',
  goals: 'Mål',
  opportunities: 'Möjligheter',
  risks: 'Risker',
  strategy: 'Strategi',
  clients: 'Klienter',
  meetings: 'Möten',
  overdue: 'Försenade åtaganden',
  episodes: 'Marknadsepisoder',
  memory: 'Ur relationsminnet',
  agenda: 'Agenda',
  objectives: 'Mål med mötet',
}

export const NATURE_LABEL: Record<ItemNature, string> = {
  fact: 'Fakta',
  assessment: 'Bedömning',
  suggestion: 'Förslag',
}

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  interaction: 'Kontakt',
  commitment: 'Åtagande',
  liability: 'Lån',
  event: 'Händelse',
  portfolio: 'Portfölj',
  holding: 'Innehav',
  'meeting-snapshot': 'Mötesbaslinje',
  context: 'Klientkontext',
  goal: 'Mål',
  opportunity: 'Möjlighet',
  asset: 'Tillgång',
  'sentinel-priority': 'Sentinel-prioritet',
  'market-event': 'Marknadshändelse',
  'relationship-health': 'Relationshälsa',
  client: 'Klient',
}

const NOTE_TEXT: Record<NoteKind, string> = {
  'no-upcoming-meeting': 'Inget möte är bokat.',
  'no-recorded-contact': 'Jag hittar ingen dokumenterad kontakt med klienten.',
  'no-open-commitments': 'Inga öppna åtaganden – allt som lovats är levererat.',
  'few-changes': FEW_CHANGES,
  'no-baseline':
    'Ingen baslinje från ett tidigare möte finns; jämförelsen bygger på det som daterats sedan senaste mötet.',
  'no-market-moves': 'Inga klientrelevanta marknadsrörelser i fönstret.',
  'nothing-documented': 'Jag hittar inget dokumenterat om detta i klienthistoriken.',
  'no-priority':
    'Sentinel prioriterar inte klienten just nu – inget i registret kallar på åtgärd.',
  'no-loans': 'Inga lån är registrerade.',
  'no-goals': 'Inga mål är registrerade.',
  'no-opportunities': 'Inga aktiva möjligheter är registrerade.',
  'no-risks': 'Inga risker att flagga just nu.',
  'no-questions': 'Inga frågor att föreslå utifrån registret.',
  'nobody-needs-attention': 'Ingen klient behöver din uppmärksamhet just nu.',
  'no-meetings-soon': 'Inga möten inom sju dagar.',
  'no-overdue': 'Inga försenade åtaganden.',
  'no-external-assets': 'Inga tillgångar utanför banken är registrerade.',
  'no-affected-clients': 'Ingen klient berörs meningsfullt av dagens rörelser.',
  'not-answerable-here': 'Det kan jag inte svara på härifrån.',
}

const FIGURE_LABEL = {
  'total-wealth': 'Total förmögenhet',
  aum: 'AUM',
  'external-assets': 'Externa tillgångar',
  debt: 'Skulder',
  'net-worth': 'Nettoförmögenhet',
  liquidity: 'Likviditet',
  'property-share': 'Fastighetsexponering',
  'portfolio-value': 'Portföljvärde',
  'portfolio-ytd': 'Portfölj i år',
  'opportunity-value': 'Möjligheter',
} as const

/** A figure older than this is said to be old, not silently treated as current. */
const STALE_DAYS = 180

export interface ItemText {
  text: string
  detail?: string
}

/** One typed item as a line, with its detail where it has one. */
export function itemText(
  item: JarvisItem,
  titles: Readonly<Record<string, string>>,
  today: string,
): ItemText {
  switch (item.kind) {
    case 'note':
      return { text: NOTE_TEXT[item.note] }
    case 'record-text':
      return {
        text: item.text,
        ...(item.date ? { detail: formatLongDate(item.date) } : {}),
      }
    case 'focus':
      return { text: focusHeadline(item.focus) }
    case 'focus-topic':
      return { text: focusReasonText(item.topic) }
    case 'change': {
      const t = changeText(item.change, titles)
      return { text: `${t.label}: ${t.value}` }
    }
    case 'promise': {
      const c = item.view.commitment
      return {
        text: c.title,
        detail: `${PROMISE_BUCKET_LABEL[item.view.bucket]}${c.dueDate ? ` · senast ${formatLongDate(c.dueDate)}` : ''}`,
      }
    }
    case 'commitment': {
      const c = item.commitment
      const when =
        c.status === 'done'
          ? `klart ${c.completedAt ? formatLongDate(c.completedAt) : ''}`
          : item.overdue && item.daysToDue !== null
            ? `försenat ${Math.abs(item.daysToDue)} dagar · förföll ${formatLongDate(c.dueDate!)}`
            : c.dueDate
              ? `senast ${formatLongDate(c.dueDate)}${item.daysToDue !== null ? ` (${formatDaysFromToday(item.daysToDue)})` : ''}`
              : 'inget datum'
      return { text: c.title, detail: `${when} · lovat ${formatLongDate(c.createdAt)}` }
    }
    case 'interaction': {
      const i = item.interaction
      return {
        text: `${formatLongDate(i.date)} · ${INTERACTION_LABEL[i.type]} · ${i.title}`,
        ...(i.noteText
          ? {
              detail:
                i.noteText.length > 240 ? `${i.noteText.slice(0, 237)}…` : i.noteText,
            }
          : {}),
      }
    }
    case 'context-fact':
      return {
        text: item.fact.statement,
        detail: `${CONTEXT_LABEL[item.fact.category]} · ${formatLongDate(item.fact.provenance.sourceDate)}`,
      }
    case 'event':
      return {
        text: `${EVENT_LABEL[item.event.type]}${item.event.title !== EVENT_LABEL[item.event.type] ? ` · ${item.event.title}` : ''}`,
        detail: `${formatLongDate(item.occursOn)} · ${formatDaysFromToday(item.daysAhead)}`,
      }
    case 'liability': {
      const l = item.liability
      return {
        text: `${l.title}: ${formatMsek(l.outstandingBalance)} · ${formatPct(l.ratePercent, 2)} ${l.interestType === 'fixed' ? 'bunden' : 'rörlig'}`,
        detail: l.maturityDate
          ? `Förfaller ${formatLongDate(l.maturityDate)}${item.daysToMaturity !== null ? ` (${formatDaysFromToday(item.daysToMaturity)})` : ''}`
          : 'Ingen förfallodag registrerad',
      }
    }
    case 'signal': {
      const t = signalText(item.signal)
      return { text: t.signal, detail: t.why }
    }
    case 'sentinel-entry':
      return item.nature === 'suggestion'
        ? { text: preparation(item.entry.priority) }
        : { text: priorityTitle(item.entry), detail: whyNow(item.entry.priority) }
    case 'sentinel-driver':
      return { text: driverText(item.driver) }
    case 'market':
      return { text: marketHeadline(item.item), detail: marketDiscussionText(item.item) }
    case 'client-question':
      return {
        text: clientQuestionText(item.question),
        detail: `Möjlig fråga · ${CONFIDENCE_LABEL_SV[item.question.confidence]}`,
      }
    case 'advisor-question':
      return {
        text: advisorQuestionText(item.question),
        detail: advisorQuestionWhy(item.question, titles),
      }
    case 'opportunity': {
      const t = opportunityText(item.opportunity)
      return { text: t.title, detail: `${t.whyRelevant} ${t.question}` }
    }
    case 'opportunity-record': {
      const o = item.opportunity
      return {
        text: `${o.title} · ${formatMsek(o.potentialValue)} · ${OPPORTUNITY_STATUS_LABEL[o.status]}`,
        ...(o.nextAction ? { detail: o.nextAction } : {}),
      }
    }
    case 'risk':
      return { text: riskText(item.risk) }
    case 'data-quality':
      return { text: dataQualityText(item.item) }
    case 'objective':
      return { text: objectiveText(item.objective) }
    case 'agenda':
      return { text: `${item.position}. ${agendaLabel(item.item)}` }
    case 'figure': {
      const label = FIGURE_LABEL[item.figure]
      const value =
        item.figure === 'property-share'
          ? `${item.percent ?? 0} % av tillgångarna (${formatMsek(item.amount)})`
          : item.figure === 'portfolio-ytd'
            ? formatSignedPct(item.percent ?? 0)
            : formatMsek(item.amount)
      const age = item.asOf ? daysBetween(item.asOf, today) : null
      const detail = item.asOf
        ? `värderad ${formatLongDate(item.asOf)}${age !== null && age > STALE_DAYS ? ` · äldre än ${STALE_DAYS} dagar` : ''}`
        : undefined
      return { text: `${label}: ${value}`, ...(detail ? { detail } : {}) }
    }
    case 'health':
      return {
        text: `Relationshälsa ${item.health.score}/100 · ${HEALTH_BAND_LABEL[item.health.band]}`,
        detail:
          item.daysSinceContact === null
            ? 'Ingen kontakt registrerad'
            : `Senaste kontakt ${formatDaysFromToday(-item.daysSinceContact)}`,
      }
    case 'goal':
      return {
        text: `${item.goal.title} · ${GOAL_STATUS_LABEL[item.goal.status]} · ${item.goal.progressPercent} %`,
        ...(item.goal.targetDate
          ? { detail: `mål ${formatLongDate(item.goal.targetDate)}` }
          : {}),
      }
    case 'strategy-observation': {
      const t = strategyObservationText(item.observation)
      return { text: t.observation, detail: t.whyItMatters }
    }
    case 'financing':
      return {
        text: financingStatusText(item.item),
        detail: financingQuestionText(item.item),
      }
    case 'client-row': {
      const r = item.row
      const because = (() => {
        switch (item.because) {
          case 'needs-attention':
            return r.nextBestAction
              ? nextBestActionText(r.nextBestAction)
              : 'Behöver uppmärksamhet'
          case 'meeting-soon':
            return r.nextMeeting
              ? `Möte ${formatDayMonth(r.nextMeeting)} · ${formatDaysFromToday(daysBetween(today, r.nextMeeting))}`
              : ''
          case 'overdue-commitment':
            return r.overdueCommitments === 1
              ? '1 försenat åtagande'
              : `${r.overdueCommitments} försenade åtaganden`
          case 'opportunity':
            return `Möjligheter ${formatMsek(r.opportunityValue)} · ${r.activeOpportunities} aktiva`
          case 'external-assets':
            return `Utanför banken ${formatMsek(r.estimatedWealth - r.aum)} av ${formatMsek(r.estimatedWealth)}`
        }
      })()
      return { text: `${r.displayName} · ${r.officeName}`, detail: because }
    }
    case 'episode':
      return {
        text: episodeHeadline(item.episode),
        detail: episodeCountsText(item.episode),
      }
    case 'affected-client':
      return {
        text: `${item.affected.client.displayName} · ${RELEVANCE_LABEL[item.affected.impact.relevance]}`,
        detail: marketMoveText(item.event),
      }
    case 'memory-hit': {
      const h = item.hit
      const kind =
        h.type === 'interaction'
          ? INTERACTION_LABEL[h.interactionType]
          : h.type === 'context'
            ? CONTEXT_LABEL[h.category]
            : h.type === 'event'
              ? EVENT_LABEL[h.eventType]
              : h.type === 'commitment'
                ? 'Åtagande'
                : h.type === 'goal'
                  ? 'Mål'
                  : h.type === 'holding'
                    ? 'Innehav'
                    : 'Lån'
      return {
        text: h.text,
        detail: `${kind}${h.date ? ` · ${formatLongDate(h.date)}` : ''}`,
      }
    }
  }
}

/** A source as the Underlag list prints it. */
export function sourceText(source: JarvisSource): string {
  return `${SOURCE_TYPE_LABEL[source.type]} · ${source.label}${source.date ? ` · ${formatLongDate(source.date)}` : ''}`
}

/** The whole answer as plain lines — for the transcript bubble, the voice, a test. */
export function answerPlainText(answer: JarvisAnswer): string {
  const lines: string[] = [answerHeadline(answer)]
  for (const section of answer.sections) {
    lines.push(`${SECTION_TITLE[section.key]}:`)
    for (const item of section.items) {
      const t = itemText(item, answer.titles, answer.today)
      lines.push(`- ${t.text}${t.detail ? ` (${t.detail})` : ''}`)
    }
  }
  return lines.join('\n')
}

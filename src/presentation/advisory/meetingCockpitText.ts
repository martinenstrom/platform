/**
 * Meeting Cockpit, as the advisor reads it: the one focus sentence, the
 * thirty-second brief, every change with its numbers, the promises, the
 * strategy observations as observation / why it matters / discussion
 * point, the financing and market questions, the possible client
 * questions and the questions to ask, the opportunities to explore, the
 * safety check, the data to verify, the agenda, the objectives and the
 * materials — in Swedish, once, from the typed cockpit.
 *
 * Nothing here recommends a transaction. A discussion point opens a
 * conversation; a question is a possible question; a material is a
 * checklist item.
 */

import type {
  AdvisorQuestion,
  AgendaItem,
  AssetClass,
  BriefItem,
  ChangeCategory,
  ClientQuestion,
  ConcernTopic,
  ContextReason,
  DataQualityItem,
  FinancingItem,
  FocusTopic,
  MarketContextItem,
  MaterialItem,
  MeetingChange,
  MeetingChanges,
  MeetingFocus,
  ObjectiveItem,
  OpportunityToExplore,
  PromiseBucket,
  RiskItem,
  StrategyObservation,
} from '~/domain/advisory'
import {
  formatDayMonth,
  formatDaysFromToday,
  formatLongDate,
  formatMsek,
  formatPoints,
  formatRiskProfile,
  formatSignedPct,
  yearOf,
} from './format'
import {
  changeStatusText,
  marketMoveText,
  peakMoveText,
  RELEVANCE_OR_NONE_LABEL,
  relevanceText,
} from './marketImpactText'
import {
  ASSET_CLASS_LABEL,
  CHANNEL_LABEL,
  CONTEXT_LABEL,
  EVENT_LABEL,
  GOAL_STATUS_LABEL,
  HEALTH_BAND_LABEL,
  SEGMENT_LABEL,
} from './text'

type Titles = Readonly<Record<string, string>>

const MONTHS = [
  'januari',
  'februari',
  'mars',
  'april',
  'maj',
  'juni',
  'juli',
  'augusti',
  'september',
  'oktober',
  'november',
  'december',
]

function monthOf(iso: string): string {
  return MONTHS[Number(iso.slice(5, 7)) - 1] ?? iso
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const TOPIC_PHRASE: Record<ConcernTopic, string> = {
  energy: 'energiexponeringen',
  rates: 'ränteläget',
  drawdown: 'risknivån',
  fx: 'valutaexponeringen',
  fees: 'avgifterna',
  equities: 'aktieexponeringen',
}

/* ------------------------------------------------------------------- focus */

function topicPhrase(topic: FocusTopic): string {
  switch (topic.kind) {
    case 'strategy-drift':
      return (topic.points ?? 0) > 0
        ? 'den förhöjda aktieexponeringen'
        : 'den låga aktieandelen'
    case 'excess-liquidity':
      return 'överskottslikviditeten'
    case 'concern-with-market':
    case 'concern':
      return `klientens oro kring ${concernPhrase(topic.label)}`
    case 'relationship-risk':
      return 'relationen, som är i riskzonen'
    case 'goal-at-risk':
      return `målet ”${topic.label ?? ''}”`
    case 'next-generation':
      return 'strukturen för nästa generation'
    case 'overdue-promise':
      return `det försenade åtagandet ”${topic.label ?? ''}”`
    case 'liquidity-event':
      return `${(topic.label ?? 'likviditetshändelsen').toLowerCase()}${topic.date ? ` i ${monthOf(topic.date)}` : ''}`
    case 'refinancing':
      return `omläggningen av bolånet${topic.date ? ` i ${monthOf(topic.date)}` : ''}`
    case 'loan-maturity':
      return `förfallet av ${loanName(topic.label).toLowerCase()}${topic.date ? ` i ${monthOf(topic.date)}` : ''}`
    case 'follow-up':
      return 'uppföljningen sedan senaste mötet'
  }
}

/** The loan behind a maturity topic: the event's title says "förfaller" itself, and the sentence says it once. */
function loanName(label: string | undefined): string {
  return (label ?? 'Lånet').replace(/\s+förfaller$/iu, '')
}

function concernPhrase(statement: string | undefined): string {
  if (!statement) return 'det klienten uttryckt'
  const s = statement.toLowerCase()
  if (/energi|olj/u.test(s)) return TOPIC_PHRASE.energy
  if (/ränt|bolån|lån/u.test(s)) return TOPIC_PHRASE.rates
  if (/risk|nedgång|svängning/u.test(s)) return TOPIC_PHRASE.drawdown
  if (/valuta|dollar/u.test(s)) return TOPIC_PHRASE.fx
  if (/avgift/u.test(s)) return TOPIC_PHRASE.fees
  return 'det klienten uttryckt'
}

const FINANCING_KINDS = new Set(['refinancing', 'loan-maturity', 'liquidity-event'])

/** One sentence, one focus: what the meeting is about, with the supporting topics folded in. */
export function focusHeadline(focus: MeetingFocus): string {
  const all = [focus.primary, ...focus.supporting]
  const review = all.filter((t) => !FINANCING_KINDS.has(t.kind)).map(topicPhrase)
  const prepare = all.filter((t) => FINANCING_KINDS.has(t.kind)).map(topicPhrase)
  if (review.length === 0) return `${cap(`förbered ${prepare.join(' och ')}`)}.`
  const head = `Gå igenom ${review.join(' och ')}`
  return prepare.length > 0
    ? `${head} och förbered ${prepare.join(' och ')}.`
    : `${head}.`
}

/** The fact line under the focus: "Aktier 67 % mot strategi 60 %". */
export function focusReasonText(topic: FocusTopic): string {
  switch (topic.kind) {
    case 'strategy-drift':
      return `${ASSET_CLASS_LABEL[topic.assetClass ?? 'equities']} ${topic.currentPercent ?? 0} % mot strategi ${topic.strategicPercent ?? 0} %`
    case 'excess-liquidity':
      return `Likviditet ${formatMsek(topic.amount ?? 0)}`
    case 'refinancing':
      return `Bolåneomläggning om ${topic.daysAhead ?? 0} dagar${topic.amount ? ` · ${formatMsek(topic.amount)}` : ''}`
    case 'loan-maturity':
      return `${loanName(topic.label)} förfaller om ${topic.daysAhead ?? 0} dagar`
    case 'liquidity-event':
      return `${topic.label ?? 'Likviditetshändelse'} ${topic.date ? formatDayMonth(topic.date) : ''}`
    case 'concern-with-market':
      return `Oro: ${topic.label ?? ''} · marknaden har rört sig i ämnet`
    case 'concern':
      return `Oro: ${topic.label ?? ''}`
    case 'relationship-risk':
      return 'Relationshälsa i riskzonen'
    case 'goal-at-risk':
      return `Mål efter plan: ${topic.label ?? ''}`
    case 'next-generation':
      return topic.label ?? 'Nästa generation'
    case 'overdue-promise':
      return `Försenat åtagande: ${topic.label ?? ''}`
    case 'follow-up':
      return 'Uppföljning sedan senaste mötet'
  }
}

/* ------------------------------------------------------------------- brief */

export function briefItemText(item: BriefItem): { label: string; value: string } {
  switch (item.kind) {
    case 'segment':
      return { label: 'Segment', value: SEGMENT_LABEL[item.segment] }
    case 'relationship-since':
      return { label: 'Relation sedan', value: yearOf(item.since) }
    case 'total-wealth':
      return { label: 'Total förmögenhet', value: formatMsek(item.amount) }
    case 'aum':
      return { label: 'AUM', value: formatMsek(item.amount) }
    case 'risk-profile':
      return { label: 'Risk', value: formatRiskProfile(item.profile) }
    case 'primary-goal':
      return { label: 'Primärt mål', value: item.title }
    case 'known-concern':
      return { label: 'Känd oro', value: item.statement }
    case 'channel':
      return { label: 'Kommunikation', value: CHANNEL_LABEL[item.channel] }
    case 'health':
      return {
        label: 'Relationshälsa',
        value: `${HEALTH_BAND_LABEL[item.band]} · ${item.score}`,
      }
  }
}

/* ----------------------------------------------------------------- changes */

export const CHANGE_CATEGORY_LABEL: Record<ChangeCategory, string> = {
  portfolio: 'Portfölj',
  liquidity: 'Likviditet',
  wealth: 'Förmögenhet',
  financing: 'Finansiering',
  goals: 'Mål',
  relationship: 'Relation',
  commitments: 'Åtaganden',
  events: 'Viktiga händelser',
  context: 'Klientkontext',
}

const title = (titles: Titles, id: string) => titles[id] ?? id

const ALLOCATION_LABEL: Record<AssetClass, string> = {
  equities: 'Aktieandel',
  'fixed-income': 'Ränteandel',
  alternatives: 'Alternativa placeringar',
  cash: 'Likviditetsandel',
}

/** "Aktieandel 65 % → 67 %", "Likviditet 5,9 → 6,8 MSEK", "2 skapade · 1 klart · 1 försenat". */
export function changeText(
  change: MeetingChange,
  titles: Titles,
): { label: string; value: string } {
  switch (change.kind) {
    case 'portfolio-value':
      return {
        label: 'Portföljvärde',
        value: `${formatSignedPct(change.percent)} · ${formatMsek(change.before)} → ${formatMsek(change.after)}`,
      }
    case 'allocation':
      return {
        label: ALLOCATION_LABEL[change.assetClass],
        value: `${change.before} % → ${change.after} % (${formatPoints(change.points)} · strategi ${change.strategicPercent} %)`,
      }
    case 'liquidity':
      return {
        label: 'Likviditet',
        value: `${formatMsek(change.before)} → ${formatMsek(change.after)} (${formatSignedPct(change.percent)})`,
      }
    case 'wealth':
      return {
        label: 'Total förmögenhet',
        value: `${formatMsek(change.before)} → ${formatMsek(change.after)} (${formatSignedPct(change.percent)})`,
      }
    case 'loan-new':
      return {
        label: 'Nytt lån',
        value: `${title(titles, change.loanId)} · ${formatMsek(change.balance)}`,
      }
    case 'loan-closed':
      return {
        label: 'Löst lån',
        value: `${title(titles, change.loanId)} · ${formatMsek(change.balance)}`,
      }
    case 'loan-balance':
      return {
        label: title(titles, change.loanId),
        value: `${formatMsek(change.before)} → ${formatMsek(change.after)}`,
      }
    case 'financing-approaching':
      return {
        label: EVENT_LABEL[change.eventType],
        value: `${title(titles, change.eventId)} · om ${change.daysAhead} dagar`,
      }
    case 'goal-status':
      return {
        label: title(titles, change.goalId),
        value: `${GOAL_STATUS_LABEL[change.before]} → ${GOAL_STATUS_LABEL[change.after]}`,
      }
    case 'goal-progress':
      return {
        label: title(titles, change.goalId),
        value: `${change.before} % → ${change.after} %`,
      }
    case 'health':
      return {
        label: 'Relationshälsa',
        value: `${change.before} → ${change.after} (${HEALTH_BAND_LABEL[change.bandBefore].toLowerCase()} → ${HEALTH_BAND_LABEL[change.bandAfter].toLowerCase()})`,
      }
    case 'contacts':
      return {
        label: 'Kontakter',
        value:
          change.interactionIds.length === 1
            ? `1 kontakt: ${title(titles, change.interactionIds[0]!)}`
            : `${change.interactionIds.length} kontakter`,
      }
    case 'commitments': {
      const parts = [
        change.createdIds.length > 0 ? `${change.createdIds.length} skapade` : null,
        change.completedIds.length > 0 ? `${change.completedIds.length} klara` : null,
        change.overdueIds.length > 0 ? `${change.overdueIds.length} försenade` : null,
        `${change.openIds.length} öppna`,
      ].filter((p): p is string => p !== null)
      return { label: 'Åtaganden', value: parts.join(' · ') }
    }
    case 'event-new':
      return {
        label: `Ny händelse · ${EVENT_LABEL[change.eventType]}`,
        value: `${title(titles, change.eventId)} · ${formatDayMonth(change.date)}`,
      }
    case 'concern-new':
      return { label: 'Ny oro', value: change.statement }
    case 'context-new':
      return {
        label: `Nytt · ${CONTEXT_LABEL[change.contextCategory]}`,
        value: change.statement,
      }
  }
}

/** "13 sep → 4 okt", or the window without a baseline. */
export function changesWindowText(changes: MeetingChanges, today: string): string {
  const from = formatDayMonth(changes.since)
  return `${from} → ${formatDayMonth(today)}`
}

export function comparisonGapText(gap: MeetingChanges['gaps'][number]): string {
  switch (gap) {
    case 'no-baseline':
      return 'Ingen baslinje från ett tidigare möte finns. Jämförelsen bygger på vad registret självt daterar: åtaganden, fakta och händelser.'
    case 'no-portfolio-baseline':
      return 'Ingen historisk allokering finns i baslinjen; portföljen kan inte jämföras.'
    case 'no-recorded-meeting':
      return 'Inget tidigare möte finns registrerat. Fönstret är de senaste 30 dagarna.'
  }
}

export const FEW_CHANGES = 'Få väsentliga förändringar sedan senaste mötet.'

/* ---------------------------------------------------------------- promises */

export const PROMISE_BUCKET_LABEL: Record<PromiseBucket, string> = {
  overdue: 'Försenat',
  'due-before-meeting': 'Före mötet',
  later: 'Öppet',
  'completed-since': 'Klart sedan sist',
}

/* ----------------------------------------------------------------- context */

export const CONTEXT_REASON_LABEL: Record<ContextReason, string> = {
  concern: 'Oro',
  objective: 'Mål',
  behaviour: 'Beteende',
  preference: 'Preferens',
  business: 'Bolag',
  family: 'Familj',
  communication: 'Kommunikation',
}

/* ---------------------------------------------------------------- strategy */

export interface ObservationText {
  observation: string
  whyItMatters: string
  discussionPoint: string
}

export function strategyObservationText(o: StrategyObservation): ObservationText {
  switch (o.kind) {
    case 'allocation-deviation': {
      const cls = ASSET_CLASS_LABEL[o.assetClass]
      const over = o.points > 0
      return {
        observation: `${cls} ligger ${over ? 'över' : 'under'} strategisk allokering: ${o.currentPercent} % mot ${o.strategicPercent} % (${formatPoints(o.points)}).`,
        whyItMatters: over
          ? 'Den överenskomna portföljrisken har glidit; portföljen bär mer av tillgångsslaget än mandatet avser.'
          : 'Den överenskomna portföljrisken har glidit; portföljen bär mindre av tillgångsslaget än mandatet avser.',
        discussionPoint: 'Pröva om den nuvarande allokeringen fortfarande är avsiktlig.',
      }
    }
    case 'excess-liquidity':
      return {
        observation: `Likvida medel ${formatMsek(o.amount)}, ${o.sharePercent} % av de finansiella tillgångarna.`,
        whyItMatters: 'Likviditet utöver reserven arbetar inte för klientens mål.',
        discussionPoint:
          'Klargör avsikten med likviditeten – reserv, kommande behov eller placering.',
      }
    case 'goal-behind':
      return {
        observation: `Målet ”${o.title}” ligger efter plan.`,
        whyItMatters:
          'Ett mål efter plan är antingen fel dimensionerat eller kräver en annan väg dit.',
        discussionPoint: 'Bekräfta om målet och tidsplanen fortfarande gäller.',
      }
  }
}

/* --------------------------------------------------------------- financing */

export function financingStatusText(item: FinancingItem): string {
  if (item.discussedDaysAgo === null)
    return 'Ingen finansieringsdiskussion finns registrerad.'
  return `Finansiering diskuterades senast för ${item.discussedDaysAgo} dagar sedan.`
}

export function financingQuestionText(item: FinancingItem): string {
  switch (item.questionKind) {
    case 'flexibility-vs-certainty':
      return 'Har något ändrats i hur du väger flexibilitet mot räntesäkerhet?'
    case 'variable-rate-sensitivity':
      return 'Hur känns den rörliga räntan i dag – finns det ett läge där du vill ha mer förutsägbarhet?'
    case 'maturity-plan':
      return 'Hur ser planen ut för lösen vid förfallet, och behöver något vara klart innan dess?'
  }
}

/* ------------------------------------------------------------------ market */

export function marketDiscussionText(item: MarketContextItem): string {
  switch (item.discussionKind) {
    case 'explain-thesis':
      return 'Var beredd att förklara om den strategiska portföljtesen har ändrats – och varför den inte har det.'
    case 'explain-rates':
      return 'Var beredd att förklara vad ränterörelsen betyder för räntedelen och för finansieringen.'
    case 'explain-holding-role':
      return 'Var beredd att förklara innehavets roll i portföljen, inte bara dess senaste utveckling.'
    case 'explain-currency':
      return 'Var beredd att förklara hur valutarörelsen slår igenom i SEK-termer.'
  }
}

/** The honest basis line for a market item: what the relevance was measured against. */
export function marketBasisText(item: MarketContextItem): string {
  if (item.exposureBasis === 'active') {
    return 'Pågående rörelse, bedömd mot klientens nuvarande registrerade exponering.'
  }
  const baseline = item.baselineAllocation
    ? ` Vid senaste mötet: ${item.baselineAllocation
        .map((a) => `${ASSET_CLASS_LABEL[a.assetClass].toLowerCase()} ${a.percent} %`)
        .join(', ')}.`
    : ''
  return `Rörelsen inträffade sedan senaste mötet och är relevant för klientens nuvarande registrerade exponering – inte ett påstående om exponeringen vid just det tillfället.${baseline}`
}

export function marketHeadline(item: MarketContextItem): string {
  return item.item.status === 'closed'
    ? peakMoveText(item.item.impact.event)
    : marketMoveText(item.item.impact.event)
}

export function marketRelevanceLines(item: MarketContextItem): {
  financial: string
  conversation: string
  why: string
  status: string
} {
  const { impact } = item.item
  return {
    financial: RELEVANCE_OR_NONE_LABEL[impact.financialRelevance],
    conversation: RELEVANCE_OR_NONE_LABEL[impact.conversationRelevance],
    why: relevanceText(impact),
    status: changeStatusText(item.item),
  }
}

/* --------------------------------------------------------------- questions */

export const CONFIDENCE_LABEL_SV: Record<ClientQuestion['confidence'], string> = {
  high: 'sannolik',
  medium: 'möjlig',
}

export function clientQuestionText(q: ClientQuestion): string {
  switch (q.kind) {
    case 'fee':
      return 'Varför betalar jag den här rådgivningsavgiften?'
    case 'energy-holding':
      return 'Varför äger vi fortfarande energifonden?'
    case 'mortgage':
      return 'Vad ska jag göra med bolånet?'
    case 'reduce-risk':
      return 'Ska vi minska risken nu?'
    case 'cash':
      return 'Ska pengarna ligga kvar på kontot?'
    case 'proceeds':
      return 'Vad gör vi med likviden när den kommer?'
    case 'performance':
      return 'Varför har portföljen gått ner?'
    case 'pension':
      return 'Hur ser min pension ut?'
    case 'gifts':
      return 'Hur gör vi med gåvorna till barnen?'
  }
}

export function clientQuestionTriggerText(q: ClientQuestion, titles: Titles): string {
  const parts = q.triggers.map((t) => {
    switch (t.kind) {
      case 'context-fact':
      case 'concern':
      case 'behaviour':
        return `klienten har uttryckt: ”${t.id ? (titles[t.id] ?? t.id) : ''}”`
      case 'health-driver':
        return 'avgiftskänslighet i relationshälsan'
      case 'market-event':
        return `marknadsrörelse: ${t.id ? (titles[t.id] ?? t.id) : ''}`
      case 'holding':
        return `innehav: ${t.id ? (titles[t.id] ?? t.id) : ''}`
      case 'event':
        return `händelse: ${t.id ? (titles[t.id] ?? t.id) : ''}`
      case 'loan':
        return `lån: ${t.id ? (titles[t.id] ?? t.id) : ''}`
      case 'signal':
        return 'överskottslikviditet enligt signalerna'
      case 'change':
        return 'portföljvärdet har fallit sedan senaste mötet'
      case 'goal':
        return `mål: ${t.id ? (titles[t.id] ?? t.id) : ''}`
      case 'commitment':
        return `åtagande: ${t.id ? (titles[t.id] ?? t.id) : ''}`
      case 'portfolio':
        return 'avvikelse från strategisk allokering'
      default:
        return t.kind
    }
  })
  return cap(parts.join(' · '))
}

export function advisorQuestionText(q: AdvisorQuestion): string {
  switch (q.kind) {
    case 'liquidity-intention':
      return 'Du har tidigare velat hålla betydande likviditet tillgänglig. Är det fortfarande avsikten?'
    case 'retirement-timeline':
      return 'Har något ändrats kring tidsplanen för pensionen och inkomstbehovet?'
    case 'refinancing-view':
      return `Hur tänker du kring omläggningen${q.date ? ` i ${monthOf(q.date)}` : ''} i dag?`
    case 'concern-nature':
      return `Du har nämnt oro kring ${q.topic ? TOPIC_PHRASE[q.topic] : 'det vi diskuterade'}. Är oron främst den senaste utvecklingen eller placeringens roll i portföljen?`
    case 'external-assets':
      return 'Finns det något i tillgångarna utanför banken som du vill att vi tar med när vi ser på den totala risken?'
    case 'proceeds-plan':
      return `Hur vill du att vi förbereder oss inför ${(q.label ?? 'likviditetshändelsen').toLowerCase()}${q.date ? ` i ${monthOf(q.date)}` : ''}?`
    case 'next-generation':
      return 'Hur vill du att nästa generation ska involveras i samtalen framöver?'
    case 'goal-priority':
      return `Är målet ”${q.label ?? ''}” fortfarande lika prioriterat, eller har något ändrats?`
    case 'risk-intention':
      return `Aktieandelen ligger ${formatPoints(q.points ?? 0)} mot strategin. Är den nivån avsiktlig?`
    case 'valuation-update':
      return `Har värderingen av ${q.label ?? 'bolaget'} ändrats sedan ${q.date ? formatLongDate(q.date) : 'senaste uppgiften'}?`
    case 'general':
      return 'Är det något i din situation som har ändrats sedan vi sågs senast?'
  }
}

export function advisorQuestionWhy(q: AdvisorQuestion, titles: Titles): string {
  switch (q.kind) {
    case 'liquidity-intention':
      return `Registrerat: ${q.label ?? 'ett likviditetsmål'}.`
    case 'retirement-timeline':
      return `Registrerat: ${q.label ?? 'ett pensionsmål'}.`
    case 'refinancing-view':
      return 'En finansieringshändelse närmar sig; klientens syn avgör vilka alternativ som är relevanta.'
    case 'concern-nature':
      return `Klienten har uttryckt: ”${q.label ?? ''}”. Svaret skiljer på en reaktion och en omprövning.`
    case 'external-assets':
      return `${formatMsek(q.amount ?? 0)} finns registrerat utanför banken; den totala risken kan inte bedömas utan det.`
    case 'proceeds-plan':
      return 'En likviditetshändelse är registrerad; en plan i förväg är bättre än en efteråt.'
    case 'next-generation':
      return `Registrerat: ${q.sourceIds.map((id) => titles[id] ?? id).join(', ')}.`
    case 'goal-priority':
      return 'Målet ligger efter plan enligt senaste bedömningen.'
    case 'risk-intention':
      return 'Avvikelsen är en faktisk förändring av den risk klienten sagt ja till.'
    case 'valuation-update':
      return 'Värderingen är äldre än sex månader; balansräkningen bygger på den.'
    case 'general':
      return 'Inget i registret pekar på en mer specifik fråga.'
  }
}

/* ----------------------------------------------------------- opportunities */

export function opportunityText(o: OpportunityToExplore): {
  title: string
  whyRelevant: string
  question: string
} {
  switch (o.kind) {
    case 'external-assets':
      return {
        title: 'Tillgångar utanför banken',
        whyRelevant: `${formatMsek(o.amount ?? 0)} finns registrerat utanför banken.`,
        question:
          'Finns det något i tillgångarna utanför banken som du vill att vi tar med när vi ser på den totala risken?',
      }
    case 'excess-liquidity':
      return {
        title: 'Överskottslikviditet',
        whyRelevant: `${formatMsek(o.amount ?? 0)} ligger utöver det som behövs som reserv.`,
        question: 'Vad är avsikten med likviditeten det närmaste året?',
      }
    case 'proceeds':
      return {
        title: 'Kommande likvid',
        whyRelevant: `En likviditetshändelse är registrerad${o.date ? ` till ${formatDayMonth(o.date)}` : ''}.`,
        question: 'Hur vill du att likviden hanteras när den kommer?',
      }
    case 'financing':
      return {
        title: 'Finansiering',
        whyRelevant: `En finansieringshändelse närmar sig${o.date ? ` (${formatDayMonth(o.date)})` : ''}${o.amount ? ` · ${formatMsek(o.amount)}` : ''}.`,
        question: 'Vilka villkor är viktigast för dig när vi ser över finansieringen?',
      }
    case 'pension':
      return {
        title: 'Pension',
        whyRelevant: 'Pensionen är ett registrerat mål eller behov.',
        question: 'Vill du att vi tar med hela pensionsbilden i nästa genomgång?',
      }
    case 'family-wealth':
      return {
        title: 'Familjens förmögenhet',
        whyRelevant: 'Överföring till nästa generation finns som mål.',
        question: 'Hur vill du att vi hjälper till med planen för familjen?',
      }
    case 'next-generation':
      return {
        title: 'Nästa generation',
        whyRelevant:
          'Relationen med nästa generation är registrerad som ett öppet samtal.',
        question:
          'Skulle det passa att bjuda in nästa generation till ett kommande möte?',
      }
  }
}

/* ------------------------------------------------------------------- risks */

export function riskText(r: RiskItem): string {
  switch (r.kind) {
    case 'overdue-promise':
      return `Försenat åtagande: ”${r.label ?? ''}”${r.daysOld !== undefined ? ` – ${r.daysOld} dagar sedan förfall` : ''}.`
    case 'complaint':
      return `Klagomål registrerat${r.date ? ` ${formatLongDate(r.date)}` : ''}: ${r.label ?? ''}.`
    case 'fee-sensitivity':
      return `Avgiftskänslig klient${r.label ? `: ”${r.label}”` : ''}. Var beredd på frågan.`
    case 'family-event':
      return `${r.label ?? 'Familjehändelse'} ${r.daysAhead !== undefined ? formatDaysFromToday(r.daysAhead) : ''}.`
    case 'stale-valuation':
      return `Värderingen av ${r.label ?? 'bolaget'} är ${r.daysOld ?? ''} dagar gammal.`
    case 'missing-data':
      return r.label === 'no-portfolio'
        ? 'Ingen portfölj hos banken är registrerad.'
        : 'Inget aktuellt pensionsvärde är registrerat.'
  }
}

/* ------------------------------------------------------------ data quality */

export function dataQualityText(d: DataQualityItem): string {
  switch (d.kind) {
    case 'stale-valuation':
      return `${d.label ?? 'Värdering'}: ${d.daysOld ?? ''} dagar gammal (${d.valuedAt ? formatLongDate(d.valuedAt) : ''}).`
    case 'external-not-updated':
      return `${d.label ?? 'Extern tillgång'}: inte uppdaterad sedan ${d.valuedAt ? formatLongDate(d.valuedAt) : ''}.`
    case 'pension-unknown':
      return 'Inget aktuellt pensionsvärde är registrerat.'
    case 'portfolio-stale':
      return `Portföljen värderades senast ${d.valuedAt ? formatLongDate(d.valuedAt) : ''}.`
    case 'no-portfolio':
      return 'Ingen portfölj hos banken är registrerad.'
  }
}

/* --------------------------------------------- agenda, objectives, materials */

export function agendaLabel(item: AgendaItem): string {
  switch (item.kind) {
    case 'follow-up':
      return 'Uppföljning sedan senaste mötet'
    case 'strategy':
      return 'Portfölj och strategisk allokering'
    case 'concern-market':
      return item.label
        ? `Klientens oro och marknadsutvecklingen`
        : 'Marknadsutvecklingen'
    case 'financing':
      return item.label ?? 'Finansiering'
    case 'liquidity':
      return 'Överskottslikviditet'
    case 'proceeds':
      return item.label ?? 'Kommande likvid'
    case 'promises':
      return 'Öppna åtaganden'
    case 'opportunities':
      return 'Möjligheter att utforska'
    case 'next-steps':
      return 'Nästa steg'
  }
}

export function objectiveText(o: ObjectiveItem): string {
  switch (o.kind) {
    case 'confirm-risk':
      return 'Bekräfta om den nuvarande strategiska risken fortfarande är lämplig.'
    case 'clarify-liquidity':
      return 'Klargöra avsikten med överskottslikviditeten.'
    case 'agree-refinancing-step':
      return 'Enas om nästa steg för finansieringen.'
    case 'close-commitment':
      return `Stänga åtagandet ”${o.label ?? ''}”.`
    case 'address-concern':
      return 'Bemöta den oro klienten uttryckt, med underlag.'
    case 'plan-proceeds':
      return `Lägga en plan för ${(o.label ?? 'likviditetshändelsen').toLowerCase()}.`
    case 'confirm-goal':
      return `Bekräfta om målet ”${o.label ?? ''}” fortfarande gäller.`
    case 'agree-next-step':
      return 'Enas om nästa kontakt och vad som ska vara klart till dess.'
  }
}

export function materialLabel(m: MaterialItem): string {
  switch (m.kind) {
    case 'portfolio-comparison':
      return m.label ? `Portföljjämförelse: ${m.label}` : 'Portföljjämförelse'
    case 'mortgage-alternatives':
      return 'Alternativ för bolånet'
    case 'cash-deployment-illustration':
      return 'Illustration av placering av likviditet'
    case 'pension-overview':
      return 'Pensionsöversikt'
    case 'valuation-request':
      return `Begäran om uppdaterad värdering${m.label ? `: ${m.label}` : ''}`
    case 'fee-overview':
      return 'Avgiftsöversikt'
    case 'financing-proposal':
      return 'Finansieringsförslag'
    case 'family-structure-outline':
      return 'Skiss på familjestruktur'
  }
}

/** A source id as a name, where the cockpit knows one. */
export function sourceName(id: string, titles: Titles): string {
  return titles[id] ?? id
}

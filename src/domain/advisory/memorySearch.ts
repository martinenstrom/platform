/**
 * Asking about a client, answered from the relationship's structured memory.
 *
 * Phase 1 is a deterministic reader: a question is classified by lexicon
 * into what it asks for — promises, worries, a topic, a date, what changed
 * — and answered with the records themselves, each with its date and id.
 * A semantic or vector search can later replace the classifier and the
 * ranking behind the same `MemoryAnswer` shape; the answer stays a set of
 * dated records, never a sentence nobody wrote.
 */

import { daysBetween } from './dates'
import type { Goal } from './goals'
import type { Holding } from './portfolio'
import type { Commitment, ContextFact, ImportantEvent, Interaction } from './relationship'
import type { Liability } from './wealth'

export interface ClientMemory {
  /** Newest first. */
  interactions: readonly Interaction[]
  contextFacts: readonly ContextFact[]
  commitments: readonly Commitment[]
  events: readonly ImportantEvent[]
  goals: readonly Goal[]
  holdings: readonly Holding[]
  liabilities: readonly Liability[]
  today: string
}

export type MemoryAnswerKind =
  | 'commitments'
  | 'concerns'
  | 'topic'
  | 'loan-maturity'
  | 'birthday'
  | 'next-meeting'
  | 'changes-since-last-meeting'
  | 'holdings'
  | 'goals'
  | 'last-contact'
  | 'unknown'

export type MemoryHit =
  | {
      type: 'interaction'
      id: string
      date: string
      text: string
      interactionType: Interaction['type']
    }
  | {
      type: 'context'
      id: string
      date: string
      text: string
      category: ContextFact['category']
    }
  | {
      type: 'commitment'
      id: string
      date: string | null
      text: string
      status: Commitment['status']
    }
  | {
      type: 'event'
      id: string
      date: string
      text: string
      eventType: ImportantEvent['type']
    }
  | { type: 'holding'; id: string; date: null; text: string; value: number }
  | {
      type: 'goal'
      id: string
      date: string | null
      text: string
      status: Goal['status']
    }
  | { type: 'liability'; id: string; date: string | null; text: string; value: number }

export interface MemoryAnswer {
  kind: MemoryAnswerKind
  /** The topic the question was read as asking about, where one was found. */
  topic: string | null
  hits: readonly MemoryHit[]
  method: 'lexicon-v1'
}

const TOPIC_WORDS: readonly { topic: string; pattern: RegExp }[] = [
  { topic: 'avgifter', pattern: /\b(avgift\w*|fee|fees|kostnad\w*|courtage)\b/i },
  { topic: 'energi', pattern: /\b(energi\w*|energy|olj\w*|oil)\b/i },
  { topic: 'pension', pattern: /\b(pension\w*|retire\w*)\b/i },
  {
    topic: 'fastighet',
    pattern: /\b(fastighet\w*|bostad\w*|hus\w*|lägenhet\w*|property|house)\b/i,
  },
  {
    topic: 'likviditet',
    pattern: /\b(likviditet\w*|kassa\w*|kontant\w*|liquidity|cash)\b/i,
  },
  { topic: 'risk', pattern: /\b(risk\w*|volatil\w*|nedgång\w*|drawdown\w*)\b/i },
  {
    topic: 'bolån',
    pattern: /\b(bolån\w*|lån\w*|finansiering\w*|mortgage|loan\w*|financing)\b/i,
  },
  { topic: 'bolaget', pattern: /\b(bolag\w*|företag\w*|company|business)\b/i },
  {
    topic: 'familj',
    pattern: /\b(familj\w*|barn\w*|dotter\w*|son\w*|fru\w*|hustru\w*|family|children)\b/i,
  },
  {
    topic: 'allokering',
    pattern: /\b(allokering\w*|fördelning\w*|aktieandel\w*|allocation)\b/i,
  },
]

function topicOf(question: string): { topic: string; pattern: RegExp } | null {
  return TOPIC_WORDS.find((entry) => entry.pattern.test(question)) ?? null
}

function interactionHit(i: Interaction): MemoryHit {
  return {
    type: 'interaction',
    id: i.id,
    date: i.date,
    text: i.noteText,
    interactionType: i.type,
  }
}

function contextHit(f: ContextFact): MemoryHit {
  return {
    type: 'context',
    id: f.id,
    date: f.provenance.sourceDate,
    text: f.statement,
    category: f.category,
  }
}

export function searchClientMemory(question: string, memory: ClientMemory): MemoryAnswer {
  const q = question.toLowerCase()
  const answer = (
    kind: MemoryAnswerKind,
    hits: readonly MemoryHit[],
    topic: string | null = null,
  ): MemoryAnswer => ({ kind, topic, hits, method: 'lexicon-v1' })

  if (/\b(lovat|lovade|löfte\w*|promis\w*|commitment\w*|åtagande\w*)\b/.test(q)) {
    return answer(
      'commitments',
      memory.commitments
        .filter((c) => c.status === 'open')
        .map((c) => ({
          type: 'commitment' as const,
          id: c.id,
          date: c.dueDate,
          text: c.title,
          status: c.status,
        })),
    )
  }
  if (/\b(orolig|oro|bekymr\w*|worri\w*|concern\w*)\b/.test(q)) {
    const concerns = memory.contextFacts
      .filter((f) => f.category === 'concern')
      .map(contextHit)
    const mentions = memory.interactions
      .filter((i) => /orolig|oro|bekymr|worri|concern/i.test(i.noteText))
      .map(interactionHit)
    return answer('concerns', [...concerns, ...mentions])
  }
  if (
    /\b(bolån\w*|lån\w*|mortgage|loan\w*)\b/.test(q) &&
    /\b(förfall\w*|löper ut|omsätt\w*|när|matur\w*|when|refinanc\w*)\b/.test(q)
  ) {
    const events = memory.events
      .filter(
        (e) =>
          (e.type === 'mortgage-refinancing' || e.type === 'loan-maturity') &&
          e.status === 'upcoming',
      )
      .map((e) => ({
        type: 'event' as const,
        id: e.id,
        date: e.date,
        text: e.title,
        eventType: e.type,
      }))
    const loans = memory.liabilities.map((l) => ({
      type: 'liability' as const,
      id: l.id,
      date: l.maturityDate,
      text: l.title,
      value: l.outstandingBalance,
    }))
    return answer('loan-maturity', [...events, ...loans])
  }
  if (/\b(födelsedag\w*|birthday|fyller)\b/.test(q)) {
    return answer(
      'birthday',
      memory.events
        .filter((e) => e.type === 'birthday')
        .map((e) => ({
          type: 'event' as const,
          id: e.id,
          date: e.date,
          text: e.title,
          eventType: e.type,
        })),
    )
  }
  if (/\b(nästa möte|next meeting|när ses vi|när träffas vi)\b/.test(q)) {
    return answer(
      'next-meeting',
      memory.events
        .filter((e) => e.type === 'client-meeting' && e.status === 'upcoming')
        .map((e) => ({
          type: 'event' as const,
          id: e.id,
          date: e.date,
          text: e.title,
          eventType: e.type,
        })),
    )
  }
  if (
    /\b(sedan (förra|senaste|sist)|ändrat|förändrat|hänt sedan|since (the |our )?(last|previous)|changed|what happened)\b/.test(
      q,
    )
  ) {
    const meeting = memory.interactions.find((i) => i.type === 'meeting')
    const since = meeting
      ? memory.interactions.filter(
          (i) => i.id !== meeting.id && daysBetween(meeting.date, i.date) > 0,
        )
      : memory.interactions.slice(0, 5)
    const facts = memory.contextFacts
      .filter((f) => meeting && daysBetween(meeting.date, f.provenance.sourceDate) > 0)
      .map(contextHit)
    const commitments = memory.commitments
      .filter((c) => meeting && daysBetween(meeting.date, c.createdAt) > 0)
      .map((c) => ({
        type: 'commitment' as const,
        id: c.id,
        date: c.dueDate,
        text: c.title,
        status: c.status,
      }))
    return answer('changes-since-last-meeting', [
      ...since.map(interactionHit),
      ...facts,
      ...commitments,
    ])
  }
  if (/\b(innehav|produkter|äger|holds?|holdings|products|invested in)\b/.test(q)) {
    return answer(
      'holdings',
      [...memory.holdings]
        .sort((a, b) => b.marketValue - a.marketValue || (a.id < b.id ? -1 : 1))
        .map((h) => ({
          type: 'holding' as const,
          id: h.id,
          date: null,
          text: h.name,
          value: h.marketValue,
        })),
    )
  }
  if (/\b(mål|goal\w*|siktar|planerar|objective\w*)\b/.test(q)) {
    return answer(
      'goals',
      memory.goals.map((g) => ({
        type: 'goal' as const,
        id: g.id,
        date: g.targetDate,
        text: g.title,
        status: g.status,
      })),
    )
  }
  if (
    /\b(senast(e)? (kontakt|samtal|möte)|last (contact|call|meeting|spoke)|när pratade)\b/.test(
      q,
    )
  ) {
    return answer('last-contact', memory.interactions.slice(0, 3).map(interactionHit))
  }
  const topic = topicOf(q)
  if (topic) {
    const hits: MemoryHit[] = [
      ...memory.interactions
        .filter(
          (i) =>
            topic.pattern.test(i.noteText) ||
            i.keyPoints.some((p) => topic.pattern.test(p)),
        )
        .map(interactionHit),
      ...memory.contextFacts
        .filter((f) => topic.pattern.test(f.statement))
        .map(contextHit),
      ...memory.commitments
        .filter((c) => topic.pattern.test(c.title))
        .map((c) => ({
          type: 'commitment' as const,
          id: c.id,
          date: c.dueDate,
          text: c.title,
          status: c.status,
        })),
    ]
    return answer('topic', hits, topic.topic)
  }
  /* Nothing recognised: the most recent record, said as such. */
  return answer('unknown', memory.interactions.slice(0, 3).map(interactionHit))
}

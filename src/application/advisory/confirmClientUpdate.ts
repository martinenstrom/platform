/**
 * The advisor's word turns a candidate into relationship memory.
 *
 * One interaction is always created — the note is the advisor's own and is
 * never lost, whatever JARVIS made of it. Every other item becomes a record
 * only when the advisor confirmed it, with the title the advisor left it
 * with, and every record carries its provenance: the interaction, the words
 * it rests on, the confidence JARVIS gave it, and the confirmation.
 *
 * An item the advisor did not decide on is discarded. Silence is not
 * confirmation.
 */

import {
  dateOf,
  isIsoDate,
  type Commitment,
  type ContextFact,
  type EventType,
  type ExtractedItem,
  type ImportantEvent,
  type Interaction,
  type Provenance,
  type ReminderRule,
} from '~/domain/advisory'
import { captureMeetingSnapshot } from './meetingCockpit'
import type { AdvisoryContext } from './ports'

export interface ItemDecision {
  itemId: string
  decision: 'confirm' | 'discard'
  /** The advisor's edit of the proposed statement, where one was made. */
  title?: string
  /** The advisor's edit of the date, where one was made. `null` clears it. */
  date?: string | null
}

export interface ConfirmClientUpdateInput {
  candidateId: string
  decisions: readonly ItemDecision[]
}

export interface ConfirmedRecords {
  contextFacts: number
  commitments: number
  events: number
  /** Open promises the note closed, and active concerns it resolved — the record moved, nothing was added. */
  completedCommitments: number
  easedConcerns: number
}

export type ConfirmClientUpdateResult =
  | { ok: true; interactionId: string; created: ConfirmedRecords }
  | {
      ok: false
      code: 'NOT_FOUND' | 'ALREADY_RESOLVED' | 'UNKNOWN_ITEM' | 'INVALID_DATE'
    }
  | { ok: false; code: 'EVENT_NEEDS_DATE'; itemId: string }

/** Default reminders per event type — the rules the spec names, stated once. */
const DEFAULT_REMINDERS: Partial<Record<EventType, readonly ReminderRule[]>> = {
  'loan-maturity': [{ daysBefore: 30 }],
  'mortgage-refinancing': [{ daysBefore: 30 }],
  'annual-review': [{ daysBefore: 14 }],
  'client-meeting': [{ daysBefore: 7 }],
  birthday: [{ daysBefore: 3 }],
}

export async function confirmClientUpdate(
  context: AdvisoryContext,
  input: ConfirmClientUpdateInput,
): Promise<ConfirmClientUpdateResult> {
  const { repositories } = context
  const candidate = await repositories.interactions.candidateById(input.candidateId)
  if (!candidate) return { ok: false, code: 'NOT_FOUND' }
  if (candidate.status !== 'pending') return { ok: false, code: 'ALREADY_RESOLVED' }

  const byId = new Map(candidate.items.map((item) => [item.id, item]))
  for (const decision of input.decisions) {
    if (!byId.has(decision.itemId)) return { ok: false, code: 'UNKNOWN_ITEM' }
    if (decision.date && !isIsoDate(decision.date))
      return { ok: false, code: 'INVALID_DATE' }
  }

  /** The item as the advisor left it, or null when discarded or undecided. */
  const confirmed = (item: ExtractedItem): ExtractedItem | null => {
    const decision = input.decisions.find((d) => d.itemId === item.id)
    if (!decision || decision.decision !== 'confirm') return null
    return {
      ...item,
      title: decision.title?.trim() ? decision.title.trim() : item.title,
      date: decision.date === undefined ? item.date : decision.date,
    }
  }
  const confirmedItems = candidate.items
    .map(confirmed)
    .filter((item): item is ExtractedItem => item !== null)

  for (const item of confirmedItems) {
    if (
      (item.kind === 'important-event' || item.kind === 'next-meeting') &&
      item.date === null
    ) {
      return { ok: false, code: 'EVENT_NEEDS_DATE', itemId: item.id }
    }
  }

  const now = context.clock.isoNow()
  const interactionId = await repositories.ids.mint('interaction')
  const provenanceOf = (item: ExtractedItem): Provenance => ({
    origin: 'jarvis-extraction',
    sourceInteractionId: interactionId,
    sourceText: item.sourceText,
    sourceDate: candidate.interactionDate,
    createdAt: now,
    createdBy: candidate.advisorId,
    confidence: item.confidence,
    confirmedByAdvisor: true,
    confirmedAt: now,
  })

  const interactionItem = confirmedItems.find((item) => item.kind === 'interaction')
  const topicsItem = confirmedItems.find((item) => item.kind === 'discussion-topics')
  const interaction: Interaction = {
    id: interactionId,
    clientId: candidate.clientId,
    type: interactionItem?.interactionType ?? candidate.interactionType,
    date: candidate.interactionDate,
    advisorId: candidate.advisorId,
    source: candidate.source,
    importance: candidate.importance,
    title: interactionItem?.title ?? firstSentence(candidate.noteText),
    noteText: candidate.noteText,
    topics: topicsItem?.topics ?? [],
    keyPoints: confirmedItems
      .filter((item) => item.kind === 'key-point')
      .map((item) => item.title),
    provenance: {
      origin: 'advisor',
      sourceInteractionId: null,
      sourceText: null,
      sourceDate: candidate.interactionDate,
      createdAt: now,
      createdBy: candidate.advisorId,
      confidence: 'high',
      confirmedByAdvisor: true,
      confirmedAt: now,
    },
  }
  await repositories.interactions.addInteraction(interaction)

  const created: ConfirmedRecords = {
    contextFacts: 0,
    commitments: 0,
    events: 0,
    completedCommitments: 0,
    easedConcerns: 0,
  }
  for (const item of confirmedItems) {
    switch (item.kind) {
      /* A promise the note says was kept: closed on the day of the conversation, its provenance untouched. */
      case 'commitment-completed': {
        if (!item.commitmentId) break
        const commitment = await repositories.commitments.commitmentById(item.commitmentId)
        if (!commitment || commitment.status !== 'open') break
        await repositories.commitments.saveCommitment({
          ...commitment,
          status: 'done',
          completedAt: candidate.interactionDate,
        })
        created.completedCommitments += 1
        break
      }
      /* A concern the note says has eased: resolved on that day; the voiced concern stays in the record as history. */
      case 'concern-eased': {
        if (!item.contextFactId) break
        const facts = await repositories.context.factsOf(candidate.clientId)
        const fact = facts.find((f) => f.id === item.contextFactId)
        if (!fact || fact.status !== 'active') break
        await repositories.context.saveFact({
          ...fact,
          status: 'resolved',
          statusAt: candidate.interactionDate,
        })
        created.easedConcerns += 1
        break
      }
      case 'concern':
      case 'preference':
      case 'objective':
      case 'family':
      case 'business': {
        const fact: ContextFact = {
          id: await repositories.ids.mint('fact'),
          clientId: candidate.clientId,
          category: item.contextCategory ?? 'behaviour',
          statement: item.title,
          status: 'active',
          statusAt: candidate.interactionDate,
          provenance: provenanceOf(item),
        }
        await repositories.context.addFact(fact)
        created.contextFacts += 1
        break
      }
      case 'commitment': {
        const commitment: Commitment = {
          id: await repositories.ids.mint('commitment'),
          clientId: candidate.clientId,
          title: item.title,
          createdAt: candidate.interactionDate,
          dueDate: item.date,
          status: 'open',
          priority: item.priority ?? 'medium',
          ownerAdvisorId: candidate.advisorId,
          completedAt: null,
          provenance: provenanceOf(item),
        }
        await repositories.commitments.addCommitment(commitment)
        created.commitments += 1
        break
      }
      case 'important-event':
      case 'next-meeting': {
        const type: EventType =
          item.kind === 'next-meeting' ? 'client-meeting' : (item.eventType ?? 'custom')
        const event: ImportantEvent = {
          id: await repositories.ids.mint('event'),
          clientId: candidate.clientId,
          type,
          title: item.title,
          date: dateOf(item.date!),
          recurring: type === 'birthday' ? 'yearly' : 'none',
          importance: type === 'client-meeting' ? 'normal' : 'high',
          notes: '',
          reminderRules: DEFAULT_REMINDERS[type] ?? [{ daysBefore: 7 }],
          status: 'upcoming',
          provenance: provenanceOf(item),
        }
        await repositories.events.addEvent(event)
        created.events += 1
        break
      }
      default:
        break
    }
  }

  await repositories.interactions.saveCandidate({
    ...candidate,
    status: 'confirmed',
    resolvedAt: now,
    interactionId,
  })

  /*
   * A confirmed meeting closes with its baseline: the record as it stands
   * now, promises and events of the meeting included, kept for the next
   * preparation to compare against. Any other interaction leaves the
   * baseline alone.
   */
  if (interaction.type === 'meeting') {
    await captureMeetingSnapshot(
      context,
      candidate.clientId,
      interactionId,
      interaction.date,
    )
  }
  return { ok: true, interactionId, created }
}

function firstSentence(text: string): string {
  const sentence = text.split(/(?<=[.!?])\s+|\n+/)[0] ?? text
  return sentence.trim().slice(0, 120)
}

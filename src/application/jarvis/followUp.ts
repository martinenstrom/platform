/**
 * The conversation's own continuations, answered from the last answer and
 * nothing else: "ta resten också", "utveckla punkt två", "vad bygger du det
 * på". No evidence service is read again — the earlier answer already
 * carried its items, its sources and the records they rest on; a
 * continuation re-arranges that, it derives nothing new.
 *
 * What a spoken answer covers first is a presentation choice (the lead
 * items); the application only needs the same number, so "the rest" starts
 * where the voice stopped. SPOKEN_LEAD_ITEMS is that number, stated once.
 */

import type { JarvisAnswer, JarvisItem, JarvisSection } from './answer'

/** How many items of the lead section a spoken answer says before offering the rest. */
export const SPOKEN_LEAD_ITEMS = 3

/** Every item of an answer in the order it is read: section by section. */
export function itemsInOrder(
  answer: JarvisAnswer,
): { section: JarvisSection; item: JarvisItem }[] {
  return answer.sections.flatMap((section) =>
    section.items.map((item) => ({ section, item })),
  )
}

/** True when a continuation can continue this answer: it is a grounded answer about the same subject. */
export function canContinue(
  previous: JarvisAnswer | null,
  subjectId: string | null,
): previous is JarvisAnswer {
  if (!previous) return false
  if (previous.intent.startsWith('FOLLOW_UP'))
    return canContinueChain(previous, subjectId)
  return subjectId === null || previous.about.id === subjectId
}

function canContinueChain(previous: JarvisAnswer, subjectId: string | null): boolean {
  return subjectId === null || previous.about.id === subjectId
}

/** The rest: the lead section past what was spoken, then every other section, as its own answer. */
export function restOf(previous: JarvisAnswer, askedAt: string): JarvisAnswer {
  const [lead, ...others] = previous.sections
  const sections: JarvisSection[] = [
    ...(lead ? [{ key: lead.key, items: lead.items.slice(SPOKEN_LEAD_ITEMS) }] : []),
    ...others,
  ].filter((section) => section.items.length > 0)
  return continuation(previous, 'FOLLOW_UP_MORE', sections, askedAt)
}

/** One item, 1-based in reading order, as its own answer; null when there is no such item. */
export function itemOf(
  previous: JarvisAnswer,
  index: number,
  askedAt: string,
): JarvisAnswer | null {
  const entry = itemsInOrder(previous)[index - 1]
  if (!entry) return null
  return continuation(
    previous,
    'FOLLOW_UP_ITEM',
    [{ key: entry.section.key, items: [entry.item] }],
    askedAt,
  )
}

/** The evidence: no items, the same sources, so the surface can list them and the voice can name them. */
export function evidenceOf(previous: JarvisAnswer, askedAt: string): JarvisAnswer {
  return continuation(previous, 'FOLLOW_UP_EVIDENCE', [], askedAt)
}

function continuation(
  previous: JarvisAnswer,
  intent: JarvisAnswer['intent'],
  sections: JarvisSection[],
  askedAt: string,
): JarvisAnswer {
  const { opens: _opens, emphasis: _emphasis, ...rest } = previous
  return {
    ...rest,
    intent,
    continues: previous.continues ?? previous.intent,
    sections,
    actions: previous.actions.filter((action) => action.kind !== 'open-meeting-pack'),
    askedAt,
  }
}

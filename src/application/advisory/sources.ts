/**
 * Every record a Client 360 view holds, addressable by id as a source — so
 * an answer, a pack or a page can name the evidence it rests on in the
 * record's own words, once, from one index.
 */

import type { Client360 } from './client360'

export type SourceType =
  | 'interaction'
  | 'commitment'
  | 'liability'
  | 'event'
  | 'portfolio'
  | 'holding'
  | 'meeting-snapshot'
  | 'context'
  | 'goal'
  | 'opportunity'
  | 'asset'
  | 'sentinel-priority'
  | 'market-event'
  | 'relationship-health'
  /** One change to the book, as the lifecycle recorded it. */
  | 'lifecycle-event'
  | 'client'

export interface RecordSource {
  id: string
  type: SourceType
  /** The record's own title or statement. */
  label: string
  date: string | null
}

/** Every record the view holds, by id, as a source. */
export function sourceIndex(view: Client360): Map<string, RecordSource> {
  const index = new Map<string, RecordSource>()
  const put = (id: string, type: SourceType, label: string, date: string | null) =>
    index.set(id, { id, type, label, date })
  for (const c of view.commitments)
    put(c.id, 'commitment', c.title, c.dueDate ?? c.createdAt)
  for (const e of view.upcomingEvents) put(e.id, 'event', e.title, e.occursOn)
  for (const l of view.liabilities)
    put(l.id, 'liability', l.title, l.maturityDate ?? l.valuedAt)
  for (const g of view.goals) put(g.id, 'goal', g.title, g.assessedAt)
  for (const f of view.contextFacts) put(f.id, 'context', f.statement, f.statusAt)
  for (const i of view.interactions) put(i.id, 'interaction', i.title, i.date)
  for (const a of view.assets) put(a.id, 'asset', a.title, a.valuedAt)
  for (const o of view.opportunities) put(o.id, 'opportunity', o.title, o.expectedDate)
  if (view.portfolio) {
    put(view.portfolio.id, 'portfolio', 'Portföljen', view.portfolio.valuedAt)
    for (const h of view.portfolio.holdings)
      put(h.id, 'holding', h.name, view.portfolio.valuedAt)
  }
  for (const m of view.marketImpacts)
    put(m.event.id, 'market-event', m.event.label, m.event.firstSeenAt)
  for (const m of view.recentMarketHistory)
    put(
      m.impact.event.id,
      'market-event',
      m.impact.event.label,
      m.impact.event.firstSeenAt,
    )
  put(view.client.id, 'client', view.client.displayName, null)
  return index
}

/** Display titles for every record id the view holds. */
export function titlesOf(view: Client360): Record<string, string> {
  const titles: Record<string, string> = {}
  for (const [id, source] of sourceIndex(view)) titles[id] = source.label
  return titles
}

/** A source for an id the index does not hold, where the id's shape says what it is. */
export function fallbackSource(id: string): RecordSource | null {
  if (id.startsWith('snap-')) {
    return {
      id,
      type: 'meeting-snapshot',
      label: 'Baslinje från senaste mötet',
      date: null,
    }
  }
  return null
}

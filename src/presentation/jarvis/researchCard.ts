/**
 * The research strip under a researched answer: "JARVIS RESEARCH · 3
 * källor · Data / nyheter t.o.m. 14:40", the support class in words, and
 * the sources behind "Visa källor". Strings are made here, once, so the
 * component renders and never computes.
 */

import type {
  ResearchConfidence,
  SourceType,
} from '~/application/jarvis/research/evidence'
import type { ResearchAnswer } from '~/application/jarvis/research/researchAnswer'
import { conflictSentences } from './researchText'

const TZ = 'Europe/Stockholm'

export interface ResearchSource {
  id: string
  publisher: string
  title: string
  url: string | null
  /** "2 okt. 14:30", or null when the source states no time. */
  publishedAt: string | null
  kind: SourceType
  /** "Officiell källa", "Finansnyheter". */
  kindLabel: string
  /** How many of the answer's claims this source carries. */
  claims: number
}

export interface ResearchCard {
  label: 'JARVIS RESEARCH'
  sourceCount: number
  /** "3 källor", "1 källa", "inga källor". */
  sourcesLabel: string
  /** "Data / nyheter t.o.m. 2 okt. 14:40", or null with nothing to date. */
  asOf: string | null
  confidence: { code: ResearchConfidence; label: string }
  sources: ResearchSource[]
  conflicts: string[]
  /** The honest strip when the web could not be reached. */
  unavailable: boolean
  /** The question's depth, for the strip. */
  depth: 'quick' | 'deep'
}

export const CONFIDENCE_LABELS: Record<ResearchConfidence, string> = {
  STRONG_EVIDENCE: 'Starkt stöd',
  SUPPORTED: 'Stöd i källor',
  MIXED: 'Blandat stöd',
  INSUFFICIENT: 'Otillräckligt underlag',
}

export const SOURCE_KIND_LABELS: Record<SourceType, string> = {
  official: 'Officiell källa',
  'market-data': 'Marknadsdata',
  issuer: 'Bolagskälla',
  government: 'Myndighet',
  news: 'Finansnyheter',
  other: 'Övrig källa',
}

const stamp = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const day = date.toLocaleDateString('sv-SE', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
  })
  const time = date.toLocaleTimeString('sv-SE', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${day} ${time}`
}

/** The strip for a researched answer. */
export function researchCardOf(answer: ResearchAnswer): ResearchCard {
  const withClaims = answer.result.evidence.filter((item) => item.claims.length > 0)
  const sources: ResearchSource[] = [...withClaims]
    .sort((a, b) => a.authority - b.authority)
    .map((item) => ({
      id: item.id,
      publisher: item.publisher,
      title: item.title,
      url: item.url,
      publishedAt: item.publishedAt ? stamp(item.publishedAt) || null : null,
      kind: item.sourceType,
      kindLabel: SOURCE_KIND_LABELS[item.sourceType],
      claims: item.claims.length,
    }))
  const count = sources.length
  return {
    label: 'JARVIS RESEARCH',
    sourceCount: count,
    sourcesLabel:
      count === 0 ? 'inga källor' : count === 1 ? '1 källa' : `${count} källor`,
    asOf: answer.asOf ? `Data / nyheter t.o.m. ${stamp(answer.asOf)}` : null,
    confidence: { code: answer.confidence, label: CONFIDENCE_LABELS[answer.confidence] },
    sources,
    conflicts: conflictSentences(answer),
    unavailable: answer.unavailable,
    depth: answer.query.depth,
  }
}

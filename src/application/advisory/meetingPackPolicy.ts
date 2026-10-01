/**
 * Who may receive what of a Meeting Pack.
 *
 * V1 generates the internal advisor pack only. The distinction is still
 * built now, as a typed classification of every content section, so that
 * an internal deck can never be handed out as client-facing by accident:
 * a future client-facing pack is composed from the shareable sections
 * alone, and the generators refuse any audience they were not built for.
 *
 * Internal: everything that is the firm's judgement or the advisor's own
 * business — relationship health and Sentinel priority, open and overdue
 * promises, opportunities and share-of-wallet, possible objections and
 * talking points, data-quality warnings, JARVIS commentary. Shareable:
 * the client's own facts — identity, the meeting, the balance sheet, the
 * portfolio against the agreed mandate, financing, goals, dated events and
 * the agenda.
 */

import type { MeetingPack, MeetingPackAudience } from './meetingPack'

export type PackClassification = 'internal' | 'shareable'

/** The pack's metadata keys: on every pack, whatever the audience. */
export const PACK_META_KEYS = [
  'audience',
  'depth',
  'generatedAt',
  'dataAsOf',
  'fingerprint',
  'method',
  'titles',
  'outline',
] as const satisfies readonly (keyof MeetingPack)[]

export type PackMetaKey = (typeof PACK_META_KEYS)[number]
export type PackContentKey = Exclude<keyof MeetingPack, PackMetaKey>

/** Every content section, classified. A new section does not compile until it is. */
export const PACK_SECTION_CLASSIFICATION: Readonly<
  Record<PackContentKey, PackClassification>
> = {
  identity: 'shareable',
  meeting: 'shareable',
  provenance: 'shareable',
  readiness: 'internal',
  meetingFocus: 'internal',
  executiveSummary: 'internal',
  topPriorities: 'internal',
  dontForget: 'internal',
  clientSnapshot: 'shareable',
  relationshipHealth: 'internal',
  relationshipContext: 'internal',
  changesSinceLastMeeting: 'internal',
  wealth: 'shareable',
  portfolio: 'shareable',
  strategy: 'shareable',
  liquidity: 'shareable',
  financing: 'shareable',
  commitments: 'internal',
  importantEvents: 'shareable',
  clientConcerns: 'internal',
  goals: 'shareable',
  marketContext: 'internal',
  sentinelContext: 'internal',
  possibleClientQuestions: 'internal',
  advisorQuestions: 'internal',
  opportunities: 'internal',
  risks: 'internal',
  dataQuality: 'internal',
  meetingObjectives: 'internal',
  agenda: 'shareable',
  materialsToPrepare: 'internal',
  nextSteps: 'internal',
  appendix: 'internal',
  sources: 'internal',
}

export const INTERNAL_SECTION_KEYS: readonly PackContentKey[] = (
  Object.keys(PACK_SECTION_CLASSIFICATION) as PackContentKey[]
).filter((key) => PACK_SECTION_CLASSIFICATION[key] === 'internal')

export const SHAREABLE_SECTION_KEYS: readonly PackContentKey[] = (
  Object.keys(PACK_SECTION_CLASSIFICATION) as PackContentKey[]
).filter((key) => PACK_SECTION_CLASSIFICATION[key] === 'shareable')

/** The audiences a pack can be generated for today. */
export const GENERATABLE_AUDIENCES: readonly MeetingPackAudience[] = ['INTERNAL_ADVISOR']

export function isGeneratable(
  audience: MeetingPackAudience,
): audience is 'INTERNAL_ADVISOR' {
  return GENERATABLE_AUDIENCES.includes(audience)
}

export type ShareableKey = Extract<
  PackContentKey,
  | 'identity'
  | 'meeting'
  | 'provenance'
  | 'clientSnapshot'
  | 'wealth'
  | 'portfolio'
  | 'strategy'
  | 'liquidity'
  | 'financing'
  | 'importantEvents'
  | 'goals'
  | 'agenda'
>

/** What a future client-facing pack may carry: the shareable sections and the metadata, nothing internal. */
export type ClientFacingPack = Pick<MeetingPack, ShareableKey | PackMetaKey> & {
  audience: 'FUTURE_CLIENT'
}

/**
 * The pack for an audience. INTERNAL_ADVISOR is the pack as built;
 * FUTURE_CLIENT is the shareable sections only — the internal ones are not
 * blanked, they are absent, so nothing downstream can render them.
 */
export function forAudience(pack: MeetingPack, audience: 'INTERNAL_ADVISOR'): MeetingPack
export function forAudience(
  pack: MeetingPack,
  audience: 'FUTURE_CLIENT',
): ClientFacingPack
export function forAudience(
  pack: MeetingPack,
  audience: MeetingPackAudience,
): MeetingPack | ClientFacingPack {
  if (audience === 'INTERNAL_ADVISOR') return { ...pack, audience }
  const out: Record<string, unknown> = { audience }
  for (const key of [...PACK_META_KEYS, ...SHAREABLE_SECTION_KEYS]) {
    if (key === 'audience') continue
    out[key] = pack[key]
  }
  return out as ClientFacingPack
}

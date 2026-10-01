/**
 * The only door between the browser and the relationship record.
 *
 * Every client surface reads through here and writes through here, exactly
 * as the institution's surfaces do through `infrastructure/analysis/serverFns`.
 * The fitness rule `no-ui-import-of-infrastructure` allows a component to
 * import this module and nothing else in the layer, so the repositories, the
 * seed and the clock never reach the client bundle.
 *
 * One function per act; refusals are bounded codes, never free text; one
 * context per server process so a confirmed update survives the next page
 * load.
 */

import { createServerFn } from '@tanstack/react-start'
import {
  askAboutClient,
  type AskAboutClientResult,
} from '~/application/advisory/askAboutClient'
import { client360, type Client360 } from '~/application/advisory/client360'
import {
  clientDirectory,
  type ClientDirectory,
} from '~/application/advisory/clientDirectory'
import { officeBook, type OfficeBookView } from '~/application/advisory/officeBook'
import {
  completeCommitment,
  type CompleteCommitmentResult,
} from '~/application/advisory/completeCommitment'
import {
  confirmClientUpdate,
  type ConfirmClientUpdateResult,
  type ItemDecision,
} from '~/application/advisory/confirmClientUpdate'
import {
  marketImpactBrief,
  type MarketImpactBrief,
} from '~/application/advisory/marketImpact'
import {
  askBeforeMeeting,
  meetingCockpit,
  type AskBeforeMeetingInput,
  type AskBeforeMeetingResult,
  type MeetingCockpit,
} from '~/application/advisory/meetingCockpit'
import {
  meetingPack,
  type MeetingPack,
  type MeetingPackDepth,
} from '~/application/advisory/meetingPack'
import type { GenerateMeetingPackResult } from '~/infrastructure/documents/generateMeetingPack'
import type {
  GeneratedPackMeta,
  PackFormat,
} from '~/infrastructure/documents/meetingPackStore'
import {
  disposePriority,
  sentinelBrief,
  type DisposeInput,
  type DisposeResult,
  type SentinelBrief,
} from '~/application/advisory/sentinel'
import type { AdvisoryContext } from '~/application/advisory/ports'
import {
  recordClientUpdate,
  type RecordClientUpdateResult,
} from '~/application/advisory/recordClientUpdate'
import type { Importance, InteractionSource, InteractionType } from '~/domain/advisory'
import { FakeClock, systemClock, type Clock } from '~/domain/shared/clock'

export type AdvisoryReadFailure = 'NOT_FOUND' | 'SERVICE_UNAVAILABLE'

let cached: AdvisoryContext | null = null

/**
 * The market source module, loaded by each handler with a dynamic import
 * written inside its own body. The type is erased; the import expression is
 * what the client build strips. A helper wrapping that expression at module
 * level would put the market-data container — and the MCP stdio client
 * behind it — into the browser bundle, as `containerInstance.ts` records.
 */
type MarketSourceModule = typeof import('./marketSource')
type LoadMarketSource = () => Promise<MarketSourceModule>

/**
 * The clock the synthetic record is seeded and read against.
 *
 * The seed is built relative to the clock's date, so the demonstration stays
 * alive on any day. A demonstration or a screenshot that must not drift sets
 * `ADVISORY_REFERENCE_DATE=YYYY-MM-DD` and gets a clock pinned to that
 * morning; otherwise the system clock. Tests never come through here: they
 * build the context with a `FakeClock` directly.
 *
 * The context lives for the server process. What the advisor confirms stays
 * across page loads and vanishes when the process restarts — a synthetic
 * store, not persistence (TD-104).
 */
function advisoryClock(): Clock {
  const reference = process.env.ADVISORY_REFERENCE_DATE?.trim()
  if (reference && /^\d{4}-\d{2}-\d{2}$/.test(reference)) {
    return new FakeClock(`${reference}T09:00:00.000Z`)
  }
  return systemClock
}

/**
 * The one advisory context of the process, for the other doors that answer
 * from the record — JARVIS's typed line. Called inside a handler body only,
 * with the market source loader the caller imports dynamically there.
 */
export function advisoryContext(
  loadMarketSource: LoadMarketSource,
): Promise<AdvisoryContext> {
  return getContext(loadMarketSource)
}

async function getContext(loadMarketSource: LoadMarketSource): Promise<AdvisoryContext> {
  if (cached) return cached
  const [{ createAdvisoryContext }, { createMarketObservationSource }] =
    await Promise.all([import('./container'), loadMarketSource()])
  const clock = advisoryClock()
  cached = createAdvisoryContext(clock, createMarketObservationSource(clock))
  return cached
}

export type ClientDirectoryResponse =
  { ok: true; directory: ClientDirectory } | { ok: false; code: AdvisoryReadFailure }

export const getClientDirectoryFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<ClientDirectoryResponse> => {
    try {
      const context = await getContext(() => import('./marketSource'))
      return { ok: true, directory: await clientDirectory(context) }
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  },
)

export type OfficeBookResponse =
  { ok: true; book: OfficeBookView } | { ok: false; code: AdvisoryReadFailure }

/** One office's book: the directory scoped to the office, or NOT_FOUND when the register has no such office. */
export const getOfficeBookFn = createServerFn({ method: 'POST' })
  .validator((officeId: string) => officeId)
  .handler(async ({ data: officeId }): Promise<OfficeBookResponse> => {
    try {
      const context = await getContext(() => import('./marketSource'))
      const book = await officeBook(context, officeId)
      return book ? { ok: true, book } : { ok: false, code: 'NOT_FOUND' }
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

export type Client360Response =
  { ok: true; view: Client360 } | { ok: false; code: AdvisoryReadFailure }

export const getClient360Fn = createServerFn({ method: 'POST' })
  .validator((clientId: string) => clientId)
  .handler(async ({ data: clientId }): Promise<Client360Response> => {
    try {
      const context = await getContext(() => import('./marketSource'))
      const view = await client360(context, clientId)
      return view ? { ok: true, view } : { ok: false, code: 'NOT_FOUND' }
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

export type MeetingCockpitResponse =
  { ok: true; cockpit: MeetingCockpit } | { ok: false; code: AdvisoryReadFailure }

/** Meeting Cockpit: what the advisor needs for this meeting, read once on the advisory clock. */
export const getMeetingCockpitFn = createServerFn({ method: 'POST' })
  .validator((clientId: string) => clientId)
  .handler(async ({ data: clientId }): Promise<MeetingCockpitResponse> => {
    try {
      const context = await getContext(() => import('./marketSource'))
      const cockpit = await meetingCockpit(context, clientId)
      return cockpit ? { ok: true, cockpit } : { ok: false, code: 'NOT_FOUND' }
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

export type AskBeforeMeetingResponse =
  AskBeforeMeetingResult | { ok: false; code: 'SERVICE_UNAVAILABLE' }

/** A question before the meeting, answered from the cockpit or the relationship memory. */
export const askBeforeMeetingFn = createServerFn({ method: 'POST' })
  .validator((input: AskBeforeMeetingInput) => input)
  .handler(async ({ data }): Promise<AskBeforeMeetingResponse> => {
    try {
      const context = await getContext(() => import('./marketSource'))
      return await askBeforeMeeting(context, data)
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

export interface RecordClientUpdateRequest {
  clientId: string
  noteText: string
  interactionDate?: string
  interactionType?: InteractionType | null
  source?: InteractionSource
  importance?: Importance
}

export type RecordClientUpdateResponse =
  RecordClientUpdateResult | { ok: false; code: 'SERVICE_UNAVAILABLE' }

export const recordClientUpdateFn = createServerFn({ method: 'POST' })
  .validator((input: RecordClientUpdateRequest) => input)
  .handler(async ({ data }): Promise<RecordClientUpdateResponse> => {
    try {
      const context = await getContext(() => import('./marketSource'))
      return await recordClientUpdate(context, data)
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

export interface ConfirmClientUpdateRequest {
  candidateId: string
  decisions: readonly ItemDecision[]
}

export type ConfirmClientUpdateResponse =
  ConfirmClientUpdateResult | { ok: false; code: 'SERVICE_UNAVAILABLE' }

export const confirmClientUpdateFn = createServerFn({ method: 'POST' })
  .validator((input: ConfirmClientUpdateRequest) => input)
  .handler(async ({ data }): Promise<ConfirmClientUpdateResponse> => {
    try {
      const context = await getContext(() => import('./marketSource'))
      return await confirmClientUpdate(context, data)
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

export type CompleteCommitmentResponse =
  CompleteCommitmentResult | { ok: false; code: 'SERVICE_UNAVAILABLE' }

export const completeCommitmentFn = createServerFn({ method: 'POST' })
  .validator((commitmentId: string) => commitmentId)
  .handler(async ({ data: commitmentId }): Promise<CompleteCommitmentResponse> => {
    try {
      const context = await getContext(() => import('./marketSource'))
      return await completeCommitment(context, commitmentId)
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

export type AskAboutClientResponse =
  AskAboutClientResult | { ok: false; code: 'SERVICE_UNAVAILABLE' }

export const askAboutClientFn = createServerFn({ method: 'POST' })
  .validator((input: { clientId: string; question: string }) => input)
  .handler(async ({ data }): Promise<AskAboutClientResponse> => {
    try {
      const context = await getContext(() => import('./marketSource'))
      return await askAboutClient(context, data)
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

/* --------------------------------------------------------------- Sentinel */

export type SentinelBriefResponse =
  { ok: true; brief: SentinelBrief } | { ok: false; code: AdvisoryReadFailure }

/** The morning brief: every client's one priority, ranked, on the advisory clock. */
export const getSentinelBriefFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<SentinelBriefResponse> => {
    try {
      const context = await getContext(() => import('./marketSource'))
      return { ok: true, brief: await sentinelBrief(context) }
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  },
)

/* ------------------------------------------------------- Market-to-Client */

export type MarketImpactResponse =
  { ok: true; brief: MarketImpactBrief } | { ok: false; code: AdvisoryReadFailure }

/**
 * Which clients the market's material moves touch, and why: the same
 * snapshot the dashboard renders, judged against the same record Sentinel
 * reads, on the advisory clock.
 */
export const getMarketImpactFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<MarketImpactResponse> => {
    try {
      const context = await getContext(() => import('./marketSource'))
      return { ok: true, brief: await marketImpactBrief(context) }
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  },
)

export type DisposePriorityResponse =
  DisposeResult | { ok: false; code: 'SERVICE_UNAVAILABLE' }

/** The advisor's word on a priority: reviewed, snoozed until a date, or dismissed. */
export const disposePriorityFn = createServerFn({ method: 'POST' })
  .validator((input: DisposeInput) => input)
  .handler(async ({ data }): Promise<DisposePriorityResponse> => {
    try {
      const context = await getContext(() => import('./marketSource'))
      return await disposePriority(context, data)
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

/* ------------------------------------------------------------ Meeting Pack */

export interface MeetingPackRequest {
  clientId: string
  depth: MeetingPackDepth
}

export type MeetingPackResponse =
  | { ok: true; pack: MeetingPack; versions: GeneratedPackMeta[] }
  | { ok: false; code: AdvisoryReadFailure }

/**
 * The Meeting Pack read model for the preview, with the versions already
 * generated in this process. The store lives behind a dynamic import inside
 * the handler: it reads the file system, and nothing of it may reach the
 * client bundle (the same discipline as the market source).
 */
export const getMeetingPackFn = createServerFn({ method: 'POST' })
  .validator((input: MeetingPackRequest) => input)
  .handler(async ({ data }): Promise<MeetingPackResponse> => {
    try {
      const context = await getContext(() => import('./marketSource'))
      const pack = await meetingPack(context, data.clientId, data.depth)
      if (!pack) return { ok: false, code: 'NOT_FOUND' }
      const { meetingPackStore } =
        await import('~/infrastructure/documents/meetingPackStore')
      return {
        ok: true,
        pack,
        versions: meetingPackStore().listForClient(pack.identity.clientId, pack.depth),
      }
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

export interface GenerateMeetingPackRequest {
  clientId: string
  depth: MeetingPackDepth
  formats: readonly PackFormat[]
}

export type GenerateMeetingPackResponse =
  GenerateMeetingPackResult | { ok: false; code: 'SERVICE_UNAVAILABLE' }

/**
 * Generate the internal advisor pack in the requested formats. The
 * audience is fixed here, on the server: the browser cannot ask for any
 * other, and the generators refuse any other regardless.
 */
export const generateMeetingPackFn = createServerFn({ method: 'POST' })
  .validator((input: GenerateMeetingPackRequest) => input)
  .handler(async ({ data }): Promise<GenerateMeetingPackResponse> => {
    try {
      const context = await getContext(() => import('./marketSource'))
      const [{ generateMeetingPack }, { meetingPackStore }] = await Promise.all([
        import('~/infrastructure/documents/generateMeetingPack'),
        import('~/infrastructure/documents/meetingPackStore'),
      ])
      return await generateMeetingPack(context, meetingPackStore(), {
        clientId: data.clientId,
        depth: data.depth,
        formats: data.formats,
        audience: 'INTERNAL_ADVISOR',
      })
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

export type DownloadMeetingPackResponse =
  | { ok: true; meta: GeneratedPackMeta; base64: string }
  | { ok: false; code: 'NOT_FOUND' | 'SERVICE_UNAVAILABLE' }

/** A generated version's bytes again, by its id; an earlier version is never rewritten. */
export const downloadMeetingPackFn = createServerFn({ method: 'POST' })
  .validator((id: string) => id)
  .handler(async ({ data: id }): Promise<DownloadMeetingPackResponse> => {
    try {
      const { meetingPackStore } =
        await import('~/infrastructure/documents/meetingPackStore')
      const generated = meetingPackStore().get(id)
      if (!generated) return { ok: false, code: 'NOT_FOUND' }
      return {
        ok: true,
        meta: generated.meta,
        base64: generated.bytes.toString('base64'),
      }
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })
